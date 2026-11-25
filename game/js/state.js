/* ============================================================
   state.js - the authoritative game state, derived stats, save /
   load / migrate and offline progress.

   Design notes
   - All numbers are plain JSON-safe values so a save is portable
     between the web build, the Capacitor APK and a future native
     shell.
   - `S` is mutated in place; systems read it directly. The UI
     re-renders on a low-frequency timer, not every tick.
   ============================================================ */
(function (root) {
  "use strict";
  var PA = root.PA, U = PA.U, D = PA.D;

  var SAVE_KEY = "pixelArenaIdle.save.v1";
  var SAVE_VERSION = 1;

  PA.SAVE_VERSION = SAVE_VERSION;

  function freshHeroes() {
    var h = {};
    D.HEROES.forEach(function (def) {
      h[def.id] = {
        unlocked: !!def.unlocked,
        level: 1,
        stars: def.rarity,
        xp: 0
      };
    });
    return h;
  }

  function freshFarm() {
    var f = {};
    D.FARM.forEach(function (b) { f[b.id] = 0; });
    return f;
  }

  PA.freshState = function () {
    return {
      version: SAVE_VERSION,
      createdAt: Date.now(),
      lastSeen: Date.now(),
      playerName: "Trailblazer",
      // resources
      gold: 0,
      gem: 0,
      shard: 0,
      // progression
      stageIndex: 0,
      stageBest: 0,          // stages cleared, 0..24
      stageProgress: 0,      // waves cleared in current stage
      heroes: freshHeroes(),
      team: ["rowan", null, null, null],
      farm: freshFarm(),
      ascend: { might: 0, harvest: 0, vigor: 0, luck: 0 },
      rebirths: 0,
      // lifetime stats (quests)
      stats: {
        kills: 0,
        bosses: 0,
        goldEarned: 0,
        upgrades: 0,
        heroes: 1,
        heroLevels: 0,
        rebirths: 0,
        playTime: 0,
        taps: 0
      },
      claimed: {},
      options: {
        auto: true,
        speed: 1,
        sfx: true,
        music: true,
        reduceFx: false
      },
      // transient-ish but persisted so the scene matches on resume
      seenIntro: false
    };
  };

  PA.S = PA.freshState();

  /* ------------------------------------------------------------
     Derived numbers
     ------------------------------------------------------------ */
  var der = (PA.derived = {});

  der.stage = function () {
    var i = U.clamp(PA.S.stageIndex, 0, D.STAGES.length - 1);
    return D.STAGES[i];
  };

  /* Quest and UI stat lookups. Most live in stats{}; stageBest is a root
     field, so it gets special-cased here instead of being duplicated. */
  der.statValue = function (stat) {
    if (stat === "stageBest") return PA.S.stageBest || 0;
    return (PA.S.stats && PA.S.stats[stat]) || 0;
  };

  der.ascendBonus = function (id) {
    var def = null;
    for (var i = 0; i < D.ASCEND.length; i++) if (D.ASCEND[i].id === id) def = D.ASCEND[i];
    if (!def) return 0;
    return (PA.S.ascend[id] || 0) * def.per;
  };

  der.farmRate = function () {
    var rate = 0;
    D.FARM.forEach(function (def) {
      var lvl = PA.S.farm[def.id] || 0;
      if (!lvl) return;
      // gentle superlinear growth so late buildings stay relevant
      rate += def.rate * lvl * (1 + (lvl - 1) * 0.06);
    });
    rate *= 1 + der.ascendBonus("harvest");
    // stage progress also speeds the farm up a little
    rate *= 1 + Math.min(PA.S.stageBest, 24) * 0.03;
    return rate;
  };

  der.heroStats = function (id) {
    var def = null;
    for (var i = 0; i < D.HEROES.length; i++) if (D.HEROES[i].id === id) def = D.HEROES[i];
    if (!def) return null;
    var h = PA.S.heroes[id] || { level: 1, stars: def.rarity };
    var lvMul = 1 + (h.level - 1) * D.BAL.heroLevelStat;
    var starMul = D.starMul(h.stars);
    var might = 1 + der.ascendBonus("might");
    var vigor = 1 + der.ascendBonus("vigor");
    var luck = der.ascendBonus("luck");
    return {
      id: id,
      def: def,
      level: h.level,
      stars: h.stars,
      atk: def.atk * lvMul * starMul * might,
      hp: def.hp * lvMul * starMul * vigor,
      heal: (def.heal || 0) * lvMul * starMul * might,
      crit: U.clamp(def.crit + luck, 0, 0.85),
      spd: def.spd,
      role: def.role,
      tank: !!def.tank
    };
  };

  der.heroLevelCost = function (id) {
    var h = PA.S.heroes[id];
    if (!h) return 0;
    return Math.ceil(D.BAL.heroLevelCostBase * Math.pow(D.BAL.heroLevelCurve, h.level - 1) *
      (1 + h.stars * 0.16));
  };

  der.teamPower = function () {
    var p = 0;
    PA.S.team.forEach(function (id) {
      if (!id) return;
      var st = der.heroStats(id);
      if (st) p += st.atk * 2.4 + st.hp * 0.55;
    });
    if (!p) {
      // fallback: base hero always counts even if team empty
      var st0 = der.heroStats("rowan");
      p = st0 ? st0.atk * 2.4 + st0.hp * 0.55 : 1;
    }
    return p;
  };

  /* Two heroes from the start, one more per rebirth, capped at four. */
  der.teamSlots = function () {
    return U.clamp(2 + (PA.S.rebirths || 0), 1, D.BAL.maxTeam);
  };

  der.activeHeroIds = function () {
    var out = [];
    var slots = der.teamSlots();
    for (var i = 0; i < slots; i++) {
      var id = PA.S.team[i];
      if (id && PA.S.heroes[id] && PA.S.heroes[id].unlocked) out.push(id);
    }
    if (!out.length) out.push("rowan");
    return out;
  };

  der.farmBuilding = function (id) {
    for (var i = 0; i < D.FARM.length; i++) if (D.FARM[i].id === id) return D.FARM[i];
    return null;
  };

  der.buildingCost = function (id) {
    var def = der.farmBuilding(id);
    if (!def) return Infinity;
    var lvl = PA.S.farm[id] || 0;
    return Math.ceil(def.base * Math.pow(def.curve, lvl));
  };

  der.buildingUnlocked = function (id) {
    var def = der.farmBuilding(id);
    if (!def) return false;
    if (def.reqStage != null && PA.S.stageBest <= def.reqStage) return false;
    return true;
  };

  der.canAfford = function (id) {
    var cost = der.buildingCost(id);
    var lvl = PA.S.farm[id] || 0;
    var def = der.farmBuilding(id);
    if (def && def.max && lvl >= def.max) return false;
    return PA.S.gold >= cost;
  };

  der.ascendCost = function (id) {
    for (var i = 0; i < D.ASCEND.length; i++) {
      var d = D.ASCEND[i];
      if (d.id === id) {
        return Math.ceil(d.base * Math.pow(d.curve, PA.S.ascend[id] || 0));
      }
    }
    return Infinity;
  };

  /* Next-stage hint: how much power the next stage wants. */
  der.nextStageNeed = function () {
    var nxt = D.STAGES[Math.min(PA.S.stageIndex + 1, D.STAGES.length - 1)];
    return nxt.power;
  };

  /* ------------------------------------------------------------
     Mutations (kept together so the UI has one place to hook)
     ------------------------------------------------------------ */
  PA.addGold = function (n) {
    if (!(n > 0)) return;
    PA.S.gold += n;
    PA.S.stats.goldEarned += n;
  };
  PA.spendGold = function (n) {
    if (PA.S.gold < n) return false;
    PA.S.gold -= n;
    return true;
  };
  PA.addGem = function (n) { PA.S.gem = Math.max(0, PA.S.gem + n); };
  PA.addShard = function (n) { PA.S.shard = Math.max(0, PA.S.shard + n); };

  PA.buyBuilding = function (id, bulk) {
    var def = der.farmBuilding(id);
    if (!def) return false;
    var lvl = PA.S.farm[id] || 0;
    var bought = 0;
    var count = bulk || 1;
    var total = 0;
    for (var i = 0; i < count; i++) {
      if (def.max && lvl + bought >= def.max) break;
      total += Math.ceil(def.base * Math.pow(def.curve, lvl + bought));
      bought++;
    }
    if (!bought || PA.S.gold < total) return false;
    PA.S.gold -= total;
    PA.S.farm[id] = lvl + bought;
    PA.S.stats.upgrades += bought;
    PA.bus.emit("buy", { id: id, total: total });
    return true;
  };

  PA.levelHero = function (id, bulk) {
    var h = PA.S.heroes[id];
    if (!h || !h.unlocked) return false;
    var count = bulk || 1;
    var spent = 0;
    for (var i = 0; i < count; i++) {
      var cost = der.heroLevelCost(id);
      if (PA.S.gold < cost) break;
      PA.S.gold -= cost;
      spent += cost;
      h.level += 1;
      PA.S.stats.heroLevels += 1;
    }
    if (!spent) return false;
    PA.bus.emit("levelup", { id: id });
    return true;
  };

  PA.recruitHero = function (id) {
    var def = null;
    for (var i = 0; i < D.HEROES.length; i++) if (D.HEROES[i].id === id) def = D.HEROES[i];
    if (!def) return { ok: false, msg: "Unknown hero" };
    var h = PA.S.heroes[id];
    if (!h || h.unlocked) return { ok: false, msg: "Already recruited" };
    if (PA.S.gem < def.cost) return { ok: false, msg: "Need " + def.cost + " essence" };
    PA.S.gem -= def.cost;
    h.unlocked = true;
    PA.S.stats.heroes = Object.keys(PA.S.heroes).filter(function (k) { return PA.S.heroes[k].unlocked; }).length;
    // auto-fill the first empty team slot
    for (var s = 0; s < PA.S.team.length; s++) {
      if (!PA.S.team[s]) { PA.S.team[s] = id; break; }
    }
    PA.bus.emit("recruit", { id: id });
    return { ok: true, msg: def.name + " joined your party!" };
  };

  PA.setTeamSlot = function (slot, id) {
    if (slot < 0 || slot >= PA.S.team.length) return false;
    if (id && !(PA.S.heroes[id] && PA.S.heroes[id].unlocked)) return false;
    // remove from any other slot to avoid duplicates
    if (id) {
      for (var i = 0; i < PA.S.team.length; i++) if (PA.S.team[i] === id) PA.S.team[i] = null;
    }
    PA.S.team[slot] = id || null;
    PA.bus.emit("team", {});
    return true;
  };

  PA.ascendBuy = function (id) {
    var cost = der.ascendCost(id);
    if (PA.S.gem < cost) return false;
    if ((PA.S.ascend[id] || 0) >= D.ASC_MAX) return false;
    PA.S.gem -= cost;
    PA.S.ascend[id] = (PA.S.ascend[id] || 0) + 1;
    PA.bus.emit("ascend", { id: id });
    return true;
  };

  /* Rebirth: wipe run progress, keep heroes + ascension, grant essence. */
  PA.rebirthGain = function () {
    var base = Math.floor(Math.sqrt(PA.S.stats.goldEarned / 2500));
    var stageBonus = PA.S.stageBest * 2;
    return Math.max(0, base + stageBonus);
  };

  PA.doRebirth = function () {
    var gain = PA.rebirthGain();
    if (gain < 3) return { ok: false, msg: "Earn more gold and clear more stages first." };
    PA.S.gem += gain;
    PA.S.rebirths += 1;
    PA.S.stats.rebirths += 1;
    // reset run
    PA.S.gold = 0;
    PA.S.stageIndex = 0;
    PA.S.stageProgress = 0;
    PA.S.farm = {}; D.FARM.forEach(function (b) { PA.S.farm[b.id] = 0; });
    // heroes keep levels but get a small % boost via stars
    Object.keys(PA.S.heroes).forEach(function (k) {
      var h = PA.S.heroes[k];
      if (!h.unlocked) return;
      if (h.stars < 8 && h.level >= 5 * h.stars) h.stars += 1;
    });
    PA.S.stats.goldEarned = PA.S.stats.goldEarned; // lifetime kept
    PA.bus.emit("rebirth", { gain: gain });
    return { ok: true, gain: gain };
  };

  /* ------------------------------------------------------------
     Save / load
     ------------------------------------------------------------ */
  function mergeDefaults(target, defaults) {
    for (var k in defaults) {
      if (!(k in target)) target[k] = defaults[k];
      else if (defaults[k] && typeof defaults[k] === "object" && !Array.isArray(defaults[k])) {
        if (typeof target[k] !== "object" || target[k] === null) target[k] = defaults[k];
        else mergeDefaults(target[k], defaults[k]);
      }
    }
    return target;
  }

  PA.save = function () {
    PA.S.lastSeen = Date.now();
    PA.S.version = SAVE_VERSION;
    var ok = PA.store.set(SAVE_KEY, PA.S);
    PA.bus.emit("saved", ok);
    return ok;
  };

  PA.hasSave = function () { return !!PA.store.get(SAVE_KEY, null); };

  PA.load = function () {
    var data = PA.store.get(SAVE_KEY, null);
    if (!data || typeof data !== "object") return false;
    var fresh = PA.freshState();
    mergeDefaults(data, fresh);
    // guard rails against corrupted numbers
    ["gold", "gem", "shard"].forEach(function (k) {
      if (typeof data[k] !== "number" || !isFinite(data[k]) || data[k] < 0) data[k] = 0;
    });
    data.stageIndex = U.clamp(data.stageIndex | 0, 0, D.STAGES.length - 1);
    data.stageBest = U.clamp(data.stageBest | 0, 0, D.STAGES.length);
    // Repair anything that a partial write, an old build or hand-editing
    // could have corrupted. Loading must never throw: a bad save degrades to a
    // playable one rather than bricking the app.
    if (typeof data.heroes !== "object" || data.heroes === null) {
      data.heroes = fresh.heroes;
    } else {
      mergeDefaults(data.heroes, fresh.heroes);
      Object.keys(data.heroes).forEach(function (k) {
        var h = data.heroes[k];
        if (typeof h !== "object" || h === null) { data.heroes[k] = fresh.heroes[k]; return; }
        h.level = Math.max(1, Math.floor(Number(h.level) || 1));
        h.stars = U.clamp(Math.floor(Number(h.stars) || 1), 1, 8);
        h.unlocked = !!h.unlocked;
      });
    }
    if (!Array.isArray(data.team)) data.team = [];
    data.team = data.team.slice(0, D.BAL.maxTeam);
    while (data.team.length < D.BAL.maxTeam) data.team.push(null);
    data.team = data.team.map(function (id) {
      return id && data.heroes[id] && data.heroes[id].unlocked ? id : null;
    });
    if (!data.team[0]) {
      // fall back to any unlocked hero, then to the starting hero
      data.team[0] = Object.keys(data.heroes).filter(function (k) {
        return data.heroes[k] && data.heroes[k].unlocked;
      })[0] || "rowan";
      if (!data.heroes[data.team[0]]) data.heroes[data.team[0]] = fresh.heroes[data.team[0]];
      data.heroes[data.team[0]].unlocked = true;
    }
    if (typeof data.farm !== "object" || data.farm === null) data.farm = fresh.farm;
    Object.keys(fresh.farm).forEach(function (k) {
      var v = Math.floor(Number(data.farm[k]));
      data.farm[k] = isFinite(v) && v > 0 ? Math.min(v, 999) : 0;
    });
    if (typeof data.claimed !== "object" || data.claimed === null) data.claimed = {};
    if (typeof data.options !== "object" || data.options === null) data.options = fresh.options;
    data.rebirths = Math.max(0, Math.floor(Number(data.rebirths) || 0));
    PA.S = data;
    return true;
  };

  PA.resetSave = function () {
    PA.store.del(SAVE_KEY);
    PA.S = PA.freshState();
    PA.bus.emit("reset", {});
  };

  /* ------------------------------------------------------------
     Offline progress: gold accumulates at a reduced rate while
     the app is closed, capped so it never trivialises the game.
     ------------------------------------------------------------ */
  PA.applyOffline = function () {
    var now = Date.now();
    var last = PA.S.lastSeen || now;
    var elapsed = Math.max(0, (now - last) / 1000);
    PA.S.lastSeen = now;
    if (elapsed < 60) return null;
    var capped = Math.min(elapsed, D.BAL.offlineCapHours * 3600);
    var rate = der.farmRate();
    var gold = rate * capped * D.BAL.offlineEfficiency;
    if (gold < 1) return null;
    PA.addGold(gold);
    return { seconds: elapsed, capped: capped, gold: gold, rate: rate };
  };

  PA.SAVE_KEY = SAVE_KEY;
})(typeof window !== "undefined" ? window : globalThis);
