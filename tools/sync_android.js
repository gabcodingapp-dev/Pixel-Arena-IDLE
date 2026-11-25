#!/usr/bin/env node
/**
 * tools/sync_android.js
 *
 * Generates ./android (the real Gradle project) and layers Pixel Arena Idle's
 * native shell onto it:
 *
 *   1. `cap add android` into a throwaway folder (Capacitor owns the Gradle
 *      plumbing, so we never hand-maintain it)
 *   2. copy it to ./android
 *   3. overlay android-template/ (manifest, MainActivity, theme)
 *   4. overlay game/android/res (icons, splash, colors, strings) from the
 *      asset pipeline
 *   5. `cap sync android` so www/ lands in app/src/main/assets/public
 *
 * Everything here is idempotent: run it as often as you like.
 * Requires Java 21 + Android SDK for the actual APK build (done in CI).
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const ANDROID = path.join(ROOT, "android");
const TEMPLATE = path.join(ROOT, "android-template");
const GEN_RES = path.join(ROOT, "game", "android", "res");
const WWW = path.join(ROOT, "www");

function run(cmd, args, opts) {
  console.log("  $ " + cmd + " " + args.join(" "));
  execFileSync(cmd, args, { cwd: ROOT, stdio: "inherit", env: process.env, ...(opts || {}) });
}

function rmrf(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function main() {
  if (!fs.existsSync(WWW)) {
    console.error("www/ not found — run `node tools/build_web.js --android` first.");
    process.exit(1);
  }

  console.log("Pixel Arena Idle — Android project sync");

  // 1. let Capacitor generate a pristine project.
  //    Capacitor 6 has no --platform-dir, so we generate into ./android and
  //    treat android-template/ as the source of truth for everything it owns.
  rmrf(ANDROID);
  run("npx", ["cap", "add", "android"]);

  // 2. (android/ is now a clean Capacitor project)

  // 3. overlay our native shell
  if (fs.existsSync(TEMPLATE)) {
    copyDir(TEMPLATE, ANDROID);
    console.log("  overlaid android-template/");
  }

  // 4. generated resources (icons, splash, colors, strings)
  if (fs.existsSync(GEN_RES)) {
    copyDir(GEN_RES, path.join(ANDROID, "app", "src", "main", "res"));
    console.log("  overlaid generated res (icons + splash + strings)");
  }

  // 5. copy the web build in and patch the Gradle manifest if needed
  run("npx", ["cap", "sync", "android"]);

  // 6. keep the Gradle build honest about the app version
  const pkg = require(path.join(ROOT, "package.json"));
  const appGradle = path.join(ANDROID, "app", "build.gradle");
  let gradle = fs.readFileSync(appGradle, "utf8");
  const buildNumber = process.env.BUILD_NUMBER || String(
    Math.floor(Date.now() / 60000) - 29000000  // monotonic-ish int for stores
  );
  // Only patch the two lines inside defaultConfig, and make the patch
  // idempotent by rewriting them to literal values every time.
  gradle = gradle.replace(
    /^\s*versionCode.*$/m,
    `        versionCode ${buildNumber}`
  );
  gradle = gradle.replace(
    /^\s*versionName.*$/m,
    `        versionName "${pkg.version}"`
  );
  fs.writeFileSync(appGradle, gradle);
  console.log("  versionCode " + buildNumber + " · versionName " + pkg.version);

  // 7. sanity checks that would otherwise fail slowly in CI
  const problems = [];
  const manifestPath = path.join(ANDROID, "app", "src", "main", "AndroidManifest.xml");
  const manifest = fs.readFileSync(manifestPath, "utf8");
  if (!manifest.includes("fullSensor")) problems.push("manifest lost fullSensor orientation");
  if (!manifest.includes("KeepScreenOn") && !manifest.includes("FLAG_KEEP_SCREEN_ON")) {
    // keep-screen-on is applied in code, so this is informational only
  }
  const activity = path.join(ANDROID, "app", "src", "main", "java", "com", "pixelarena", "idle", "MainActivity.java");
  if (!fs.existsSync(activity)) problems.push("MainActivity.java missing");
  const publicDir = path.join(ANDROID, "app", "src", "main", "assets", "public");
  if (!fs.existsSync(path.join(publicDir, "index.html"))) problems.push("web assets not synced");

  if (problems.length) {
    console.error("  ✗ " + problems.join("\n  ✗ "));
    process.exit(1);
  }
  console.log("  ✓ android/ ready");
}

main();
