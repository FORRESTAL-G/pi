/**
 * Tests for mid-sentence skill invocation (`/name args` anywhere from line 2 on).
 *
 * Mirrors the semantics documented in the PRD:
 * - word-boundary trigger (whitespace before the slash)
 * - first line is native pi territory (never scanned)
 * - args run to end of line
 * - `/name:` namespace guard (e.g. `/skill:foo` stays literal)
 * - fail-soft on unknown names
 * - `/?` discovery listing
 * - single pass (expansion result is not rescanned)
 */

import { describe, expect, it } from "vitest";
import { expandSkillMidsentence, type Skill } from "../src/core/skills.ts";

const SKILL_BODY = `# Test Skill

Instructions here.
`;

const FILES: Record<string, string> = {
	"/skills/test-skill/SKILL.md": `---
name: test-skill
description: A test skill.
---

${SKILL_BODY}`,
	"/skills/other-skill/SKILL.md": `---
name: other-skill
description: Another skill.
---

# Other Skill

Other instructions.
`,
	"/skills/hidden-skill/SKILL.md": `---
name: hidden-skill
description: Hidden from model invocation but explicitly invocable.
disable-model-invocation: true
---

# Hidden Skill

Hidden instructions.
`,
};

function makeSkill(name: string, filePath: string, files: Record<string, string> = FILES, disableModelInvocation = false): Skill {
	return {
		name,
		description: files[filePath]!.match(/description: (.*)/)![1]!,
		filePath,
		baseDir: filePath.replace("/SKILL.md", ""),
		sourceInfo: { source: "test" } as Skill["sourceInfo"],
		disableModelInvocation,
	};
}

const SKILLS: Skill[] = [
	makeSkill("test-skill", "/skills/test-skill/SKILL.md"),
	makeSkill("other-skill", "/skills/other-skill/SKILL.md"),
	makeSkill("hidden-skill", "/skills/hidden-skill/SKILL.md", FILES, true),
];

const read = (p: string) => {
	if (FILES[p] === undefined) throw new Error("file not found");
	return FILES[p]!;
};

function run(text: string) {
	return expandSkillMidsentence(text, SKILLS, read);
}

const TEST_BLOCK = `<skill name="test-skill" location="/skills/test-skill/SKILL.md">\nReferences are relative to /skills/test-skill.\n\n# Test Skill\n\nInstructions here.\n</skill>`;

describe("expandSkillMidsentence", () => {
	it("expands a mid-sentence skill with args", () => {
		const { text, expanded } = run("fai X poi /test-skill arg1 arg2 e dimmi");
		expect(text).toBe(`fai X poi ${TEST_BLOCK}\n\narg1 arg2 e dimmi`);
		expect(expanded).toEqual(["test-skill"]);
	});

	it("expands a mid-sentence skill without args", () => {
		const { text } = run("prima riga\npoi /test-skill e basta");
		// "e basta" is the args (to end of line)
		expect(text).toBe(`prima riga\npoi ${TEST_BLOCK}\n\ne basta`);
	});

	it("does not trigger without a word boundary (paths, fractions)", () => {
		for (const t of [
			"guarda C:/x/y e dimmi",
			"protocollo :/x",
			"prima a/b poi",
			"vale n/d",
			"3 km/h ok",
		]) {
			expect(run(t).text).toBe(t);
		}
	});

	it("leaves the entire first line to native pi", () => {
		for (const t of [
			"/skill:test-skill args",
			"/test-skill args",
			"/comando qualsiasi cosa",
		]) {
			expect(run(t).text).toBe(t);
			expect(run(`${t}\nseconda riga`).text).toBe(`${t}\nseconda riga`);
		}
	});

	it("takes args to end of line, preserving following lines", () => {
		const { text } = run("usa /test-skill questi args\nriga dopo");
		expect(text).toBe(`usa ${TEST_BLOCK}\n\nquesti args\nriga dopo`);
	});

	it("expands multiple tokens on the same and different lines", () => {
		const { text, expanded } = run("a /test-skill uno\nb /other-skill due");
		expect(text).toContain('<skill name="test-skill"');
		expect(text).toContain('<skill name="other-skill"');
		expect(text).toMatch(/^a <skill/);
		expect(text).toMatch(/\nb <skill/);
		expect(expanded).toEqual(["test-skill", "other-skill"]);
	});

	it("fail-soft: unknown skill leaves text untouched", () => {
		const t = "usa /mx-rail args";
		const { text, expanded, missing } = run(t);
		expect(text).toBe(t);
		expect(expanded).toEqual([]);
		expect(missing).toEqual(["mx-rail"]);
	});

	it("namespace guard: colon after the name stays literal", () => {
		for (const t of [
			"mid /skill:foo args",
			"mid /test-skill:foo args",
		]) {
			expect(run(t).text).toBe(t);
		}
	});

	it("name must end at a boundary (no prefix matching)", () => {
		const t = "usa /test-skill2 ora";
		const { text, missing } = run(t);
		expect(text).toBe(t);
		expect(missing).toEqual(["test-skill2"]);
	});

	it("expands /? discovery listing (not on line 1)", () => {
		const { text, expanded } = run("lista /? per favore");
		expect(text).toContain("[skills] invocable mid-sentence (/name [args]):");
		expect(text).toContain("test-skill — A test skill.");
		expect(text).toContain("hidden-skill —");
		expect(expanded).toEqual(["?"]);
		// line 1 stays native
		expect(run("/?").text).toBe("/?");
	});

	it("does not rescan the expansion result (no recursion)", () => {
		// hidden-skill's body does not reference other skills, so craft one on the fly
		const files: Record<string, string> = {
			"/s/loop/SKILL.md": "---\nname: loop\ndescription: loop skill.\n---\n\nbody mentions /test-skill inline\n",
			...FILES,
		};
		const skills = [...SKILLS, makeSkill("loop", "/s/loop/SKILL.md", files)];
		const { text } = expandSkillMidsentence("vai /loop ora", skills, (p) => files[p]!);
		expect(text).toContain("body mentions /test-skill inline");
		expect(text).not.toContain('<skill name="test-skill"');
	});

	it("expands disable-model-invocation skills", () => {
		const { text, expanded } = run("usa /hidden-skill zzz");
		expect(text).toContain('<skill name="hidden-skill"');
		expect(expanded).toEqual(["hidden-skill"]);
	});

	it("returns text unchanged when no skills are loaded", () => {
		const t = "usa /test-skill ora";
		expect(expandSkillMidsentence(t, [], read).text).toBe(t);
	});

	it("fail-soft: unreadable file leaves token untouched", () => {
		const { text, missing } = expandSkillMidsentence("usa /test-skill ora", SKILLS, () => {
			throw new Error("EACCES");
		});
		expect(text).toBe("usa /test-skill ora");
		expect(missing).toEqual(["test-skill"]);
	});
});
