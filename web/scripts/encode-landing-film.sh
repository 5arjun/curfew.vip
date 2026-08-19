#!/usr/bin/env bash
# Encode a landing film: the 1600x900 master from a raw screen recording, and
# the -720 phone cut from that master.
#
#   ./scripts/encode-landing-film.sh master ~/Downloads/Setutil.mp4 public/landing/library-utilization.mp4
#   ./scripts/encode-landing-film.sh public/landing/library-utilization.mp4
#
# Every film on `/` ships twice: the 1600x900 60fps master the beats were cut
# against, and a `-720` companion served to viewports at or under 640px. The
# names are not configurable — Beats.tsx derives the phone cut from the master's
# path (see `phoneCut`), so a master without its pair 404s on a phone.
#
# MASTER MODE EXISTS BECAUSE THE RECIPE KEPT GETTING LOST (Arjun, 2026-08-19:
# "you might have to convert them or something to make the size smaller. i
# forgot what you did last time"). Only the phone cut was written down, so the
# master settings were re-derived by hand every time a take arrived — which is
# how you end up with four films on one page encoded four different ways.
#
# The numbers, and why:
#   1600x900   the frame the beats were composed against. Raw captures come off
#              at 1920x1080; nothing on the page displays them above ~1300 CSS
#              px, and the beats' frames are all 16/9, so this is a straight
#              downscale with no crop.
#   60 fps     kept on the master. These takes are driven by cursor movement and
#              scroll, and 30 is visible on desktop at this size.
#   crf 28     high for video, right for flat UI gradients with no grain. 26
#              looked identical and cost 25% more; below that you are paying for
#              a difference nobody can see.
#   30 fps     on the phone cut only. Halving the rate is the single largest
#              saving there and the one you cannot see at ~350-390 CSS px.
#   crf 30     ditto: below 720 wide the UI text inside the recordings mushes,
#              so the width holds and the quality gives.
#   faststart  the moov atom has to lead or the file will not begin playing
#              until it has fully downloaded.
#
# Masters land at ~2-3.5 MB, phone cuts at ~450-750 KB.
#
# TRIM THE HEAD AND TAIL BEFORE YOU ENCODE, not after. Raw takes open on a
# window that is still zooming in — letterboxed, with the browser's link-preview
# URL sitting in the corner — and end on empty mesh after the last scroll. Both
# are visible in the beat's frame and in the poster cut from it. Pass -ss/-t
# through EXTRA_ARGS:
#
#   EXTRA_ARGS="-ss 7.9 -t 16.9" ./scripts/encode-landing-film.sh master in.mp4 out.mp4
#
# And cut the poster from the ENCODED master, at the frame the beat enters:
#
#   ffmpeg -ss 0.1 -i out.mp4 -frames:v 1 -q:v 4 out-poster.jpg
set -euo pipefail

usage() {
  echo "usage: $0 <path/to/master.mp4>                    # phone cut" >&2
  echo "       $0 master <raw-capture.mp4> <master.mp4>   # master, then run again for the cut" >&2
  exit 64
}

# EXTRA_ARGS goes before -i so -ss seeks by keyframe rather than decoding to the
# cut point; -t after it is still relative to the seek.
#
# Expanded with the +alternate-value guard at every use rather than bare: macOS
# ships bash 3.2, where an EMPTY array is "unbound" under set -u and the bare
# form aborts the script. Which is a fault that only shows up when EXTRA_ARGS is
# unset — i.e. on the plain phone-cut call, the one path that was already
# working before this flag existed.
extra=(${EXTRA_ARGS:-})

if [ "${1:-}" = "master" ]; then
  [ $# -eq 3 ] || usage
  src="$2"
  out="$3"
  [ -f "$src" ] || { echo "no such file: $src" >&2; exit 66; }

  ffmpeg -y -loglevel error ${extra[@]+"${extra[@]}"} -i "$src" \
    -an \
    -vf "scale=1600:900" \
    -c:v libx264 -profile:v high -preset slow -crf 28 \
    -pix_fmt yuv420p -movflags +faststart \
    "$out"
else
  [ $# -eq 1 ] || usage
  src="$1"
  [ -f "$src" ] || { echo "no such file: $src" >&2; exit 66; }
  out="${src%.mp4}-720.mp4"

  ffmpeg -y -loglevel error ${extra[@]+"${extra[@]}"} -i "$src" \
    -an \
    -vf "scale=720:-2,fps=30" \
    -c:v libx264 -profile:v main -level 4.0 -preset slow -crf 30 \
    -pix_fmt yuv420p -movflags +faststart \
    "$out"
fi

printf '%s  ->  %s (%s)\n' "$src" "$out" "$(du -h "$out" | cut -f1)"
