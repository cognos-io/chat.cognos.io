#!/usr/bin/env bash
#
# Strip the tells of machine-written prose from staged files.
#
# One rule for now: an em dash (U+2014) becomes a plain hyphen. Em dashes read as
# a signature of generated copy, so we write in a register that does not need
# them. Add further rules here as they earn their place.
#
# Runs before the formatters in pre-commit: swapping a three-byte character for a
# one-byte one changes line lengths, so prettier and rumdl must get the last word
# on wrapping.
#
# Lefthook passes the staged file list. Safe to run by hand over the whole repo:
#   scripts/remove-ai-slop.sh $(git ls-files)
set -euo pipefail

# The UTF-8 encoding of U+2014, matched and replaced as raw bytes so files with
# unusual encodings are left structurally intact.
em_dash=$'\xe2\x80\x94'

cleaned=0
for file in "$@"; do
  # Skip files an earlier hook removed, and anything binary.
  [ -f "$file" ] || continue
  grep -Iq . "$file" 2>/dev/null || continue

  if LC_ALL=C grep -qF "$em_dash" "$file"; then
    perl -i -pe 's/\xe2\x80\x94/-/g' "$file"
    echo "  em dash -> hyphen: $file"
    cleaned=$((cleaned + 1))
  fi
done

if [ "$cleaned" -eq 0 ]; then
  echo "  clean"
else
  echo "  cleaned $cleaned file(s)"
fi
