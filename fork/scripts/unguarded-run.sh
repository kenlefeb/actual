#!/bin/zsh
# Fork-only (sc-5219, the Designer's ruling). Run by hand on a Mac, never in CI:
# UnguardedPageUITests in a Release-configured build with a test page that loads
# without the storage guard, ending the page process when the test asks, so the
# next page load can be checked.
#
#   fork/scripts/unguarded-run.sh <look: light|dark|ax5> [--skip-stage]
#
# The page is built with FORK_TEST_HOOKS=true FORK_TEST_PAGE_UNGUARDED=true; the
# Release build bundles it only with FORK_RELEASE_SMOKE_TEST_PAGE=YES (a simulator
# build, never an archive). One fresh simulator, refused if any is booted, deleted
# after. The page process is ended with packages/mobile-client/ios/kill-tests/simkill.sh,
# which touches only the simulator this run created.
# Evidence: ~/Library/Developer/HomeEconomicsSpike/guard-flip-5219/unguarded-release-<look>-<time>/
set -u
W=${0:A:h:h:h}
look=${1:-light}
run=unguarded-release-$look-$(date +%m%d-%H%M)
D=$HOME/Library/Developer/HomeEconomicsSpike/guard-flip-5219/$run
mkdir -p $D
export PATH=$HOME/.nvm/versions/node/v24.22.1/bin:$PATH
sim= watcher=
export KILL_SIM_FILE=$D/simulator-udid
cleanup() {
  [ -n "$watcher" ] && kill $watcher 2> /dev/null
  [ -n "$sim" ] && { xcrun simctl shutdown $sim > /dev/null 2>&1; xcrun simctl delete $sim > /dev/null 2>&1; }
  echo "simulator ${sim:-none} deleted"
}
trap cleanup EXIT INT TERM
if [ $(xcrun simctl list devices booted | grep -c Booted) -gt 0 ]; then echo "a simulator is already booted; not starting"; exit 2; fi
cd $W
if [ "${2:-}" != "--skip-stage" ]; then
  env FORK_TEST_HOOKS=true FORK_TEST_PAGE_UNGUARDED=true corepack yarn build:browser > $D/page-build.log 2>&1 || { echo "page build failed"; exit 1; }
  corepack yarn workspace mobile-client stage:www > /dev/null 2>&1 && (cd packages/mobile-client && npx --no-install cap copy ios > /dev/null 2>&1) || { echo "stage failed"; exit 1; }
  grep -lq __forkTestPageUnguarded packages/mobile-client/ios/App/App/public/static/js/*.js && echo "staged the unguarded test page (marker present)"
fi
sim=$(xcrun simctl create "sc-5219 unguarded" com.apple.CoreSimulator.SimDeviceType.iPhone-16e com.apple.CoreSimulator.SimRuntime.iOS-27-0)
echo $sim > $KILL_SIM_FILE
xcrun simctl bootstatus $sim -b > /dev/null 2>&1
echo "simulator $sim booted; $(uptime | sed 's/.*load/load/')"
# Ends the page process once, when the test asks
(
  until grep -q "unguarded evidence: kill the page now" $D/xcodebuild.log 2> /dev/null; do perl -e 'select(undef,undef,undef,0.5)'; done
  zsh $W/packages/mobile-client/ios/kill-tests/simkill.sh $sim
) > $D/kill.txt 2>&1 &
watcher=$!
cd packages/mobile-client/ios/App
TEST_RUNNER_UNGUARDED=page TEST_RUNNER_UNGUARDED_KILL=1 TEST_RUNNER_UNGUARDED_RUN=$run TEST_RUNNER_UNGUARDED_LOOK=$look \
xcodebuild test -workspace App.xcworkspace -scheme App -configuration Release \
  -destination "platform=iOS Simulator,id=$sim" -derivedDataPath ${UNGUARDED_DERIVED:-$TMPDIR/unguarded-derived} \
  CODE_SIGNING_ALLOWED=NO FORK_RELEASE_SMOKE_TEST_PAGE=YES \
  -only-testing:AppUITests/UnguardedPageUITests -resultBundlePath $D/result.xcresult > $D/xcodebuild.log 2>&1
echo "exit=$?"
grep -E "error:|Test Case .*(passed|failed|skipped)" $D/xcodebuild.log | sed -E 's/^.*AppUITests\///' | cut -c1-240 | tail -4
grep "unguarded evidence" $D/xcodebuild.log | sort -u | cut -c1-300
cat $D/kill.txt | tail -2
xcrun simctl spawn $sim log show --last 30m --style compact --predicate 'eventMessage CONTAINS "actual storage guard"' 2> /dev/null | grep "actual storage" | cut -c1-240 | tee $D/guard-log.txt
echo "evidence: $D"
