#!/bin/sh
# Shared agent guard that blocks GitHub repo-admin writes from the shell (sc-696),
# wired next to git-guard.sh for Claude (PreToolUse[Bash]), Codex
# (PreToolUse[^Bash$]) and Cursor (beforeShellExecution via guard-shell.sh).
#
# Agents run `gh` as Ken, an admin on both repos, so a mistaken or
# prompt-injected command could rewrite branch protection or repo settings.
# Blocked (exit 2 + stderr feeds the reason back to the agent):
#   - `gh api` writes (-X/--method PUT|PATCH|POST|DELETE, or any -f/-F/--field/
#     --raw-field/--input, which make gh send a POST) to repo settings, branch
#     protection, rulesets, collaborators, deploy keys, hooks, environments,
#     transfer, Actions secrets/variables/permissions, Dependabot secrets,
#     vulnerability-alerts and automated-security-fixes;
#   - `gh api graphql` mentioning a branch-protection, ruleset or
#     updateRepository mutation;
#   - `gh repo edit|delete|rename|archive|unarchive`, `gh repo deploy-key
#     add|delete`, `gh secret set|delete`, `gh variable set|delete`, and any
#     `gh ruleset` subcommand except list|view|check.
# Reads, PR work, workflow enable/disable, Dependabot alert dismissals and
# branch deletion pass.
#
# There is deliberately NO override variable (an agent could set it).
# shortcut: this reads command text only. `gh auth token` plus curl, `sh -c`,
# xargs or another harness gets around it. It is a speed bump; the real
# boundary is a token without Administration rights (sc-696, part a).

. "$(dirname "$0")/common.sh"
require_jq

block() {
  echo "Blocked: agents must not change repo admin settings (branch protection, rulesets, secrets, deploy keys, hooks, repo settings). $1 Post the exact command on the story for Security Analyst sign-off; Ken runs it himself in his own terminal or the GitHub web UI. (scripts/agent-hooks/no-repo-admin.sh)" >&2
  exit 2
}

# Fail closed: a payload we can't read blocks rather than allows.
cmd=$(jq -re '.tool_input | objects | .command // ""' 2>/dev/null) ||
  block "Could not read the hook payload (.tool_input.command)."
[ -z "$cmd" ] && exit 0

# True when $1 (an API path) is a repo-admin endpoint. Components are matched
# by position, so a branch literally named "hooks" is not mistaken for /hooks.
is_admin_path() {
  p=${1#\"}; p=${p%\"}; p=${p#\'}; p=${p%\'}
  p=${p#https://*/}
  p=${p%%\?*}; p=${p#/}; p=${p%/}
  old=$IFS; IFS=/; set -f; set -- $p; IFS=$old
  [ "${1:-}" = repos ] || return 1
  [ $# -eq 3 ] && return 0
  case "${4:-}" in
    hooks | keys | collaborators | rulesets | environments | transfer | \
      vulnerability-alerts | automated-security-fixes) return 0 ;;
    branches)
      shift 4
      for c; do [ "$c" = protection ] && return 0; done ;;
    actions) case "${5:-}" in secrets | variables | permissions) return 0 ;; esac ;;
    dependabot) [ "${5:-}" = secrets ] && return 0 ;;
  esac
  return 1
}

# $1: the tokens after `gh api`.
check_api() {
  set -f
  set -- $1
  method='' write=0 prev='' path='' seen=''
  for t; do
    if [ -n "$prev" ]; then
      case "$prev" in -X | --method) method=$(printf '%s' "$t" | tr a-z A-Z) ;; esac
      prev=''
      continue
    fi
    case "$t" in
      -X | --method) prev=$t ;;
      -X?*) method=$(printf '%s' "${t#-X}" | tr a-z A-Z) ;;
      --method=*) method=$(printf '%s' "${t#--method=}" | tr a-z A-Z) ;;
      -f | -F | --field | --raw-field | --input) write=1; prev=$t ;;
      -f?* | -F?* | --field=* | --raw-field=* | --input=*) write=1 ;;
      -H | --header | -q | --jq | -t | --template | --hostname | --cache | -p | --preview) prev=$t ;;
      -*) ;;
      *)
        if [ -z "$seen" ]; then seen=1 # the literal `api`
        elif [ -z "$path" ]; then path=$t; fi ;;
    esac
  done
  case "$method" in
    GET) return 0 ;;
    PUT | PATCH | POST | DELETE) write=1 ;;
  esac
  [ "$write" -eq 1 ] || return 0
  if [ "$path" = graphql ]; then
    case "$cmd" in
      *createBranchProtectionRule* | *updateBranchProtectionRule* | *deleteBranchProtectionRule* | \
        *createRepositoryRuleset* | *updateRepositoryRuleset* | *deleteRepositoryRuleset* | *updateRepository*)
        block "This GraphQL mutation changes branch protection or repo settings." ;;
    esac
    return 0
  fi
  is_admin_path "$path" && block "'gh api' write to '$path' changes repo settings."
}

# $1: one command segment. Only a segment that runs `gh` (after env
# assignments and wrappers) is inspected, so text that merely mentions gh,
# such as a commit message or an rg pattern, passes.
check_segment() {
  set -f
  set -- $1
  while [ $# -gt 0 ]; do
    case "$1" in
      *=* | env | command | exec | sudo | time | nohup | op | plugin | run | --) shift ;;
      *) break ;;
    esac
  done
  [ "${1:-}" = gh ] || return 0
  shift
  rest="$*"
  skip=0 words=''
  for t; do
    if [ "$skip" -eq 1 ]; then skip=0; continue; fi
    case "$t" in
      -R | --repo | --hostname) skip=1 ;;
      -*) ;;
      *) words="$words $t" ;;
    esac
  done
  set -- $words
  case "${1:-} ${2:-}" in
    "api "*) check_api "$rest" ;;
    "repo edit" | "repo delete" | "repo rename" | "repo archive" | "repo unarchive")
      block "'gh $1 $2' changes the repository." ;;
    "repo deploy-key")
      case "${3:-}" in add | delete) block "'gh repo deploy-key $3' changes deploy keys." ;; esac ;;
    "secret set" | "secret delete" | "variable set" | "variable delete")
      block "'gh $1 $2' changes Actions secrets or variables." ;;
    "ruleset "*)
      case "${2:-}" in list | view | check) ;; *) block "'gh ruleset $2' changes rulesets." ;; esac ;;
  esac
  return 0
}

# Split on ; | & ( ) ` and newlines, then check each segment.
segments=$(printf '%s\n' "$cmd" | tr ';|&()`' '\n\n\n\n\n\n')
while IFS= read -r seg; do
  check_segment "$seg"
done <<EOF
$segments
EOF

exit 0
