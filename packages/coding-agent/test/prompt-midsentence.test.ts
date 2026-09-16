/**
 * MS5 tests: mid-sentence prompt-template invocation in the CORE.
 *
 * Contract (owner mandate, BRIEF-MS5):
 * - the user message arrives VERBATIM: pre-text + trigger + args, byte-per-byte
 *   (zero rewrites, zero inline markers, zero substitutions — even a unique-prefix
 *   name stays written as typed)
 * - the RAW template body (placeholders NOT substituted) is delivered immediately
 *   after, in the SAME turn, as a separate message (skill-block delivery semantics)
 * - args (multi-line included) live ONLY in the user message
 * - unresolvable trigger: text untouched (fail-soft)
 * - core-self-sufficient: with the prompt-midsentence extension enabled, the core
 *   strips its PRE markers on resolved tokens and drops its duplicate bodies.
 */

import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent } from "@earendil-works/pi-agent-core";
import {
	type AssistantMessage,
	type AssistantMessageEvent,
	EventStream,
	getModel,
	type ImageContent,
	type TextContent,
} from "@earendil-works/pi-ai/compat";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentSession } from "../src/core/agent-session.ts";
import { AuthStorage } from "../src/core/auth-storage.ts";
import type { BeforeAgentStartEventResult, Extension } from "../src/core/extensions/types.ts";
import { convertToLlm } from "../src/core/messages.ts";
import { expandPromptMidsentence, type PromptTemplate } from "../src/core/prompt-templates.ts";
import type { ResourceLoader } from "../src/core/resource-loader.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { createSyntheticSourceInfo } from "../src/core/source-info.ts";
import { createModelRegistry, getModelRuntime } from "./model-runtime-test-utils.ts";
import { createTestResourceLoader } from "./utilities.ts";

// ────────────────────────── unit: expandPromptMidsentence ──────────────────────────

function makeTemplate(name: string, content: string): PromptTemplate {
	return {
		name,
		description: "test template",
		content,
		filePath: `/prompts/${name}.md`,
		sourceInfo: createSyntheticSourceInfo(`/prompts/${name}.md`, { source: "test" }),
	};
}

/** RAW template body with placeholders — `\${` escapes biome's noTemplateCurlyInString. */
const RAW_BODY = `BODY $@ $1 \${@:2} raw`;

/** Join a user message content (string or parts) into its model-visible text. */
function userTextOf(content: string | (TextContent | ImageContent)[]): string {
	const parts = typeof content === "string" ? [{ type: "text" as const, text: content }] : content;
	return parts
		.filter((part): part is TextContent => part.type === "text")
		.map((part) => part.text)
		.join("\n");
}

const TPL = makeTemplate("mio-trigger", RAW_BODY);
const TPL_OTHER = makeTemplate("other-trigger", "OTHER BODY");
const TEMPLATES = [TPL, TPL_OTHER];

describe("expandPromptMidsentence", () => {
	it("keeps the user text byte-per-byte and returns the RAW body as a block", () => {
		const input = "ciao /mio-trigger e poi altre cose\nseconda riga";
		const result = expandPromptMidsentence(input, TEMPLATES);

		expect(result.text).toBe(input);
		expect(result.blocks).toHaveLength(1);
		expect(result.blocks[0]!.name).toBe("mio-trigger");
		// placeholders NOT substituted, args NOT appended
		expect(result.blocks[0]!.message).toBe(RAW_BODY);
		// multi-line args stay ONLY in the user text
		expect(result.blocks[0]!.message).not.toContain("seconda riga");
		expect(result.missing).toHaveLength(0);
	});

	it("records the token position for interleaving", () => {
		const input = "uno /mio-trigger x";
		const result = expandPromptMidsentence(input, TEMPLATES);
		expect(result.blocks[0]!.pos).toBe(input.indexOf("/mio-trigger"));
	});

	it("leaves an unknown name untouched and reports it", () => {
		const input = "ciao /nope x";
		const result = expandPromptMidsentence(input, TEMPLATES);
		expect(result.text).toBe(input);
		expect(result.blocks).toHaveLength(0);
		expect(result.missing).toEqual(["nope"]);
	});

	it("resolves a unique prefix but keeps the typed name in the text", () => {
		const input = "usa /mio-trig arg";
		const result = expandPromptMidsentence(input, TEMPLATES);
		expect(result.text).toBe(input);
		expect(result.blocks).toEqual([{ name: "mio-trigger", message: TPL.content, pos: input.indexOf("/mio-trig") }]);
	});

	it("does not resolve an ambiguous prefix", () => {
		const result = expandPromptMidsentence("x /other x", [
			makeTemplate("other-a", "A"),
			makeTemplate("other-b", "B"),
		]);
		expect(result.blocks).toHaveLength(0);
		expect(result.missing).toEqual(["other"]);
	});

	it("resolves a unique case-insensitive variant without rewriting the text", () => {
		const input = "usa /MIO-TRIGGER x";
		const result = expandPromptMidsentence(input, TEMPLATES);
		expect(result.text).toBe(input);
		expect(result.blocks[0]!.name).toBe("mio-trigger");
	});

	it("never triggers on position 0 (first line is native)", () => {
		const input = "/mio-trigger args";
		const result = expandPromptMidsentence(input, TEMPLATES);
		expect(result.text).toBe(input);
		expect(result.blocks).toHaveLength(0);
	});

	it("never triggers on path-like or fraction slashes", () => {
		const input = "guarda C:/mio-trigger e n/d e a/b";
		const result = expandPromptMidsentence(input, TEMPLATES);
		expect(result.text).toBe(input);
		expect(result.blocks).toHaveLength(0);
	});

	it("leaves /? untouched (discovery stays with skills/extension)", () => {
		const input = "cosa c'e /? qui";
		const result = expandPromptMidsentence(input, TEMPLATES);
		expect(result.text).toBe(input);
		expect(result.blocks).toHaveLength(0);
	});

	it("strips an extension PRE marker next to a resolved token", () => {
		const input = "ciao /mio-trigger [→ prompt: mio-trigger] e args";
		const result = expandPromptMidsentence(input, TEMPLATES);
		expect(result.text).toBe("ciao /mio-trigger e args");
		expect(result.blocks).toHaveLength(1);
	});

	it("keeps the marker next to a token the core does not resolve (extension-only)", () => {
		const input = "ciao /pkg-only [→ prompt: pkg-only] x";
		const result = expandPromptMidsentence(input, TEMPLATES);
		expect(result.text).toBe(input);
		expect(result.missing).toEqual(["pkg-only"]);
	});

	it("collects multiple tokens as separate blocks in text order", () => {
		const input = "uno /mio-trigger a\ndue /other-trigger b";
		const result = expandPromptMidsentence(input, TEMPLATES);
		expect(result.text).toBe(input);
		expect(result.blocks.map((b) => b.name)).toEqual(["mio-trigger", "other-trigger"]);
	});
});

// ────────────────────────── session: AgentSession.prompt/steer ──────────────────────────

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

describe("AgentSession mid-sentence prompt delivery (MS5)", () => {
	let session: AgentSession;
	let tempDir: string;
	/** All user-role text messages captured across streamFn calls. */
	const capturedUserTexts: string[] = [];
	/** Full ordered message log from the LAST streamFn call (role + text / customType). */
	let capturedLog: Array<{ role: string; text: string; customType?: string }> = [];
	/** Stub extension mirroring prompt-midsentence: input transform (PRE marker) +
	 *  before_agent_start custom bodies. Null handlers = extension disabled. */
	let stubInputTransform: ((text: string) => string) | null = null;
	let stubBeforeAgentStart: ((prompt: string) => BeforeAgentStartEventResult | undefined) | null = null;

	beforeEach(async () => {
		tempDir = join(tmpdir(), `pi-prompt-mid-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });

		const template: PromptTemplate = {
			name: "mio-trigger",
			description: "A test template.",
			content: RAW_BODY,
			filePath: join(tempDir, "mio-trigger.md"),
			sourceInfo: createSyntheticSourceInfo(join(tempDir, "mio-trigger.md"), { source: "test" }),
		};

		const stubExtension: Extension = {
			path: "stub-prompt-midsentence",
			resolvedPath: "stub-prompt-midsentence",
			sourceInfo: createSyntheticSourceInfo("stub-prompt-midsentence", { source: "test" }),
			handlers: new Map<string, ((event: any, ctx: any) => any)[]>([
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
					[async (event: { prompt?: string }) => stubBeforeAgentStart?.(event.prompt ?? "") ?? undefined],
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
			getPrompts: () => ({ prompts: [template], diagnostics: [] }),
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
						return { role: "user", text: userTextOf(msg.content) };
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
						capturedUserTexts.push(userTextOf(msg.content));
					}
				}
				const stream = new MockAssistantStream();
				queueMicrotask(() => {
					stream.push({ type: "start", partial: createAssistantMessage("") });
					stream.push({ type: "done", reason: "stop", message: createAssistantMessage("ok") });
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
		stubInputTransform = null;
		stubBeforeAgentStart = null;
		if (session) {
			session.dispose();
		}
		if (tempDir && existsSync(tempDir)) {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	it("BRIEF test: user message verbatim + RAW body next message, same turn, no third message", async () => {
		const input = "ciao /mio-trigger e poi altre cose\nseconda riga";
		await session.prompt(input);

		// user message = input UNALTERED, byte-per-byte, newline included; args stay in it
		expect(capturedUserTexts).toHaveLength(2);
		expect(capturedUserTexts[0]).toBe(input);
		// next message same turn = RAW template body, placeholders untouched
		expect(capturedUserTexts[1]).toBe(RAW_BODY);
		// no third message, no substitution anywhere
		expect(capturedUserTexts.some((t) => t !== input && t.includes("seconda riga"))).toBe(false);
		expect(capturedUserTexts.some((t) => t.includes("test-key"))).toBe(false);
	});

	it("extension enabled: PRE marker stripped from model text, duplicate ext body dropped", async () => {
		const input = "ciao /mio-trigger con args";
		stubInputTransform = (text) => text.replace("/mio-trigger con", "/mio-trigger [→ prompt: mio-trigger] con");
		stubBeforeAgentStart = () => ({
			messages: [
				{
					customType: "prompt-midsentence",
					content: "EXT SUBSTITUTED BODY",
					display: true,
					details: { names: ["mio-trigger"], pos: input.indexOf("/mio-trigger") },
				},
			],
		});

		await session.prompt(input);

		expect(capturedUserTexts).toHaveLength(2);
		expect(capturedUserTexts[0]).toBe(input); // marker stripped → verbatim restored
		expect(capturedUserTexts[1]).toBe(RAW_BODY); // core raw body, not ext's
		expect(capturedLog.some((e) => e.text.includes("EXT SUBSTITUTED BODY"))).toBe(false);
	});

	it("foreign extension messages survive the MS5 dedupe", async () => {
		const input = "ciao /mio-trigger x";
		stubBeforeAgentStart = () => ({
			messages: [
				{
					customType: "prompt-midsentence",
					content: "EXT BODY",
					display: true,
					details: { names: ["mio-trigger"], pos: 6 },
				},
				{ customType: "foreign-ext", content: "FOREIGN", display: true, details: {} },
			],
		});

		await session.prompt(input);

		// user input + core raw body + FOREIGN (custom → user via convertToLlm)
		expect(capturedUserTexts).toHaveLength(3);
		expect(capturedUserTexts[0]).toBe(input);
		expect(capturedUserTexts[1]).toBe(RAW_BODY);
		expect(capturedLog.some((e) => e.text === "FOREIGN")).toBe(true);
		expect(capturedLog.some((e) => e.text === "EXT BODY")).toBe(false);
	});

	it("unresolvable trigger: text intact, nothing queued (fail-soft)", async () => {
		const input = "ciao /innesco-inesistente x";
		await session.prompt(input);

		expect(capturedUserTexts).toHaveLength(1);
		expect(capturedUserTexts[0]).toBe(input);
	});

	it("unique prefix resolves with the typed name kept in the text", async () => {
		const input = "usa /mio-trig questi argomenti";
		await session.prompt(input);

		expect(capturedUserTexts).toHaveLength(2);
		expect(capturedUserTexts[0]).toBe(input);
		expect(capturedUserTexts[1]).toBe(RAW_BODY);
	});

	it("position-0 native template substitution is unchanged", async () => {
		await session.prompt("/mio-trigger hello world");

		// native expandPromptTemplate: substituted inline, single message
		expect(capturedUserTexts).toHaveLength(1);
		expect(capturedUserTexts[0]).toBe("BODY hello world hello world raw");
	});

	it("steer(): text verbatim, raw body queued as separate message", async () => {
		await session.prompt("parti");
		await session.steer("poi /mio-trigger args steered");
		await session.prompt("vai");

		expect(capturedUserTexts).toContain("poi /mio-trigger args steered");
		expect(capturedUserTexts).toContain(RAW_BODY);
	});
});
