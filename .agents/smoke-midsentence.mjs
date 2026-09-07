import { expandMidsentence } from "../packages/coding-agent/src/core/midsentence.ts";
import { createSyntheticSourceInfo } from "../packages/coding-agent/src/core/source-info.ts";

const skill = {
	name: "verify-build",
	description: "d",
	filePath: "/s/vb/SKILL.md",
	baseDir: "/s/vb",
	sourceInfo: createSyntheticSourceInfo("/s/vb/SKILL.md", { source: "local" }),
	disableModelInvocation: false,
};
const reader = () => "---\nname: verify-build\ndescription: d\n---\nBody here.";
const opts = { skills: [skill], templates: [] };
const r = { readSkillFile: reader };
console.log("1)", expandMidsentence("can you check the build please run /verify-build on the current branch and summarize", opts, r));
console.log("2)", expandMidsentence("/verify-build native\nline2 /verify-build expands", opts, r));
console.log("3)", expandMidsentence("C:/x a/b n/d km/h untouched", opts, r));
console.log("4)", expandMidsentence("run /skill:foo stays literal /verify-build tail", opts, r));
