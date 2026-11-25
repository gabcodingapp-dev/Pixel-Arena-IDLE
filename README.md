# Pixel Arena Idle

A cozy pixel-art **idle RPG** for Android and the web: plant a farm, deploy
heroes, expand your territory, and rebirth for permanent power.

One codebase, two deliverables:

| Target | How | Where |
| --- | --- | --- |
| **Android APK / AAB** | Capacitor shell around the game, built by CI | `.github/workflows/build-apk.yml` |
| **Browser / PWA** | Plain static files, auto-deployed to GitHub Pages | `.github/workflows/pages.yml` |

Portrait and landscape are both fully supported — the layout reflows, the scene
canvas re-lays out its plot grid and battle line, and the dock moves from a
bottom sheet to a side panel.

---

## Why not Kotlin?

The honest answer: **correctness, iteration speed, and the APK requirement.**

* **The game is one shared artifact across web and Android.** A Kotlin/Compose
  implementation would either mean two codebases or a web-only nobody-can-install
  game. With Capacitor, `www/` *is* the app — the browser build and the APK run
  byte-identical logic, and bugs reproduce in either.
* **Zero warm-up cost.** Canvas 2D + a low internal render resolution
  (≈460 px portrait / 620 px landscape, upscaled with smoothing off) gives the
  chunky pixel look at 60fps on cheap phones, with no engine runtime bundled.
* **APK builds are still real, signed Android builds.** The `android/` project is
  a genuine Gradle/AGP project — `MainActivity` extends Capacitor's
  `BridgeActivity`, keeps the screen awake, disables overscroll and long-press,
  and forces hardware layers. If the game ever needs native features (AdMob,
  Play Games, IAP), Capacitor plugins or a `Kotlin` plugin drop straight in
  without a rewrite.

If you'd rather go native later, the whole simulation (`js/state.js`,
`js/battle.js`, `js/data.js`) is pure, DOM-free logic with a save format designed
to be portable — it maps cleanly onto Kotlin coroutines.

---

## Play it

```bash
npm install
npm run dev          # serves ./game at http://localhost:8080
```

Open the URL, and it works on a phone too (the dev server binds `0.0.0.0`).

## Build the APK locally

Requires **JDK 21** and the **Android SDK** (`ANDROID_HOME` set).

```bash
npm install
python3 tools/build_assets.py     # regenerate sprites/icons from source art
                                  # (needs pillow, numpy, scipy)
node tools/build_web.js           # assemble www/
node tools/sync_android.js        # generate ./android + overlay the native shell

cd android
./gradlew assembleDebug           # app/build/outputs/apk/debug/*.apk
./gradlew bundleRelease           # app/build/outputs/bundle/release/*.aab
```

### On GitHub

Push to `main` (or any `arena/**` branch) and `.github/workflows/build-apk.yml`
builds the APK + AAB and attaches them to the workflow run.

To publish a **signed** release, add these repository secrets:

| Secret | Value |
| --- | --- |
| `KEYSTORE_BASE64` | `base64 -w0 release.keystore` |
| `KEYSTORE_PASSWORD` | keystore password |
| `KEY_ALIAS` | key alias |
| `KEY_PASSWORD` | key password |

Push a tag (`git tag v1.0.0 && git push --tags`) and the workflow also creates a
GitHub Release with the APK attached, ready to sideload.

Without secrets the release build is signed with the debug key, so testers can
still install it — it just cannot be uploaded to Play as-is.

---

## The game

Four systems, interlocking:

**Farm (idle engine).** Eight buildings, each with exponential cost curves and
superlinear output. Tap anywhere on the farm scene for gold with a combo
multiplier. Gold keeps accruing while you're away (55% rate, capped at 8 hours).

**Battle (auto-battler).** Heroes and monsters trade blows on a 2.5D line. Toggle
AUTO, cycle x1/x2/x3 speed, or tap enemies to add damage. 24 stages across four
chapters, each ending in a boss with an enrage timer. Every stage grants gold per
kill; bosses grant Essence.

**Heroes (collection + progression).** Five characters — a farm kid, a star
witch, a tide spirit, a scarf fox, and a moss golem — across four roles (DPS,
burst, healer, tank). Levels cost gold, stars come from rebirths, and team size
grows with each rebirth.

**Rebirth (prestige).** Trade run progress for Essence, then spend it on four
permanent ascension tracks. Quest log keeps long-tail goals visible.

All balance lives in [`game/js/data.js`](game/js/data.js) — one file, plain
numbers, no magic constants buried in logic.

## Art pipeline

Every asset is generated for this project and processed by
[`tools/build_assets.py`](tools/build_assets.py):

1. Source art (JPEG, kept small in-repo) in `game/assets/raw/` and `game/assets/art/`.
2. Chroma-key the flat magenta backdrop — sampled per image, border-connected
   flood fill for background, enclosed-pocket detection, edge un-fringing, and
   hidden-RGB neutralisation so scaled sprites don't bleed magenta.
3. Trim to alpha bounds, area-average down, light unsharp.
4. Emit WebP + PNG sprites, WebP scene panoramas, and Android mipmaps/splash.

The scene backdrops (farm, forest clearing) are *procedural* — painted on a
canvas from a seeded RNG, so the field, arena ellipse and prop layout adapt to
any screen size instead of being a stretching photo. Generated art is composited
on top when available.

## Project layout

```
game/                 the game itself (this is what ships)
  index.html
  css/style.css       design system + portrait/landscape layouts
  js/core.js          helpers, big-number formatting, event bus, storage
  js/data.js          heroes, enemies, stages, farm, quests, balance
  js/state.js         save/load/migrate, derived stats, offline progress
  js/art.js           asset loading, canvas sizing, procedural scenery, fx
  js/farm.js          idle economy, plot rendering, taps
  js/battle.js        auto-battler simulation + rendering
  js/ui.js            DOM panels, HUD, toasts, modals
  js/game.js          boot, main loop, input, scene switching
  js/audio.js         fully synthesised SFX + generative music (no audio files)
  assets/raw,art/     source art (JPEG)
  assets/sprites,scene,ui/  generated runtime assets
  android/res/        generated Android resources (icons, splash, values)
tools/
  build_assets.py     art pipeline
  build_web.js        assemble + verify www/
  sync_android.js     generate the Gradle project, overlay the native shell
  harness.js          headless smoke test + screenshots
  serve.js            dev server
android-template/     files that override Capacitor's generated project
.github/workflows/    APK build, Pages deploy
```

## Testing

There's no browser in CI, so [`tools/harness.js`](tools/harness.js) runs the real
game scripts inside JSDOM backed by a real 2D canvas implementation. It boots the
game, drives the main loop, exercises every panel and action, and exports PNG
frames for both orientations — genuine regression coverage for a canvas game.

```bash
npm test                  # logic suite + render smoke test
npm run test:logic        # 113 assertions, no DOM needed
npm run test:render       # boots the game headlessly, exports screenshots
```

Screenshots land in `.harness/`.

## License

Game code and generated art: this repository.
Fonts: [Press Start 2P](https://fonts.google.com/specimen/Press+Start+2P) and
[Nunito](https://fonts.google.com/specimen/Nunito), both SIL OFL 1.1.
