/* ============================================================
   audio.js - all sound is synthesised with WebAudio, so the game
   ships zero audio files and still feels alive. Everything is
   guarded: no WebAudio, no sound, no crash.
   ============================================================ */
(function (root) {
  "use strict";
  var PA = root.PA;
  var Au = (PA.audio = { enabled: true, ctx: null, master: null });

  Au.init = function () {
    if (Au.ctx) return true;
    var AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) { Au.enabled = false; return false; }
    try {
      Au.ctx = new AC();
      Au.master = Au.ctx.createGain();
      Au.master.gain.value = 0.5;
      Au.master.connect(Au.ctx.destination);
      Au.musicBus = Au.ctx.createGain();
      Au.musicBus.gain.value = 0.0;
      Au.musicBus.connect(Au.master);
    } catch (e) { Au.enabled = false; }
    return Au.enabled;
  };

  Au.resume = function () {
    if (!Au.ctx) Au.init();
    if (Au.ctx && Au.ctx.state === "suspended") Au.ctx.resume();
  };

  function tone(freq, dur, type, gain, when, slideTo) {
    if (!Au.enabled || !Au.ctx || Au.ctx.state !== "running") return;
    var t0 = when || Au.ctx.currentTime;
    var o = Au.ctx.createOscillator();
    var g = Au.ctx.createGain();
    o.type = type || "square";
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain || 0.08), t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(Au.master);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }

  function noise(dur, gain, filterFreq, when) {
    if (!Au.enabled || !Au.ctx || Au.ctx.state !== "running") return;
    var t0 = when || Au.ctx.currentTime;
    var len = Math.max(1, Math.floor(Au.ctx.sampleRate * dur));
    var buf = Au.ctx.createBuffer(1, len, Au.ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    var src = Au.ctx.createBufferSource();
    src.buffer = buf;
    var bp = Au.ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = filterFreq || 1200;
    var g = Au.ctx.createGain();
    g.gain.value = gain || 0.05;
    src.connect(bp); bp.connect(g); g.connect(Au.master);
    src.start(t0);
  }

  var last = {};
  function throttle(key, ms) {
    var n = Date.now();
    if (last[key] && n - last[key] < ms) return false;
    last[key] = n;
    return true;
  }

  Au.sfx = {
    tap: function () { if (throttle("tap", 40)) tone(520 + Math.random() * 60, 0.05, "square", 0.035); },
    hit: function (crit) {
      if (!throttle("hit", 70)) return;
      noise(crit ? 0.12 : 0.07, crit ? 0.09 : 0.05, crit ? 700 : 1500);
      if (crit) tone(220, 0.12, "square", 0.05, null, 90);
    },
    kill: function () {
      if (!throttle("kill", 90)) return;
      var t = Au.ctx ? Au.ctx.currentTime : 0;
      tone(660, 0.07, "square", 0.05, t);
      tone(990, 0.09, "square", 0.045, t + 0.06);
    },
    coin: function () {
      if (!throttle("coin", 100)) return;
      var t = Au.ctx ? Au.ctx.currentTime : 0;
      tone(1180, 0.05, "triangle", 0.04, t);
      tone(1580, 0.07, "triangle", 0.03, t + 0.04);
    },
    buy: function () {
      var t = Au.ctx ? Au.ctx.currentTime : 0;
      tone(520, 0.06, "square", 0.05, t);
      tone(700, 0.07, "square", 0.05, t + 0.05);
      tone(880, 0.1, "square", 0.05, t + 0.11);
    },
    deny: function () { tone(170, 0.12, "sawtooth", 0.05, null, 110); },
    levelup: function () {
      var t = Au.ctx ? Au.ctx.currentTime : 0;
      [523, 659, 784, 1046].forEach(function (f, i) {
        tone(f, 0.14, "square", 0.055, t + i * 0.07);
      });
    },
    boss: function () {
      var t = Au.ctx ? Au.ctx.currentTime : 0;
      tone(110, 0.5, "sawtooth", 0.06, t, 70);
      tone(165, 0.4, "square", 0.04, t + 0.15, 110);
      noise(0.5, 0.05, 400, t);
    },
    wave: function () {
      var t = Au.ctx ? Au.ctx.currentTime : 0;
      tone(392, 0.1, "square", 0.04, t);
      tone(587, 0.12, "square", 0.04, t + 0.09);
    },
    heal: function () {
      var t = Au.ctx ? Au.ctx.currentTime : 0;
      [880, 1174, 1568].forEach(function (f, i) { tone(f, 0.16, "sine", 0.045, t + i * 0.05); });
    },
    prestige: function () {
      var t = Au.ctx ? Au.ctx.currentTime : 0;
      [392, 523, 659, 784, 1046, 1318].forEach(function (f, i) {
        tone(f, 0.3, "triangle", 0.05, t + i * 0.09);
      });
      noise(0.9, 0.05, 900, t);
    }
  };

  /* ------------------------------------------------------------
     A tiny generative music bed: 4 chords, gentle arpeggio.
     Starts only after a user gesture (mobile autoplay rules).
     ------------------------------------------------------------ */
  var musicTimer = null, step = 0;
  var PROGRESSIONS = [
    [261.63, 329.63, 392.0, 523.25],  // C
    [220.0, 261.63, 329.63, 440.0],   // Am
    [174.61, 220.0, 261.63, 349.23],  // F
    [196.0, 246.94, 293.66, 392.0]    // G
  ];

  Au.startMusic = function () {
    if (!Au.enabled || !Au.ctx || musicTimer || !Au.musicOn) return;
    if (Au.ctx.state !== "running") return;
    Au.musicBus.gain.setTargetAtTime(0.16, Au.ctx.currentTime, 1.2);
    var beat = 380;
    musicTimer = setInterval(function () {
      if (!Au.musicOn || !Au.ctx || Au.ctx.state !== "running") return;
      var chord = PROGRESSIONS[Math.floor(step / 8) % PROGRESSIONS.length];
      var note = chord[step % 4] * (step % 8 >= 4 ? 2 : 1);
      var t = Au.ctx.currentTime;
      var o = Au.ctx.createOscillator(), g = Au.ctx.createGain();
      o.type = "triangle";
      o.frequency.value = note;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.05, t + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
      o.connect(g); g.connect(Au.musicBus);
      o.start(t); o.stop(t + 1.0);
      // soft bass every bar
      if (step % 8 === 0) {
        var b = Au.ctx.createOscillator(), bg = Au.ctx.createGain();
        b.type = "sine"; b.frequency.value = chord[0] / 2;
        bg.gain.setValueAtTime(0.0001, t);
        bg.gain.exponentialRampToValueAtTime(0.09, t + 0.08);
        bg.gain.exponentialRampToValueAtTime(0.0001, t + 2.4);
        b.connect(bg); bg.connect(Au.musicBus);
        b.start(t); b.stop(t + 2.5);
      }
      step++;
    }, beat);
  };

  Au.stopMusic = function () {
    if (musicTimer) { clearInterval(musicTimer); musicTimer = null; }
    if (Au.musicBus && Au.ctx) Au.musicBus.gain.setTargetAtTime(0, Au.ctx.currentTime, 0.4);
  };

  Au.setMusic = function (on) {
    Au.musicOn = !!on;
    if (!on) Au.stopMusic();
    else Au.startMusic();
  };

  Au.setSfx = function (on) { Au.enabled = !!on; };
})(typeof window !== "undefined" ? window : globalThis);
