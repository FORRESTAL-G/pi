/**
 * Integration tests for mid-sentence skill expansion through AgentSession.prompt/steer.
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
import { AuthStorage } from "../src/core/auth-storage.ts";
import type { ResourceLoader } from "../src/core/resource-loader.ts";
import { type Skill } from "../src/core/skills.ts";
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

describe("AgentSession mid-sentence skill expansion", () => {
	let session: AgentSession;
	let tempDir: string;
	/** All user-role text messages captured across streamFn calls. */
	const capturedUserTexts: string[] = [];

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

		const baseLoader = createTestResourceLoader();
		const resourceLoader: ResourceLoader = {
			...baseLoader,
			getSkills: () => ({ skills: [skill], diagnostics: [] }),
		};

		const model = getModel("anthropic", "claude-sonnet-4-5")!;
		const agent = new Agent({
			getApiKey: () => "test-key",
			initialState: {
				model,
				systemPrompt: "Test",
				tools: [],
			},
			streamFn: (_model, context) => {
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
		if (session) {
			session.dispose();
		}
		if (tempDir && existsSync(tempDir)) {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	it("expands a mid-sentence skill in prompt()", async () => {
		await session.prompt("prima fai X\npoi /test-skill arg1 arg2 e dimmi");

		expect(capturedUserTexts).toHaveLength(1);
		const text = capturedUserTexts[0]!;
		expect(text.startsWith("prima fai X\npoi <skill name=\"test-skill\"")).toBe(true);
		expect(text).toContain("Skill instructions here.");
		expect(text).toContain("\n\narg1 arg2 e dimmi");
	});

	it("keeps native /skill:name at input start working", async () => {
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

	it("expands mid-sentence skills in steer()", async () => {
		await session.prompt("parti");
		await session.steer("poi ancora /test-skill due");
		await session.prompt("vai");

		const steerText = capturedUserTexts.find((t) => t.includes("poi ancora"));
		expect(steerText).toBeDefined();
		expect(steerText!.startsWith("poi ancora <skill name=\"test-skill\"")).toBe(true);
		expect(steerText).toContain("\n\ndue");
		expect(capturedUserTexts).toContain("vai");
	});
});
