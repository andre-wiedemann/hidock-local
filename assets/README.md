# Assets

App icon and screenshots live here.

- `icon.png` — 512×512 master, used by Linux builds and as a fallback
- `icon.icns` — macOS icon (generate from `icon.png` via `iconutil` or [iconz](https://github.com/raphaelhanneken/iconz))
- `icon.ico` — Windows icon
- `screenshots/` — used by README and any future website

These are placeholders for the v0.1.0 release. Replace before tagging a stable version.

To generate an `.icns` from a 1024×1024 PNG on macOS:

```bash
mkdir icon.iconset
sips -z 16 16     icon.png --out icon.iconset/icon_16x16.png
sips -z 32 32     icon.png --out icon.iconset/icon_16x16@2x.png
sips -z 32 32     icon.png --out icon.iconset/icon_32x32.png
sips -z 64 64     icon.png --out icon.iconset/icon_32x32@2x.png
sips -z 128 128   icon.png --out icon.iconset/icon_128x128.png
sips -z 256 256   icon.png --out icon.iconset/icon_128x128@2x.png
sips -z 256 256   icon.png --out icon.iconset/icon_256x256.png
sips -z 512 512   icon.png --out icon.iconset/icon_256x256@2x.png
sips -z 512 512   icon.png --out icon.iconset/icon_512x512.png
cp icon.png       icon.iconset/icon_512x512@2x.png
iconutil -c icns icon.iconset
```
