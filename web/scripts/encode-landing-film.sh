#!/usr/bin/env bash
# Encode the phone cut of a landing film.
#
#   ./scripts/encode-landing-film.sh public/landing/set-detail-3.mp4
#
# Every film on `/` ships twice: the 1600x900 60fps master the beats were cut
# against, and a `-720` companion served to viewports at or under 640px. The
# names are not configurable — Beats.tsx derives the phone cut from the master's
# path (see `phoneCut`), so a master without its pair 404s on a phone.
#
# The numbers, and why:
#   720 wide   a phone displays these at ~350-390 CSS px, so this is still 2x.
#              Below 640 the UI text inside the recordings starts to mush.
#   30 fps     these are screen recordings of a interface, not motion footage.
#              Halving the rate is the single largest saving and the one you
#              cannot see; the masters stay at 60 for desktop.
#   crf 30     high for video, right for flat UI gradients with no grain.
#   faststart  the moov atom has to lead or the file will not begin playing
#              until it has fully downloaded.
#
# Result is ~660 KB against the master's ~3.4 MB.
set -euo pipefail

if [ $# -ne 1 ]; then
  echo "usage: $0 <path/to/film.mp4>" >&2
  exit 64
fi

src="$1"
if [ ! -f "$src" ]; then
  echo "no such file: $src" >&2
  exit 66
fi

out="${src%.mp4}-720.mp4"

ffmpeg -y -loglevel error -i "$src" \
  -an \
  -vf "scale=720:-2,fps=30" \
  -c:v libx264 -profile:v main -level 4.0 -preset slow -crf 30 \
  -pix_fmt yuv420p -movflags +faststart \
  "$out"

printf '%s  ->  %s (%s)\n' "$src" "$out" "$(du -h "$out" | cut -f1)"
