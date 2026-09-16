import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { basename, dirname, join, resolve, sep } from "path";
import { CONFIG_DIR_NAME } from "../config.ts";
import { parseFrontmatter } from "../utils/frontmatter.ts";
import { resolvePath } from "../utils/paths.ts";
import { createSyntheticSourceInfo, type SourceInfo } from "./source-info.ts";

/**
 * Represents a prompt template loaded from a markdown file
 */
export interface PromptTemplate {
	name: string;
	description: string;
	argumentHint?: string;
	content: string;
	sourceInfo: SourceInfo;
	filePath: string; // Absolute path to the template file
}

/**
 * Parse command arguments respecting quoted strings (bash-style)
 * Returns array of arguments
 */
export function parseCommandArgs(argsString: string): string[] {
	const args: string[] = [];
	let current = "";
	let inQuote: string | null = null;

	for (let i = 0; i < argsString.length; i++) {
		const char = argsString[i];

		if (inQuote) {
			if (char === inQuote) {
				inQuote = null;
			} else {
				current += char;
			}
		} else if (char === '"' || char === "'") {
			inQuote = char;
		} else if (/\s/.test(char)) {
			if (current) {
				args.push(current);
				current = "";
			}
		} else {
			current += char;
		}
	}

	if (current) {
		args.push(current);
	}

	return args;
}

/**
 * Substitute argument placeholders in template content
 * Supports:
 * - $1, $2, ... for positional args
 * - $@ and $ARGUMENTS for all args
 * - ${N:-default} for positional arg N with default when missing/empty
 * - ${@:-default} and ${ARGUMENTS:-default} for all args with a default when empty
 * - ${@:N} for args from Nth onwards (bash-style slicing)
 * - ${@:N:L} for L args starting from Nth
 *
 * Note: Replacement happens on the template string only. Argument and default values
 * containing patterns like $1, $@, or $ARGUMENTS are NOT recursively substituted.
 */
export function substituteArgs(content: string, args: string[]): string {
	const allArgs = args.join(" ");

	return content.replace(
		/\$\{(\d+|ARGUMENTS|@):-([^}]*)\}|\$\{@:(\d+)(?::(\d+))?\}|\$(ARGUMENTS|@|\d+)/g,
		(_match, defaultTarget, defaultValue, sliceStart, sliceLength, simple) => {
			if (defaultTarget) {
				const value =
					defaultTarget === "@" || defaultTarget === "ARGUMENTS" ? allArgs : args[parseInt(defaultTarget, 10) - 1];
				return value ? value : defaultValue;
			}

			if (sliceStart) {
				let start = parseInt(sliceStart, 10) - 1; // Convert to 0-indexed (user provides 1-indexed)
				// Treat 0 as 1 (bash convention: args start at 1)
				if (start < 0) start = 0;

				if (sliceLength) {
					const length = parseInt(sliceLength, 10);
					return args.slice(start, start + length).join(" ");
				}
				return args.slice(start).join(" ");
			}

			if (simple === "ARGUMENTS" || simple === "@") {
				return allArgs;
			}

			const index = parseInt(simple, 10) - 1;
			return args[index] ?? "";
		},
	);
}

function loadTemplateFromFile(filePath: string, sourceInfo: SourceInfo): PromptTemplate | null {
	try {
		const rawContent = readFileSync(filePath, "utf-8");
		const { frontmatter, body } = parseFrontmatter<Record<string, string>>(rawContent);

		const name = basename(filePath).replace(/\.md$/, "");

		// Get description from frontmatter or first non-empty line
		let description = frontmatter.description || "";
		if (!description) {
			const firstLine = body.split("\n").find((line) => line.trim());
			if (firstLine) {
				// Truncate if too long
				description = firstLine.slice(0, 60);
				if (firstLine.length > 60) description += "...";
			}
		}

		return {
			name,
			description,
			...(frontmatter["argument-hint"] && { argumentHint: frontmatter["argument-hint"] }),
			content: body,
			sourceInfo,
			filePath,
		};
	} catch {
		return null;
	}
}

/**
 * Scan a directory for .md files (non-recursive) and load them as prompt templates.
 */
function loadTemplatesFromDir(dir: string, getSourceInfo: (filePath: string) => SourceInfo): PromptTemplate[] {
	const templates: PromptTemplate[] = [];

	if (!existsSync(dir)) {
		return templates;
	}

	try {
		const entries = readdirSync(dir, { withFileTypes: true });

		for (const entry of entries) {
			const fullPath = join(dir, entry.name);

			// For symlinks, check if they point to a file
			let isFile = entry.isFile();
			if (entry.isSymbolicLink()) {
				try {
					const stats = statSync(fullPath);
					isFile = stats.isFile();
				} catch {
					// Broken symlink, skip it
					continue;
				}
			}

			if (isFile && entry.name.endsWith(".md")) {
				const template = loadTemplateFromFile(fullPath, getSourceInfo(fullPath));
				if (template) {
					templates.push(template);
				}
			}
		}
	} catch {
		return templates;
	}

	return templates;
}

export interface LoadPromptTemplatesOptions {
	/** Working directory for project-local templates. */
	cwd: string;
	/** Agent config directory for global templates. */
	agentDir: string;
	/** Explicit prompt template paths (files or directories). */
	promptPaths: string[];
	/** Include default prompt directories. */
	includeDefaults: boolean;
}

/**
 * Load all prompt templates from:
 * 1. Global: agentDir/prompts/
 * 2. Project: cwd/{CONFIG_DIR_NAME}/prompts/
 * 3. Explicit prompt paths
 */
export function loadPromptTemplates(options: LoadPromptTemplatesOptions): PromptTemplate[] {
	const resolvedCwd = resolvePath(options.cwd);
	const resolvedAgentDir = resolvePath(options.agentDir);
	const promptPaths = options.promptPaths;
	const includeDefaults = options.includeDefaults;

	const templates: PromptTemplate[] = [];

	const globalPromptsDir = join(resolvedAgentDir, "prompts");
	const projectPromptsDir = resolve(resolvedCwd, CONFIG_DIR_NAME, "prompts");

	const isUnderPath = (target: string, root: string): boolean => {
		const normalizedRoot = resolve(root);
		if (target === normalizedRoot) {
			return true;
		}
		const prefix = normalizedRoot.endsWith(sep) ? normalizedRoot : `${normalizedRoot}${sep}`;
		return target.startsWith(prefix);
	};

	const getSourceInfo = (resolvedPath: string): SourceInfo => {
		if (isUnderPath(resolvedPath, globalPromptsDir)) {
			return createSyntheticSourceInfo(resolvedPath, {
				source: "local",
				scope: "user",
				baseDir: globalPromptsDir,
			});
		}
		if (isUnderPath(resolvedPath, projectPromptsDir)) {
			return createSyntheticSourceInfo(resolvedPath, {
				source: "local",
				scope: "project",
				baseDir: projectPromptsDir,
			});
		}
		return createSyntheticSourceInfo(resolvedPath, {
			source: "local",
			baseDir: statSync(resolvedPath).isDirectory() ? resolvedPath : dirname(resolvedPath),
		});
	};

	if (includeDefaults) {
		templates.push(...loadTemplatesFromDir(globalPromptsDir, getSourceInfo));
		templates.push(...loadTemplatesFromDir(projectPromptsDir, getSourceInfo));
	}

	// 3. Load explicit prompt paths
	for (const rawPath of promptPaths) {
		const resolvedPath = resolvePath(rawPath, resolvedCwd, { trim: true });
		if (!existsSync(resolvedPath)) {
			continue;
		}

		try {
			const stats = statSync(resolvedPath);
			if (stats.isDirectory()) {
				templates.push(...loadTemplatesFromDir(resolvedPath, getSourceInfo));
			} else if (stats.isFile() && resolvedPath.endsWith(".md")) {
				const template = loadTemplateFromFile(resolvedPath, getSourceInfo(resolvedPath));
				if (template) {
					templates.push(template);
				}
			}
		} catch {
			// Ignore read failures
		}
	}

	return templates;
}

// ---------------------------------------------------------------------------
// Mid-sentence prompt invocation (`/name` anywhere from the scan position on)
// ---------------------------------------------------------------------------

/** Charset of prompt template names (file names may contain underscores). */
const MIDSENTENCE_PROMPT_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*/;

/** MS5: PRE marker inserted by the prompt-midsentence extension right after a token
 *  (`[→ prompt: x · skill: y]`). When the core delivers the body itself, the marker is
 *  UI chrome that must NOT reach the model text: it is stripped from the emitted text
 *  (stripping restores the user's original bytes — the user never typed the marker). */
const MIDSENTENCE_PROMPT_MARKER_RE = /^ ?\[→ [^\]\n]*\]/;

export interface PromptMidsentenceBlock {
	/** Resolved template name. */
	name: string;
	/** RAW template content (frontmatter stripped by the loader): placeholders like
	 *  $@, $ARGUMENTS, $1..$9, ${...}, ${@:...} are NOT substituted. Args live only in
	 *  the user message, verbatim (MS5 contract). */
	message: string;
	/** Offset of the `/` token in the scanned text, for the position-ordered
	 *  skill/prompt interleaving in AgentSession.prompt (same coordinate system as
	 *  SkillMidsentenceBlock.pos). */
	pos: number;
}

export interface ExpandPromptMidsentenceResult {
	/** User text VERBATIM — no rewrite, no marker, no name normalization (MS5 contract:
	 *  even a unique-prefix match stays written as typed). Extension PRE markers next to
	 *  tokens the core resolved are stripped (they were never typed by the user). */
	text: string;
	/** RAW template bodies to emit as separate messages right after the user text. */
	blocks: PromptMidsentenceBlock[];
	/** Typed names that did not resolve to a loaded template (left untouched). */
	missing: string[];
}

/** Resolve a typed name to a loaded template: exact match first, then unique prefix,
 *  then unique case-insensitive variant (same ladder as skills.resolveSkill). */
function resolvePromptTemplate(templates: PromptTemplate[], typed: string): PromptTemplate | undefined {
	const exact = templates.find((t) => t.name === typed);
	if (exact) return exact;
	const prefixed = templates.filter((t) => t.name.startsWith(typed));
	if (prefixed.length === 1) return prefixed[0];
	const lower = typed.toLowerCase();
	const ci = templates.filter((t) => t.name.toLowerCase() === lower);
	return ci.length === 1 ? ci[0] : undefined;
}

/**
 * Collect mid-sentence prompt-template invocations (MS5, core-self-sufficient port of
 * the prompt-midsentence extension semantics).
 *
 * - Trigger `/name` where name resolves to a loaded template (exact, unique prefix, or
 *   unique case-insensitive variant); whitespace-preceded slash only (C:/x, a/b never
 *   trigger); input start (position 0 / first line) is native pi territory.
 * - The user text is NEVER rewritten: the trigger and everything after it (args,
 *   multi-line) stay verbatim in the message the model reads.
 * - Each resolved token yields a block: the RAW template content, to be delivered as a
 *   separate message immediately after the user text in the SAME turn (no substitution,
 *   no args appended — the skill-block delivery semantics of the ms line).
 * - Extension PRE markers (`[→ ...]`) adjacent to a token the core resolved are
 *   stripped from the emitted text so the extension-enabled pipeline stays byte-exact.
 * - Fail-soft: unknown names leave the text untouched (warning, when present, stays the
 *   extension's UI toast). Single pass: the result is never rescanned.
 */
export function expandPromptMidsentence(text: string, templates: PromptTemplate[]): ExpandPromptMidsentenceResult {
	let i = 0;
	let out = "";
	const blocks: PromptMidsentenceBlock[] = [];
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

		// `/?` discovery stays with the skills scanner / extension — never a prompt.
		if (text[start + 1] === "?") {
			out += text.slice(i, start + 2);
			i = start + 2;
			continue;
		}

		const candidate = MIDSENTENCE_PROMPT_NAME_RE.exec(text.slice(start + 1));
		if (!candidate || candidate[0].length < 2) {
			out += text.slice(i, start + 1);
			i = start + 1;
			continue;
		}

		const name = candidate[0];
		const afterName = start + 1 + name.length;
		const nextCh = text[afterName] ?? "";

		// The name must end at a boundary.
		if (nextCh && /[A-Za-z0-9_-]/.test(nextCh)) {
			out += text.slice(i, start + 1);
			i = start + 1;
			continue;
		}

		const template = resolvePromptTemplate(templates, name);
		if (!template) {
			missing.push(name);
			out += text.slice(i, afterName);
			i = afterName;
			continue;
		}

		// Resolved: emit the token verbatim (NO name normalization in the model text),
		// then drop the extension PRE marker if it sits right after the token.
		out += text.slice(i, afterName);
		let resume = afterName;
		const marker = MIDSENTENCE_PROMPT_MARKER_RE.exec(text.slice(afterName));
		if (marker) {
			resume = afterName + marker[0].length;
		}
		// ponytail: block pos is recorded on THIS (post-skill-scan) text while skill
		// blocks keep their pre-normalization offsets — mixed-line ordering can only
		// misorder when a skill name was normalized earlier in the same text; back-mapping
		// offsets is the upgrade path if that ever bites.
		blocks.push({ name: template.name, message: template.content, pos: start });
		i = resume;
	}

	return { text: out, blocks, missing };
}

/**
 * Expand a prompt template if it matches a template name.
 * Returns the expanded content or the original text if not a template.
 */
export function expandPromptTemplate(text: string, templates: PromptTemplate[]): string {
	if (!text.startsWith("/")) return text;

	const match = text.match(/^\/([^\s]+)(?:\s+([\s\S]*))?$/);
	if (!match) return text;

	const templateName = match[1];
	const argsString = match[2] ?? "";

	const template = templates.find((t) => t.name === templateName);
	if (template) {
		const args = parseCommandArgs(argsString);
		return substituteArgs(template.content, args);
	}

	return text;
}
