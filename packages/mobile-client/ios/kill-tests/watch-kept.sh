#!/bin/zsh
# Fork-only (sc-5219 task 3.4). watch-kept.sh <udid> <App.app> <out-dir> [minutes]:
# boots a simulator kept from a stalled kill-test round, with its data as it
# was, and watches whether the app reopens the budget by itself. Every minute
# it saves the stage log and a screenshot. If the budget opens, it reads the
# test categories back and runs PRAGMA integrity_check on the exported budget.
# It never deletes the simulator; it shuts it down at the end.
udid=$1 app=$2 out=$3 minutes=${4:-15}
bid=com.actualbudget.actual
mkdir -p $out
xcrun simctl boot $udid 2> /dev/null
xcrun simctl bootstatus $udid -b > /dev/null 2>&1
# Installing over the app keeps its data container
xcrun simctl install $udid $app
docs=$(xcrun simctl get_app_container $udid $bid data)/Documents/kill
trap 'xcrun simctl shutdown $udid > /dev/null 2>&1; echo "simulator shut down, kept: $udid"' EXIT
rm -f $docs/reopen-watch.json $docs/error.json
start=$(date +%s)
xcrun simctl launch $udid $bid -UITestKill reopen:watch -UITestKillLimit $((minutes * 60)) > /dev/null
echo "launched at $(date -u +%H:%M:%S)"
minute=0
while [ ! -f $docs/reopen-watch.json ] && [ $(( $(date +%s) - start )) -lt $(( minutes * 60 + 60 )) ]; do
  perl -e 'select(undef,undef,undef,60)'
  minute=$((minute + 1))
  xcrun simctl io $udid screenshot $out/minute-$minute.png > /dev/null 2>&1
  echo "minute $minute: $(tail -1 $docs/progress.log 2>/dev/null)"
done
cp $docs/progress.log $out/progress.log 2>/dev/null
echo "--- stage log"
grep "reopen watch" $out/progress.log
[ -f $docs/reopen-watch.json ] || { echo "no result in $minutes minutes"; exit 1; }
echo "result: $(cat $docs/reopen-watch.json | cut -c1-600)"
grep -q '"reopenedBySelfSeconds":-1' $docs/reopen-watch.json && grep -q '"testOpen":"not needed"' $docs/reopen-watch.json && exit 1
echo "--- reading the budget back"
rm -f $docs/read.json
xcrun simctl terminate $udid $bid > /dev/null 2>&1
xcrun simctl launch $udid $bid -UITestKill read -UITestKillLimit 600 > /dev/null
for i in {1..600}; do [ -f $docs/read.json ] && break; perl -e 'select(undef,undef,undef,1)'; done
[ -f $docs/read.json ] || { echo "no read-back in 10 minutes: $(cat $docs/error.json 2>/dev/null)"; exit 1; }
node -e '
  const fs = require("fs");
  const r = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  fs.writeFileSync(process.argv[2], Buffer.from(r.zip, "base64"));
  console.log("test categories: " + r.names.join(", ") + " (" + r.names.length + "), error: " + r.error);
' $docs/read.json $out/budget.zip
rm -rf $out/db && unzip -q -o $out/budget.zip -d $out/db
echo "integrity_check: $(sqlite3 $(ls $out/db/*.sqlite | head -1) 'PRAGMA integrity_check;')"
