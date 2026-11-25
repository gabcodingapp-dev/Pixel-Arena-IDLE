/**
 * tools/harness.js
 *
 * Head-less smoke test + screenshot tool for the game.
 *
 * There is no browser binary in CI, so this runs the real game scripts
 * inside a JSDOM window, backed by a real 2D canvas implementation
 * (@napi-rs/canvas). That catches runtime errors, missing DOM hooks and
 * rendering crashes, and lets us export actual PNG frames to eyeball the
 * layout in both portrait and landscape.
 *
 * Usage:
 *   node tools/harness.js            # run checks, write screenshots to .harness/
 *   node tools/harness.js --keep     # leave the tile server up for preview
 */
"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");

const ROOT = path.resolve(__dirname, "..");
const GAME = path.join(ROOT, "game");
const OUT = path.resolve(ROOT, ".harness");

function resolveDep(name) {
  const candidates = [
    name,
    path.join("/tmp/node_modules", name),
    path.join(ROOT, "node_modules", name),
  ];
  for (const c of candidates) {
    try { return require(c); } catch (e) { /* keep looking */ }
  }
  return null;
}

const jsdomMod = resolveDep("jsdom");
const canvasMod = resolveDep("@napi-rs/canvas");

if (!jsdomMod) {
  console.error("Missing dev dependency: jsdom (npm i -D jsdom)");
  process.exit(2);
}
if (!canvasMod) {
  console.error("Missing dev dependency: @napi-rs/canvas (npm i -D @napi-rs/canvas)");
  process.exit(2);
}

const { JSDOM, VirtualConsole } = jsdomMod;
const { createCanvas, Image: NodeImage, GlobalFonts } = canvasMod;

/* Register the real game fonts so the canvas text measures like a phone. */
const FONT_DIR = path.join(GAME, "fonts");
GlobalFonts.registerFromPath(path.join(FONT_DIR, "press-start-2p-latin-400-normal.woff2"), "PixelFont");
GlobalFonts.registerFromPath(path.join(FONT_DIR, "nunito-latin-700-normal.woff2"), "Nunito");

const SCENES = [
  { name: "portrait", width: 390, height: 780, dpr: 2 },
  { name: "portrait-small", width: 360, height: 640, dpr: 2 },
  { name: "landscape", width: 844, height: 390, dpr: 2 },
];

const errors = [];

function makeWindow(vp) {
  const html = fs.readFileSync(path.join(GAME, "index.html"), "utf8");
  const vconsole = new VirtualConsole();
  vconsole.on("jsdomError", (e) => {
    const msg = String((e && e.stack) || e);
    if (/Not implemented|Could not parse CSS|css/i.test(msg)) return;
    errors.push("jsdomError: " + msg.split("\n").slice(0, 4).join(" | "));
  });
  vconsole.on("error", (...args) => errors.push("console.error: " + args.join(" ")));

  const dom = new JSDOM(html, {
    runScripts: "outside-only",
    pretendToBeVisual: true,
    virtualConsole: vconsole,
    url: "http://localhost/",
  });
  const win = dom.window;

  Object.defineProperty(win, "innerWidth", { value: vp.width, configurable: true });
  Object.defineProperty(win, "innerHeight", { value: vp.height, configurable: true });
  Object.defineProperty(win, "devicePixelRatio", { value: vp.dpr, configurable: true });

  /* --- canvas backing --- */
  const canvases = new Map();
  const originalCreate = win.document.createElement.bind(win.document);
  win.document.createElement = function (tag, opts) {
    const el = originalCreate(tag, opts);
    if (String(tag).toLowerCase() === "canvas") patchCanvas(el, true);
    return el;
  };
  function patchCanvas(el, initial) {
    if (el.__patched) return el;
    const c = createCanvas(300, 150);
    el.__nodeCanvas = c;
    el.getContext = function (type) {
      if (type !== "2d") return null;
      const real = c.getContext("2d");
      if (!real.__wrapped) {
        const origDraw = real.drawImage.bind(real);
        real.drawImage = function (img) {
          const args = Array.prototype.slice.call(arguments);
          args[0] = win.__isLocalImage(args[0]);
          return origDraw.apply(null, args);
        };
        real.__wrapped = true;
      }
      return real;
    };
    Object.defineProperty(el, "width", {
      get() { return c.width; },
      set(v) { c.width = Math.max(1, v | 0); },
      configurable: true,
    });
    Object.defineProperty(el, "height", {
      get() { return c.height; },
      set(v) { c.height = Math.max(1, v | 0); },
      configurable: true,
    });
    el.toDataURL = function () { return c.toDataURL("image/png"); };
    el.__patched = true;
    canvases.set(el, c);
    return el;
  }
  win.HTMLCanvasElement.prototype.getContext = function (type) {
    if (!this.__patched) patchCanvas(this, false);
    const real = this.__nodeCanvas.getContext(type);
    if (!real || real.__wrapped) return real;
    const origDraw = real.drawImage.bind(real);
    real.drawImage = function (img) {
      const args = Array.prototype.slice.call(arguments);
      args[0] = win.__isLocalImage(args[0]);
      return origDraw.apply(null, args);
    };
    real.__wrapped = true;
    return real;
  };
  Object.defineProperties(win.HTMLCanvasElement.prototype, {
    width: {
      get() { if (!this.__patched) patchCanvas(this, false); return this.__nodeCanvas.width; },
      set(v) { if (!this.__patched) patchCanvas(this, false); this.__nodeCanvas.width = Math.max(1, v | 0); },
      configurable: true,
    },
    height: {
      get() { if (!this.__patched) patchCanvas(this, false); return this.__nodeCanvas.height; },
      set(v) { if (!this.__patched) patchCanvas(this, false); this.__nodeCanvas.height = Math.max(1, v | 0); },
      configurable: true,
    },
  });

  /* --- Image: plain JS object that loads real PNG/WebP from disk --- */
  function LocalImage() {
    this._src = "";
    this.onload = null;
    this.onerror = null;
    this.decoding = "async";
    this.width = 0;
    this.height = 0;
    this.__nodeImage = null;
  }
  Object.defineProperty(LocalImage.prototype, "src", {
    get() { return this._src; },
    set(v) {
      this._src = v;
      const rel = String(v).replace(/^\.\//, "");
      const file = path.join(GAME, rel);
      const fallback = file.replace(/\.webp$/, ".png");
      const target = fs.existsSync(file) ? file : (fs.existsSync(fallback) ? fallback : null);
      setImmediate(() => {
        if (!target) { if (this.onerror) this.onerror(new Error("404 " + v)); return; }
        try {
          const img = new NodeImage();
          img.src = fs.readFileSync(target);
          this.__nodeImage = img;
          this.width = img.width;
          this.height = img.height;
          if (this.onload) this.onload();
        } catch (e) {
          if (this.onerror) this.onerror(e);
        }
      });
    },
    configurable: true,
  });
  win.Image = LocalImage;
  win.__isLocalImage = (v) => {
    if (!v) return v;
    if (v.__nodeImage) return v.__nodeImage;
    if (v.__nodeCanvas) return v.__nodeCanvas;
    return v;
  };

  /* --- misc browser APIs the game touches --- */
  win.AudioContext = undefined;
  if (!win.performance) win.performance = {};
  try { win.performance.now = () => win.__fakeT || 1000; } catch (e) {}
  let rafId = 1;
  const rafQueue = [];
  win.requestAnimationFrame = function (cb) {
    rafQueue.push(cb);
    return rafId++;
  };
  win.cancelAnimationFrame = function () {};
  win.__drainRaf = function (frames, stepMs) {
    let t = (win.__fakeT = win.__fakeT || 1000);
    for (let i = 0; i < frames; i++) {
      const batch = rafQueue.splice(0, rafQueue.length);
      t += stepMs || 16;
      for (const cb of batch) {
        try { cb(t); } catch (e) {
          errors.push("rAF: " + ((e && e.stack) || e).split("\n").slice(0, 5).join(" | "));
        }
      }
    }
    win.__fakeT = t;
  };
  try { win.performance.now = () => win.__fakeT || 1000; } catch (e) {}

  win.localStorage.clear();
  win.matchMedia = win.matchMedia || function () {
    return { matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} };
  };

  /* element geometry: jsdom reports 0 for everything */
  const stageEl = win.document.getElementById("stage");
  const stageH = vp.height - 120;
  Object.defineProperty(stageEl, "getBoundingClientRect", {
    value: () => ({
      left: 0, top: 48, width: vp.width, height: stageH,
      right: vp.width, bottom: stageH + 48, x: 0, y: 48,
    }),
    configurable: true,
  });
  win.HTMLElement.prototype.getBoundingClientRect = function () {
    if (this.id === "stage") return stageEl.getBoundingClientRect();
    return { left: 0, top: 0, width: vp.width, height: vp.height, right: vp.width, bottom: vp.height, x: 0, y: 0 };
  };
  win.HTMLElement.prototype.animate = function () { return { cancel() {}, finish() {} }; };
  win.HTMLElement.prototype.closest = win.HTMLElement.prototype.closest || function (sel) {
    let n = this;
    while (n && n.matches && !n.matches(sel)) n = n.parentElement;
    return n && n.matches ? n : null;
  };

  return { dom, win, canvases };
}

const SCRIPT_ORDER = [
  "js/core.js", "js/art.js", "js/data.js", "js/audio.js",
  "js/state.js", "js/farm.js", "js/battle.js", "js/ui.js", "js/game.js",
];

function runScene(vp) {
  const { win, canvases } = makeWindow(vp);
  const { document } = win;

  // Execute the game scripts in order (index.html loads them with src).
  for (const rel of SCRIPT_ORDER) {
    const code = fs.readFileSync(path.join(GAME, rel), "utf8");
    try {
      win.eval(code);
    } catch (e) {
      errors.push(rel + ": " + ((e && e.stack) || e).split("\n").slice(0, 6).join(" | "));
      return null;
    }
  }

  // Fire DOMContentLoaded path + let image loads settle.
  return new Promise((resolve) => {
    setTimeout(() => {
      // advance the clock used by the game loop
      win.__fakeT = 1000;
      win.__drainRaf(1, 16);
      // simulate the boot "tap to play"
      try {
        const btn = document.getElementById("bootStart");
        if (btn) btn.click();
      } catch (e) { errors.push("bootStart: " + e.message); }
      win.__drainRaf(90, 16);

      // exercise every panel + action
      try {
        const PA = win.PA;
        PA.S.gold = 5e6;
        PA.S.gem = 200;
        PA.buyBuilding("plot", 5);
        PA.buyBuilding("shovel", 3);
        PA.levelHero("rowan", 4);
        PA.recruitHero("luna");
        PA.recruitHero("fox");
        PA.setTeamSlot(0, "rowan");
        PA.setTeamSlot(1, "luna");
        PA.setTeamSlot(2, "fox");
        PA.ascendBuy("might");
        ["team", "heroes", "shop", "quests"].forEach((t) => PA.ui.setTab(t, true));
        PA.ui.heroModal("rowan");
        PA.ui.settingsModal();
        PA.ui.rebirthModal();
        PA.ui.stagePicker();
        PA.ui.closeModal();
        PA.ui.toast("harness toast", "good");
        win.__drainRaf(40, 16);
      } catch (e) {
        errors.push("actions: " + ((e && e.stack) || e).split("\n").slice(0, 6).join(" | "));
      }

      // dump the scene canvas + a farm-scene frame
      try {
        const PIC = win.PA;
        PIC.Game.setScene("farm");
        win.__drainRaf(30, 16);
        const cnv = document.getElementById("scene");
        if (cnv && cnv.__nodeCanvas) {
          fs.mkdirSync(OUT, { recursive: true });
          fs.writeFileSync(path.join(OUT, "farm-" + vp.name + ".png"), cnv.__nodeCanvas.toBuffer("image/png"));
        }
        PIC.Game.setScene("battle");
        win.__drainRaf(10, 16);
      } catch (e) { errors.push("farm shot: " + e.message); }
      const canvas = document.getElementById("scene");
      const nc = canvas && canvas.__nodeCanvas;
      let outFile = null;
      if (nc) {
        fs.mkdirSync(OUT, { recursive: true });
        outFile = path.join(OUT, "scene-" + vp.name + ".png");
        fs.writeFileSync(outFile, nc.toBuffer("image/png"));
      }
      resolve({ win, canvas: nc, outFile, vp });
    }, 120);
  });
}

(async function main() {
  console.log("Pixel Arena Idle - headless harness\n");
  const want = process.argv.includes("--all")
    ? SCENES
    : SCENES.filter((s) => s.name === (process.env.HARNESS_SCENE || "portrait"));
  const results = [];
  for (const vp of want) results.push(await runScene(vp));
  let bad = 0;
  for (const r of results) {
    if (!r) { bad++; continue; }
    const PA = r.win.PA;
    const info = {
      scene: r.vp.name,
      canvas: r.canvas ? r.canvas.width + "x" + r.canvas.height : "none",
      gold: PA && PA.fmt(PA.S.gold),
      rate: PA && PA.fmt(PA.derived.farmRate()) + "/s",
      power: PA && PA.fmt(PA.derived.teamPower()),
      stage: PA && PA.S.stageIndex,
      wave: PA && PA.battle.wave,
      kills: PA && PA.S.stats.kills,
      enemies: PA && PA.battle.foes.length,
      shot: r.outFile,
    };
    console.log(JSON.stringify(info, null, 2));
  }
  if (errors.length) {
    console.log("\n=== ERRORS (" + errors.length + ") ===");
    const seen = new Set();
    for (const e of errors) {
      const k = e.slice(0, 140);
      if (seen.has(k)) continue;
      seen.add(k);
      console.log(" - " + e);
    }
    process.exitCode = 1;
  } else {
    console.log("\nNo runtime errors.");
  }
  if (bad) process.exitCode = 1;
})();
