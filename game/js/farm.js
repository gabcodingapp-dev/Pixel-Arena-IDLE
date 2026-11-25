/* ============================================================
   farm.js - the idle economy: passive gold, tapping, farms plots
   placing on the scene, and floating feedback.
   ============================================================ */
(function (root) {
  "use strict";
  var PA = root.PA, U = PA.U, D = PA.D;

  var Farm = (PA.farm = {});

  Farm.acc = 0;          // fractional gold accumulator
  Farm.tapCombo = 0;
  Farm.tapComboT = 0;
  Farm.plots = [];       // visual plot positions/state on the scene
  Farm.dirty = true;

  /* Tap income scales with farm level so tapping stays relevant early
     and becomes a bonus (not a requirement) later. */
  Farm.tapValue = function () {
    var rate = PA.derived.farmRate();
    var base = 1 + PA.S.stats.taps * 0.02;
    var fromFarm = rate * 0.8;
    var lvlBonus = 1 + (PA.S.heroes.rowan ? PA.S.heroes.rowan.level * 0.08 : 0);
    return Math.max(1, (base + fromFarm) * lvlBonus);
  };

  Farm.tap = function (x, y) {
    Farm.tapCombo = Math.min(2.5, Farm.tapCombo + 0.12);
    Farm.tapComboT = Date.now() + 1200;
    var v = Farm.tapValue() * Farm.tapCombo;
    PA.addGold(v);
    PA.S.stats.taps += 1;
    return v;
  };

  Farm.step = function (dt) {
    var rate = PA.derived.farmRate();
    Farm.acc += rate * dt;
    if (Farm.acc >= 1) {
      var whole = Math.floor(Farm.acc);
      Farm.acc -= whole;
      PA.addGold(whole);
    }
    // tap combo decay
    if (Farm.tapCombo > 0 && Date.now() > Farm.tapComboT) {
      Farm.tapCombo = Math.max(0, Farm.tapCombo - dt * 1.6);
    }
  };

  /* ------------------------------------------------------------
     Plot layout for the farm scene. Each purchased Carrot Plot
     shows up as a tilled bed; other buildings appear as props.
     ------------------------------------------------------------ */
  Farm.layoutPlots = function (W, H, landscape) {
    var plots = [];
    var top = PA.art.fieldTop(H, landscape);
    var cols = landscape ? 6 : 3;
    var rows = landscape ? 2 : 3;
    // Reserve the bottom strip for the heroes standing in front.
    var fieldH = (H - top) * 0.80;
    var startY = top + fieldH * 0.18;
    var plotW = Math.min(W * (landscape ? 0.11 : 0.24), W / cols * 0.82);
    var plotH = plotW * 0.58;
    var gapX = W / cols;
    var gapY = Math.min(plotH * 1.55, (fieldH * 0.82) / rows);
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        plots.push({
          x: gapX * (c + 0.5),
          y: startY + r * gapY,
          w: plotW, h: plotH,
          grow: 0,
          stage: 0
        });
      }
    }
    Farm.plots = plots;
    Farm.dirty = true;
  };

  Farm.plotCount = function () {
    return Math.min(Farm.plots.length, PA.S.farm.plot || 0);
  };

  /* Growth animation: plots fill up and then "harvest" visually. */
  Farm.stepPlots = function (dt) {
    var n = Farm.plotCount();
    var rate = PA.S.farm.plot || 0;
    var speed = 0.20 + Math.min(1.1, rate * 0.014);
    for (var i = 0; i < n; i++) {
      var p = Farm.plots[i];
      p.grow += dt * speed;
      if (p.grow >= 1) {
        p.grow = 0;
        p.harvest = 0.28; // sparkle timer
      }
      if (p.harvest > 0) p.harvest = Math.max(0, p.harvest - dt);
    }
  };

  Farm.draw = function (ctx) {
    var n = Farm.plotCount();
    for (var i = 0; i < n; i++) {
      var p = Farm.plots[i];
      drawPlot(ctx, p);
    }
  };

  function drawPlot(ctx, p) {
    var w = p.w, h = p.h, x = p.x - w / 2, y = p.y - h / 2;
    // tilled soil with rounded ends
    PA.art.rrect(ctx, x, y, w, h, h * 0.28, "#6b4427");
    PA.art.rrect(ctx, x + 1, y + 1, w - 2, h - 2, h * 0.26, "#8a5a34");
    // furrows
    ctx.fillStyle = "#6b4427";
    var rows = 3;
    for (var r = 1; r < rows; r++) {
      ctx.fillRect(Math.round(x + 2), Math.round(y + (h / rows) * r), Math.round(w - 4), 1);
    }
    // crops grow in
    var g = U.clamp(p.grow, 0, 1);
    var harvestPulse = p.harvest > 0 ? Math.sin((0.28 - p.harvest) * 40) * 0.5 + 1 : 1;
    var cols = 3;
    for (var r2 = 0; r2 < rows; r2++) {
      for (var c = 0; c < cols; c++) {
        var cx = x + w * ((c + 0.5) / cols);
        var cy = y + h * ((r2 + 0.5) / rows);
        var scale = (0.45 + 0.55 * g) * harvestPulse;
        var leafH = h * 0.42 * scale;
        if (g > 0.15) {
          ctx.fillStyle = "#2a6525";
          ctx.fillRect(Math.round(cx - 3), Math.round(cy), 2, Math.round(leafH * 0.7));
          ctx.fillRect(Math.round(cx + 1), Math.round(cy), 2, Math.round(leafH * 0.7));
          ctx.fillStyle = "#6ec24a";
          ctx.fillRect(Math.round(cx - 3), Math.round(cy - 1), 2, Math.round(leafH * 0.5));
          ctx.fillRect(Math.round(cx + 1), Math.round(cy - 1), 2, Math.round(leafH * 0.45));
        }
        if (g > 0.72) {
          // carrot tip poking out
          ctx.fillStyle = "#f08a2e";
          var tipY = Math.round(cy + h * 0.16);
          ctx.fillRect(Math.round(cx - 1), tipY, 3, 2);
          ctx.fillStyle = "#ffb45e";
          ctx.fillRect(Math.round(cx - 1), tipY, 1, 1);
        }
      }
    }
    if (p.harvest > 0) {
      ctx.globalAlpha = p.harvest * 2.4;
      ctx.fillStyle = "#ffe07a";
      ctx.fillRect(Math.round(x + w * 0.2), Math.round(y + h * 0.1), 2, 2);
      ctx.fillRect(Math.round(x + w * 0.7), Math.round(y + h * 0.3), 2, 2);
      ctx.globalAlpha = 1;
    }
  }

  /* ------------------------------------------------------------
     Floating coin gains on the scene
     ------------------------------------------------------------ */
  Farm.coinFly = function (ctx, x, y, t, seed) {
    var life = 0.9;
    if (t > life) return false;
    var p = t / life;
    var rnd = U.seeded(seed);
    var dx = (rnd() - 0.5) * 40 * p;
    var dy = -34 * U.easeOutCubic(p) + 20 * p * p;
    var alpha = 1 - p * p;
    ctx.globalAlpha = alpha;
    PA.art.drawCoinIcon(ctx, x + dx, y + dy, 4);
    ctx.globalAlpha = 1;
    return true;
  };

  /* The farm art already shows the cottage, well and fences, so purchased
     non-plot buildings are surfaced in the shop panel rather than scattered
     over the field (which used to collide with the plots). */
  Farm.drawProps = function () {};

})(typeof window !== "undefined" ? window : globalThis);
