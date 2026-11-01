#!/bin/sh
# Cursor `beforeShellExecution` adapter.
#
# Translates Cursor's hook I/O to the shared guard in
# scripts/agent-hooks/git-guard.sh. Cursor input on stdin: { command, cwd, ... }.
# Output on stdout: { permission: "allow" | "deny", userMessage, agentMessage }.

# jq is a hard prerequisite — even deny() below needs it to build JSON — so
# fail closed with a static deny instead of emitting nothing at all.
command -v jq >/dev/null 2>&1 || {
  printf '%s\n' '{"permission":"deny","userMessage":"Blocked by repo policy","agentMessage":"The agent hooks require jq, which was not found on PATH. Install jq (https://jqlang.org) and retry."}'
  exit 0
}

input=$(cat)
ROOT=$(CDPATH= cd "$(dirname "$0")/../.." && pwd)

deny() {
  jq -n --arg m "$1" \
    '{permission:"deny", userMessage:"Blocked by repo policy", agentMessage:$m}'
  exit 0
}
allow() {
  jq -n '{permission:"allow"}'
  exit 0
}

# Fail closed: a malformed payload (jq parse failure / missing command) must
# deny, not silently allow.
cmd=$(printf '%s' "$input" | jq -re '.command // empty') ||
  deny "Invalid Cursor hook payload: could not read .command."
cwd=$(printf '%s' "$input" | jq -r '.cwd // ""')

# Cursor passes cwd rather than a literal `cd packages/...`, so catch
# yarn-run-from-a-workspace here before delegating.
case "$cwd" in
  "$ROOT"/packages | "$ROOT"/packages/*)
    case "$cmd" in
      yarn* | *" yarn "*)
        deny "Run yarn from the repo root, not a child workspace (AGENTS.md). Use 'yarn workspace <name> <cmd>' from $ROOT." ;;
    esac ;;
esac

# Delegate to the shared guards (they read .tool_input.command): git-safety and
# repo-admin writes. Fail closed: deny on a block (exit 2) AND on any
# unexpected guard failure.
payload=$(printf '{"tool_input":{"command":%s}}' "$(jq -n --arg c "$cmd" '$c')")
for guard in git-guard no-repo-admin; do
  status=0
  err=$(printf '%s' "$payload" | "$ROOT/scripts/agent-hooks/$guard.sh" 2>&1) || status=$?
  case "$status" in
    0) ;;
    2) deny "$err" ;;
    *) deny "$guard failed (exit $status): $err" ;;
  esac
done
allow
