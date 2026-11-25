#!/usr/bin/env node
/**
 * tools/simtest.js
 *
 * Pure-logic simulation tests. No DOM, no canvas: we load the data/state/battle
 * scripts into a bare VM context and drive the simulation directly. This checks
 * things a screenshot can't:
 *
 *   - balance sanity (can a fresh save clear stage 1? how long does it take?)
 *   - economy growth (does buying plots actually accelerate income?)
 *   - progression gates (stage power curve vs. hero power curve)
 *   - save/load round-trip fidelity
 *   - rebirth maths and offline accrual
 *
 * Exits non-zero on a failed assertion so CI catches regressions.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const GAME = path.join(ROOT, "game");

let failures = 0;
let checks = 0;

function ok(cond, label, detail) {
  checks++;
  if (cond) {
    console.log("  ✓ " + label + (detail ? "  (" + detail + ")" : ""));
  } else {
    failures++;
    console.log("  ✗ " + label + (detail ? "  (" + detail + ")" : ""));
  }
}

function boot() {
  const ctx = {
    console: { log() {}, error() {}, warn() {} },
    Math, Date, JSON, Infinity, isFinite, isNaN, parseInt, parseFloat, Number, String, Object, Array,
    setTimeout() {}, clearTimeout() {}, setInterval() {}, clearInterval() {},
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  for (const f of ["core", "art", "data", "state"]) {
    vm.runInContext(fs.readFileSync(path.join(GAME, "js", f + ".js"), "utf8"), ctx, { filename: f + ".js" });
  }
  // battle needs a canvas-ish art stub only for drawing, which we never call.
  vm.runInContext(fs.readFileSync(path.join(GAME, "js", "battle.js"), "utf8"), ctx, { filename: "battle.js" });
  vm.runInContext(fs.readFileSync(path.join(GAME, "js", "farm.js"), "utf8"), ctx, { filename: "farm.js" });
  // audio is a no-op in a bare context; stub the API the sim touches.
  ctx.PA.audio = { sfx: new Proxy({}, { get: () => () => {} }), startMusic() {}, setMusic() {} };
  return ctx.PA;
}

/** Drive the battle sim for `seconds`, optionally buying farm upgrades. */
function run(PA, seconds, opts = {}) {
  const dt = 1 / 30;
  const steps = Math.round(seconds / dt);
  PA.art.lastLandscape = false;
  PA.battle.layout(460, 700, false);
  PA.battle.enterStage(PA.S.stageIndex, {});
  const events = { kills: 0, clears: 0 };
  PA.bus.on("kill", () => events.kills++);
  PA.bus.on("stageClear", () => events.clears++);

  for (let i = 0; i < steps; i++) {
    PA.S.options.auto = true;
    PA.farm.step(dt);
    PA.battle.step(dt);
    if (opts.buyEvery && i % opts.buyEvery === 0) {
      // Greedy purchase: cheapest affordable upgrade.
      let best = null;
      for (const def of PA.D.FARM) {
        if (!PA.derived.buildingUnlocked(def.id)) continue;
        const cost = PA.derived.buildingCost(def.id);
        if (PA.S.gold >= cost && (!best || cost < best.cost)) best = { id: def.id, cost };
      }
      if (best) PA.buyBuilding(best.id, 1);
    }
  }
  return events;
}

console.log("Pixel Arena Idle — simulation tests\n");

// ---------------------------------------------------------------- balance
console.log("balance");
{
  const PA = boot();
  PA.S.gold = 0;
  const ev = run(PA, 90);
  ok(ev.kills > 0, "fresh save kills stage-1 enemies", ev.kills + " kills in 90s");
  ok(PA.S.stats.goldEarned > 0, "gold accrues from kills", PA.fmt(PA.S.stats.goldEarned) + "g");
  ok(PA.S.stageIndex >= 0, "stage index valid", "stage " + (PA.S.stageIndex + 1));

  // A fresh hero should not one-shot the whole chapter; it should need growth.
  const cleared = PA.S.stageBest;
  ok(cleared < 6, "chapter 1 is not trivially auto-cleared in 90s", "best stage " + cleared);
}

// ---------------------------------------------------------------- economy
console.log("\neconomy");
{
  const PA = boot();
  const r0 = PA.derived.farmRate();
  ok(r0 === 0, "no buildings means no passive income", r0 + "/s");

  PA.S.gold = 1e6;
  PA.buyBuilding("plot", 10);
  const r1 = PA.derived.farmRate();
  ok(r1 > 0, "plots produce income", r1.toFixed(1) + "/s");
  PA.buyBuilding("shovel", 5);
  const r2 = PA.derived.farmRate();
  ok(r2 > r1, "shovels raise income further", r2.toFixed(1) + "/s");

  // costs must outpace a single building's linear output (idle-game shape)
  const c1 = PA.derived.buildingCost("plot");
  PA.S.gold = 1e12;
  PA.buyBuilding("plot", 1);
  const c2 = PA.derived.buildingCost("plot");
  ok(c2 > c1, "plot cost grows with level", c1 + " → " + c2);

  // bulk buy is priced exactly like repeated single buys
  const before = PA.S.farm.plot;
  const goldBefore = PA.S.gold;
  PA.buyBuilding("plot", 5);
  const after = PA.S.farm.plot;
  ok(after - before === 5, "bulk buy grants exactly N levels", (after - before) + " levels");
  ok(PA.S.gold < goldBefore, "bulk buy charges gold");
}

// ---------------------------------------------------------------- tap
console.log("\ntapping");
{
  const PA = boot();
  const v1 = PA.farm.tapValue();
  PA.S.gold = 1e6;
  PA.buyBuilding("plot", 20);
  const v2 = PA.farm.tapValue();
  ok(v1 >= 1, "tap has a base value", PA.fmt(v1) + "g");
  ok(v2 > v1, "tap scales with farm progress", PA.fmt(v1) + " → " + PA.fmt(v2));
}

// ---------------------------------------------------------------- heroes
console.log("\nheroes");
{
  const PA = boot();
  PA.S.gold = 1e9;
  const p0 = PA.derived.teamPower();
  PA.levelHero("rowan", 10);
  const p1 = PA.derived.teamPower();
  ok(p1 > p0, "levelling raises team power", PA.fmt(p0) + " → " + PA.fmt(p1));
  ok(PA.S.stats.heroLevels === 10, "hero level counter tracks levels", PA.S.stats.heroLevels + "");

  PA.S.gem = 500;
  const r = PA.recruitHero("luna");
  ok(r.ok, "recruiting with enough essence succeeds");
  ok(PA.S.heroes.luna.unlocked, "recruited hero is unlocked");
  const p2 = PA.derived.teamPower();
  ok(p2 > p1, "deploying a second hero raises power", PA.fmt(p1) + " → " + PA.fmt(p2));

  const dup = PA.recruitHero("luna");
  ok(!dup.ok, "recruiting twice is rejected");

  // team slots grow with rebirths, capped at 4
  PA.S.rebirths = 0;
  ok(PA.derived.teamSlots() === 2, "two slots at rebirth 0", PA.derived.teamSlots() + "");
  PA.S.rebirths = 1;
  ok(PA.derived.teamSlots() === 3, "three slots at rebirth 1");
  PA.S.rebirths = 9;
  ok(PA.derived.teamSlots() === 4, "slots cap at four");
}

// ---------------------------------------------------------------- save/load
console.log("\nsave / load");
{
  const PA = boot();
  PA.S.gold = 12345;
  PA.S.gem = 77;
  PA.S.stageBest = 9;
  PA.S.farm.plot = 7;
  PA.S.heroes.rowan.level = 12;
  PA.S.team = ["rowan", "luna", null, null];
  PA.S.heroes.luna.unlocked = true;
  PA.save();

  const reloaded = PA.load();
  ok(reloaded, "save is readable");
  ok(PA.S.gold === 12345, "gold survives round-trip", PA.S.gold + "");
  ok(PA.S.heroes.rowan.level === 12, "hero level survives round-trip");
  ok(PA.S.farm.plot === 7, "farm level survives round-trip");
  ok(PA.S.stageBest === 9, "stage progress survives round-trip");

  // corrupt save must not throw
  PA.store.set(PA.SAVE_KEY, { gold: "banana", stageIndex: 999, team: "nope", heroes: null });
  let threw = false;
  try { PA.load(); } catch (e) { threw = true; }
  ok(!threw, "corrupt save does not throw");
  ok(typeof PA.S.gold === "number" && isFinite(PA.S.gold), "corrupt gold is sanitised", PA.S.gold + "");
  ok(PA.S.stageIndex <= PA.D.STAGES.length - 1, "out-of-range stage is clamped", "stage " + PA.S.stageIndex);
  ok(Array.isArray(PA.S.team) && PA.S.team.length === 4, "team array is repaired");
  ok(PA.S.team[0] === "rowan", "team always has a leader");
}

// ---------------------------------------------------------------- migration
console.log("\nsave migration");
{
  const PA = boot();
  // A save from an older/partial build: missing fields entirely.
  PA.store.set(PA.SAVE_KEY, { gold: 100, heroes: { rowan: { unlocked: true, level: 3 } } });
  let threw = false;
  try { PA.load(); } catch (e) { threw = true; console.log("      " + e.message); }
  ok(!threw, "sparse save loads without throwing");
  ok(PA.S.farm && typeof PA.S.farm.plot === "number", "missing farm is created");
  ok(PA.S.stats && PA.S.stats.kills === 0, "missing stats are created");
  ok(PA.S.options.auto === true, "missing options default to auto-battle");
  ok(PA.S.team[0] === "rowan", "team is rebuilt from unlocked heroes");
  ok(PA.S.heroes.rowan.level === 3, "existing hero progress is preserved");

  // Out-of-range / nonsense values are clamped, not trusted.
  PA.store.set(PA.SAVE_KEY, {
    gold: -50, gem: "lots", stageIndex: 900, stageBest: 900,
    farm: { plot: -3, shovel: "x" }, heroes: {}, team: [1, 2, 3, 4, 5, 6],
  });
  threw = false;
  try { PA.load(); } catch (e) { threw = true; }
  ok(!threw, "nonsense save loads without throwing");
  ok(PA.S.gold === 0, "negative gold clamped to 0");
  ok(PA.S.gem === 0, "non-numeric essence clamped to 0");
  ok(PA.S.stageIndex < PA.D.STAGES.length, "stage index clamped into range");
  ok(PA.S.stageBest <= PA.D.STAGES.length, "stage best clamped into range");
  ok(PA.S.farm.plot === 0, "negative farm level clamped to 0");
  ok(PA.S.team.length === 4, "team truncated to four slots");
  ok(PA.S.heroes.rowan && PA.S.heroes.rowan.unlocked, "starter hero is restored");
}

// ---------------------------------------------------------------- rebirth
console.log("\nrebirth");
{
  const PA = boot();
  PA.S.stats.goldEarned = 0;
  PA.S.stageBest = 0;
  const early = PA.rebirthGain();
  ok(early < 3, "no essence for a fresh save", early + " essence");
  ok(!PA.doRebirth().ok, "rebirth is blocked when the gain is too small");

  PA.S.stats.goldEarned = 1e7;
  PA.S.stageBest = 12;
  PA.S.gold = 5e6;
  PA.S.farm.plot = 20;
  const gain = PA.rebirthGain();
  ok(gain >= 3, "rebirth becomes available with progress", gain + " essence");
  const res = PA.doRebirth();
  ok(res.ok, "rebirth succeeds");
  ok(PA.S.gem >= gain, "essence credited", PA.S.gem + "");
  ok(PA.S.gold === 0, "gold reset");
  ok(PA.S.farm.plot === 0, "farm reset");
  ok(PA.S.heroes.rowan.unlocked, "heroes are kept");
  ok(PA.S.rebirths === 1, "rebirth counter incremented");
  ok(PA.derived.heroStats("rowan").atk > 0, "heroes still usable after rebirth");
}

// ---------------------------------------------------------------- ascension
console.log("\nascension");
{
  const PA = boot();
  const base = PA.derived.heroStats("rowan").atk;
  PA.S.gem = 1000;
  ok(PA.ascendBuy("might"), "buying an ascension rank works");
  const boosted = PA.derived.heroStats("rowan").atk;
  ok(boosted > base, "ascension raises attack", base.toFixed(1) + " → " + boosted.toFixed(1));
  const rateBefore = PA.derived.farmRate();
  PA.S.gold = 1e6;
  PA.buyBuilding("plot", 10);
  const r1 = PA.derived.farmRate();
  PA.ascendBuy("harvest");
  ok(PA.derived.farmRate() > r1, "harvest ascension raises income", r1.toFixed(1) + " → " + PA.derived.farmRate().toFixed(1));
  void rateBefore;
}

// ---------------------------------------------------------------- offline
console.log("\noffline progress");
{
  const PA = boot();
  PA.S.gold = 1e6;
  PA.buyBuilding("plot", 15);
  const rate = PA.derived.farmRate();
  PA.S.lastSeen = Date.now() - 3600 * 1000;
  const off = PA.applyOffline();
  ok(!!off, "offline accrual triggers after an hour");
  ok(off.gold > 0, "offline gold is positive", PA.fmt(off.gold) + "g");
  const expected = rate * 3600 * PA.D.BAL.offlineEfficiency;
  ok(Math.abs(off.gold - expected) / expected < 0.05, "offline gold matches the formula",
    PA.fmt(off.gold) + " ≈ " + PA.fmt(expected));

  PA.S.lastSeen = Date.now() - 100 * 3600 * 1000;
  PA.S.gold = 0;
  const capped = PA.applyOffline();
  const capSeconds = PA.D.BAL.offlineCapHours * 3600;
  ok(capped.capped === capSeconds, "offline time is capped", PA.dur(capped.capped * 1000));
}

// ---------------------------------------------------------------- content
console.log("\ncontent integrity");
{
  const PA = boot();
  const D = PA.D;
  ok(D.STAGES.length === 24, "24 stages defined", D.STAGES.length + "");
  const ids = new Set(D.STAGES.map((s) => s.id));
  ok(ids.size === D.STAGES.length, "stage ids are unique");

  const heroIds = D.HEROES.map((h) => h.id);
  ok(new Set(heroIds).size === heroIds.length, "hero ids are unique");
  for (const h of D.HEROES) {
    ok(!!PA.art.SPRITES.includes(h.sprite), "hero " + h.id + " has a sprite");
    ok(!!h.skill && !!h.skill.name, "hero " + h.id + " has a skill");
  }

  for (const q of D.QUESTS) {
    ok(PA.derived.statValue(q.stat) !== undefined, "quest " + q.id + " tracks a real stat");
  }

  // every building must be affordable before it is gated forever
  for (const b of D.FARM) {
    ok(b.curve > 1, b.id + " cost curve grows");
    ok(b.reqStage == null || b.reqStage < D.STAGES.length, b.id + " gate is reachable");
  }

  // difficulty curve: each stage should be meaningfully harder than the last
  let monotonic = true;
  for (let i = 1; i < D.STAGES.length; i++) {
    if (D.STAGES[i].enemyHp <= D.STAGES[i - 1].enemyHp) monotonic = false;
    if (D.STAGES[i].goldPerKill <= D.STAGES[i - 1].goldPerKill) monotonic = false;
  }
  ok(monotonic, "difficulty and rewards both ramp monotonically");
}

// ---------------------------------------------------------------- progression
console.log("\nprogression (5 simulated minutes of active play)");
{
  const PA = boot();
  PA.art.lastLandscape = true;
  const start = Date.now();
  let stageLog = [];
  const dt = 1 / 20;
  PA.battle.layout(620, 380, true);
  PA.battle.enterStage(0, {});
  let lastStage = -1;
  const steps = Math.round(300 / dt);
  for (let i = 0; i < steps; i++) {
    PA.S.options.auto = true;
    PA.farm.step(dt);
    PA.battle.step(dt);
    if (i % 10 === 0) {
      // buy the cheapest affordable farm upgrade + level the lead hero
      let best = null;
      for (const def of PA.D.FARM) {
        if (!PA.derived.buildingUnlocked(def.id)) continue;
        const cost = PA.derived.buildingCost(def.id);
        if (PA.S.gold >= cost && (!best || cost < best.cost)) best = { id: def.id, cost };
      }
      if (best) PA.buyBuilding(best.id, 1);
      if (PA.S.gold > PA.derived.heroLevelCost("rowan") * 3) PA.levelHero("rowan", 1);
    }
    if (PA.S.stageIndex !== lastStage) {
      lastStage = PA.S.stageIndex;
      stageLog.push(lastStage + 1);
    }
  }
  const secs = (Date.now() - start) / 1000;
  console.log(
    "    result: stage " + (PA.S.stageIndex + 1) + ", " +
    PA.fmt(PA.S.gold) + "g, rate " + PA.fmt(PA.derived.farmRate()) + "/s, " +
    "PWR " + PA.fmt(PA.derived.teamPower()) + ", " + PA.S.stats.kills + " kills"
  );
  ok(PA.S.stats.kills > 20, "5 minutes of play produces kills", PA.S.stats.kills + "");
  ok(PA.S.stageIndex > 0, "player advances past stage 1", "reached stage " + (PA.S.stageIndex + 1));
  ok(PA.derived.farmRate() > 0, "farm economy is running", PA.fmt(PA.derived.farmRate()) + "/s");
  ok(PA.derived.teamPower() > 50, "heroes grow in power", PA.fmt(PA.derived.teamPower()));
  ok(PA.S.stageIndex < PA.D.STAGES.length, "no stage overflow");
  ok(secs < 30, "simulation is fast enough for CI", secs.toFixed(1) + "s wall clock");
}

// ---------------------------------------------------------------- summary
console.log("\n" + (failures ? "✗ " + failures + " of " + checks + " checks failed" : "✓ all " + checks + " checks passed"));
process.exitCode = failures ? 1 : 0;
