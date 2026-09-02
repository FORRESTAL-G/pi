import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import ignore from "ignore";
import { basename, dirname, join, relative, resolve, sep } from "path";
import { CONFIG_DIR_NAME, getAgentDir } from "../config.ts";
import { parseFrontmatter, stripFrontmatter } from "../utils/frontmatter.ts";
import { canonicalizePath, resolvePath } from "../utils/paths.ts";
import type { ResourceDiagnostic } from "./diagnostics.ts";
import { createSyntheticSourceInfo, type SourceInfo } from "./source-info.ts";

/** Max name length per spec */
const MAX_NAME_LENGTH = 64;

/** Max description length per spec */
const MAX_DESCRIPTION_LENGTH = 1024;

const IGNORE_FILE_NAMES = [".gitignore", ".ignore", ".fdignore"];

type IgnoreMatcher = ReturnType<typeof ignore>;

function toPosixPath(p: string): string {
	return p.split(sep).join("/");
}

function prefixIgnorePattern(line: string, prefix: string): string | null {
	const trimmed = line.trim();
	if (!trimmed) return null;
	if (trimmed.startsWith("#") && !trimmed.startsWith("\\#")) return null;

	let pattern = line;
	let negated = false;

	if (pattern.startsWith("!")) {
		negated = true;
		pattern = pattern.slice(1);
	} else if (pattern.startsWith("\\!")) {
		pattern = pattern.slice(1);
	}

	if (pattern.startsWith("/")) {
		pattern = pattern.slice(1);
	}

	const prefixed = prefix ? `${prefix}${pattern}` : pattern;
	return negated ? `!${prefixed}` : prefixed;
}

function addIgnoreRules(ig: IgnoreMatcher, dir: string, rootDir: string): void {
	const relativeDir = relative(rootDir, dir);
	const prefix = relativeDir ? `${toPosixPath(relativeDir)}/` : "";

	for (const filename of IGNORE_FILE_NAMES) {
		const ignorePath = join(dir, filename);
		if (!existsSync(ignorePath)) continue;
		try {
			const content = readFileSync(ignorePath, "utf-8");
			const patterns = content
				.split(/\r?\n/)
				.map((line) => prefixIgnorePattern(line, prefix))
				.filter((line): line is string => Boolean(line));
			if (patterns.length > 0) {
				ig.add(patterns);
			}
		} catch {}
	}
}

export interface SkillFrontmatter {
	name?: string;
	description?: string;
	"disable-model-invocation"?: boolean;
	[key: string]: unknown;
}

export interface Skill {
	name: string;
	description: string;
	filePath: string;
	baseDir: string;
	sourceInfo: SourceInfo;
	disableModelInvocation: boolean;
}

export interface LoadSkillsResult {
	skills: Skill[];
	diagnostics: ResourceDiagnostic[];
}

/**
 * Validate skill name per Agent Skills spec.
 * Returns array of validation error messages (empty if valid).
 */
function validateName(name: string): string[] {
	const errors: string[] = [];

	if (name.length > MAX_NAME_LENGTH) {
		errors.push(`name exceeds ${MAX_NAME_LENGTH} characters (${name.length})`);
	}

	if (!/^[a-z0-9-]+$/.test(name)) {
		errors.push(`name contains invalid characters (must be lowercase a-z, 0-9, hyphens only)`);
	}

	if (name.startsWith("-") || name.endsWith("-")) {
		errors.push(`name must not start or end with a hyphen`);
	}

	if (name.includes("--")) {
		errors.push(`name must not contain consecutive hyphens`);
	}

	return errors;
}

/**
 * Validate description per Agent Skills spec.
 */
function validateDescription(description: string | undefined): string[] {
	const errors: string[] = [];

	if (!description || description.trim() === "") {
		errors.push("description is required");
	} else if (description.length > MAX_DESCRIPTION_LENGTH) {
		errors.push(`description exceeds ${MAX_DESCRIPTION_LENGTH} characters (${description.length})`);
	}

	return errors;
}

export interface LoadSkillsFromDirOptions {
	/** Directory to scan for skills */
	dir: string;
	/** Source identifier for these skills */
	source: string;
}

function createSkillSourceInfo(filePath: string, baseDir: string, source: string): SourceInfo {
	switch (source) {
		case "user":
			return createSyntheticSourceInfo(filePath, {
				source: "local",
				scope: "user",
				baseDir,
			});
		case "project":
			return createSyntheticSourceInfo(filePath, {
				source: "local",
				scope: "project",
				baseDir,
			});
		case "path":
			return createSyntheticSourceInfo(filePath, {
				source: "local",
				baseDir,
			});
		default:
			return createSyntheticSourceInfo(filePath, { source, baseDir });
	}
}

/**
 * Load skills from a directory.
 *
 * Discovery rules:
 * - if a directory contains SKILL.md, treat it as a skill root and do not recurse further
 * - otherwise, load direct .md children in the root
 * - recurse into subdirectories to find SKILL.md
 */
export function loadSkillsFromDir(options: LoadSkillsFromDirOptions): LoadSkillsResult {
	const { dir, source } = options;
	return loadSkillsFromDirInternal(dir, source, true);
}

function loadSkillsFromDirInternal(
	dir: string,
	source: string,
	includeRootFiles: boolean,
	ignoreMatcher?: IgnoreMatcher,
	rootDir?: string,
): LoadSkillsResult {
	const skills: Skill[] = [];
	const diagnostics: ResourceDiagnostic[] = [];

	if (!existsSync(dir)) {
		return { skills, diagnostics };
	}

	const root = rootDir ?? dir;
	const ig = ignoreMatcher ?? ignore();
	addIgnoreRules(ig, dir, root);

	try {
		const entries = readdirSync(dir, { withFileTypes: true });

		for (const entry of entries) {
			if (entry.name !== "SKILL.md") {
				continue;
			}

			const fullPath = join(dir, entry.name);

			let isFile = entry.isFile();
			if (entry.isSymbolicLink()) {
				try {
					isFile = statSync(fullPath).isFile();
				} catch {
					continue;
				}
			}

			const relPath = toPosixPath(relative(root, fullPath));
			if (!isFile || ig.ignores(relPath)) {
				continue;
			}

			const result = loadSkillFromFile(fullPath, source);
			if (result.skill) {
				skills.push(result.skill);
			}
			diagnostics.push(...result.diagnostics);
			return { skills, diagnostics };
		}

		for (const entry of entries) {
			if (entry.name.startsWith(".")) {
				continue;
			}

			// Skip node_modules to avoid scanning dependencies
			if (entry.name === "node_modules") {
				continue;
			}

			const fullPath = join(dir, entry.name);

			// For symlinks, check if they point to a directory and follow them
			let isDirectory = entry.isDirectory();
			let isFile = entry.isFile();
			if (entry.isSymbolicLink()) {
				try {
					const stats = statSync(fullPath);
					isDirectory = stats.isDirectory();
					isFile = stats.isFile();
				} catch {
					// Broken symlink, skip it
					continue;
				}
			}

			const relPath = toPosixPath(relative(root, fullPath));
			const ignorePath = isDirectory ? `${relPath}/` : relPath;
			if (ig.ignores(ignorePath)) {
				continue;
			}

			if (isDirectory) {
				const subResult = loadSkillsFromDirInternal(fullPath, source, false, ig, root);
				skills.push(...subResult.skills);
				diagnostics.push(...subResult.diagnostics);
				continue;
			}

			if (!isFile || !includeRootFiles || !entry.name.endsWith(".md")) {
				continue;
			}

			const result = loadSkillFromFile(fullPath, source);
			if (result.skill) {
				skills.push(result.skill);
			}
			diagnostics.push(...result.diagnostics);
		}
	} catch {}

	return { skills, diagnostics };
}

function loadSkillFromFile(
	filePath: string,
	source: string,
): { skill: Skill | null; diagnostics: ResourceDiagnostic[] } {
	const diagnostics: ResourceDiagnostic[] = [];

	try {
		const rawContent = readFileSync(filePath, "utf-8");
		const { frontmatter } = parseFrontmatter<SkillFrontmatter>(rawContent);
		const skillDir = dirname(filePath);
		const parentDirName = basename(skillDir);

		// Validate description
		const descErrors = validateDescription(frontmatter.description);
		for (const error of descErrors) {
			diagnostics.push({ type: "warning", message: error, path: filePath });
		}

		// Use name from frontmatter, or fall back to parent directory name
		const name = frontmatter.name || parentDirName;

		// Validate name
		const nameErrors = validateName(name);
		for (const error of nameErrors) {
			diagnostics.push({ type: "warning", message: error, path: filePath });
		}

		// Still load the skill even with warnings (unless description is completely missing)
		if (!frontmatter.description || frontmatter.description.trim() === "") {
			return { skill: null, diagnostics };
		}

		return {
			skill: {
				name,
				description: frontmatter.description,
				filePath,
				baseDir: skillDir,
				sourceInfo: createSkillSourceInfo(filePath, skillDir, source),
				disableModelInvocation: frontmatter["disable-model-invocation"] === true,
			},
			diagnostics,
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : "failed to parse skill file";
		diagnostics.push({ type: "warning", message, path: filePath });
		return { skill: null, diagnostics };
	}
}

/**
 * Format skills for inclusion in a system prompt.
 * Uses XML format per Agent Skills standard.
 * See: https://agentskills.io/integrate-skills
 *
 * Skills with disableModelInvocation=true are excluded from the prompt
 * (they can only be invoked explicitly via /skill:name commands).
 */
export function formatSkillsForPrompt(skills: Skill[]): string {
	const visibleSkills = skills.filter((s) => !s.disableModelInvocation);

	if (visibleSkills.length === 0) {
		return "";
	}

	const lines = [
		"\n\nThe following skills provide specialized instructions for specific tasks.",
		"Use the read tool to load a skill's file when the task matches its description.",
		"When a skill file references a relative path, resolve it against the skill directory (parent of SKILL.md / dirname of the path) and use that absolute path in tool commands.",
		"",
		"<available_skills>",
	];

	for (const skill of visibleSkills) {
		lines.push("  <skill>");
		lines.push(`    <name>${escapeXml(skill.name)}</name>`);
		lines.push(`    <description>${escapeXml(skill.description)}</description>`);
		lines.push(`    <location>${escapeXml(skill.filePath)}</location>`);
		lines.push("  </skill>");
	}

	lines.push("</available_skills>");

	return lines.join("\n");
}

function escapeXml(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

export interface LoadSkillsOptions {
	/** Working directory for project-local skills. */
	cwd: string;
	/** Agent config directory for global skills. */
	agentDir: string;
	/** Explicit skill paths (files or directories) */
	skillPaths: string[];
	/** Include default skills directories. */
	includeDefaults: boolean;
}

/**
 * Load skills from all configured locations.
 * Returns skills and any validation diagnostics.
 */
export function loadSkills(options: LoadSkillsOptions): LoadSkillsResult {
	const { agentDir, skillPaths, includeDefaults } = options;

	// Resolve agentDir - if not provided, use default from config
	const resolvedCwd = resolvePath(options.cwd);
	const resolvedAgentDir = resolvePath(agentDir ?? getAgentDir());

	const skillMap = new Map<string, Skill>();
	const realPathSet = new Set<string>();
	const allDiagnostics: ResourceDiagnostic[] = [];
	const collisionDiagnostics: ResourceDiagnostic[] = [];

	function addSkills(result: LoadSkillsResult) {
		allDiagnostics.push(...result.diagnostics);
		for (const skill of result.skills) {
			// Resolve symlinks to detect duplicate files
			const realPath = canonicalizePath(skill.filePath);

			// Skip silently if we've already loaded this exact file (via symlink)
			if (realPathSet.has(realPath)) {
				continue;
			}

			const existing = skillMap.get(skill.name);
			if (existing) {
				collisionDiagnostics.push({
					type: "collision",
					message: `name "${skill.name}" collision`,
					path: skill.filePath,
					collision: {
						resourceType: "skill",
						name: skill.name,
						winnerPath: existing.filePath,
						loserPath: skill.filePath,
					},
				});
			} else {
				skillMap.set(skill.name, skill);
				realPathSet.add(realPath);
			}
		}
	}

	if (includeDefaults) {
		addSkills(loadSkillsFromDirInternal(join(resolvedAgentDir, "skills"), "user", true));
		addSkills(loadSkillsFromDirInternal(resolve(resolvedCwd, CONFIG_DIR_NAME, "skills"), "project", true));
	}

	const userSkillsDir = join(resolvedAgentDir, "skills");
	const projectSkillsDir = resolve(resolvedCwd, CONFIG_DIR_NAME, "skills");

	const isUnderPath = (target: string, root: string): boolean => {
		const normalizedRoot = resolve(root);
		if (target === normalizedRoot) {
			return true;
		}
		const prefix = normalizedRoot.endsWith(sep) ? normalizedRoot : `${normalizedRoot}${sep}`;
		return target.startsWith(prefix);
	};

	const getSource = (resolvedPath: string): "user" | "project" | "path" => {
		if (!includeDefaults) {
			if (isUnderPath(resolvedPath, userSkillsDir)) return "user";
			if (isUnderPath(resolvedPath, projectSkillsDir)) return "project";
		}
		return "path";
	};

	for (const rawPath of skillPaths) {
		const resolvedPath = resolvePath(rawPath, resolvedCwd, { trim: true });
		if (!existsSync(resolvedPath)) {
			allDiagnostics.push({ type: "warning", message: "skill path does not exist", path: resolvedPath });
			continue;
		}

		try {
			const stats = statSync(resolvedPath);
			const source = getSource(resolvedPath);
			if (stats.isDirectory()) {
				addSkills(loadSkillsFromDirInternal(resolvedPath, source, true));
			} else if (stats.isFile() && resolvedPath.endsWith(".md")) {
				const result = loadSkillFromFile(resolvedPath, source);
				if (result.skill) {
					addSkills({ skills: [result.skill], diagnostics: result.diagnostics });
				} else {
					allDiagnostics.push(...result.diagnostics);
				}
			} else {
				allDiagnostics.push({ type: "warning", message: "skill path is not a markdown file", path: resolvedPath });
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : "failed to read skill path";
			allDiagnostics.push({ type: "warning", message, path: resolvedPath });
		}
	}

	return {
		skills: Array.from(skillMap.values()),
		diagnostics: [...allDiagnostics, ...collisionDiagnostics],
	};
}

// ---------------------------------------------------------------------------
// Mid-sentence skill invocation (`/name args` anywhere from line 2 on)
// ---------------------------------------------------------------------------

/** Charset of valid skill names per the Agent Skills spec. */
const MIDSENTENCE_SKILL_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9-]*/;

/** Truncation for descriptions in the `/?` discovery listing. */
const DISCOVERY_DESCRIPTION_LENGTH = 90;

/** MS4: pre-markers inserted by the prompt-midsentence extension next to a token
 *  (`[→ prompt: x · skill: y]` — names contain no `/` and no `]` by charset) are UI
 *  chrome in the scanned text, never args and never a sibling token. Stripped from
 *  the rest-of-line before args/sibling computation; the marker stays visible in the
 *  emitted text. ponytail: prose legitimately containing a literal `[→ ...]` is also
 *  stripped from args — acceptable ceiling, upgrade to an escape if it ever bites. */
const MIDSENTENCE_MARKER_RE = /\s?\[→ [^\]\n]*\]/g;

export interface SkillMidsentenceBlock {
	/** Full skill name (normalized when the typed name was a unique prefix). */
	name: string;
	/** Text of the separate follow-up user message: the `<skill ...>...</skill>` block,
	 *  followed by the args when present (same shape the native `/skill:name` command
	 *  produces — the TUI renders it as a collapsible skill invocation + args). */
	message: string;
	/** MS3: offset of the `/` token in the SCANNED text. The prompt-midsentence
	 *  extension reports its tokens with the same coordinate system (details.pos on its
	 *  custom messages, computed on the very same transformed text) - together they
	 *  drive the global position-ordered interleaving in AgentSession.prompt. */
	pos: number;
}

export interface ExpandSkillMidsentenceResult {
	/** User text with `/name args` kept VERBATIM (name normalized to the full skill name
	 *  only when the typed name was a unique prefix of exactly one loaded skill). */
	text: string;
	/** Skill bodies to emit as separate follow-up user messages, in order. */
	blocks: SkillMidsentenceBlock[];
	/** Names of the skills expanded, in order of appearance (`?` = discovery listing). */
	expanded: string[];
	/** Candidate names that did not resolve to a loaded skill (left untouched). */
	missing: string[];
}

/** Resolve a typed name to a loaded skill: exact match first, then unique-prefix
 *  normalization ("make sure it is the full name" — never a guess on ambiguity). */
function resolveSkill(skills: Skill[], typed: string): Skill | undefined {
	const exact = skills.find((s) => s.name === typed);
	if (exact) return exact;
	// v3 (owner mandate 2026-09-02, the /checkpoint-vs-CHECKPOINT.md case): exact match
	// always wins; if the typed name is not real but a UNIQUE case-insensitive variant
	// exists, use it (same normalization philosophy as unique prefixes).
	const lower = typed.toLowerCase();
	const ci = skills.filter((s) => s.name.toLowerCase() === lower);
	if (ci.length === 1) return ci[0];
	const prefixed = skills.filter((s) => s.name.startsWith(typed));
	return prefixed.length === 1 ? prefixed[0] : undefined;
}

/**
 * Format the discovery listing shown when `/?` appears mid-sentence.
 */
function formatSkillDiscoveryListing(skills: Skill[]): string {
	if (skills.length === 0) return "[skills] none available\n";
	const lines = skills.map((skill) => {
		const d =
			skill.description.length > DISCOVERY_DESCRIPTION_LENGTH
				? `${skill.description.slice(0, DISCOVERY_DESCRIPTION_LENGTH)}...`
				: skill.description;
		return `  ${skill.name} — ${d}`;
	});
	return `[skills] invocable mid-sentence (/name [args]):\n${lines.join("\n")}\n`;
}

/**
 * Collect mid-sentence skill invocations (`/name args` anywhere from line 2 on).
 *
 * Semantics (v2, mirroring the prompt-midsentence companion feature; v3 adds unique
 * case-insensitive variant normalization):
 * - Trigger `/name` where `name` matches a loaded skill exactly, or is a unique prefix
 *   of exactly one loaded skill (the typed name is then normalized in the text to the
 *   full skill name); the slash must be preceded by whitespace (so `C:/x`, `a/b`,
 *   `n/d` never trigger).
 * - The first line of the input is native pi territory (slash commands consume the
 *   whole line); scanning starts at line 2.
 * - `name:` (a colon right after the name, e.g. `/skill:foo`) is not a sigil.
 * - Args run to the end of the line (exclusive); the rest of the text is preserved.
 * - MS4: extension pre-markers (`[→ prompt: x · skill: y]`) next to a token are UI
 *  chrome — stripped from args/sibling computation, kept visible in the text.
 * - The user text is NOT rewritten beyond name normalization: `/name args` stays
 *   visible (owner mandate: never substitute the name with the body).
 * - Each skill body is returned as a separate block to be emitted as a follow-up user
 *   message right after the user text (same `<skill ...>` block + args shape the
 *   native `/skill:name` command produces).
 * - `/?` is a discovery alias: replaced in place by the listing of loaded skills
 *   (a listing is not a body; the name-stays rule concerns bodies).
 * - Fail-soft: unknown names and unreadable files leave the text untouched.
 * - Single pass: the result is never rescanned.
 *
 * @param readSkillFile injected file reader (keeps this pure and testable).
 */
export function expandSkillMidsentence(
	text: string,
	skills: Skill[],
	readSkillFile: (filePath: string) => string,
): ExpandSkillMidsentenceResult {
	let i = 0;
	let out = "";
	const blocks: SkillMidsentenceBlock[] = [];
	const expanded: string[] = [];
	const missing: string[] = [];

	while (true) {
		const start = text.indexOf("/", i);
		if (start === -1) {
			out += text.slice(i);
			break;
		}

		// Absolute start of input is native: skip the entire first line.
		if (start === 0) {
			const nl = text.search(/[\n\r]/);
			const stop = nl === -1 ? text.length : nl;
			out += text.slice(0, stop);
			i = stop;
			continue;
		}

		// Word boundary: the character before the slash must be whitespace.
		if (!/\s/.test(text[start - 1]!)) {
			out += text.slice(i, start + 1);
			i = start + 1;
			continue;
		}

		const rest = text.slice(start + 1);

		// `/?` discovery alias.
		if (rest.startsWith("?")) {
			out += text.slice(i, start) + formatSkillDiscoveryListing(skills);
			expanded.push("?");
			i = start + 2;
			continue;
		}

		const candidate = MIDSENTENCE_SKILL_NAME_RE.exec(rest);
		if (!candidate || candidate[0].length < 2) {
			out += text.slice(i, start + 1);
			i = start + 1;
			continue;
		}

		const name = candidate[0];
		const afterName = start + 1 + name.length;
		const nextCh = text[afterName] ?? "";

		// The name must end at a boundary.
		if (nextCh && /[a-z0-9-]/.test(nextCh)) {
			out += text.slice(i, start + 1);
			i = start + 1;
			continue;
		}

		// Namespace guard: `/name:...` (e.g. `/skill:foo`) is not a mid-sentence sigil.
		if (nextCh === ":") {
			out += text.slice(i, start + 1);
			i = start + 1;
			continue;
		}

		// Args (MS3.1, owner bugfix 01/09): the rest of the sentence is NOT args.
		// (1) non-whitespace char right after the name (e.g. `/name)`) -> BARE token;
		// (2) whitespace + another token candidate later on the line (whitespace-preceded
		//     slash) -> list member -> BARE (sibling tokens must each invoke);
		// (3) otherwise args run to the end of the line (certified v1/v2 semantics).
		// MS4: args VALUE and sibling detection are computed on the marker-stripped line;
		// offsets (scanEnd) stay in the ORIGINAL text so the marker stays visible.
		const restOfLine = text.slice(afterName);
		let args = "";
		let scanEnd = afterName; // where scanning resumes (default: right after the name)
		const firstCh = restOfLine.charAt(0);
		if (firstCh && /\s/.test(firstCh)) {
			const relNl = restOfLine.search(/[\n\r]/);
			const eol = relNl === -1 ? restOfLine.length : relNl;
			const cleanedLine = restOfLine.slice(0, eol).replace(MIDSENTENCE_MARKER_RE, " ");
			const nextTok = /\s\/[A-Za-z0-9]/.exec(cleanedLine);
			if (!nextTok) {
				args = cleanedLine.trim();
				scanEnd = afterName + eol;
			}
		}

		const skill = resolveSkill(skills, name);
		if (!skill) {
			missing.push(name);
			out += text.slice(i, afterName);
			i = afterName;
			continue;
		}

		try {
			const content = readSkillFile(skill.filePath);
			const body = stripFrontmatter(content).trim();
			const skillBlock = `<skill name="${skill.name}" location="${skill.filePath}">\nReferences are relative to ${skill.baseDir}.\n\n${body}\n</skill>`;
			// v2: the token stays in the user text — verbatim on an exact match, with the
			// name normalized to the full skill name on a unique-prefix match. The body is
			// emitted as a separate follow-up message (block + args, native shape).
			out += text.slice(i, start) + "/" + skill.name + text.slice(afterName, scanEnd);
			// MS3: pos = offset of the token in this input text, for the global
			// skill/prompt interleaving by position.
			blocks.push({ name: skill.name, message: args ? `${skillBlock}\n\n${args}` : skillBlock, pos: start });
			expanded.push(skill.name);
			i = scanEnd;
		} catch {
			missing.push(name);
			out += text.slice(i, afterName);
			i = afterName;
		}
	}

	return { text: out, blocks, expanded, missing };
}
