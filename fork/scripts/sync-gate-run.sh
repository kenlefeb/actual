#!/bin/zsh
# Fork-only (sc-5219, "Only stored changes reach the server"). Run by hand on a
# Mac, never in CI: shows on an iPhone simulator that a sync after a change sends
# nothing until this device has stored it.
#
#   fork/scripts/sync-gate-run.sh [--skip-stage]
#
# 1. Stages a test page whose storage commits take 3 s (FORK_TEST_HOOKS, longer
#    than the 2 s storage wait), unless --skip-stage.
# 2. Starts a throwaway sync server bound to 127.0.0.1:5007, with its own data
#    folder and a random password kept only in that folder (never printed,
#    never committed).
# 3. Counts the server's stored messages twice a second, with times.
# 4. Runs SyncGateUITests on a fresh simulator (one at a time: it refuses to
#    start if any simulator is booted).
# 5. Stops the server, deletes its data and the simulator.
# Evidence: ~/Library/Developer/HomeEconomicsSpike/guard-flip-5219/sync-gate-<time>/
set -u
W=${0:A:h:h:h}
D=$HOME/Library/Developer/HomeEconomicsSpike/guard-flip-5219/sync-gate-$(date +%m%d-%H%M)
DATA=$(mktemp -d -t sync-gate)
PORT=5007
mkdir -p $D
export PATH=$HOME/.nvm/versions/node/v24.22.1/bin:$PATH
server= counter= sim=
cleanup() {
  [ -n "$counter" ] && kill $counter 2> /dev/null
  [ -n "$server" ] && pkill -P $server 2> /dev/null; [ -n "$server" ] && kill $server 2> /dev/null
  [ -n "$sim" ] && { xcrun simctl shutdown $sim > /dev/null 2>&1; xcrun simctl delete $sim > /dev/null 2>&1; }
  rm -rf $DATA
  echo "cleaned up: server stopped, its data deleted, simulator ${sim:-none} deleted"
}
trap cleanup EXIT INT TERM

if [ $(xcrun simctl list devices booted | grep -c Booted) -gt 0 ]; then echo "a simulator is already booted; not starting"; exit 2; fi
cd $W
if [ "${1:-}" != "--skip-stage" ]; then
  env FORK_TEST_HOOKS=true FORK_TEST_COMMIT_DELAY_MS=3000 corepack yarn build:browser > $D/page-build.log 2>&1 || { echo "page build failed"; exit 1; }
  corepack yarn workspace mobile-client stage:www > /dev/null 2>&1 && (cd packages/mobile-client && npx --no-install cap copy ios > /dev/null 2>&1) || { echo "stage failed"; exit 1; }
  echo "staged the 3 s commit page"
fi

# The server, on localhost only
ACTUAL_DATA_DIR=$DATA ACTUAL_PORT=$PORT ACTUAL_HOSTNAME=127.0.0.1 corepack yarn workspace @actual-app/sync-server start > $D/server.log 2>&1 &
server=$!
for i in {1..120}; do curl -s -o /dev/null http://127.0.0.1:$PORT/health && break; perl -e 'select(undef,undef,undef,1)'; done
curl -s -o /dev/null http://127.0.0.1:$PORT/health || { echo "the server did not start (see $D/server.log)"; exit 1; }
openssl rand -hex 16 > $DATA/password
printf '{"password":"%s"}' "$(cat $DATA/password)" > $DATA/bootstrap.json
curl -s -o $D/bootstrap.json -X POST -H 'Content-Type: application/json' --data @$DATA/bootstrap.json http://127.0.0.1:$PORT/account/bootstrap
echo "server up on 127.0.0.1:$PORT; bootstrap: $(head -c 80 $D/bootstrap.json | sed 's/"token":"[^"]*"/"token":"…"/')"

# The server's stored messages: a line each time the count changes
(
  last=
  while true; do
    for f in $DATA/user-files/group-*.sqlite(N); do
      now=$(sqlite3 $f "select count(*) || ' messages, newest ' || ifnull(max(timestamp),'-') from messages_binary" 2> /dev/null)
      [ "$now" != "$last" ] && { echo "$(date +%Y-%m-%dT%H:%M:%S.%3N 2>/dev/null || date +%Y-%m-%dT%H:%M:%S) ${f:t}: $now"; last=$now; }
    done
    perl -e 'select(undef,undef,undef,0.5)'
  done
) > $D/server-messages.txt 2>&1 &
counter=$!

sim=$(xcrun simctl create "sc-5219 sync gate" com.apple.CoreSimulator.SimDeviceType.iPhone-16e com.apple.CoreSimulator.SimRuntime.iOS-27-0)
xcrun simctl bootstatus $sim -b > /dev/null 2>&1
echo "simulator $sim"
cd packages/mobile-client/ios/App
TEST_RUNNER_SYNC_GATE_SETTLE_S=${SYNC_GATE_SETTLE_S:-600} TEST_RUNNER_SYNC_GATE_WATCH_S=${SYNC_GATE_WATCH_S:-150} TEST_RUNNER_SYNC_GATE_URL=http://localhost:$PORT TEST_RUNNER_SYNC_GATE_PASSWORD=$(cat $DATA/password) \
xcodebuild test -workspace App.xcworkspace -scheme App -configuration Debug \
  -destination "platform=iOS Simulator,id=$sim" -derivedDataPath ${SYNC_GATE_DERIVED:-$TMPDIR/sync-gate-derived} \
  CODE_SIGNING_ALLOWED=NO -only-testing:AppUITests/SyncGateUITests > $D/xcodebuild.log 2>&1
echo "exit=$?"
grep -E "error:|Test Case .*(passed|failed)" $D/xcodebuild.log | sed -E 's/^.*AppUITests\///' | cut -c1-220 | tail -3
grep "sync gate evidence" $D/xcodebuild.log | sort -u | sed 's/^.*sync gate evidence: //' | tee $D/app-evidence.txt
echo "--- server messages"
cat $D/server-messages.txt
grep -c '"route":"/sync/sync"' $D/server.log | sed 's/^/sync requests: /'
grep '"route":"/sync/sync"' $D/server.log | sed -E 's/.*"time":"([^"]*)".*"status":([0-9]+).*/\1 \2/' > $D/sync-requests.txt
echo "evidence: $D"
