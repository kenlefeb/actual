#!/bin/sh
# Acceptance tests for no-repo-admin.sh (sc-696). Feeds sample hook payloads on
# stdin and asserts the exit code; no command here is ever executed.
# Run: sh scripts/agent-hooks/no-repo-admin.test.sh

dir=$(CDPATH= cd "$(dirname "$0")" && pwd)
hook="$dir/no-repo-admin.sh"
fail=0

# check <expected exit> <name> <raw payload>
check() {
  want=$1 name=$2
  printf '%s' "$3" | "$hook" >/dev/null 2>&1
  got=$?
  if [ "$got" -eq "$want" ]; then
    echo "ok   $name"
  else
    echo "FAIL $name (want exit $want, got $got)"
    fail=1
  fi
}

# cmd <expected exit> <name> <command>: wraps the command in a Bash payload.
cmd() {
  check "$1" "$2" "$(jq -n --arg c "$3" '{tool_input:{command:$c}}')"
}

# Blocked (exit 2)
cmd 2 'blocked 1: PATCH on protection with --input' 'gh api -X PATCH repos/kenlefeb/actual/branches/development/protection/required_status_checks --input -'
cmd 2 'blocked 2: -f on protection implies POST' 'gh api repos/kenlefeb/actual/branches/development/protection/required_status_checks -f strict=false'
cmd 2 'blocked 3: --method DELETE on protection' 'gh api --method DELETE repos/kenlefeb/actual/branches/development/protection'
cmd 2 'blocked 4: PATCH on the repo itself' 'gh api -X PATCH repos/kenlefeb/actual -f default_branch=master'
cmd 2 'blocked 5: graphql branch protection mutation' "gh api graphql -f query='mutation{updateBranchProtectionRule(input:{pattern:\"development\"}){clientMutationId}}'"
cmd 2 'blocked 6: gh repo edit' 'gh repo edit kenlefeb/actual --default-branch master'
cmd 2 'blocked 7: gh secret set' 'gh secret set FOO -R kenlefeb/actual'
cmd 2 'blocked 8: gh repo deploy-key add' 'gh repo deploy-key add k.pub -R kenlefeb/actual-hosting'
check 2 'blocked 9: malformed payload' 'not json {'

# Allowed (exit 0)
cmd 0 'allowed 10: GET protection' 'gh api repos/kenlefeb/actual/branches/development/protection'
cmd 0 'allowed 11: dismiss a Dependabot alert' 'gh api -X PATCH repos/kenlefeb/actual/dependabot/alerts/43 -f state=dismissed'
cmd 0 'allowed 12: gh pr merge' 'gh pr merge 164 -R kenlefeb/actual --squash'
cmd 0 'allowed 13: gh workflow enable' 'gh workflow enable fork-ci.yml'
cmd 0 'allowed 14: delete a branch ref' 'gh api -X DELETE repos/kenlefeb/actual/git/refs/heads/feature-x'
cmd 0 'allowed 15: search that only mentions the path' 'rg "branches/development/protection" docs/'

exit "$fail"
