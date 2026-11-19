#!/bin/zsh
# Fork-only (sc-5219 task 3.4). simkill.sh <udid> [--dry]: ends the page
# (WebContent) process of one simulator only. It finds that simulator's
# launchd_sim by its UDID, walks down from that pid, and prints each target's
# pid, parent chain and the UDID before ending it. It refuses unless the UDID
# is the one kill-run.sh created, named in $KILL_SIM_FILE, so no other
# simulator and nothing outside a simulator is ever touched.
udid=$1
mine=$(cat "${KILL_SIM_FILE:-/nonexistent}" 2>/dev/null)
if [ -z "$udid" ] || [ "$udid" != "$mine" ]; then
  echo "refused: $udid is not the simulator this run created (${mine:-none})"
  exit 2
fi
table=$(ps -axo pid=,ppid=,command=)
root=$(echo "$table" | awk -v u="$udid" '$3 ~ /launchd_sim$/ && index($0, u) { print $1 }' | head -1)
if [ -z "$root" ]; then
  echo "refused: no launchd_sim for $udid"
  exit 3
fi
below=($root)
frontier=($root)
while [ ${#frontier} -gt 0 ]; do
  next=()
  for p in $frontier; do
    for c in $(echo "$table" | awk -v p="$p" '$2 == p { print $1 }'); do
      below+=($c)
      next+=($c)
    done
  done
  frontier=($next)
done
targets=()
for p in $below; do
  cmd=$(echo "$table" | awk -v p="$p" '$1 == p { $1=""; $2=""; print }')
  [[ "$cmd" == *com.apple.WebKit.WebContent* ]] && targets+=($p)
done
if [ ${#targets} -eq 0 ]; then
  echo "no WebContent process under $udid"
  exit 4
fi
for t in $targets; do
  chain="$t"
  p=$t
  while [ "$p" != "$root" ] && [ "$p" != 1 ] && [ -n "$p" ]; do
    p=$(echo "$table" | awk -v q="$p" '$1 == q { print $2 }')
    chain="$chain <- $p"
  done
  if [ "$p" != "$root" ]; then
    echo "refused: $t is not under launchd_sim $root"
    exit 5
  fi
  echo "target pid $t, chain $chain (launchd_sim of $udid)"
  [ "$2" = "--dry" ] || kill -9 $t
done
