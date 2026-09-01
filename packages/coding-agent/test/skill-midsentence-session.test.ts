/**
 * Integration tests for mid-sentence skill collection through AgentSession.prompt/steer.
 * v2 semantics: the user text keeps `/name args` (name normalized on unique-prefix
 * match), and each skill body is delivered as a SEPARATE follow-up user message in
 * the native `<skill ...>` shape (same turn, collapsible in the TUI).
 * MS3 (multi-invocation): one message PER invocation, and skill blocks are INTERLEAVED
 * with prompt-midsentence extension messages by token position in the user text —
 * certified here with a stub extension mirroring ext v1.6 (plural `messages` + pos).
 * Uses a mock streamFn that captures the messages sent to the (fake) LLM — no API keys.
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent } from "@earendil-works/pi-agent-core";
import {
	type AssistantMessage,
	type AssistantMessageEvent,
	EventStream,
	getModel,
} from "@earendil-works/pi-ai/compat";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentSession } from "../src/core/agent-session.ts";
import { convertToLlm } from "../src/core/messages.ts";
import { AuthStorage } from "../src/core/auth-storage.ts";
import type { ResourceLoader } from "../src/core/resource-loader.ts";
import { type Skill } from "../src/core/skills.ts";
import type { Extension } from "../src/core/extensions/types.ts";
import type { BeforeAgentStartEventResult } from "../src/core/extensions/types.ts";
import { createSyntheticSourceInfo } from "../src/core/source-info.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { createModelRegistry, getModelRuntime } from "./model-runtime-test-utils.ts";
import { createTestResourceLoader } from "./utilities.ts";

class MockAssistantStream extends EventStream<AssistantMessageEvent, AssistantMessage> {
	constructor() {
		super(
			(event) => event.type === "done" || event.type === "error",
			(event) => {
				if (event.type === "done") return event.message;
				if (event.type === "error") return event.error;
				throw new Error("Unexpected event type");
			},
		);
	}
}

function createAssistantMessage(text: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "mock",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

describe("AgentSession mid-sentence skill collection", () => {
	let session: AgentSession;
	let tempDir: string;
	/** All user-role text messages captured across streamFn calls. */
	const capturedUserTexts: string[] = [];
	/** Full ordered message log from the LAST streamFn call (role + text / customType). */
	let capturedLog: Array<{ role: string; text: string; customType?: string }> = [];
	/** When set, a stub extension mirrors prompt-midsentence v1.6 for /alpha and /gamma:
	 *  plural `messages` (one per invocation, details.pos = token offset) + `message`
	 *  joined fallback (must be IGNORED by the MS3 runner) + one foreign no-pos message. */
	let stubBeforeAgentStart: ((prompt: string) => BeforeAgentStartEventResult | undefined) | null = null;
	/** MS4: when set, a stub input handler mirrors the ext v1.7 TRANSFORM (PRE marker
	 *  insertion next to tokens) — the core must then scan marker-laden text. */
	let stubInputTransform: ((text: string) => string) | null = null;

	beforeEach(async () => {
		tempDir = join(tmpdir(), `pi-skill-mid-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		const skillDir = join(tempDir, "skills", "test-skill");
		mkdirSync(skillDir, { recursive: true });
		writeFileSync(
			join(skillDir, "SKILL.md"),
			`---
name: test-skill
description: A test skill for mid-sentence tests.
---

# Test Skill

Skill instructions here.
`,
		);

		const skill: Skill = {
			name: "test-skill",
			description: "A test skill for mid-sentence tests.",
			filePath: join(skillDir, "SKILL.md"),
			baseDir: skillDir,
			sourceInfo: createSyntheticSourceInfo(join(skillDir, "SKILL.md"), { source: "test" }),
			disableModelInvocation: false,
		};

		const otherDir = join(tempDir, "skills", "other-skill");
		mkdirSync(otherDir, { recursive: true });
		writeFileSync(
				join(otherDir, "SKILL.md"),
			"---\nname: other-skill\ndescription: Another test skill.\n---\n\n# Other Skill\n\nOther instructions.\n",
		);
		const otherSkill: Skill = {
			name: "other-skill",
			description: "Another test skill.",
			filePath: join(otherDir, "SKILL.md"),
			baseDir: otherDir,
			sourceInfo: createSyntheticSourceInfo(join(otherDir, "SKILL.md"), { source: "test" }),
			disableModelInvocation: false,
		};

		const stubExtension: Extension = {
			path: "stub-ms3",
			resolvedPath: "stub-ms3",
			sourceInfo: createSyntheticSourceInfo("stub-ms3", { source: "test" }),
			handlers: new Map([
				[
					"input",
					[
						(event: { text?: string }) => {
							const out = stubInputTransform?.(event.text ?? "");
							return out !== undefined && out !== event.text
								? { action: "transform", text: out }
								: { action: "continue" };
						},
					],
				],
				[
					"before_agent_start",
					[
						async (event: { prompt?: string }) =>
							stubBeforeAgentStart?.(event.prompt ?? "") ?? undefined,
					],
				],
			]),
			tools: new Map(),
			messageRenderers: new Map(),
			commands: new Map(),
			flags: new Map(),
			shortcuts: new Map(),
		};

		const baseLoader = createTestResourceLoader();
		const resourceLoader: ResourceLoader = {
			...baseLoader,
			getSkills: () => ({ skills: [skill, otherSkill], diagnostics: [] }),
			getExtensions: () => ({ ...baseLoader.getExtensions(), extensions: [stubExtension] }),
		};

		const model = getModel("anthropic", "claude-sonnet-4-5")!;
		const agent = new Agent({
			getApiKey: () => "test-key",
			initialState: {
				model,
				systemPrompt: "Test",
				tools: [],
			},
			convertToLlm,
			streamFn: (_model, context) => {
				capturedLog = context.messages.map((msg) => {
					if (msg.role === "user") {
						return { role: "user", text: msg.content.filter((p) => p.type === "text").map((p) => p.text).join("\n") };
					}
					const cm = msg as { role: string; customType?: string; content: unknown };
						const text =
							typeof cm.content === "string"
								? cm.content
								: Array.isArray(cm.content)
									? cm.content
											.filter((p: { type: string; text?: string }) => p && p.type === "text")
											.map((p: { text?: string }) => p.text ?? "")
											.join("\n")
									: "";
					return { role: cm.role, text, customType: cm.customType };
				});
				for (const msg of context.messages) {
					if (msg.role === "user") {
						for (const part of msg.content) {
							if (part.type === "text") capturedUserTexts.push(part.text);
						}
					}
				}
				const stream = new MockAssistantStream();
				queueMicrotask(() => {
					stream.push({ type: "start", partial: createAssistantMessage("") });
					stream.push({ type: "done", message: createAssistantMessage("ok") });
				});
				return stream;
			},
		});

		const sessionManager = SessionManager.inMemory();
		const settingsManager = SettingsManager.create(tempDir, tempDir);
		const authStorage = AuthStorage.create(join(tempDir, "auth.json"));
		const modelRegistry = await createModelRegistry(authStorage, tempDir);
		await authStorage.modify("anthropic", async () => ({ type: "api_key", key: "test-key" }));

		session = new AgentSession({
			agent,
			sessionManager,
			settingsManager,
			cwd: tempDir,
			modelRuntime: getModelRuntime(modelRegistry),
			resourceLoader,
		});
	});

	afterEach(async () => {
		capturedUserTexts.length = 0;
		capturedLog = [];
		stubBeforeAgentStart = null;
		stubInputTransform = null;
		if (session) {
			session.dispose();
		}
		if (tempDir && existsSync(tempDir)) {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	it("keeps the token in the user text and sends the body as a separate message (prompt)", async () => {
		await session.prompt("prima fai X\npoi /test-skill arg1 arg2 e dimmi");

		expect(capturedUserTexts).toHaveLength(2);
		const [userText, blockMessage] = capturedUserTexts;
		expect(userText).toBe("prima fai X\npoi /test-skill arg1 arg2 e dimmi");
		expect(blockMessage!.startsWith('<skill name="test-skill"')).toBe(true);
		expect(blockMessage).toContain("Skill instructions here.");
		expect(blockMessage).toContain("\n\narg1 arg2 e dimmi");
	});

	it("normalizes a unique-prefix name in the text, body still separate", async () => {
		await session.prompt("usa /test-skil questi");

		expect(capturedUserTexts).toHaveLength(2);
		expect(capturedUserTexts[0]).toBe("usa /test-skill questi");
		expect(capturedUserTexts[1]!.startsWith('<skill name="test-skill"')).toBe(true);
	});

	it("keeps native /skill:name at input start working (single inline message)", async () => {
		await session.prompt("/skill:test-skill arg1");

		expect(capturedUserTexts).toHaveLength(1);
		const text = capturedUserTexts[0]!;
		expect(text.startsWith('<skill name="test-skill"')).toBe(true);
		expect(text).toContain("\n\narg1");
	});

	it("does not expand path-like or fraction slashes", async () => {
		await session.prompt("guarda C:/x e anche n/d ok");

		expect(capturedUserTexts).toHaveLength(1);
		expect(capturedUserTexts[0]).toBe("guarda C:/x e anche n/d ok");
	});

	it("collects mid-sentence skills in steer() (text kept, body queued separately)", async () => {
		await session.prompt("parti");
		await session.steer("poi ancora /test-skill due");
		await session.prompt("vai");

		const steerText = capturedUserTexts.find((t) => t === "poi ancora /test-skill due");
		expect(steerText).toBeDefined();
		const steerBlock = capturedUserTexts.find((t) => t.startsWith('<skill name="test-skill"') && t.includes("\n\ndue"));
		expect(steerBlock).toBeDefined();
		expect(capturedUserTexts).toContain("vai");
	});

	it("MS3: two skills in one message → two separate block messages in text order", async () => {
		await session.prompt("intro\nprima /test-skill uno\npoi /other-skill due\nfine");

		expect(capturedUserTexts).toHaveLength(3);
		expect(capturedUserTexts[0]).toBe("intro\nprima /test-skill uno\npoi /other-skill due\nfine");
		expect(capturedUserTexts[1]!.startsWith('<skill name="test-skill"')).toBe(true);
		expect(capturedUserTexts[1]).toContain("\n\nuno");
		expect(capturedUserTexts[2]!.startsWith('<skill name="other-skill"')).toBe(true);
		expect(capturedUserTexts[2]).toContain("\n\ndue");
	});

	it("MS3: mixed skill+prompt tokens interleave by text position (stub ext mirrors v1.6)", async () => {
		const input = "intro\nusa /alpha x\npoi /test-skill y\ne /gamma z fine";
		stubBeforeAgentStart = (prompt) => {
			const messages: NonNullable<BeforeAgentStartEventResult["messages"]> = [];
			for (const name of ["alpha", "gamma"]) {
				const pos = prompt.indexOf(`/${name}`);
				if (pos > 0 && /\s/.test(prompt[pos - 1]!)) {
					messages.push({
						customType: "prompt-midsentence",
						content: `BODY ${name.toUpperCase()}`,
						display: true,
						details: { names: [name], pos },
					});
				}
			}
			// foreign extension message without pos → sorts last, arrival order
			messages.push({ customType: "foreign-ext", content: "FOREIGN", display: true, details: {} });
			return {
				// v1.5 joined fallback: the MS3 runner must IGNORE it when `messages` is set
				message: { customType: "prompt-midsentence", content: "JOINED FALLBACK", display: true, details: { names: ["fallback"] } },
				messages,
			};
		};

		await session.prompt(input);

		const idx = capturedLog.findIndex((e) => e.role === "user" && e.text === input);
		expect(idx).toBeGreaterThanOrEqual(0);
		const tail = capturedLog.slice(idx + 1, idx + 5);
		expect(tail).toHaveLength(4);
		// global order by token position: alpha (prompt, custom) → test-skill (skill,
		// user block) → gamma (prompt, custom) → foreign (no pos, last)
		expect(tail[0]).toMatchObject({ role: "user", text: "BODY ALPHA" });
		expect(tail[1]!.role).toBe("user");
		expect(tail[1]!.text.startsWith('<skill name="test-skill"')).toBe(true);
		expect(tail[2]).toMatchObject({ role: "user", text: "BODY GAMMA" });
		expect(tail[3]).toMatchObject({ role: "user", text: "FOREIGN" });
		// the joined fallback must NOT be emitted (runner prefers plural `messages`)
		expect(capturedLog.some((e) => e.text.includes("JOINED FALLBACK"))).toBe(false);
	});

	// ── MS4: unified resolution + PRE markers through the real prompt() pipeline ──

	it("MS4 BOTH: same token queued as prompt custom AND skill block (tie pos, zero ghost)", async () => {
		const input = "intro\nusa /test-skill y";
		// stub mirrors ext v1.7: /test-skill resolves on BOTH registries → marker + custom
		stubInputTransform = (text) => text.replace("/test-skill y", "/test-skill [→ prompt: test-skill · skill: test-skill] y");
		stubBeforeAgentStart = (prompt) => {
			const pos = prompt.indexOf("/test-skill");
			return pos > 0
				? {
						messages: [
							{
								customType: "prompt-midsentence",
								content: "BODY TEST-SKILL",
								display: true,
								details: { names: ["test-skill"], pos },
							},
						],
					}
				: undefined;
		};

		await session.prompt(input);

		const expected = "intro\nusa /test-skill [→ prompt: test-skill · skill: test-skill] y";
		expect(capturedUserTexts[0]).toBe(expected); // marker visible, args intatti
		// ENTRAMBI in coda: blocco skill + custom prompt, ordine tie-pos (skill prima, stable)
		const block = capturedUserTexts.find((t) => t.startsWith('<skill name="test-skill"'));
		expect(block).toBeDefined();
		expect(block!.endsWith("</skill>\n\ny")).toBe(true); // marker NON negli args
		const custom = capturedLog.find((e) => e.text === "BODY TEST-SKILL");
		expect(custom).toMatchObject({ role: "user", text: "BODY TEST-SKILL" }); // custom→user via convertToLlm
		const blockIdx = capturedLog.findIndex((e) => e.role === "user" && e.text.startsWith('<skill name="test-skill"'));
		const customIdx = capturedLog.findIndex((e) => e.text === "BODY TEST-SKILL");
		expect(blockIdx).toBeGreaterThan(-1);
		expect(customIdx).toBeGreaterThan(blockIdx); // tie → skill block, poi custom
	});

	it("MS4 mixed line prompt+skill with text after: pos order, zero ghost", async () => {
		const input = "intro\na /alpha x poi /test-skill y\nfine";
		// stub v1.7: /alpha = prompt-only (marker, custom), /test-skill = skill-only
		// (marker, silent) — alpha e' list-member BARE (sibling avanti), test-skill e'
		// l'ultimo della riga → args a fine riga (`y`)
		stubInputTransform = (text) =>
			text
				.replace("/alpha x", "/alpha [→ prompt: alpha] x")
				.replace("/test-skill y", "/test-skill [→ skill: test-skill] y");
		stubBeforeAgentStart = (prompt) => {
			const pos = prompt.indexOf("/alpha");
			return pos > 0
				? {
						messages: [
							{ customType: "prompt-midsentence", content: "BODY ALPHA", display: true, details: { names: ["alpha"], pos } },
						],
					}
				: undefined;
		};

		await session.prompt(input);

		const expected =
			"intro\na /alpha [→ prompt: alpha] x poi /test-skill [→ skill: test-skill] y\nfine";
		expect(capturedUserTexts[0]).toBe(expected);
		// ordine globale per posizione: alpha (custom) prima del blocco test-skill
		const customIdx = capturedLog.findIndex((e) => e.text === "BODY ALPHA");
		const blockIdx = capturedLog.findIndex((e) => e.role === "user" && e.text.startsWith('<skill name="test-skill"'));
		expect(customIdx).toBeGreaterThan(-1);
		expect(blockIdx).toBe(customIdx + 1);
		// ZERO GHOST: alpha e' list-member bare (nessuna coda), test-skill e' l'ULTIMO
		// token della riga → args = `y` (fine riga, semantica certificata); `fine` (riga
		// DOPO) e la prosa `x poi` restano nel testo utente, MAI nel blocco
		const block = capturedUserTexts.find((t) => t.startsWith('<skill name="test-skill"'))!;
		expect(block.endsWith("</skill>\n\ny")).toBe(true);
		expect(block).not.toContain("fine");
		expect(block).not.toContain("x poi");
	});

	it("MS4 SKILL-ONLY: ext silent (no custom), core expands bare name, marker chrome only", async () => {
		const input = "usa /test-skill y";
		stubInputTransform = (text) => text.replace("/test-skill y", "/test-skill [→ skill: test-skill] y");

		await session.prompt(input);

		expect(capturedUserTexts[0]).toBe("usa /test-skill [→ skill: test-skill] y");
		expect(capturedUserTexts[1]!.startsWith('<skill name="test-skill"')).toBe(true);
		expect(capturedUserTexts[1]!.endsWith("</skill>\n\ny")).toBe(true);
		// ext SILENT: nessun corpo prompt in coda (solo user text + blocco skill)
		expect(capturedUserTexts).toHaveLength(2);
	});

	it("MS4 NEITHER: unknown name is left verbatim, nothing queued", async () => {
		const input = "usa /mx-rail y";
		await session.prompt(input);
		expect(capturedUserTexts).toHaveLength(1);
		expect(capturedUserTexts[0]).toBe(input);
	});
});
