/**
 * Tests for mid-sentence skill invocation (`/name args` anywhere from line 2 on).
 *
 * v2 semantics (owner mandate, same as the prompt-midsentence companion feature):
 * - word-boundary trigger (whitespace before the slash)
 * - first line is native pi territory (never scanned)
 * - args run to end of line
 * - `/name:` namespace guard (e.g. `/skill:foo` stays literal)
 * - the user text KEEPS `/name args` verbatim (name normalized to the full skill
 *   name only on a unique-prefix match — never substituted with the body)
 * - each skill body is returned as a separate block (native `<skill ...>` shape)
 * - fail-soft on unknown names
 * - `/?` discovery listing
 * - single pass (the result is never rescanned)
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
	it("keeps the token verbatim and returns the body as a separate block", () => {
		const { text, blocks, expanded } = run("fai X poi /test-skill arg1 arg2 e dimmi");
		expect(text).toBe("fai X poi /test-skill arg1 arg2 e dimmi");
		expect(blocks).toHaveLength(1);
		expect(blocks[0]!.name).toBe("test-skill");
		expect(blocks[0]!.message).toBe(`${TEST_BLOCK}\n\narg1 arg2 e dimmi`);
		expect(expanded).toEqual(["test-skill"]);
	});

	it("works without args (block has no trailing args)", () => {
		const { text, blocks } = run("prima riga\npoi /test-skill");
		expect(text).toBe("prima riga\npoi /test-skill");
		expect(blocks).toHaveLength(1);
		expect(blocks[0]!.message).toBe(TEST_BLOCK);
	});

	it("normalizes a unique-prefix name to the full skill name (text keeps a name, never a body)", () => {
		const { text, blocks, expanded } = run("usa /test-skil questi args");
		expect(text).toBe("usa /test-skill questi args");
		expect(blocks).toHaveLength(1);
		expect(blocks[0]!.name).toBe("test-skill");
		expect(blocks[0]!.message).toBe(`${TEST_BLOCK}\n\nquesti args`);
		expect(expanded).toEqual(["test-skill"]);
	});

	it("does not guess on ambiguous or non-matching partials", () => {
		// real ambiguity: two skills share the prefix "amb"
		const files: Record<string, string> = {
			...FILES,
			"/skills/amb-a/SKILL.md": "---\nname: amb-a\ndescription: a.\n---\n\nA\n",
			"/skills/amb-b/SKILL.md": "---\nname: amb-b\ndescription: b.\n---\n\nB\n",
		};
		const skills = [...SKILLS, makeSkill("amb-a", "/skills/amb-a/SKILL.md", files), makeSkill("amb-b", "/skills/amb-b/SKILL.md", files)];
		const r = expandSkillMidsentence("vai /amb ora", skills, (p) => files[p]!);
		expect(r.text).toBe("vai /amb ora");
		expect(r.blocks).toEqual([]);
		expect(r.missing).toEqual(["amb"]);

		// a name that is not a prefix of anything stays literal too
		const t = "usa /test-skill2 ora";
		const r2 = run(t);
		expect(r2.text).toBe(t);
		expect(r2.missing).toEqual(["test-skill2"]);
	});

	it("does not trigger without a word boundary (paths, fractions)", () => {
		for (const t of [
			"guarda C:/x/y e dimmi",
			"protocollo :/x",
			"prima a/b poi",
			"vale n/d",
			"3 km/h ok",
		]) {
			const r = run(t);
			expect(r.text).toBe(t);
			expect(r.blocks).toEqual([]);
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
		const { text, blocks } = run("usa /test-skill questi args\nriga dopo");
		expect(text).toBe("usa /test-skill questi args\nriga dopo");
		expect(blocks[0]!.message).toBe(`${TEST_BLOCK}\n\nquesti args`);
	});

	it("collects multiple tokens on the same and different lines", () => {
		const { text, blocks, expanded } = run("a /test-skill uno\nb /other-skill due");
		expect(text).toBe("a /test-skill uno\nb /other-skill due");
		expect(blocks.map((b) => b.name)).toEqual(["test-skill", "other-skill"]);
		expect(blocks[0]!.message).toContain('<skill name="test-skill"');
		expect(blocks[1]!.message).toContain('<skill name="other-skill"');
		expect(expanded).toEqual(["test-skill", "other-skill"]);
	});

	it("fail-soft: unknown skill leaves text untouched", () => {
		const t = "usa /mx-rail args";
		const { text, blocks, expanded, missing } = run(t);
		expect(text).toBe(t);
		expect(blocks).toEqual([]);
		expect(expanded).toEqual([]);
		expect(missing).toEqual(["mx-rail"]);
	});

	it("namespace guard: colon after the name stays literal", () => {
		for (const t of [
			"mid /skill:foo args",
			"mid /test-skill:foo args",
		]) {
			const r = run(t);
			expect(r.text).toBe(t);
			expect(r.blocks).toEqual([]);
		}
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

	it("does not rescan the collected bodies (no recursion)", () => {
		// hidden-skill's body does not reference other skills, so craft one on the fly
		const files: Record<string, string> = {
			"/s/loop/SKILL.md": "---\nname: loop\ndescription: loop skill.\n---\n\nbody mentions /test-skill inline\n",
			...FILES,
		};
		const skills = [...SKILLS, makeSkill("loop", "/s/loop/SKILL.md", files)];
		const r = expandSkillMidsentence("vai /loop ora", skills, (p) => files[p]!);
		expect(r.text).toBe("vai /loop ora");
		expect(r.blocks).toHaveLength(1);
		expect(r.blocks[0]!.message).toContain("body mentions /test-skill inline"); // /test-skill inside the body is NOT expanded
	});

	it("expands disable-model-invocation skills", () => {
		const { text, blocks, expanded } = run("usa /hidden-skill zzz");
		expect(text).toBe("usa /hidden-skill zzz");
		expect(blocks[0]!.message).toContain('<skill name="hidden-skill"');
		expect(expanded).toEqual(["hidden-skill"]);
	});

	it("returns text unchanged when no skills are loaded", () => {
		const t = "usa /test-skill ora";
		const r = expandSkillMidsentence(t, [], read);
		expect(r.text).toBe(t);
		expect(r.blocks).toEqual([]);
	});

	it("fail-soft: unreadable file leaves token untouched", () => {
		const { text, blocks, missing } = expandSkillMidsentence("usa /test-skill ora", SKILLS, () => {
			throw new Error("EACCES");
		});
		expect(text).toBe("usa /test-skill ora");
		expect(blocks).toEqual([]);
		expect(missing).toEqual(["test-skill"]);
	});
});
