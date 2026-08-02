#!/bin/bash
# Store-screenshot capture: drives the real app in headless Chrome and crops
# to exact store pixel sizes. Run from the repo root:
#
#   python3 -m http.server 8123 &
#   cp native/screenshots/make-shots.html _shots.html    # must be same-origin
#   native/screenshots/shoot.sh home    430 932 1290 2796 native/screenshots/appstore/home.png
#   native/screenshots/shoot.sh home    360 720 1080 2160 native/screenshots/play/home.png
#   rm _shots.html
#
# Scenes: home | library | cryptogram | fiver | hidden (see make-shots.html).
# App Store 6.7" is 430x932 CSS at 3x = 1290x2796; Play caps aspect at 2:1,
# so its set is 360x720 at 3x = 1080x2160. The driver sets the title to
# READY when the scene is fully staged; anything else aborts the shot.
#
# shoot.sh <scene> <cssW> <cssH> <pxW> <pxH> <outfile>
set -e
SCRATCH=$(mktemp -d)
trap 'rm -rf "$SCRATCH"' EXIT
raw=$SCRATCH/raw.png
title=$(google-chrome --headless=new --disable-gpu --no-sandbox --hide-scrollbars \
  --user-data-dir=$SCRATCH/prof --force-device-scale-factor=3 \
  --window-size=500,$((($3)+100)) --virtual-time-budget=15000 \
  --screenshot=$raw --dump-dom "http://localhost:8123/_shots.html?scene=$1&w=$2&h=$3" 2>/dev/null \
  | grep -o '<title>[^<]*</title>' | head -1)
case "$title" in *READY*) ;; *) echo "SCENE $1 NOT READY: $title" >&2; exit 1;; esac
python3 - "$raw" "$4" "$5" "$6" <<'PY'
import sys
from PIL import Image
raw, w, h, out = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4]
img = Image.open(raw)
assert img.width >= w and img.height >= h, f"shot {img.size} smaller than crop {w}x{h}"
img.crop((0, 0, w, h)).save(out)
print(f"{out}: {w}x{h} (from {img.size[0]}x{img.size[1]})")
PY
