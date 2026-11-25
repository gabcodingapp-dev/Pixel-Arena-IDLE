#!/usr/bin/env node
/**
 * tools/build_web.js
 *
 * Produces the shippable web bundle in ./www :
 *   - copies the game source (html/css/js/fonts/assets)
 *   - verifies every referenced asset actually exists (fails the build)
 *   - writes a build stamp + an asset manifest for cache busting
 *   - when --android is passed, also stages the Android resource overlay
 *     (icons, splash, colors/strings) into www/android/ for tools/sync_android.js
 *
 * This is what CI runs before `npx cap sync android`.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "game");
const OUT = path.join(ROOT, "www");
// Source-only folders never ship; PNG duplicates are dropped because every
// target (Android WebView 6+, iOS 14+, all evergreen browsers) reads WebP.
const SKIP_DIRS = new Set(["android", "raw", "art"]);
const SKIP_PNG_DIRS = new Set(["sprites"]);
// PNG twins of the WebP backgrounds: pure duplication, ~4 MB of dead weight.
const SKIP_PNG_FILES = new Set(["title_land.png", "title_port.png"]);
const SKIP_DIRS_2 = new Set(["scene"]); // webp only

function rmrf(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}

function copyDir(src, dest, filter) {
  copyDirFiltered(src, dest, (entry) => (filter ? filter(entry, src) : true));
}

function copyDirFiltered(src, dest, filter) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (!filter(entry, src)) continue;
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDirFiltered(s, d, filter);
    else fs.copyFileSync(s, d);
  }
}

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}

function main() {
  const withAndroid = process.argv.includes("--android");
  console.log("Pixel Arena Idle — web build");

  rmrf(OUT);
  const skipFilter = (entry, dir) => {
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) return false;
    if (entry.isDirectory() && SKIP_DIRS_2.has(entry.name)) return true;
    if (entry.isDirectory()) return true;
    if (SKIP_PNG_FILES.has(entry.name)) return false;
    if (/\.png$/i.test(entry.name)) {
      const parent = path.basename(path.dirname(path.join(dir || SRC, entry.name)));
      if (SKIP_PNG_DIRS.has(parent)) return false;
    }
    return true;
  };
  copyDirFiltered(SRC, OUT, skipFilter);
  if (withAndroid) copyDir(path.join(SRC, "android"), path.join(OUT, "android"));
  console.log("  copied game/ -> www/");

  // ---- verify referenced assets
  const missing = [];
  const html = fs.readFileSync(path.join(OUT, "index.html"), "utf8");
  const refs = new Set();
  for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) refs.add(m[1]);
  const css = fs.readFileSync(path.join(OUT, "css", "style.css"), "utf8");
  // CSS url() is resolved relative to the stylesheet, not the document root.
  for (const m of css.matchAll(/url\(["']?([^"')]+)["']?\)/g)) {
    if (/^(https?:|data:)/.test(m[1])) continue;
    refs.add(path.posix.join("css", m[1]));
  }
  const manifest = fs.existsSync(path.join(OUT, "manifest.webmanifest"))
    ? JSON.parse(fs.readFileSync(path.join(OUT, "manifest.webmanifest"), "utf8"))
    : null;
  if (manifest) {
    for (const i of manifest.icons || []) refs.add(i.src);
    if (manifest.start_url) refs.add(manifest.start_url === "./" ? "index.html" : manifest.start_url);
  }
  for (const ref of refs) {
    if (/^(https?:|data:|mailto:)/.test(ref) || ref.startsWith("#")) continue;
    const clean = ref.split("?")[0].replace(/^\.\//, "");
    const target = path.join(OUT, clean);
    if (!fs.existsSync(target)) missing.push(ref);
  }
  // sprites referenced from JS
  const art = fs.readFileSync(path.join(OUT, "js", "art.js"), "utf8");
  for (const name of ["rowan", "luna", "nixie", "fox", "slime", "mimic", "boss"]) {
    if (!fs.existsSync(path.join(OUT, "assets", "sprites", name + ".webp")) &&
        !fs.existsSync(path.join(OUT, "assets", "sprites", name + ".png"))) missing.push("sprite:" + name);
  }
  if (missing.length) {
    console.error("  ✗ missing assets:\n    " + missing.join("\n    "));
    process.exit(1);
  }
  console.log("  verified " + refs.size + " asset references");

  // ---- build stamp + manifest (sorted, hashed)
  const files = walk(OUT).sort();
  let total = 0;
  const entries = files.map((f) => {
    const rel = path.relative(OUT, f).split(path.sep).join("/");
    const buf = fs.readFileSync(f);
    total += buf.length;
    return {
      path: rel,
      size: buf.length,
      hash: crypto.createHash("sha1").update(buf).digest("hex").slice(0, 10),
    };
  });
  const build = {
    app: "pixel-arena-idle",
    version: require(path.join(ROOT, "package.json")).version,
    builtAt: new Date().toISOString(),
    fileCount: entries.length,
    bytes: total,
    files: entries,
  };
  fs.writeFileSync(path.join(OUT, "build-info.json"), JSON.stringify(build, null, 2));

  // Text summary printed into the CI run so the size is auditable.
  console.log(
    "  bundle: " + entries.length + " files, " + (total / 1024 / 1024).toFixed(2) + " MB"
  );
  const big = entries.filter((e) => e.size > 400 * 1024);
  if (big.length) {
    console.log("  largest files:");
    big.sort((a, b) => b.size - a.size).slice(0, 6).forEach((e) => {
      console.log("    " + (e.size / 1024).toFixed(0) + " KB  " + e.path);
    });
  }
  console.log("  ✓ www/ ready");
}

main();
