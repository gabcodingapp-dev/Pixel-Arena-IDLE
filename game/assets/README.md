# Assets

| Folder | Contents |
| --- | --- |
| `raw/` | Source character/enemy art on a flat magenta backdrop (JPEG, kept small) |
| `art/` | Source key art and the master app icon |
| `sprites/` | Generated, chroma-keyed sprites (WebP + PNG fallback) |
| `scene/` | Generated title/menu panoramas, portrait + landscape |
| `ui/` | Generated web app icon |
| `atlas.json` | Dimensions of every generated sprite |

Everything here is original art generated for Pixel Arena Idle. Regenerate with:

```bash
python3 tools/build_assets.py    # needs pillow, numpy, scipy
```

`android/` (Android resource overlay: mipmaps, splash, colors, strings) is
generated into this folder too, then copied into the Gradle project by
`tools/sync_android.js`.
