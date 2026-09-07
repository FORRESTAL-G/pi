#!/usr/bin/env bash
# Mirrors test.sh isolation but skips test:scripts (pre-existing Windows failure there).
set -uo pipefail
temp_parent="${TMPDIR:-/tmp}"
temp_parent="${temp_parent%/}"
test_root="$(mktemp -d "$temp_parent/pi-test.XXXXXX")"
trap 'rm -rf -- "$test_root"' EXIT
mkdir -p "$test_root/home/.config" "$test_root/tmp" "$test_root/cache/npm"
test_env=(
	"PATH=$PATH" "PWD=$PWD"
	"HOME=$test_root/home" "USERPROFILE=$test_root/home"
	"TMPDIR=$test_root/tmp" "TMP=$test_root/tmp" "TEMP=$test_root/tmp"
	"XDG_CONFIG_HOME=$test_root/home/.config" "XDG_CACHE_HOME=$test_root/cache"
	"LANG=C" "LC_ALL=C" "TZ=UTC"
	"GIT_CONFIG_NOSYSTEM=1" "GIT_CONFIG_GLOBAL=/dev/null"
	"GIT_TERMINAL_PROMPT=0" "GIT_ASKPASS=$(type -P false)"
	"GIT_EDITOR=true" "GIT_SEQUENCE_EDITOR=true"
	"NPM_CONFIG_USERCONFIG=$test_root/npm-userconfig"
	"NPM_CONFIG_GLOBALCONFIG=$test_root/npm-globalconfig"
	"NPM_CONFIG_CACHE=$test_root/cache/npm"
	"PI_NO_LOCAL_LLM=1" "AWS_EC2_METADATA_DISABLED=true"
)
for name in SystemRoot SYSTEMROOT WINDIR COMSPEC PATHEXT; do
	value="${!name-}"
	[[ -z "$value" ]] || test_env+=("$name=$value")
done
for name in CI GITHUB_ACTIONS; do
	value="${!name-}"
	[[ -z "$value" ]] || test_env+=("$name=$value")
done
echo "Workspace tests in isolated home: $test_root/home"
env -i "${test_env[@]}" npm test --workspace @earendil-works/pi-coding-agent
