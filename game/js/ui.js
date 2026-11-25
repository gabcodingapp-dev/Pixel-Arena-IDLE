/* ============================================================
   ui.js - DOM rendering. One render function per surface, each
   guarded by a cheap signature so we don't thrash the DOM at
   60fps on a mid-range phone.
   ============================================================ */
(function (root) {
  "use strict";
  var PA = root.PA, U = PA.U, D = PA.D, der = PA.derived;

  var UI = (PA.ui = {});
  var $ = function (id) { return root.document.getElementById(id); };
  var doc = root.document;

  UI.tab = "team";
  UI.signatures = {};
  UI.lastPanelRender = 0;

  function sig(key, value) {
    if (UI.signatures[key] === value) return false;
    UI.signatures[key] = value;
    return true;
  }

  UI.invalidate = function () { UI.signatures = {}; };

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* ------------------------------------------------------------
     HUD
     ------------------------------------------------------------ */
  UI.renderHud = function () {
    var S = PA.S;
    var rate = der.farmRate();
    var stage = D.STAGES[U.clamp(S.stageIndex, 0, D.STAGES.length - 1)];

    var g = PA.fmt(S.gold);
    if (sig("gold", g)) $("resGold").textContent = g;
    var r = "+" + PA.fmt(rate) + "/s";
    if (sig("rate", r)) $("resIncome").textContent = r;
    var gm = PA.fmt(S.gem);
    if (sig("gem", gm)) $("resGem").textContent = gm;
    var sh = PA.fmt(S.shard);
    if (sig("shard", sh)) $("resShard").textContent = sh;

    var lvl = Math.round(der.teamPower());
    var nameTxt = S.playerName;
    if (sig("pname", nameTxt)) $("playerName").textContent = nameTxt;
    var pstage = "Stage " + stage.id + " · PWR " + PA.fmt(lvl);
    if (sig("pstage", pstage)) $("playerStage").textContent = pstage;

    // stage tracker
    var status = PA.battle.status ? PA.battle.status() : { label: stage.name, sub: "", progress: 0 };
    if (sig("stName", status.label)) $("stageName").textContent = status.label;
    if (sig("stSub", status.sub)) $("stageSub").textContent = status.sub || (stage.chapterName + " " + stage.id);
    var pct = Math.round((status.progress || 0) * 100) + "%";
    if (sig("stFill", pct)) $("stageFill").style.width = pct;

    // auto / speed
    var autoCls = "round-btn" + (S.options.auto ? " is-on" : "");
    if (sig("autoBtn", autoCls)) $("btnAuto").className = autoCls;
    if (sig("speedLbl", String(S.options.speed))) $("speedLabel").textContent = "x" + S.options.speed;

    // dock active state
    if (sig("dockTab", UI.tab)) {
      var tabs = doc.querySelectorAll(".tab");
      for (var i = 0; i < tabs.length; i++) {
        tabs[i].classList.toggle("is-active", tabs[i].getAttribute("data-tab") === UI.tab);
      }
    }
    var farmActive = PA.scene && PA.scene.name === "farm";
    if (sig("sceneBtns", farmActive + "")) {
      $("btnFarm").classList.toggle("is-active", farmActive);
      $("btnBattle").classList.toggle("is-active", !farmActive);
    }
  };

  /* ------------------------------------------------------------
     Dock + panels
     ------------------------------------------------------------ */
  UI.setTab = function (tab, open) {
    UI.tab = tab;
    if (open !== false) UI.openDock(true);
    UI.renderPanel(true);
    UI.renderHud();
  };

  UI.openDock = function (open) {
    var dock = $("dock");
    if (!dock) return;
    dock.classList.toggle("is-open", !!open);
    if (open) UI.renderPanel(true);
  };

  UI.isDockOpen = function () {
    var dock = $("dock");
    return dock && dock.classList.contains("is-open");
  };

  UI.renderPanel = function (force) {
    var el = $("panel");
    if (!el) return;
    var html = "";
    if (UI.tab === "team") html = panelTeam();
    else if (UI.tab === "heroes") html = panelHeroes();
    else if (UI.tab === "shop") html = panelShop();
    else html = panelQuests();
    // signature guards against identical re-renders (keeps scroll + taps stable)
    if (force || sig("panel:" + UI.tab, html)) {
      var scroll = el.scrollTop;
      el.innerHTML = html;
      el.scrollTop = scroll;
    }
  };

  function heroRow(id, opts) {
    opts = opts || {};
    var S = PA.S;
    var h = S.heroes[id];
    var st = der.heroStats(id);
    if (!st) return "";
    var deployed = S.team.indexOf(id) >= 0;
    var locked = !h.unlocked;
    var stars = "";
    for (var i = 0; i < 5; i++) stars += i < h.stars ? "★" : "☆";
    var actions;
    if (locked) {
      actions = '<span class="pill locked">' + st.def.cost + ' <i class="ico ico-gem"></i></span>';
    } else if (opts.showDeploy) {
      actions = '<span class="pill ' + (deployed ? "deployed" : "bench") + '">' + (deployed ? "DEPLOYED" : "BENCH") + '</span>';
    } else {
      var cost = der.heroLevelCost(id);
      var can = S.gold >= cost;
      actions = '<button class="buy ' + (can ? "" : "is-locked") + '" data-act="level" data-id="' + id + '">' +
        '<i class="ico ico-coin"></i>' + PA.fmt(cost) + '</button>';
    }
    return '' +
      '<div class="hero-row ' + (locked ? "is-locked" : "") + '" data-act="heroInfo" data-id="' + id + '">' +
        '<div class="hero-ava rarity-' + st.def.rarity + '">' +
          '<img src="' + PA.art.imgUrl(st.def.sprite) + '" alt="" />' +
        '</div>' +
        '<div class="hero-main">' +
          '<div class="hero-name"><b>' + esc(st.def.name) + '</b><em>' + esc(st.def.role) + '</em></div>' +
          '<div class="hero-lv">Lv ' + h.level + ' <span style="color:#e6b422">' + stars + '</span></div>' +
          '<div class="hero-stats"><span>ATK <b>' + PA.fmt(st.atk) + '</b></span><span>HP <b>' + PA.fmt(st.hp) + '</b></span>' +
          '<span>SPD <b>' + st.spd.toFixed(2) + '</b></span></div>' +
        '</div>' +
        '<div class="hero-actions" data-act="' + (opts.showDeploy ? "deploy" : "level") + '" data-id="' + id + '">' + actions + '</div>' +
      '</div>';
  }

  function panelTeam() {
    var S = PA.S;
    var slots = der.teamSlots();
    var html = '<div class="sec-title">Deployed squad <small>PWR ' + PA.fmt(der.teamPower()) + '</small></div>';

    for (var i = 0; i < 4; i++) {
      var id = S.team[i];
      var unlocked = i < slots;
      if (id && S.heroes[id] && S.heroes[id].unlocked) {
        html += heroRow(id, { showDeploy: true });
      } else {
        html += '<div class="hero-row' + (unlocked ? "" : " is-locked") + '">' +
          '<div class="hero-ava" style="background:#e6d7bb;font-size:20px">+</div>' +
          '<div class="hero-main"><div class="hero-name"><b>Empty slot</b></div>' +
          '<div class="hero-lv">' + (unlocked ? "Tap a hero in Heroes to deploy" : "Unlocks with Rebirth " + Math.max(1, i - 1)) + '</div></div>' +
          '</div>';
      }
    }

    html += '<div class="sec-title" style="margin-top:14px">Bench <small>' +
      Object.keys(S.heroes).filter(function (k) { return S.heroes[k].unlocked && S.team.indexOf(k) < 0; }).length +
      ' ready</small></div>';

    D.HEROES.forEach(function (def) {
      if (!S.heroes[def.id].unlocked) return;
      if (S.team.indexOf(def.id) >= 0) return;
      html += heroRow(def.id, {});
    });

    html += '<p style="font-size:11px;color:#7a6448;font-weight:800;text-align:center;margin:14px 0 0">' +
      'Team size grows with each Rebirth · spend Gold on levels</p>';
    return html;
  }

  function panelHeroes() {
    var S = PA.S;
    var html = '<div class="sec-title">Roster <small>' +
      Object.keys(S.heroes).filter(function (k) { return S.heroes[k].unlocked; }).length +
      ' / ' + D.HEROES.length + '</small></div>';
    D.HEROES.forEach(function (def) {
      html += heroRow(def.id, {});
    });
    html += '<div class="card" style="margin-top:12px;font-size:11px;color:#6b5638;line-height:1.5">' +
      '<b style="color:#2a1c10">Tip:</b> role matters. <b>Healers</b> keep the team alive, ' +
      '<b>Tanks</b> soak damage, <b>Burst</b> mages splash groups. ' +
      'Deploy a mix and your clear speed roughly doubles.</div>';
    return html;
  }

  function panelShop() {
    var S = PA.S;
    var rate = der.farmRate();
    var html = '<div class="sec-title">Your farm <small>' + PA.fmt(rate) + '/s</small></div>';
    D.FARM.forEach(function (def) {
      var lvl = S.farm[def.id] || 0;
      var unlocked = der.buildingUnlocked(def.id);
      var cost = der.buildingCost(def.id);
      var can = unlocked && S.gold >= cost && !(def.max && lvl >= def.max);
      var maxed = def.max && lvl >= def.max;
      var contribution = def.rate * lvl * (1 + Math.max(0, lvl - 1) * 0.06) * (1 + der.ascendBonus("harvest"));
      var sub;
      if (!unlocked) sub = "Clear stage " + D.STAGES[def.reqStage].id + " to unlock";
      else if (maxed) sub = "MAX LEVEL · +" + PA.fmt(contribution) + "/s";
      else sub = "Lv " + lvl + (lvl ? " · +" + PA.fmt(contribution) + "/s" : " · " + def.desc);
      html += '<div class="up-row">' +
        '<div class="up-ico">' + def.icon + '</div>' +
        '<div class="up-main">' +
          '<div class="up-name"><b>' + esc(def.name) + '</b><span>Lv ' + lvl + (def.max ? " / " + def.max : "") + '</span></div>' +
          '<div class="up-sub">' + esc(sub) + '</div>' +
        '</div>' +
        (maxed
          ? '<div class="buy" style="filter:grayscale(1);opacity:.7">MAX</div>'
          : '<button class="buy ' + (can ? "" : "is-locked") + '" data-act="buy" data-id="' + def.id + '">' +
            '<i class="ico ico-coin"></i>' + PA.fmt(cost) + '</button>') +
      '</div>';
    });
    html += '<div class="sec-title" style="margin-top:14px">Ascension <small>permanent</small></div>';
    D.ASCEND.forEach(function (def) {
      var rank = S.ascend[def.id] || 0;
      var cost = der.ascendCost(def.id);
      var can = S.gem >= cost && rank < D.ASC_MAX;
      html += '<div class="up-row">' +
        '<div class="up-ico">' + def.icon + '</div>' +
        '<div class="up-main">' +
          '<div class="up-name"><b>' + esc(def.name) + '</b><span>Rank ' + rank + '</span></div>' +
          '<div class="up-sub">' + esc(def.desc) + '</div>' +
        '</div>' +
        (rank >= D.ASC_MAX ? '<div class="buy" style="filter:grayscale(1);opacity:.7">MAX</div>' :
        '<button class="buy ' + (can ? "" : "is-locked") + '" data-act="ascend" data-id="' + def.id + '">' +
          '<i class="ico ico-gem"></i>' + cost + '</button>') +
        '</div>';
    });
    return html;
  }

  function panelQuests() {
    var S = PA.S;
    var html = '<div class="sec-title">Quests <small>' + Object.keys(S.claimed).length + ' / ' + D.QUESTS.length + ' claimed</small></div>';
    D.QUESTS.forEach(function (q) {
      var cur = der.statValue(q.stat);
      var done = cur >= q.goal;
      var claimed = !!S.claimed[q.id];
      var pct = Math.min(100, Math.round((cur / q.goal) * 100));
      var reward = [];
      if (q.reward.gold) reward.push(PA.fmt(q.reward.gold) + "g");
      if (q.reward.gem) reward.push(q.reward.gem + " essence");
      if (q.reward.shard) reward.push(q.reward.shard + " shard");
      html += '<div class="quest ' + (done ? "is-done" : "") + '">' +
        '<div class="quest-mark">' + (claimed ? "✓" : done ? "!" : "") + '</div>' +
        '<div class="quest-main">' +
          '<div class="quest-title"><b>' + esc(q.label) + '</b></div>' +
          '<div class="quest-sub">' + PA.fmt(Math.min(cur, q.goal)) + " / " + PA.fmt(q.goal) +
            ' · reward: ' + esc(reward.join(" + ")) + '</div>' +
          '<div class="bar"><i style="width:' + pct + '%"></i></div>' +
        '</div>' +
        '<button class="claim" data-act="claim" data-id="' + q.id + '" ' +
          (done && !claimed ? "" : "disabled") + '>' + (claimed ? "DONE" : "CLAIM") + '</button>' +
      '</div>';
    });
    return html;
  }

  /* ------------------------------------------------------------
     Toasts
     ------------------------------------------------------------ */
  UI.toast = function (msg, kind) {
    var rootEl = $("toasts");
    if (!rootEl) return;
    var el = doc.createElement("div");
    el.className = "toast " + (kind || "");
    el.textContent = msg;
    rootEl.appendChild(el);
    while (rootEl.children.length > 3) rootEl.removeChild(rootEl.firstChild);
    setTimeout(function () {
      el.classList.add("out");
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 320);
    }, 2200);
  };

  /* ------------------------------------------------------------
     Modal
     ------------------------------------------------------------ */
  UI.modal = function (html, opts) {
    opts = opts || {};
    var rootEl = $("modalRoot");
    if (!rootEl) return;
    rootEl.innerHTML = '<div class="modal">' + html + '</div>';
    rootEl.classList.add("is-open");
    rootEl.onclick = function (e) {
      if (e.target === rootEl && opts.dismissible !== false) UI.closeModal();
    };
  };

  UI.closeModal = function () {
    var rootEl = $("modalRoot");
    if (!rootEl) return;
    rootEl.classList.remove("is-open");
    rootEl.innerHTML = "";
  };

  UI.isModalOpen = function () {
    var rootEl = $("modalRoot");
    return rootEl && rootEl.classList.contains("is-open");
  };

  UI.confirm = function (title, body, okLabel, onOk) {
    UI.modal(
      "<h2>" + esc(title) + "</h2><p>" + body + "</p>" +
      '<div class="row"><button class="btn btn-sm" data-modal="close">Cancel</button>' +
      '<button class="btn btn-primary btn-sm" data-modal="ok">' + esc(okLabel || "Confirm") + "</button></div>"
    );
    var rootEl = $("modalRoot");
    rootEl.onclick = function (e) {
      var m = e.target.closest ? e.target.closest("[data-modal]") : null;
      if (!m) { if (e.target === rootEl) UI.closeModal(); return; }
      if (m.getAttribute("data-modal") === "ok") { UI.closeModal(); onOk && onOk(); }
      else UI.closeModal();
    };
  };

  /* ------------------------------------------------------------
     Specific dialogs
     ------------------------------------------------------------ */
  UI.offlineModal = function (info) {
    UI.modal(
      "<h2>Welcome back!</h2>" +
      "<p>Your farm kept working while you were away for <b>" + PA.dur(info.seconds * 1000) + "</b>.</p>" +
      '<div class="stat-grid">' +
        '<div>' + PA.fmt(info.rate) + "/s<b>" + "Farm rate" + '</b></div>' +
        '<div>' + PA.fmt(info.gold) + '<b>Gold collected</b></div>' +
        '<div>' + PA.dur(info.capped * 1000) + '<b>Time counted</b></div>' +
        '<div>' + Math.round(D.BAL.offlineEfficiency * 100) + "%<b>Offline rate</b></div>" +
      "</div>" +
      '<div class="row"><button class="btn btn-primary btn-wide" data-modal="close">Collect</button></div>'
    , { dismissible: true });
    $("modalRoot").onclick = function (e) {
      if (e.target.closest && e.target.closest("[data-modal]")) UI.closeModal();
      else if (e.target === $("modalRoot")) UI.closeModal();
    };
  };

  UI.heroModal = function (id) {
    var S = PA.S;
    var h = S.heroes[id];
    var st = der.heroStats(id);
    if (!h || !st) return;
    var locked = !h.unlocked;
    var cost = der.heroLevelCost(id);
    var deployed = S.team.indexOf(id) >= 0;
    var stars = "";
    for (var i = 0; i < 5; i++) stars += i < h.stars ? "★" : "☆";

    var body =
      "<h2>" + esc(st.def.name) + " · " + esc(st.def.title) + "</h2>" +
      '<div style="display:flex;gap:12px;align-items:center;margin-bottom:10px">' +
        '<div class="hero-ava rarity-' + st.def.rarity + '" style="width:84px;height:84px">' +
          '<img src="' + PA.art.imgUrl(st.def.sprite) + '" alt="" /></div>' +
        '<div style="flex:1">' +
          '<div class="hero-lv" style="font-size:12px">Lv ' + h.level + ' · <span style="color:#e6b422">' + stars + '</span></div>' +
          '<p style="margin:6px 0 0;font-size:12px">' + esc(st.def.blurb) + "</p>" +
        "</div>" +
      "</div>" +
      '<div class="stat-grid">' +
        "<div>ATK<b>" + PA.fmt(st.atk) + "</b></div>" +
        "<div>HP<b>" + PA.fmt(st.hp) + "</b></div>" +
        "<div>SPEED<b>" + st.spd.toFixed(2) + "</b></div>" +
        "<div>CRIT<b>" + Math.round(st.crit * 100) + "%</b></div>" +
      "</div>" +
      '<div class="card" style="font-size:12px;line-height:1.5"><b>' + esc(st.def.skill.name) + "</b><br>" +
        esc(st.def.skill.desc) + "</div>";

    var actions = '<div class="row">';
    if (locked) {
      actions += '<button class="btn btn-sm" data-modal="close">Close</button>' +
        '<button class="btn btn-primary btn-sm" data-act="recruit" data-id="' + id + '">Recruit · ' +
        st.def.cost + ' essence</button>';
    } else {
      actions += '<button class="btn btn-sm" data-modal="close">Close</button>' +
        '<button class="btn btn-leaf btn-sm" data-act="deploy" data-id="' + id + '">' +
        (deployed ? "Bench" : "Deploy") + "</button>" +
        '<button class="btn btn-primary btn-sm" data-act="level" data-id="' + id + '">Level up · ' +
        PA.fmt(cost) + "</button>";
    }
    actions += "</div>";
    UI.modal(body + actions);
  };

  UI.settingsModal = function () {
    var S = PA.S;
    var html =
      "<h2>Settings</h2>" +
      '<div class="card" style="margin-bottom:10px">' +
        "<div style=\"display:flex;justify-content:space-between;align-items:center;margin-bottom:10px\">" +
          "<b>Auto battle</b>" +
          '<button class="btn btn-sm ' + (S.options.auto ? "btn-leaf" : "") + '" data-act="toggleAuto">' +
          (S.options.auto ? "ON" : "OFF") + "</button></div>" +
        "<div style=\"display:flex;justify-content:space-between;align-items:center;margin-bottom:10px\">" +
          "<b>Sound effects</b>" +
          '<button class="btn btn-sm ' + (S.options.sfx ? "btn-leaf" : "") + '" data-act="toggleSfx">' +
          (S.options.sfx ? "ON" : "OFF") + "</button></div>" +
        "<div style=\"display:flex;justify-content:space-between;align-items:center;margin-bottom:10px\">" +
          "<b>Music</b>" +
          '<button class="btn btn-sm ' + (S.options.music ? "btn-leaf" : "") + '" data-act="toggleMusic">' +
          (S.options.music ? "ON" : "OFF") + "</button></div>" +
        "<div style=\"display:flex;justify-content:space-between;align-items:center\">" +
          "<b>Reduce effects</b>" +
          '<button class="btn btn-sm ' + (S.options.reduceFx ? "btn-leaf" : "") + '" data-act="toggleFx">' +
          (S.options.reduceFx ? "ON" : "OFF") + "</button></div>" +
      "</div>" +
      '<div class="stat-grid">' +
        "<div>Play time<b>" + PA.dur(S.stats.playTime * 1000) + "</b></div>" +
        "<div>Kills<b>" + PA.fmt(S.stats.kills) + "</b></div>" +
        "<div>Gold earned<b>" + PA.fmt(S.stats.goldEarned) + "</b></div>" +
        "<div>Rebirths<b>" + S.rebirths + "</b></div>" +
      "</div>" +
      '<div class="row"><button class="btn btn-sm" data-act="wipe">Delete save</button>' +
      '<button class="btn btn-primary btn-sm" data-modal="close">Done</button></div>';
    UI.modal(html);
  };

  UI.rebirthModal = function () {
    var gain = PA.rebirthGain();
    var ok = gain >= 3;
    UI.modal(
      "<h2>Rebirth</h2>" +
      "<p>Start over with nothing but your heroes and your wits — and come back far stronger.</p>" +
      '<div class="stat-grid">' +
        "<div>Essence gained<b>" + gain + "</b></div>" +
        "<div>Team slots next run<b>" + Math.min(D.BAL.maxTeam, 1 + PA.S.rebirths + 1) + "</b></div>" +
        "<div>Next team slot<b>" + Math.min(D.BAL.maxTeam, 2 + PA.S.rebirths + 1) + " heroes</b></div>" +
        "<div>Hero stars<b>+1 per eligible hero</b></div>" +
      "</div>" +
      "<p style=\"font-size:11px\">Keeps: heroes, levels, ascension ranks, quest progress.<br>" +
      "Resets: gold, farm, stage progress.</p>" +
      '<div class="row"><button class="btn btn-sm" data-modal="close">Not yet</button>' +
      '<button class="btn btn-primary btn-sm" data-act="doRebirth" ' + (ok ? "" : "disabled") + ">" +
      (ok ? "Rebirth · +" + gain + " essence" : "Need more progress") + "</button></div>"
    );
  };

  UI.introModal = function () {
    UI.modal(
      "<h2>Welcome to Pixel Arena</h2>" +
      "<p>Your little farm hides a very big fortune. Here's the loop:</p>" +
      '<div class="card" style="font-size:12px;line-height:1.6;margin-bottom:10px">' +
        "<b>1. Tap the farm</b> to dig up gold.<br>" +
        "<b>2. Buy plots</b> in the Farm tab — they earn gold while you're away.<br>" +
        "<b>3. Battle</b> with your heroes to unlock new stages and farm buildings.<br>" +
        "<b>4. Rebirth</b> for essence once progress slows, then go further." +
      "</div>" +
      "<p style=\"font-size:11px\">Toggle AUTO in the top right to let the fight run itself.</p>" +
      '<div class="row"><button class="btn btn-primary btn-wide" data-modal="close">Let\'s dig!</button></div>',
      { dismissible: false }
    );
    $("modalRoot").onclick = function (e) {
      if (e.target.closest && e.target.closest("[data-modal]")) UI.closeModal();
    };
  };

  UI.stagePicker = function () {
    var S = PA.S;
    var html = "<h2>Stage select</h2>";
    D.CHAPTERS.forEach(function (ch, ci) {
      html += '<div class="sec-title" style="margin-top:10px">' + esc(ch.name) + "</div>";
      html += '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px">';
      for (var si = 0; si < 6; si++) {
        var st = D.STAGES[ci * 6 + si];
        var reached = st.index <= S.stageBest;
        var current = st.index === S.stageIndex;
        html += '<button class="btn btn-sm" data-act="goStage" data-id="' + st.index + '" ' +
          (reached ? "" : "disabled") + ' style="' + (current ? "border-color:#2f7a2b;background:#c8f0a6" : "") + ';flex-direction:column;gap:2px;padding:8px 4px">' +
          '<span style="font-size:11px">' + st.id + "</span>" +
          '<span style="font-size:9px;color:#7a6448">' + (st.isBoss ? "BOSS" : st.name) + "</span></button>";
      }
      html += "</div>";
    });
    html += '<div class="row"><button class="btn btn-primary btn-wide" data-modal="close">Close</button></div>';
    UI.modal(html);
  };
})(typeof window !== "undefined" ? window : globalThis);
