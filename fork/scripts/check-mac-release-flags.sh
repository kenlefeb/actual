#!/bin/sh
# Fork-only (story 5186). The Mac app's Release build must not define DEBUG:
# Debug builds open the page to Safari's Web Inspector (MacEngineHost), and
# Release builds ship. Fails, naming the setting, when the Release
# configuration of the app target sets DEBUG in its Swift conditions, its
# preprocessor definitions or its Swift flags.
# Usage: fork/scripts/check-mac-release-flags.sh [path/to/HomeEconomicsMac.xcodeproj]
set -eu
project="${1:-packages/mobile-client/macos/HomeEconomicsMac.xcodeproj}"
settings=$(xcodebuild -showBuildSettings -project "$project" -target HomeEconomicsMac -configuration Release)
found=$(printf '%s\n' "$settings" |
  grep -E '^[[:space:]]*(SWIFT_ACTIVE_COMPILATION_CONDITIONS|GCC_PREPROCESSOR_DEFINITIONS|OTHER_SWIFT_FLAGS) = (.*[^A-Za-z0-9_])?DEBUG([^A-Za-z0-9_]|$)' || true)
if [ -n "$found" ]; then
  echo "Release build of the Mac app defines DEBUG:" >&2
  printf '%s\n' "$found" >&2
  exit 1
fi
echo "Release build of the Mac app defines no DEBUG."
