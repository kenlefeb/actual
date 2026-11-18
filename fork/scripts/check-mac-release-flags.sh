#!/bin/sh
# Fork-only (story 5186). The Mac app's Release build must not define DEBUG:
# Debug builds open the page to Safari's Web Inspector (MacEngineHost), and
# Release builds ship. Reads the app target's Release build settings and
# fails, naming the setting, when the value of SWIFT_ACTIVE_COMPILATION_CONDITIONS,
# GCC_PREPROCESSOR_DEFINITIONS or OTHER_SWIFT_FLAGS defines DEBUG: a word
# `DEBUG`, `DEBUG=…`, `-DDEBUG` or `-D DEBUG`. Setting names that contain DEBUG
# (DEBUG_INFORMATION_FORMAT) and other macros (NDEBUG, DEBUG_MENU) pass.
# Not covered: per-file compiler flags (a source file's "Compiler Flags" in
# the build phase) are not build settings, so `-showBuildSettings` never
# shows them; review the project file for those.
# Usage: check-mac-release-flags.sh [path/to/HomeEconomicsMac.xcodeproj]
#        check-mac-release-flags.sh --settings-file FILE   (tests)
set -eu
if [ "${1:-}" = "--settings-file" ]; then
  settings=$(cat "$2")
else
  project="${1:-packages/mobile-client/macos/HomeEconomicsMac.xcodeproj}"
  settings=$(xcodebuild -showBuildSettings -project "$project" -target HomeEconomicsMac -configuration Release)
fi
found=$(printf '%s\n' "$settings" | awk '
  $1 ~ /^(SWIFT_ACTIVE_COMPILATION_CONDITIONS|GCC_PREPROCESSOR_DEFINITIONS|OTHER_SWIFT_FLAGS)$/ && $2 == "=" {
    for (i = 3; i <= NF; i++) {
      # A value can be stored quoted: -D "DEBUG", "-DDEBUG"
      word = $i
      gsub(/["\047]/, "", word)
      if (word ~ /^(-D)?DEBUG(=.*)?$/) { print; break }
    }
  }')
if [ -n "$found" ]; then
  echo "Release build of the Mac app defines DEBUG:" >&2
  printf '%s\n' "$found" >&2
  exit 1
fi
echo "Release build of the Mac app defines no DEBUG."
