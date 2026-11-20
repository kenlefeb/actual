#!/bin/sh
# Fork-only (sc-5219, Security's ruling on the guard flip). The iPhone app's
# "Check the bundled page holds no test hooks" build phase: a Release build
# fails when the page it bundles holds a storage test hook, so a local Xcode
# archive can't skip the check that fork-ios.yml runs before its own archive.
#
# The one escape, for the Release smoke run (ReleaseSmokeUITests), which bundles
# a hooks page on purpose: the build setting FORK_RELEASE_SMOKE_TEST_PAGE=YES,
# passed on the xcodebuild command line. It is honoured only for a simulator
# build (PLATFORM_NAME iphonesimulator) that is not an archive (ACTION not
# install), so no build that can reach a device or the App Store can use it.
set -eu

[ "${CONFIGURATION:-}" = "Release" ] || exit 0

page="${TARGET_BUILD_DIR}/${UNLOCALIZED_RESOURCES_FOLDER_PATH}/public"

if [ "${FORK_RELEASE_SMOKE_TEST_PAGE:-}" = "YES" ]; then
  if [ "${PLATFORM_NAME:-}" = "iphonesimulator" ] && [ "${ACTION:-}" != "install" ]; then
    echo "warning: FORK_RELEASE_SMOKE_TEST_PAGE=YES: this simulator Release build skips the test-hook check (Release smoke run only)"
    exit 0
  fi
  echo "error: FORK_RELEASE_SMOKE_TEST_PAGE is honoured only for a simulator build that isn't an archive" >&2
  exit 1
fi

# Xcode's PATH lacks a version manager's node: look where it is usually installed.
# No node fails the build, so the check can't be skipped by its absence.
node=$(command -v node || true)
for candidate in /opt/homebrew/bin/node /usr/local/bin/node "$HOME"/.nvm/versions/node/*/bin/node; do
  [ -n "$node" ] && break
  [ -x "$candidate" ] && node=$candidate
done
if [ -z "$node" ]; then
  echo "error: node not found, so the bundled page could not be checked for test hooks" >&2
  exit 1
fi

if ! "$node" "${SRCROOT}/../../../../fork/scripts/check-test-hooks.mjs" "$page"; then
  echo "error: the bundled page holds storage test hooks; stage a production page (yarn build:browser without FORK_TEST_HOOKS)" >&2
  exit 1
fi
