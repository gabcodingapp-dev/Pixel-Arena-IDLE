/* ============================================================
   core.js - tiny helpers, no DOM at load time so the engine can
   also be exercised head-less in Node for tests.
   ============================================================ */
(function (root) {
  "use strict";

  var PA = (root.PA = root.PA || {});

  var U = (PA.U = {
    clamp: function (v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; },
    lerp: function (a, b, t) { return a + (b - a) * t; },
    inv: function (a, b, v) { return b === a ? 0 : U.clamp((v - a) / (b - a), 0, 1); },
    easeOutCubic: function (t) { return 1 - Math.pow(1 - t, 3); },
    easeInOut: function (t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; },
    easeOutBack: function (t) {
      var c = 1.70158;
      return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
    },
    rand: function (a, b) { return a + Math.random() * (b - a); },
    randInt: function (a, b) { return Math.floor(a + Math.random() * (b - a + 1)); },
    pick: function (arr) { return arr[(Math.random() * arr.length) | 0]; },
    shuffle: function (arr) {
      var a = arr.slice();
      for (var i = a.length - 1; i > 0; i--) {
        var j = (Math.random() * (i + 1)) | 0;
        var t = a[i]; a[i] = a[j]; a[j] = t;
      }
      return a;
    },
    sum: function (arr, fn) {
      var s = 0;
      for (var i = 0; i < arr.length; i++) s += fn ? fn(arr[i], i) : arr[i];
      return s;
    },
    // deterministic RNG, handy for stable cosmetic jitter
    seeded: function (seed) {
      var a = seed >>> 0;
      return function () {
        a |= 0; a = (a + 0x6d2b79f5) | 0;
        var t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    },
    now: function () { return Date.now(); },
    uid: function () { return Math.random().toString(36).slice(2, 9); }
  });

  /* ------------------------------------------------------------
     Number formatting - idle games live or die on readable big
     numbers. Short suffixes, no scientific notation until absurd.
     ------------------------------------------------------------ */
  var SUFFIX = ["", "K", "M", "B", "T", "Qa", "Qi", "Sx", "Sp", "Oc", "No", "Dc"];
  PA.fmt = function (n) {
    if (n === Infinity) return "∞";
    if (n === null || n === undefined || isNaN(n)) return "0";
    var neg = n < 0;
    n = Math.abs(n);
    if (n < 1000) {
      // keep small numbers tidy: ints as-is, decimals to 1 place
      var i = Math.round(n * 10) / 10;
      return (neg ? "-" : "") + (i % 1 === 0 ? Math.round(i) : i.toFixed(1));
    }
    var tier = Math.floor(Math.log10(n) / 3);
    tier = U.clamp(tier, 0, SUFFIX.length - 1);
    var scaled = n / Math.pow(1000, tier);
    var str;
    if (scaled >= 100) str = scaled.toFixed(0);
    else if (scaled >= 10) str = scaled.toFixed(1);
    else str = scaled.toFixed(2);
    str = str.replace(/\.0+$/, "").replace(/(\.\d)0$/, "$1");
    return (neg ? "-" : "") + str + SUFFIX[tier];
  };

  PA.fmtRate = function (n) { return PA.fmt(n) + "/s"; };

  PA.dur = function (ms) {
    var s = Math.floor(ms / 1000);
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
    if (h > 0) return h + "h " + m + "m";
    if (m > 0) return m + "m " + r + "s";
    return r + "s";
  };

  /* ------------------------------------------------------------
     Event bus - decouples simulation from rendering.
     ------------------------------------------------------------ */
  function Bus() { this._m = {}; }
  Bus.prototype.on = function (evt, fn) {
    (this._m[evt] = this._m[evt] || []).push(fn);
    return function () { this.off(evt, fn); }.bind(this);
  };
  Bus.prototype.off = function (evt, fn) {
    var a = this._m[evt]; if (!a) return;
    var i = a.indexOf(fn); if (i >= 0) a.splice(i, 1);
  };
  Bus.prototype.emit = function (evt, data) {
    var a = this._m[evt]; if (!a) return;
    for (var i = 0; i < a.length; i++) {
      try { a[i](data); } catch (e) { if (root.console) console.error("[bus:" + evt + "]", e); }
    }
  };
  PA.Bus = Bus;
  PA.bus = new Bus();

  /* ------------------------------------------------------------
     Storage with graceful degradation (private mode, quota, etc)
     ------------------------------------------------------------ */
  var memStore = {};
  PA.store = {
    get: function (key, fallback) {
      try {
        var raw = root.localStorage.getItem(key);
        if (raw == null) return fallback;
        return JSON.parse(raw);
      } catch (e) {
        return key in memStore ? memStore[key] : fallback;
      }
    },
    set: function (key, val) {
      try { root.localStorage.setItem(key, JSON.stringify(val)); return true; }
      catch (e) { memStore[key] = val; return false; }
    },
    del: function (key) {
      try { root.localStorage.removeItem(key); } catch (e) {}
      delete memStore[key];
    }
  };

  /* ------------------------------------------------------------
     Idle-time math: exponential growth helpers used by the economy.
     cost(base, growth, owned) -> price of the *next* unit
     ------------------------------------------------------------ */
  PA.costOf = function (base, growth, owned) {
    return Math.ceil(base * Math.pow(growth, owned));
  };
  PA.totalCost = function (base, growth, owned, count) {
    // geometric series, used for "buy x10"
    var r = growth;
    if (Math.abs(r - 1) < 1e-9) return base * count;
    return Math.ceil(base * Math.pow(r, owned) * (Math.pow(r, count) - 1) / (r - 1));
  };

  PA.version = "1.0.0";
})(typeof window !== "undefined" ? window : globalThis);
