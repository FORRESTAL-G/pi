## Problem

`/skill:name args` and `/template args` only expand at the start of the input (#8457). A skill or template referenced in the middle of a message stays literal, so the user has to split the message and resend the invocation as its own line.

Skills with `disable-model-invocation: true` cannot be invoked at all unless the token is at position 0: they are hidden from the system prompt, and the native expansion only fires when the text starts with the command.

Extensions cannot fix this: the extension API exposes no way to read loaded skills (only to contribute paths via `resources_discover`), so an extension would have to duplicate the skill loader and drift.

## Example

```text
User input:
  can you check the build please run /verify-build on the current branch and summarize

Model receives (at the invocation site):
  can you check the build please run <skill name="verify-build" location="...">
  References are relative to ...

  (skill body)
  </skill>

  on the current branch and summarize
```

Multiple tokens in one message all expand, in position order.

## Solution

A single-pass scanner (`src/core/midsentence.ts`) expands `/name args` tokens anywhere except the very start of the message (a slash at position 0 begins a line-1 command, which consumes the whole first line; `/skill:foo` after a space also stays literal). Names resolve against prompt templates first, then skills, by exact match, unique case-insensitive variant, or unique prefix. Skill output is byte-identical to the native `/skill:name` expansion (shared builder), template output identical to line-1 expansion (`parseCommandArgs` + `substituteArgs`). Unresolvable names and unreadable files stay literal, silently. The output is never rescanned, so expansions cannot recurse.

Wired into `prompt()`, `steer()`, and `followUp()` before the native expansions, respecting the `expandPromptTemplates` option, so native line-1 output is never rescanned. Arguably this also makes `disable-model-invocation` skills reachable in practice: the user can invoke them anywhere in the message without giving up the surrounding prose.

The same works for prompt templates: `/templatename args` anywhere except the very start expands the template body with the arguments, identical to line-1 behavior. If a skill and a template share a name, the template wins.
