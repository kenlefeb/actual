#!/bin/zsh
# Fork-only (sc-5219 task 3.4, design D12): the iPhone kill tests, one
# simulator session. Debug build of the app with a FORK_TEST_HOOKS=true page
# staged (for the control run). It creates its own simulator, refuses to start
# if two are already booted, and shuts it down and deletes it at the end.
#   kill-run.sh <App.app> <out-dir> kills|all
#   kills: 20 kills right after native/persisted answers stored, then one kill
#          mid-write; it stops at once if a stored write is lost
#   all:   then the control, 5 kills with the page bridge's barrier off; at
#          least 1 should be lost. The 300 ms commit delay hook is read in the
#          engine's worker, which the page can't set, so it isn't used.
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
cleanup() {
  xcrun simctl shutdown $sim > /dev/null 2>&1
  xcrun simctl delete $sim > /dev/null 2>&1
  echo "simulator deleted: $sim"
}
trap cleanup EXIT
xcrun simctl boot $sim
xcrun simctl bootstatus $sim -b > /dev/null 2>&1
xcrun simctl install $sim $app
docs=$(xcrun simctl get_app_container $sim $bid data)/Documents/kill

pause() { perl -e "select(undef,undef,undef,$1)"; }
launch() {
  xcrun simctl terminate $sim $bid > /dev/null 2>&1
  # A killed step leaves its own error behind; it isn't the next step's
  rm -f $docs/error.json $docs/progress.json
  xcrun simctl launch $sim $bid -UITestKill "$1" > /dev/null
}
waitfor() {
  for i in {1..3000}; do
    [ -f "$1" ] && return 0
    [ -f "$docs/error.json" ] && { echo "app error: $(cat $docs/error.json)"; return 1; }
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

kill_after() { # name mode
  rm -f $docs/result-$1.json
  launch "$2:$1"
  waitfor $docs/result-$1.json || return 1
  echo "$1 answer: $(cat $docs/result-$1.json)"
  zsh $here/simkill.sh $sim
  pause 4
}

echo "--- refusal check"
zsh $here/simkill.sh 00000000-0000-0000-0000-000000000000 --dry
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
echo "--- mid-write"
rm -f $docs/bulk-started.json
launch bulk
waitfor $docs/bulk-started.json || exit 1
pause 2
zsh $here/simkill.sh $sim
pause 4
readback after-bulk || exit 1
[ $phase = all ] || exit 0
echo "--- control: barrier off (page hook), no commit delay"
for n in {1..5}; do kill_after control-$n control || exit 1; done
readback after-control || exit 1
echo "kept: $(grep -c '^control-' $out/after-control-names.txt) of 5"
