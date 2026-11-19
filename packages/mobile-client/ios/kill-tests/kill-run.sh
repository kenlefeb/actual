#!/bin/zsh
# Fork-only (sc-5219 task 3.4, design D12): the iPhone kill tests, one
# simulator session. Debug build of the app with a FORK_TEST_HOOKS=true page
# staged (for the control run). It creates its own simulator, refuses to start
# if two are already booted, and shuts it down and deletes it at the end.
#   kill-run.sh <App.app> <out-dir> kills|all|rest|delay|reopen|migrate|series
#   series: SERIES_ROUNDS launches of SERIES_WRITES barrier-on writes each, no kill between (sc-5404)
#   kills: 20 kills right after native/persisted answers stored, then one kill
#          mid-write; it stops at once if a stored write is lost
#   all:   then 5 kills with the page bridge's barrier off
#   rest:  the mid-write kill and those 5 only
#   delay: with a page built FORK_TEST_COMMIT_DELAY_MS=300, the budget opened
#          and stored first (out of the migration window), DELAY_KILLS (default
#          5) kills with the barrier on, each read back (all must be kept; rows
#          in <out-dir>/delayed-table.txt), then the control (barrier off, at
#          least 1 must be lost): the pair that shows the barrier saves them
# Each part ends with a read: the test categories still there, and
# PRAGMA integrity_check on the exported budget.
app=$1 out=$2 phase=$3
here=${0:A:h}
bid=com.actualbudget.actual
mkdir -p $out
export KILL_SIM_FILE=$out/kill-sim.txt
booted=$(xcrun simctl list devices booted | grep -c Booted)
echo "booted before: $booted"
if [ $booted -ge 2 ]; then
  echo "two simulators already booted: not starting"
  exit 9
fi
sim=$(xcrun simctl create "sc-5219 kill $phase" com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro com.apple.CoreSimulator.SimRuntime.iOS-27-0)
echo $sim > $KILL_SIM_FILE
echo "simulator $sim"
keep=0
cleanup() {
  xcrun simctl shutdown $sim > /dev/null 2>&1
  if [ $keep = 1 ]; then
    echo "simulator kept, shut down, for its data: $sim"
  else
    xcrun simctl delete $sim > /dev/null 2>&1
    echo "simulator deleted: $sim"
  fi
}
trap cleanup EXIT
xcrun simctl boot $sim
xcrun simctl bootstatus $sim -b > /dev/null 2>&1
xcrun simctl install $sim $app
docs=$(xcrun simctl get_app_container $sim $bid data)/Documents/kill

# Seconds a step may wait for the page; the reopen phase raises it (REOPEN_LIMIT)
limit=300
alerted=0
pause() { perl -e "select(undef,undef,undef,$1)"; }
launch() {
  xcrun simctl terminate $sim $bid > /dev/null 2>&1
  # A killed step leaves its own error behind; it isn't the next step's
  rm -f $docs/error.json $docs/progress.json
  xcrun simctl launch $sim $bid -UITestKill "$1" -UITestKillLimit $limit > /dev/null
}
waitfor() {
  for i in {1..$(( (limit + 20) * 10 ))}; do
    [ -f "$1" ] && return 0
    [ -f "$docs/error.json" ] && { echo "app error: $(cat $docs/error.json)"; return 1; }
    # A page alert() holds the page's JavaScript until someone taps it: nothing more will come
    grep -q "page alert shown" $docs/progress.json 2>/dev/null && { echo "page alert: $(cat $docs/progress.json)"; alerted=1; return 1; }
    [ $((i % 300)) -eq 0 ] && echo "  still waiting ($((i / 10)) s): $(cat $docs/progress.json 2>/dev/null)"
    pause 0.1
  done
  echo "timed out waiting for $1"
  return 1
}
# Reads back after a kill: test categories, and the exported budget's integrity
readback() {
  rm -f $docs/read.json
  launch read
  waitfor $docs/read.json || return 1
  node -e '
    const fs = require("fs");
    const r = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    fs.writeFileSync(process.argv[2], Buffer.from(r.zip, "base64"));
    console.log(JSON.stringify({ names: r.names.length, bulk: r.bulk, error: r.error }));
    fs.writeFileSync(process.argv[3], r.names.join("\n"));
  ' $docs/read.json $out/$1.zip $out/$1-names.txt
  rm -rf $out/$1-db
  unzip -q -o $out/$1.zip -d $out/$1-db
  db=$(ls $out/$1-db/*.sqlite | head -1)
  echo "integrity_check ($1): $(sqlite3 $db 'PRAGMA integrity_check;')"
}

# A step that never finished: what the app logged, the screen, and the
# simulator's storage, copied before anything is deleted and checked
diagnose() { # label
  local d=$out/stall-$1
  mkdir -p $d
  cp $docs/progress.log $d/ 2>/dev/null
  echo "--- stall $1: the app's log"
  cat $docs/progress.log 2>/dev/null | tail -20
  cat $docs/error.json 2>/dev/null && echo
  xcrun simctl io $sim screenshot $d/screen.png > /dev/null 2>&1 && echo "screenshot: $d/screen.png"
  cp -R "$(xcrun simctl get_app_container $sim $bid data)/Library" $d/Library 2>/dev/null
  for f in $(find $d/Library -name '*.sqlite3' -o -name '*.sqlite' 2>/dev/null); do
    echo "integrity_check ${f#$d/}: $(sqlite3 "$f" 'PRAGMA integrity_check;' 2>&1 | head -3 | tr '\n' ' ')"
  done
}

kill_after() { # name mode
  rm -f $docs/result-$1.json
  launch "$2:$1"
  if ! waitfor $docs/result-$1.json; then
    diagnose $1-a
    if [ $alerted = 1 ]; then
      echo "$1: the budget did not open (page alert): keeping the data"
      keep=1
      return 1
    fi
    echo "--- repeating $1 once"
    launch "$2:$1"
    if ! waitfor $docs/result-$1.json; then
      diagnose $1-b
      echo "$1 stalled twice: stopping, keeping the data"
      keep=1
      return 1
    fi
  fi
  echo "$1 answer: $(cat $docs/result-$1.json)"
  zsh $here/simkill.sh $sim
  # How long after the answer was written the kill landed (sc-5404: a control's
  # commit delay must be longer than this for the kill to land inside it)
  echo "$1 kill latency: $(perl -MTime::HiRes=time -e 'printf "%d", (time - (stat($ARGV[0]))[9]) * 1000' $docs/result-$1.json) ms after the answer"
  pause 4
}

echo "--- refusal check"
zsh $here/simkill.sh 00000000-0000-0000-0000-000000000000 --dry
if [ $phase = migrate ]; then
  # Kill while a fresh budget is created and migrated (every migration is its
  # own commit), at offsets spread over the open, then relaunch: does it open?
  limit=${REOPEN_LIMIT:-120}
  echo "round | kill offset after the bridge | reopened by itself | screen"
  for n in {1..${REOPEN_ROUNDS:-10}}; do
    offset=$(( n * ${MIGRATE_STEP_MS:-250} ))
    rm -f $docs/budget-id $docs/result-mig-$n.json
    launch control:mig-$n
    for i in {1..600}; do grep -q "page's bridge ready" $docs/progress.json 2>/dev/null && break; pause 0.1; done
    pause $(( offset / 1000.0 ))
    echo "mig-$n at $offset ms, stage then: $(cat $docs/progress.json 2>/dev/null)"
    zsh $here/simkill.sh $sim
    pause 4
    # The test budget's id is fixed; the kill may come before the hook saved it
    print -n _test-budget > $docs/budget-id
    rm -f $docs/reopen-mig-$n.json
    launch reopen:mig-$n
    if ! waitfor $docs/reopen-mig-$n.json; then
      echo "$n | $offset ms | no (page alert) | $(cat $docs/progress.json)"
      cp $docs/progress.log $out/progress-mig-$n.log 2>/dev/null
      diagnose mig-$n
      keep=1
      exit 1
    fi
    echo "$n | $offset ms | $(node -e 'const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); console.log((r.reopenedBySelfSeconds < 0 ? "no" : r.reopenedBySelfSeconds + " s") + " | " + r.testOpen)' $docs/reopen-mig-$n.json)"
  done
  exit 0
fi
if [ $phase = reopen ]; then
  # Kill, then relaunch and let the app reopen the budget by itself before the
  # test opens it. REOPEN_MODE=control (barrier off: with a delayed page the
  # kill lands in a held commit) or write (barrier on: killed after stored).
  # REOPEN_LIMIT: seconds each relaunch may take (default 600).
  mode=${REOPEN_MODE:-control} limit=${REOPEN_LIMIT:-600}
  echo "mode $mode, limit $limit s per relaunch"
  echo "round | page's bridge ready | reopened by itself | test's own open | screen"
  for n in {1..${REOPEN_ROUNDS:-5}}; do
    kill_after reopen-kill-$n $mode || exit 1
    pause 1
    rm -f $docs/reopen-$n.json
    launch reopen:$n
    waitfor $docs/reopen-$n.json || { echo "$n | did not reopen"; cp $docs/progress.log $out/progress-$n.log 2>/dev/null; diagnose reopen-$n; keep=1; exit 1; }
    xcrun simctl io $sim screenshot $out/reopen-$n.png > /dev/null 2>&1
    cp $docs/progress.log $out/progress-$n.log 2>/dev/null
    row=$(node -e '
      const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
      const p = JSON.parse(r.page || "{}");
      console.log([r.bridgeSeconds + " s", r.reopenedBySelfSeconds < 0 ? "no" : r.reopenedBySelfSeconds + " s",
        r.testOpen, (p.text || "").replace(/\s+/g, " ").slice(0, 60)].join(" | "));
    ' $docs/reopen-$n.json)
    echo "$n | $row"
    if grep -q '"reopenedBySelfSeconds":-1' $docs/reopen-$n.json; then
      echo "round $n: the app did not reopen the budget by itself: keeping the data"
      diagnose reopen-$n
      keep=1
      exit 1
    fi
  done
  readback after-reopen || exit 1
  echo "kept: $(grep -c '^reopen-kill-' $out/after-reopen-names.txt) of ${REOPEN_ROUNDS:-5}"
  exit 0
fi
if [ $phase = series ]; then
  # sc-5404: SERIES_WRITES barrier-on writes in one launch, no kill between,
  # after the budget is created and stored; each answer and how long it took
  launch write:warm-up
  waitfor $docs/result-warm-up.json || exit 1
  echo "warm-up: $(cat $docs/result-warm-up.json); waiting ${WARMUP_SECONDS:-90} s"
  pause ${WARMUP_SECONDS:-90}
  for round in {1..${SERIES_ROUNDS:-3}}; do
    rm -f $docs/writes.json
    launch writes:${SERIES_WRITES:-5}
    waitfor $docs/writes.json || exit 1
    echo "--- round $round (relaunched), load $(uptime | sed 's/.*averages: //')"
    cat $docs/writes.json; echo
    pause ${SERIES_PAUSE:-0}
  done
  exit 0
fi
if [ $phase = delay ]; then
  # A page built with FORK_TEST_COMMIT_DELAY_MS=300: every commit waits 300 ms.
  # DELAY_KILLS (default 5): barrier-on kills, each read back on its own.
  kills=${DELAY_KILLS:-5}
  # A read that stalls keeps the simulator and its storage
  held_read() { readback $1 && return 0; diagnose $1; keep=1; return 1; }
  # Create and migrate the budget, then wait until all of it is stored: every
  # migration is its own commit, so with the delay they reach storage well
  # after the budget opens, and a kill before then lands in the migration window
  # (native/persisted answers at once, so the first write's answer is still
  # stored: false). Wait, then a second write: commits are stored in order, so
  # its stored: true means every migration before it is stored too
  echo "--- warm-up: open the test budget and wait until it is stored"
  rm -f $docs/result-warm-up.json
  launch write:warm-up
  waitfor $docs/result-warm-up.json || { diagnose warm-up; keep=1; exit 1; }
  echo "warm-up answer: $(cat $docs/result-warm-up.json); waiting ${WARMUP_SECONDS:-90} s for storage"
  pause ${WARMUP_SECONDS:-90}
  kill_after warm-up-2 prewrite || exit 1
  grep -q '"stored":true' $docs/result-warm-up-2.json || { echo "the warm-up was not stored in time: stopping"; exit 1; }
  held_read warm-up || exit 1
  echo "--- barrier on, 300 ms commit delay: $kills kills right after stored: true, each read back"
  # A write can still miss native-persist-wait-ms under load and be answered
  # stored: false; it makes no promise, so it is killed but not counted (up to 3x tries)
  echo "try | answer | write took | load | counted | this write kept | all stored writes kept | integrity_check" > $out/delayed-table.txt
  stored=() a=0
  while [ ${#stored} -lt $kills ] && [ $a -lt $((kills * 3)) ]; do
    a=$((a + 1))
    # The counted write is the second after the launch: with the test's 300 ms
    # delay the reopen's commits put the first past the 2 s wait (series-1200:
    # first 2.0-2.3 s, later 1.5-1.9 s; without the delay 0.1-0.4 s at load 650)
    kill_after kill-delayed-$a prewrite || exit 1
    answer="$(cat $docs/result-kill-delayed-$a.json) | $(grep -o 'answered in [0-9]* ms' $docs/progress.log | tail -1 | cut -d' ' -f3-) | $(uptime | sed 's/.*averages: //' | cut -d' ' -f1)"
    if ! grep -q '"stored":true' $docs/result-kill-delayed-$a.json; then
      echo "$a | $answer | no (not stored in time) | - | - | -" | tee -a $out/delayed-table.txt
      continue
    fi
    stored+=(kill-delayed-$a)
    held_read after-delayed-$a || exit 1
    names=$out/after-delayed-$a-names.txt
    grep -qx "kill-delayed-$a" $names && kept=yes || kept=no
    all=0
    for w in $stored; do grep -qx $w $names && all=$((all + 1)); done
    check=$(sqlite3 $(ls $out/after-delayed-$a-db/*.sqlite | head -1) 'PRAGMA integrity_check;')
    echo "$a | $answer | ${#stored} | $kept | $all of ${#stored} | $check" | tee -a $out/delayed-table.txt
    if [ $kept != yes ] || [ $all != ${#stored} ] || [ "$check" != ok ]; then
      echo "a stored write was lost or the check failed after try $a: stopping"
      keep=1
      exit 1
    fi
  done
  if [ ${#stored} -lt $kills ]; then
    echo "only ${#stored} of $kills writes were answered stored in $a tries: stopping"
    exit 1
  fi
  echo "all $kills stored writes kept"
  # The control last, so a budget it strands can't spoil the barrier result
  echo "--- control: barrier off, 300 ms commit delay"
  for n in {1..5}; do kill_after control-$n control || exit 1; done
  held_read after-control || exit 1
  kept=$(grep -c '^control-' $out/after-control-names.txt)
  echo "control kept: $kept of 5 (integrity: $(sqlite3 $(ls $out/after-control-db/*.sqlite | head -1) 'PRAGMA integrity_check;'))"
  if [ "$kept" = 5 ]; then
    echo "the control lost nothing: the delay didn't bite, so the barrier result is inconclusive"
    exit 1
  fi
  exit 0
fi
if [ $phase != rest ]; then
  echo "--- 20 kills right after stored: true"
  for n in {1..20}; do
    kill_after kill-$n write || exit 1
    grep -q '"stored":true' $docs/result-kill-$n.json || { echo "kill-$n was not answered stored: stopping"; exit 1; }
  done
  readback after-kills || exit 1
  kept=$(grep -c '^kill-' $out/after-kills-names.txt)
  echo "kept: $kept of 20"
  check=$(sqlite3 $(ls $out/after-kills-db/*.sqlite | head -1) 'PRAGMA integrity_check;')
  if [ "$kept" != 20 ] || [ "$check" != ok ]; then
    echo "a stored write was lost or the check failed: stopping"
    exit 1
  fi
fi
echo "--- mid-write"
readback before-bulk || exit 1
rm -f $docs/bulk-started.json
launch bulk
waitfor $docs/bulk-started.json || exit 1
pause 2
zsh $here/simkill.sh $sim
pause 4
readback after-bulk || exit 1
[ $phase = kills ] && exit 0
echo "--- control: barrier off (page hook), no commit delay"
for n in {1..5}; do kill_after control-$n control || exit 1; done
readback after-control || exit 1
echo "kept: $(grep -c '^control-' $out/after-control-names.txt) of 5"
