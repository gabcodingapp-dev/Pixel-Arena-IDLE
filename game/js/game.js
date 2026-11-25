/* ============================================================
   game.js - boot, main loop, input wiring, scene switching.
   ============================================================ */
(function (root) {
  "use strict";
  var PA = root.PA, U = PA.U, D = PA.D, A = PA.art, UI = PA.ui, B = PA.battle;
  var $ = function (id) { return root.document.getElementById(id); };
  var doc = root.document;

  var canvas, box, ambience, running = false, lastT = 0;
  var saveAcc = 0, uiAcc = 0, plotAcc = 0;
  var gameT = 0;

  PA.scene = { name: "battle", dirty: true };

  /* ------------------------------------------------------------
     Boot
     ------------------------------------------------------------ */
  function bootStatus(msg, pct) {
    var s = $("bootStatus");
    if (s && msg) s.textContent = msg;
    if (pct != null) {
      var f = $("bootFill");
      if (f) f.style.width = Math.round(4 + pct * 96) + "%";
    }
  }

  function init() {
    canvas = $("scene");
    if (!canvas) return;

    PA.store; // ensure available
    var had = PA.load();
    var offline = had ? PA.applyOffline() : null;

    PA.audio.setMusic(PA.S.options.music);

    box = A.resize(canvas, root.innerWidth, root.innerHeight - headerHeightGuess());

    var boot = $("boot");
    var start = $("bootStart");

    bootStatus("Unpacking sprites...", 0.1);
    A.load(function (p) { bootStatus(null, 0.1 + p * 0.75); }).then(function () {
      bootStatus("Planting carrots...", 0.92);
      layoutScene();
      PA.battle.enterStage(PA.S.stageIndex, {});
      start.hidden = false;
      bootStatus(had ? "Save loaded · Stage " + D.STAGES[PA.S.stageIndex].id : "A new farm awaits");
      start.textContent = had ? "Continue" : "Tap to Play";
      start.addEventListener("click", function () {
        PA.audio.init();
        PA.audio.resume();
        PA.audio.setMusic(PA.S.options.music);
        if (had && offline) { /* shown after the intro */ }
        startGame(had, offline);
      });
      // Auto-start once the art is in; the tap only unlocks audio on mobile.
      var autoStart = setTimeout(function () {
        if (!running) { startGame(had, offline); }
      }, 900);
      start.addEventListener("click", function () { clearTimeout(autoStart); }, { once: true });
    });
  }

  function headerHeightGuess() {
    // during boot #app is transparent; use the full viewport for the canvas
    return 0;
  }

  function startGame(had, offline) {
    if (running) return;
    running = true;
    var boot = $("boot");
    boot.classList.add("is-gone");
    doc.body.classList.remove("is-booting");
    setTimeout(function () { boot.style.display = "none"; }, 500);

    layoutScene();
    wireInput();
    UI.renderHud();
    UI.renderPanel(true);

    if (!had || !PA.S.seenIntro) {
      PA.S.seenIntro = true;
      setTimeout(function () { UI.introModal(); }, 260);
    } else if (offline) {
      setTimeout(function () { UI.offlineModal(offline); }, 300);
    }

    lastT = performance.now();
    requestAnimationFrame(frame);
    PA.bus.emit("started", {});
  }

  /* ------------------------------------------------------------
     Scene layout / orientation
     ------------------------------------------------------------ */
  function layoutScene() {
    if (!canvas) return;
    var stage = $("stage");
    var rect = stage.getBoundingClientRect();
    var cssW = Math.max(200, rect.width);
    var cssH = Math.max(160, rect.height);
    var landscape = cssW > cssH;

    doc.body.classList.toggle("orient-landscape", landscape);
    doc.body.classList.toggle("orient-portrait", !landscape);

    box = A.resize(canvas, cssW, cssH);
    A.invalidate();

    PA.farm.layoutPlots(box.W, box.H, box.landscape);
    B.layout(box.W, box.H, box.landscape);
    ambience = new A.Ambience(sceneAmbience());
    PA.scene.dirty = true;
  }

  function sceneAmbience() {
    if (PA.scene.name === "battle") return "spores";
    return "petals";
  }

  function setScene(name) {
    if (PA.scene.name === name) return;
    PA.scene.name = name;
    PA.scene.dirty = true;
    A.invalidate();
    ambience = new A.Ambience(sceneAmbience());
    UI.renderHud();
  }

  /* ------------------------------------------------------------
     Main loop
     ------------------------------------------------------------ */
  function frame(now) {
    if (!running) return;
    var dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    gameT += dt;
    var speed = PA.S.options.speed || 1;

    // ---- simulation
    PA.farm.step(dt);
    if (PA.scene.name === "battle") B.step(dt);
    PA.farm.stepPlots(dt * speed);
    PA.battle.auto = PA.S.options.auto;
    PA.S.stats.playTime += dt;

    // ---- rendering
    render(dt);

    // ---- periodic UI / persistence
    uiAcc += dt;
    if (uiAcc > 0.2) { UI.renderHud(); uiAcc = 0; }
    plotAcc += dt;
    if (plotAcc > 0.5) { UI.renderPanel(); plotAcc = 0; }
    saveAcc += dt;
    if (saveAcc > D.BAL.autosave) { PA.save(); saveAcc = 0; }

    requestAnimationFrame(frame);
  }

  function render(dt) {
    if (!box) return;
    var ctx = box.ctx, W = box.W, H = box.H;
    var scene = PA.scene.name;

    ambience.step(dt, W, H);

    var staticC = A.ensureStatic(scene, W, H, box.landscape);
    ctx.drawImage(staticC, 0, 0);

    if (scene === "farm") {
      PA.farm.drawProps(ctx, W, H, box.landscape);
      PA.farm.draw(ctx);
      // hero stands on the farm
      // Heroes stand at the bottom edge, below the plot grid, so they never
      // overlap the crops.
      var ids = PA.derived.activeHeroIds();
      var groundY = H * 0.985;
      var h = H * (box.landscape ? 0.15 : 0.10);
      var spread = Math.min(W * 0.24, 90);
      for (var hi = 0; hi < ids.length; hi++) {
        var hx = ids.length === 1 ? W * 0.5 : W * 0.5 + (hi - (ids.length - 1) / 2) * spread;
        var bob = Math.sin(gameT * 1.8 + hi) * 1.2;
        A.drawShadow(ctx, hx, groundY + 1, h * 0.26, h * 0.06, 0.22);
        A.drawSprite(ctx, A.sprites[heroSprite(ids[hi])], hx, groundY + bob, h, {});
      }
      drawCoinsFromFarm(ctx, W, H, dt);
    } else {
      if (PA.scene.dirty) { B.layout(W, H, box.landscape); PA.scene.dirty = false; }
      B.draw(ctx, W, H, box.landscape, gameT);
    }

    if (!PA.S.options.reduceFx) ambience.draw(ctx);
    A.stepFx(dt);
    A.drawFx(ctx);

    // subtle screen edge worry when heroes are losing
    if (scene === "battle" && PA.S.options.auto) {
      var living = B.units.filter(function (u) { return !u.dead; }).length;
      if (living === 0 && B.phase === "fight") {
        ctx.fillStyle = "rgba(120,10,10," + (0.12 + Math.sin(gameT * 6) * 0.05) + ")";
        ctx.fillRect(0, 0, W, H);
      }
    }
  }

  function heroSprite(id) {
    var d = null;
    for (var i = 0; i < D.HEROES.length; i++) if (D.HEROES[i].id === id) d = D.HEROES[i];
    return d ? d.sprite : "rowan";
  }

  /* Occasional coin sparkles above the plots, paced by income so the farm
     feels busier as it grows. */
  var farmCoinT = 0, farmCoinSeed = 1, farmCoinAge = 0, farmCoinPos = null;
  function drawCoinsFromFarm(ctx, W, H, dt) {
    if (PA.S.options.reduceFx) return;
    var rate = PA.derived.farmRate();
    if (rate < 0.5) return;
    farmCoinT += dt;
    farmCoinAge += dt;
    var period = Math.max(0.35, 2.2 / Math.log10(rate + 10));
    if (farmCoinT > period) {
      farmCoinT = 0;
      farmCoinAge = 0;
      farmCoinSeed = (farmCoinSeed * 7919 + 13) % 100000;
      var plots = PA.farm.plots;
      var n = PA.farm.plotCount();
      farmCoinPos = n > 0
        ? plots[Math.floor(Math.random() * n)]
        : { x: W * 0.5, y: H * 0.62 };
    }
    if (farmCoinPos) {
      PA.farm.coinFly(ctx, farmCoinPos.x, farmCoinPos.y - 4, farmCoinAge, farmCoinSeed);
    }
  }

  /* ------------------------------------------------------------
     Input
     ------------------------------------------------------------ */
  function wireInput() {
    var tapLayer = $("tapLayer");

    function onTap(e) {
      if (UI.isModalOpen()) return;
      var r = canvas.getBoundingClientRect();
      var x = (e.clientX != null ? e.clientX : e.touches && e.touches[0].clientX) - r.left;
      var y = (e.clientY != null ? e.clientY : e.touches && e.touches[0].clientY) - r.top;
      PA.audio.resume();

      if (PA.scene.name === "battle") {
        var res = B.tap(x, y, null, { cssW: r.width, W: box.W });
        PA.audio.sfx.tap();
      } else {
        var v = PA.farm.tap();
        PA.audio.sfx.tap();
        if (Math.random() < 0.35) PA.audio.sfx.coin();
        floatText(x, y, "+" + PA.fmt(v), "gold");
        A.spawnFx("burst", x / (r.width / box.W), y / (r.height / box.H), { color: "#ffe07a", r: 12, life: 0.3 });
      }
    }

    tapLayer.addEventListener("pointerdown", function (e) {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      onTap(e);
    });

    // buttons
    $("btnAuto").addEventListener("click", function () {
      PA.S.options.auto = !PA.S.options.auto;
      UI.renderHud();
      UI.toast(PA.S.options.auto ? "Auto battle on" : "Auto battle off");
      PA.audio.sfx.tap();
    });
    $("btnSpeed").addEventListener("click", function () {
      var order = [1, 2, 3];
      var i = order.indexOf(PA.S.options.speed);
      PA.S.options.speed = order[(i + 1) % order.length];
      UI.renderHud();
      UI.toast("Speed x" + PA.S.options.speed);
      PA.audio.sfx.tap();
    });
    $("btnMenu").addEventListener("click", function () {
      if (UI.isDockOpen()) { UI.openDock(false); return; } // first tap just closes the dock
      UI.settingsModal();
    });
    $("btnFarm").addEventListener("click", function () {
      setScene("farm");
      PA.audio.sfx.tap();
    });
    $("btnBattle").addEventListener("click", function () {
      setScene("battle");
      if (B.phase === "clear") { /* handled by sim */ }
      PA.audio.sfx.tap();
    });
    $("btnPrestige").addEventListener("click", function () {
      UI.rebirthModal();
    });

    // tabs
    var tabs = doc.querySelectorAll(".tab");
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].addEventListener("click", function (e) {
        var t = e.currentTarget.getAttribute("data-tab");
        if (UI.isDockOpen() && UI.tab === t) { UI.openDock(false); return; }
        UI.setTab(t, true);
        PA.audio.sfx.tap();
      });
    }

    // delegated actions inside the panel + modals
    doc.addEventListener("click", function (e) {
      var el = e.target.closest ? e.target.closest("[data-act]") : null;
      if (!el) return;
      var act = el.getAttribute("data-act");
      var id = el.getAttribute("data-id");
      handleAction(act, id, el, e);
    });

    // long-press a shop buy button for x10
    doc.addEventListener("pointerdown", function (e) {
      var el = e.target.closest ? e.target.closest('[data-act="buy"]') : null;
      if (!el) return;
      var t = setTimeout(function () {
        var id = el.getAttribute("data-id");
        if (PA.buyBuilding(id, 10)) {
          PA.audio.sfx.buy();
          UI.toast("Bought 10x " + (PA.derived.farmBuilding(id) || {}).name);
          UI.renderPanel(true);
        }
      }, 520);
      var cancel = function () { clearTimeout(t); el.removeEventListener("pointerup", cancel); el.removeEventListener("pointercancel", cancel); };
      el.addEventListener("pointerup", cancel);
      el.addEventListener("pointercancel", cancel);
    }, { passive: true });

    root.addEventListener("resize", debounce(function () { layoutScene(); }, 180));
    root.addEventListener("orientationchange", function () {
      setTimeout(layoutScene, 280);
    });
    doc.addEventListener("visibilitychange", function () {
      if (doc.hidden) { PA.save(); PA.audio.stopMusic(); }
      else {
        var off = PA.applyOffline();
        if (off && off.gold > 1) { UI.toast("+" + PA.fmt(off.gold) + " gold while away", "good"); PA.audio.sfx.coin(); }
        if (PA.S.options.music) PA.audio.startMusic();
        lastT = performance.now();
        UI.invalidate();
      }
    });
    root.addEventListener("beforeunload", function () { PA.save(); });
  }

  function floatText(cssX, cssY, text, kind) {
    var layer = $("floaters");
    if (!layer) return;
    var el = doc.createElement("div");
    el.className = "floater " + (kind || "");
    el.textContent = text;
    el.style.left = cssX + "px";
    el.style.top = cssY + "px";
    layer.appendChild(el);
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 1000);
  }

  function handleAction(act, id, el, ev) {
    if (ev) ev.stopPropagation();
    switch (act) {
      case "buy": {
        var n = ev && ev.shiftKey ? 10 : 1;
        if (PA.buyBuilding(id, n)) { PA.audio.sfx.buy(); UI.renderPanel(true); UI.renderHud(); }
        else { PA.audio.sfx.deny(); shake(el); }
        break;
      }
      case "level": {
        if (PA.levelHero(id, 1)) {
          PA.audio.sfx.levelup();
          UI.renderPanel(true);
          UI.renderHud();
          var m = $("modalRoot");
          if (m && m.classList.contains("is-open")) UI.heroModal(id);
        } else { PA.audio.sfx.deny(); shake(el); }
        break;
      }
      case "ascend":
        if (PA.ascendBuy(id)) { PA.audio.sfx.levelup(); UI.renderPanel(true); UI.renderHud(); }
        else { PA.audio.sfx.deny(); shake(el); }
        break;
      case "claim": claimQuest(id, el); break;
      case "heroInfo": UI.heroModal(id); break;
      case "deploy": {
        var inTeam = PA.S.team.indexOf(id) >= 0;
        if (inTeam) {
          PA.setTeamSlot(PA.S.team.indexOf(id), null);
          UI.toast("Benched");
        } else {
          var slots = PA.derived.teamSlots();
          var placed = false;
          for (var s = 0; s < slots; s++) {
            if (!PA.S.team[s]) { PA.setTeamSlot(s, id); placed = true; break; }
          }
          if (!placed) { UI.toast("Squad full — bench someone first", "bad"); PA.audio.sfx.deny(); }
          else { UI.toast("Deployed!"); PA.audio.sfx.buy(); }
        }
        B.spawnTeam(true);
        UI.renderPanel(true);
        UI.renderHud();
        if (UI.isModalOpen()) UI.closeModal();
        break;
      }
      case "recruit": {
        var r = PA.recruitHero(id);
        UI.toast(r.msg, r.ok ? "good" : "bad");
        PA.audio.sfx[r.ok ? "levelup" : "deny"]();
        UI.closeModal();
        UI.renderPanel(true);
        UI.renderHud();
        break;
      }
      case "doRebirth": {
        var rb = PA.doRebirth();
        UI.closeModal();
        if (rb.ok) {
          PA.audio.sfx.prestige();
          UI.toast("Reborn! +" + rb.gain + " essence", "good");
          setScene("battle");
          B.enterStage(0, {});
          UI.invalidate();
          UI.renderPanel(true);
          UI.renderHud();
          for (var i = 0; i < 3; i++) {
            A.spawnFx("rise", box.W * (0.3 + i * 0.2), box.H * 0.6, { color: "#ffe07a", r: 60, life: 1.2 });
          }
        } else UI.toast(rb.msg, "bad");
        break;
      }
      case "goStage": {
        var idx = parseInt(id, 10);
        PA.S.stageIndex = idx;
        setScene("battle");
        B.enterStage(idx, {});
        UI.closeModal();
        UI.toast("Stage " + D.STAGES[idx].id + " — " + D.STAGES[idx].name);
        break;
      }
      case "stagePicker": UI.stagePicker(); break;
      case "toggleAuto":
        PA.S.options.auto = !PA.S.options.auto;
        UI.settingsModal(); UI.renderHud();
        break;
      case "toggleSfx":
        PA.S.options.sfx = !PA.S.options.sfx;
        PA.audio.setSfx(PA.S.options.sfx);
        UI.settingsModal();
        break;
      case "toggleMusic":
        PA.S.options.music = !PA.S.options.music;
        PA.audio.setMusic(PA.S.options.music);
        UI.settingsModal();
        break;
      case "toggleFx":
        PA.S.options.reduceFx = !PA.S.options.reduceFx;
        UI.settingsModal();
        break;
      case "wipe":
        UI.confirm("Delete save?", "This erases your farm, heroes and progress for good.", "Delete", function () {
          PA.resetSave();
          root.location.reload();
        });
        break;
    }
  }

  function shake(el) {
    if (!el || !el.animate) return;
    el.animate(
      [{ transform: "translateX(0)" }, { transform: "translateX(-4px)" },
       { transform: "translateX(4px)" }, { transform: "translateX(0)" }],
      { duration: 220, easing: "ease-out" }
    );
  }

  function claimQuest(id, el) {
    var q = null;
    for (var i = 0; i < D.QUESTS.length; i++) if (D.QUESTS[i].id === id) q = D.QUESTS[i];
    if (!q || PA.S.claimed[id]) return;
    var cur = PA.derived.statValue(q.stat);
    if (cur < q.goal) { PA.audio.sfx.deny(); return; }
    PA.S.claimed[id] = true;
    if (q.reward.gold) PA.addGold(q.reward.gold);
    if (q.reward.gem) PA.addGem(q.reward.gem);
    if (q.reward.shard) PA.addShard(q.reward.shard);
    PA.audio.sfx.levelup();
    UI.toast("Quest complete! Claimed rewards.", "good");
    UI.renderPanel(true);
    UI.renderHud();
  }

  function debounce(fn, ms) {
    var t;
    return function () {
      clearTimeout(t);
      t = setTimeout(fn, ms);
    };
  }

  /* ------------------------------------------------------------
     Global events wired to feedback
     ------------------------------------------------------------ */
  PA.bus.on("kill", function (d) {
    if (d.foe && d.foe.isBoss) {
      UI.toast("Guardian defeated!", "good");
      UI.invalidate();
    }
  });
  PA.bus.on("stageClear", function (st) {
    var next = D.STAGES[Math.min(st.index + 1, D.STAGES.length - 1)];
    UI.toast("★ " + st.name + " cleared!", "good");
    if (PA.derived.teamPower() < next.power * D.BAL.shopUnlockPower) {
      setTimeout(function () {
        UI.toast("Power up before " + next.chapterName + " — try the Farm tab", "");
      }, 1200);
    }
    UI.invalidate();
  });
  PA.bus.on("recruit", function () { UI.invalidate(); });
  PA.bus.on("rebirth", function () { UI.invalidate(); });
  PA.bus.on("wave", function () { UI.renderHud(); });

  /* ------------------------------------------------------------
     Go
     ------------------------------------------------------------ */
  if (doc.readyState === "loading") {
    doc.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  PA.Game = {
    start: function () { if (!running) startGame(PA.hasSave(), null); },
    layout: layoutScene,
    setScene: setScene
  };
})(typeof window !== "undefined" ? window : globalThis);
