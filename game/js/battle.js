/* ============================================================
   battle.js - the auto-battler. Heroes and monsters trade blows
   on a fixed 2.5D line; the player taps to add damage and can
   toggle AUTO / speed. Stages progress when waves are cleared.
   ============================================================ */
(function (root) {
  "use strict";
  var PA = root.PA, U = PA.U, D = PA.D, A = PA.art;

  var B = (PA.battle = {});

  /* ------------------------------------------------------------
     Runtime state
     ------------------------------------------------------------ */
  B.units = [];       // heroes
  B.foes = [];        // enemies
  B.numbers = [];     // floating combat text
  B.ripples = [];     // tap feedback
  B.phase = "fight";
  B.wave = 0;
  B.phaseT = 0;
  B.bossTimer = 0;
  B.stage = null;
  B.killsThisStage = 0;
  B.shake = 0;
  B.auto = true;
  B.speed = 1;
  B.slotPos = [];
  B.enemyPos = [];
  B.introT = 0;

  B.HERO_HP = {};     // persisted between waves so healing matters shorthand
  B.heroDeadT = {};

  /* ------------------------------------------------------------
     Layout
     ------------------------------------------------------------ */
  /* Unit sizes derive from BOTH axes so sprites never get clipped by the
     screen edge on a narrow phone, while landscape keeps them large. */
  B.heroHeight = function (W, H) { return Math.min(H * 0.30, W * 0.32); };
  B.foeHeight = function (W, H) { return Math.min(H * 0.245, W * 0.24); };

  B.layout = function (W, H, landscape) {
    var floor = B.floorY(H, landscape);
    var n = PA.derived.activeHeroIds().length;
    var slots = [];
    // keep the leftmost hero fully on screen: offset by half a sprite width
    var heroHalf = (B.heroHeight(W, H) * 1.35) / 2;
    var heroStartX = Math.max(heroHalf + 2, W * (landscape ? 0.10 : 0.17));
    var heroSpanX = Math.min(W * (landscape ? 0.22 : 0.30), W * 0.5 - heroHalf);
    for (var i = 0; i < Math.max(2, n); i++) {
      var t = n <= 1 ? 0 : i / Math.max(1, n - 1);
      slots.push({
        x: heroStartX + heroSpanX * t,
        // front row sits lower on the ellipse, back row steps up the depth
        y: floor + H * 0.045 - t * H * 0.055 - (i % 2 === 1 ? H * 0.035 : 0)
      });
    }
    B.slotPos = slots;

    // Enemy line: fewer, further-apart slots in portrait where space is tight.
    var foeHalf = (B.foeHeight(W, H) * 1.55) / 2;
    var maxX = W - foeHalf - 2;
    B.enemyPos = landscape
      ? [
          { x: W * 0.60, y: floor + H * 0.055 },
          { x: W * 0.78, y: floor - H * 0.02 },
          { x: Math.min(maxX, W * 0.91), y: floor - H * 0.10 }
        ]
      : [
          { x: Math.min(maxX, W * 0.66), y: floor + H * 0.05 },
          { x: Math.min(maxX, W * 0.88), y: floor - H * 0.06 },
          { x: Math.min(maxX, W * 0.99), y: floor - H * 0.15 }
        ];
  };

  /* Portrait phones can only show two readable foes at once. */
  B.maxFoes = function () {
    return PA.art && PA.art.lastLandscape ? 3 : 2;
  };

  // Shared with the backdrop painter so fighters always stand on the floor.
  B.floorY = function (H, landscape) { return H * PA.art.arenaFrac(landscape); };

  /* ------------------------------------------------------------
     Setup
     ------------------------------------------------------------ */
  B.enterStage = function (index, opts) {
    opts = opts || {};
    var st = D.STAGES[U.clamp(index, 0, D.STAGES.length - 1)];
    B.stage = st;
    B.wave = 0;
    B.phase = "fight";
    B.phaseT = 0;
    B.killsThisStage = 0;
    B.foes = [];
    B.numbers = [];
    B.introT = 0.9;
    if (!opts.keepHp) {
      B.HERO_HP = {};
      B.heroDeadT = {};
    }
    // carry HP across a stage advance, heal to full on a fresh attempt
    B.spawnTeam(!opts.keepHp);
    B.spawnWave();
    PA.bus.emit("stageEnter", st);
    if (st.isBoss) PA.audio.sfx.boss();
    return st;
  };

  B.spawnTeam = function (full) {
    var ids = PA.derived.activeHeroIds();
    B.units = ids.map(function (id, i) {
      var st = PA.derived.heroStats(id);
      var maxHp = st.hp;
      var carry = B.HERO_HP[id];
      var hp = (full || carry == null) ? maxHp : U.clamp(carry, 0, maxHp);
      return {
        id: id,
        def: st.def,
        stats: st,
        hp: hp,
        maxHp: maxHp,
        slot: i,
        cd: U.rand(0.1, 0.7),
        atkAnim: 0,
        hitAnim: 0,
        bob: U.rand(0, 6.28),
        swingCount: 0,
        dead: hp <= 0,
        reviveT: 0
      };
    });
  };

  B.enemyFor = function (templateKey, stage, index) {
    var t = D.ENEMIES[templateKey];
    var hp = stage.enemyHp * t.hp * (1 + index * 0.06);
    var atk = stage.enemyAtk * t.atk;
    return {
      key: templateKey,
      def: t,
      name: t.name,
      hp: hp,
      maxHp: hp,
      atk: atk,
      cd: U.rand(0.7, 2.0) / t.speed,
      slot: index,
      hitAnim: 0,
      atkAnim: 0,
      bob: U.rand(0, 6.28),
      spawnT: 0.35,
      dead: false,
      isBoss: templateKey === "boss"
    };
  };

  B.spawnWave = function () {
    var st = B.stage;
    var count;
    if (st.isBoss) {
      count = 1;
      B.foes = [B.enemyFor("boss", st, 0)];
      B.bossTimer = D.BAL.bossTimer;
    } else {
      B.wave += 1;
      count = st.wave >= 3 ? 3 : (st.wave >= 2 ? 2 : U.randInt(2, 3));
      count = Math.min(B.maxFoes(), count);
      var pool = [];
      for (var i = 0; i < count; i++) {
        var r = Math.random();
        pool.push(r < D.ENEMIES.mimic.w * (st.index / 24) ? "mimic" : "slime");
      }
      B.foes = pool.map(function (k, i) { return B.enemyFor(k, st, i); });
    }
    B.phase = "fight";
    B.phaseT = 0;
    PA.bus.emit("wave", { wave: B.wave, enemies: B.foes.length });
  };

  B.waveTotal = function () { return B.stage ? (B.stage.isBoss ? 1 : B.stage.waves) : 4; };

  /* ------------------------------------------------------------
     Combat helpers
     ------------------------------------------------------------ */
  function aliveFoes() { return B.foes.filter(function (f) { return !f.dead; }); }
  function aliveHeroes() { return B.units.filter(function (u) { return !u.dead; }); }

  function fxNumber(x, y, text, kind) {
    B.numbers.push({ x: x, y: y, text: text, kind: kind || "hit", t: 0, life: 0.85, vy: -26 });
    if (B.numbers.length > 28) B.numbers.shift();
  }

  function damageFoe(foe, amount, opts) {
    opts = opts || {};
    if (foe.dead) return 0;
    var dmg = Math.max(1, amount);
    foe.hp -= dmg;
    foe.hitAnim = 0.22;
    var pos = B.enemyPos[Math.min(foe.slot, B.enemyPos.length - 1)];
    fxNumber(pos.x + U.rand(-5, 5), pos.y - 26, (opts.crit ? "" : "") + PA.fmt(dmg), opts.crit ? "crit" : "hit");
    if (opts.crit) B.shake = Math.max(B.shake, 0.22);
    A.spawnFx("burst", pos.x, pos.y - 18, { color: opts.crit ? "#ffd166" : "#ffffff", r: opts.crit ? 20 : 13, life: 0.3 });
    if (foe.hp <= 0) killFoe(foe);
    return dmg;
  }

  function killFoe(foe) {
    foe.dead = true;
    var pos = B.enemyPos[Math.min(foe.slot, B.enemyPos.length - 1)];
    A.spawnFx("burst", pos.x, pos.y - 16, { color: "#ffe07a", r: 26, life: 0.5 });
    PA.audio.sfx.kill();
    PA.S.stats.kills += 1;
    if (foe.isBoss) PA.S.stats.bosses += 1;
    var gold = B.stage.goldPerKill * (foe.isBoss ? 8 : 1) * D.BAL.killGoldMul;
    PA.addGold(gold);
    fxNumber(pos.x, pos.y - 34, "+" + PA.fmt(gold), "gold");
    PA.bus.emit("kill", { foe: foe, gold: gold });
    // coin bounce on the enemy line
    B.ripples.push({ x: pos.x, y: pos.y - 20, t: 0, life: 0.5, kind: "coins" });
    B.killsThisStage++;

    if (aliveFoes().length === 0) {
      if (B.stage.isBoss) B.clearStage();
      else if (B.wave >= B.waveTotal()) B.clearStage();
      else { B.phase = "waveclear"; B.phaseT = 0; }
    }
  }

  function hurtHero(hero, amount) {
    if (hero.dead) return;
    var dmg = amount * (hero.stats.tank ? 0.65 : 1);
    hero.hp -= dmg;
    hero.hitAnim = 0.24;
    var p = B.slotPos[hero.slot] || B.slotPos[0];
    fxNumber(p.x, p.y - 30, "-" + PA.fmt(dmg), "hurt");
    if (hero.hp <= 0) {
      hero.hp = 0;
      hero.dead = true;
      hero.reviveT = D.BAL.reviveTime;
      fxNumber(p.x, p.y - 38, "DOWN", "hurt");
      PA.bus.emit("heroDown", hero);
    }
    B.HERO_HP[hero.id] = hero.hp;
  }

  function healTeam(hero, amount) {
    var healed = 0;
    B.units.forEach(function (u) {
      if (u.dead) return;
      var before = u.hp;
      u.hp = Math.min(u.maxHp, u.hp + amount);
      healed += u.hp - before;
      B.HERO_HP[u.id] = u.hp;
    });
    if (healed > 0.5) {
      var p = B.slotPos[hero.slot] || B.slotPos[0];
      fxNumber(p.x, p.y - 36, "+" + PA.fmt(healed), "heal");
      A.spawnFx("heal", p.x, p.y - 10, { life: 0.6 });
      PA.audio.sfx.heal();
    }
    return healed;
  }

  /* Hero attack resolution */
  function heroAttack(hero, foe) {
    var st = hero.stats;
    var crit = Math.random() < st.crit;
    var dmg = st.atk * (crit ? 1.9 : 1) * U.rand(0.92, 1.08);
    var pos = B.slotPos[hero.slot] || B.slotPos[0];
    var epos = B.enemyPos[Math.min(foe.slot, B.enemyPos.length - 1)];
    hero.atkAnim = 0.26;
    hero.swingCount++;

    if (hero.def.role === "healer") {
      // healers alternate: heal the team, occasionally chip the enemy
      if (hero.swingCount % 3 === 0) damageFoe(foe, st.atk * 0.6);
      else healTeam(hero, st.heal);
      return;
    }

    A.spawnFx("beam", pos.x + 6, pos.y - 20, {
      x2: epos.x - 6, y2: epos.y - 18,
      color: hero.id === "luna" ? "#c9a3ff" : (hero.id === "nixie" ? "#9ee6ff" : "#fff2c0"),
      life: 0.14
    });

    if (hero.id === "rowan" && hero.swingCount % 5 === 0) {
      // Golden Dig: splash everything
      aliveFoes().forEach(function (f) {
        damageFoe(f, dmg * 1.35, { crit: crit });
      });
      B.ripples.push({ x: epos.x, y: epos.y - 16, t: 0, life: 0.5, kind: "gold" });
      PA.audio.sfx.coin();
      return;
    }

    damageFoe(foe, dmg, { crit: crit });
    PA.audio.sfx.hit(crit);

    // Luna's bolts splash
    if (hero.def.role === "burst") {
      aliveFoes().forEach(function (f) {
        if (f === foe || f.dead) return;
        damageFoe(f, dmg * 0.4, {});
      });
    }
  }

  function foeAttack(foe) {
    var heroes = aliveHeroes();
    if (!heroes.length) return;
    var target = heroes[0];
    if (Math.random() < 0.45) {
      var tanks = heroes.filter(function (h) { return h.stats.tank; });
      if (tanks.length) target = tanks[0];
      else target = U.pick(heroes);
    }
    foe.atkAnim = 0.3;
    var tp = B.slotPos[target.slot] || B.slotPos[0];
    var epos = B.enemyPos[Math.min(foe.slot, B.enemyPos.length - 1)];
    A.spawnFx("beam", epos.x - 6, epos.y - 20, { x2: tp.x + 6, y2: tp.y - 18, color: "#ff9a6a", life: 0.16 });
    hurtHero(target, foe.atk * U.rand(0.9, 1.12));
    PA.audio.sfx.hit(false);
  }

  /* ------------------------------------------------------------
     Stage flow
     ------------------------------------------------------------ */
  B.clearStage = function () {
    B.phase = "clear";
    B.phaseT = 0;
    PA.S.stageProgress = 0;
    var st = B.stage;
    PA.S.stageBest = Math.max(PA.S.stageBest, Math.min(st.index + 1, D.STAGES.length));
    // boss reward
    if (st.gemReward) {
      PA.addGem(st.gemReward);
      fxNumber(root.innerWidth / 2, 80, "+" + st.gemReward + " essence", "gold");
    }
    PA.bus.emit("stageClear", st);
    PA.audio.sfx.wave();
  };

  B.advanceStage = function () {
    var next = Math.min(B.stage.index + 1, D.STAGES.length - 1);
    PA.S.stageIndex = next;
    B.enterStage(next, { keepHp: true });
  };

  B.retryStage = function (index) {
    PA.S.stageIndex = index;
    B.enterStage(index, {});
  };

  /* ------------------------------------------------------------
     Simulation step
     ------------------------------------------------------------ */
  B.step = function (dt) {
    B.auto = !!PA.S.options.auto;
    B.speed = PA.S.options.speed || 1;
    var sdt = dt * B.speed;

    B.introT = Math.max(0, B.introT - sdt);
    B.shake = Math.max(0, B.shake - dt * 3);
    if (B.phaseT != null) B.phaseT += sdt;

    // fx + numbers always animate regardless of pause
    for (var i = B.numbers.length - 1; i >= 0; i--) {
      var n = B.numbers[i];
      n.t += sdt;
      n.y += n.vy * sdt;
      n.vy *= 0.94;
      if (n.t >= n.life) B.numbers.splice(i, 1);
    }
    for (var r = B.ripples.length - 1; r >= 0; r--) {
      var rp = B.ripples[r];
      rp.t += sdt;
      if (rp.t >= rp.life) B.ripples.splice(r, 1);
    }

    // wave / stage transitions
    if (B.phase === "waveclear") {
      if (B.phaseT > D.BAL.waveDelay) B.spawnWave();
      return;
    }
    if (B.phase === "clear") {
      if (B.phaseT > 1.1) {
        var nextIdx = B.stage.index + 1;
        var power = PA.derived.teamPower();
        var nextStage = D.STAGES[Math.min(nextIdx, D.STAGES.length - 1)];
        if (B.auto && nextIdx < D.STAGES.length && power >= nextStage.power * D.BAL.shopUnlockPower) {
          B.advanceStage();
        } else {
          // stay and farm this stage
          B.enterStage(B.stage.index, { keepHp: false });
        }
      }
      return;
    }

    // boss enrage timer: if you can't kill it in time it resets (no penalty)
    if (B.stage && B.stage.isBoss) {
      B.bossTimer -= sdt;
      if (B.bossTimer <= 0) {
        var boss = B.foes[0];
        if (boss && !boss.dead) {
          boss.hp = boss.maxHp;
          B.bossTimer = D.BAL.bossTimer;
          fxNumber(B.enemyPos[0].x, B.enemyPos[0].y - 40, "HEALED", "hurt");
          PA.bus.emit("bossHeal", {});
        }
      }
    }

    // revives
    B.units.forEach(function (u) {
      if (!u.dead) return;
      u.reviveT -= sdt;
      if (u.reviveT <= 0 && B.phase === "fight") {
        u.dead = false;
        u.hp = u.maxHp * 0.6;
        u.hitAnim = 0.3;
        B.HERO_HP[u.id] = u.hp;
        A.spawnFx("heal", (B.slotPos[u.slot] || B.slotPos[0]).x, (B.slotPos[u.slot] || B.slotPos[0]).y - 10, { life: 0.7 });
        fxNumber((B.slotPos[u.slot] || B.slotPos[0]).x, (B.slotPos[u.slot] || B.slotPos[0]).y - 30, "REVIVED", "heal");
      }
    });

    // animations
    B.units.forEach(function (u) {
      u.atkAnim = Math.max(0, u.atkAnim - dt);
      u.hitAnim = Math.max(0, u.hitAnim - dt);
      u.bob += dt * 2.2;
    });
    B.foes.forEach(function (f) {
      f.atkAnim = Math.max(0, f.atkAnim - dt);
      f.hitAnim = Math.max(0, f.hitAnim - dt);
      f.bob += dt * 2.8;
      f.spawnT = Math.max(0, f.spawnT - dt);
    });

    if (!B.auto || B.introT > 0) return;

    var heroes = aliveHeroes();
    var foes = aliveFoes();
    if (!heroes.length || !foes.length) return;

    var target = foes[0];
    heroes.forEach(function (h) {
      h.cd -= sdt * h.stats.spd;
      if (h.cd <= 0) {
        h.cd = 1;
        heroAttack(h, target);
      }
    });

    B.foes.forEach(function (f) {
      if (f.dead || f.spawnT > 0) return;
      f.cd -= sdt * f.def.speed;
      if (f.cd <= 0) {
        f.cd = f.isBoss ? 1.6 : U.rand(1.6, 2.4);
        foeAttack(f);
      }
    });
  };

  /* Player tap: extra damage at the tapped point. */
  B.tap = function (cssX, cssY, canvasCtx, box) {
    var scale = box.cssW / box.W;
    var x = cssX / scale, y = cssY / scale;
    B.ripples.push({ x: x, y: y, t: 0, life: 0.35, kind: "tap" });
    var best = null, bestD = 1e9;
    B.foes.forEach(function (f) {
      if (f.dead) return;
      var p = B.enemyPos[Math.min(f.slot, B.enemyPos.length - 1)];
      var d = Math.hypot(p.x - x, (p.y - 22) - y);
      if (d < bestD) { bestD = d; best = f; }
    });
    var power = PA.derived.teamPower();
    var dmg = power * 0.55;
    if (best && bestD < box.W * 0.3) {
      var crit = Math.random() < 0.12;
      damageFoe(best, dmg * (crit ? 2 : 1), { crit: crit });
      PA.audio.sfx.hit(crit);
      return { hit: true, dmg: dmg };
    }
    return { hit: false };
  };

  /* ------------------------------------------------------------
     Rendering
     ------------------------------------------------------------ */
  B.draw = function (ctx, W, H, landscape, t) {
    var floor = B.floorY(H, landscape);

    ctx.save();
    if (B.shake > 0) {
      ctx.translate(U.rand(-1.5, 1.5) * B.shake * 3, U.rand(-1.5, 1.5) * B.shake * 3);
    }

    // ---- enemies (draw far slot first)
    var order = B.foes.slice().sort(function (a, b) { return b.slot - a.slot; });
    order.forEach(function (f) {
      if (f.dead) return;
      var p = B.enemyPos[Math.min(f.slot, B.enemyPos.length - 1)];
      drawFoe(ctx, f, p, W, H, landscape, t);
    });

    // ---- heroes (back slots first)
    var unitsBySlot = B.units.slice().sort(function (a, b) { return b.slot - a.slot; });
    unitsBySlot.forEach(function (u) {
      var p = B.slotPos[u.slot] || B.slotPos[0];
      drawHero(ctx, u, p, W, H, t);
    });

    // ---- projectiles / impacts
    A.drawFx(ctx);

    // ---- floating numbers
    B.numbers.forEach(function (n) {
      var p = n.t / n.life;
      ctx.globalAlpha = 1 - p * p;
      var size = n.kind === "crit" ? 11 : 8;
      ctx.font = size + 'px "PixelFont", monospace';
      ctx.textAlign = "center";
      var col = n.kind === "gold" ? "#ffd166" : n.kind === "hurt" ? "#ff8a7a" : n.kind === "heal" ? "#a6f08a" : "#ffffff";
      ctx.fillStyle = "rgba(40,20,6,.75)";
      ctx.fillText(n.text, Math.round(n.x) + 1, Math.round(n.y) + 1);
      ctx.fillStyle = col;
      ctx.fillText(n.text, Math.round(n.x), Math.round(n.y));
      ctx.globalAlpha = 1;
    });

    // ---- tap ripples
    B.ripples.forEach(function (r) {
      var p = r.t / r.life;
      if (r.kind === "tap") {
        ctx.globalAlpha = 1 - p;
        ctx.strokeStyle = "#fff6d0";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(r.x, r.y, 4 + p * 18, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      } else {
        // coin burst
        ctx.globalAlpha = 1 - p;
        for (var i = 0; i < 4; i++) {
          var a = -Math.PI / 2 + (i - 1.5) * 0.5;
          var d = 26 * U.easeOutCubic(p);
          A.drawCoinIcon(ctx, r.x + Math.cos(a) * d, r.y + Math.sin(a) * d - p * 8, 4);
        }
        ctx.globalAlpha = 1;
      }
    });

    ctx.restore();

    // ---- boss health / timer banner
    if (B.stage && B.stage.isBoss && B.foes[0] && !B.foes[0].dead) {
      drawBossBar(ctx, W, H);
    }

    // ---- stage intro flash
    if (B.introT > 0) {
      var a = U.clamp(B.introT / 0.9, 0, 1);
      ctx.globalAlpha = a * 0.55;
      ctx.fillStyle = "#120b05";
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
      ctx.font = '10px "PixelFont", monospace';
      ctx.textAlign = "center";
      ctx.fillStyle = "#ffe9b6";
      ctx.fillText(PA.S.stageIndex < 0 ? "" : "STAGE " + (B.stage ? B.stage.id : ""),
        Math.round(W / 2), Math.round(H * 0.36));
      ctx.font = '8px "PixelFont", monospace';
      ctx.fillStyle = "#ffffff";
      ctx.fillText((B.stage ? B.stage.name : "").toUpperCase(), Math.round(W / 2), Math.round(H * 0.36) + 16);
    }
  };

  function drawHero(ctx, u, p, W, H, t) {
    var footY = p.y;
    var base = B.heroHeight(W, H);
    var height = u.stats.tank ? base * 1.15 : (u.id === "fox" ? base * 0.72 : base);
    if (u.id === "luna") height *= 1.02;
    var bob = Math.sin(u.bob) * (height * 0.012);
    var lunge = u.atkAnim > 0 ? U.easeOutCubic(1 - u.atkAnim / 0.26) * 10 : 0;
    var hitX = u.hitAnim > 0 ? Math.sin(u.hitAnim * 60) * 2 : 0;

    if (u.dead) {
      ctx.globalAlpha = 0.35;
      A.drawSprite(ctx, A.sprites[u.def.sprite], p.x, footY, height, { alpha: 0.4 });
      ctx.globalAlpha = 1;
      // revive ring
      var rp = 1 - u.reviveT / D.BAL.reviveTime;
      ctx.strokeStyle = "#ffe07a";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, footY - height * 0.4, height * 0.34 * (1 - rp) + 2, 0, Math.PI * 2);
      ctx.stroke();
      return;
    }

    A.drawShadow(ctx, p.x + hitX, footY + 1, height * 0.26, height * 0.075, 0.22);
    var img = A.sprites[u.def.sprite];
    // attack flash behind the sprite
    if (u.atkAnim > 0.12) {
      ctx.save();
      ctx.globalAlpha = (u.atkAnim / 0.26) * 0.5;
      A.drawSprite(ctx, img, p.x, footY, height, { alpha: 0.5 });
      ctx.restore();
    }
    A.drawSprite(ctx, img, p.x + lunge + hitX, footY + bob, height, {});
    drawUnitHp(ctx, p.x + hitX, footY - height - 7, Math.max(20, height * 0.46), u.hp / u.maxHp, "#7ddc5a");
  }

  function drawFoe(ctx, f, p, W, H, landscape, t) {
    var baseH = B.foeHeight(W, H);
    var height = f.isBoss ? baseH * 1.25 : (f.key === "mimic" ? baseH * 0.78 : baseH * 0.62);
    var spawn = 1 - U.clamp(f.spawnT / 0.35, 0, 1);
    var scale = U.easeOutBack(spawn);
    var bob = Math.sin(f.bob) * height * 0.014;
    var lunge = f.atkAnim > 0 ? -U.easeOutCubic(1 - f.atkAnim / 0.3) * 12 : 0;
    var hitX = f.hitAnim > 0 ? Math.sin(f.hitAnim * 120) * 2.5 : 0;

    A.drawShadow(ctx, p.x, p.y + 1, height * 0.28, height * 0.08, 0.24);
    var img = A.sprites[f.def.sprite];
    var opts = { scale: Math.max(0.01, scale), flip: true };
    if (f.hitAnim > 0.08) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = 0.55;
      A.drawSprite(ctx, img, p.x + lunge + hitX, p.y + bob, height, opts);
      ctx.restore();
    }
    A.drawSprite(ctx, img, p.x + lunge + hitX, p.y + bob, height, opts);
    drawUnitHp(ctx, p.x, p.y - height - 7, Math.max(18, height * 0.44), f.hp / f.maxHp, "#ff7a6a");
  }

  function drawUnitHp(ctx, cx, y, w, ratio, color) {
    w = Math.max(16, Math.round(w));
    var x = Math.round(cx - w / 2), yy = Math.round(y);
    ctx.fillStyle = "rgba(30,18,8,.72)";
    ctx.fillRect(x - 1, yy - 1, w + 2, 5);
    ctx.fillStyle = "#3a2412";
    ctx.fillRect(x, yy, w, 3);
    var fw = Math.round(w * U.clamp(ratio, 0, 1));
    ctx.fillStyle = color;
    ctx.fillRect(x, yy, fw, 3);
    ctx.fillStyle = "rgba(255,255,255,.45)";
    ctx.fillRect(x, yy, fw, 1);
  }

  function drawBossBar(ctx, W, H) {
    var f = B.foes[0];
    var w = Math.round(W * 0.62), x = Math.round((W - w) / 2), y = 8;
    ctx.fillStyle = "rgba(24,14,6,.8)";
    ctx.fillRect(x - 2, y - 2, w + 4, 14);
    ctx.fillStyle = "#4a2416";
    ctx.fillRect(x, y, w, 10);
    ctx.fillStyle = "#e0503c";
    ctx.fillRect(x, y, Math.round(w * U.clamp(f.hp / f.maxHp, 0, 1)), 10);
    ctx.fillStyle = "rgba(255,255,255,.25)";
    ctx.fillRect(x, y, w, 3);
    ctx.font = '7px "PixelFont", monospace';
    ctx.textAlign = "center";
    ctx.fillStyle = "#fff3d6";
    ctx.fillText("GUARDIAN  " + Math.ceil(f.hp) + " / " + Math.ceil(f.maxHp), W / 2, y + 8);
    // timer ticks
    var tw = Math.round((B.bossTimer / D.BAL.bossTimer) * w);
    ctx.fillStyle = "#ffd166";
    ctx.fillRect(x, y + 11, Math.max(0, tw), 2);
  }

  /* ------------------------------------------------------------
     Read-outs for the HUD
     ------------------------------------------------------------ */
  B.status = function () {
    if (B.phase === "clear") return { label: "Stage clear!", sub: "", progress: 1 };
    var total = B.waveTotal();
    var frac = total ? U.clamp((B.wave - 0.0) / total, 0, 1) : 0;
    return {
      label: B.stage ? B.stage.name : "",
      sub: B.stage && B.stage.isBoss ? "Boss fight" : "Wave " + Math.max(1, B.wave) + " / " + total,
      progress: frac
    };
  };
})(typeof window !== "undefined" ? window : globalThis);
