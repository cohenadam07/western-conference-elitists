#!/bin/zsh
# Recalculate an .xlsx in Numbers.app (no LibreOffice on this machine) and export it back to .xlsx with computed values.
# Usage: tools/live-lineups/recalc.sh <in.xlsx> <out.xlsx>
in=${1:A}; out=${2:A}
osascript <<OSA
tell application "Numbers"
  set d to open POSIX file "$in"
  delay 3
  export d to POSIX file "$out" as Microsoft Excel
  close d saving no
end tell
OSA
