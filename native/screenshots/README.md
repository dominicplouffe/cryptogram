# Store screenshots

Captured from the real app in headless Chrome — nothing is mocked up. The
driver seeds a rich-but-honest state (12-day streak, varied per-game stats)
and plays real moves by clicking cells and keys; every board shown is one the
app actually rendered.

- `appstore/` — five shots at 1290×2796 (the 6.7" size App Store Connect
  accepts for all iPhones). Upload at least three.
- `play/` — the same five scenes at 1080×2160 (Play caps screenshot aspect at
  2:1), plus `feature-graphic.png` at 1024×500.

## Regenerating

```sh
python3 -m http.server 8123 &
cp native/screenshots/make-shots.html _shots.html    # driver must be same-origin
for s in home library cryptogram fiver hidden; do
  native/screenshots/shoot.sh $s 430 932 1290 2796 native/screenshots/appstore/$s.png
  native/screenshots/shoot.sh $s 360 720 1080 2160 native/screenshots/play/$s.png
done
rm _shots.html
```

The feature graphic comes from `make-feature.html` the same way (copy to the
repo root, screenshot at scale factor 1, crop 1024×500).

Needs `google-chrome` and Python `PIL` — no other tooling. Two traps the
driver already handles: the app's home view is visible before boot finishes
(readiness is gated on `#home-date` having text, and the title is set to
READY / SCENE FAILED accordingly), and CSS transitions freeze under Chrome's
virtual-time clock (a `transition: none` style is injected before capture).
