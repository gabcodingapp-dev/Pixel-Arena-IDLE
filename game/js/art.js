/* ============================================================
   art.js - loading, pixel-perfect canvas sizing, procedurally
   painted scenery and small effects.

   The scene canvas renders at a deliberately LOW internal
   resolution (about 480-640 px wide) and is upscaled by CSS with
   smoothing off. That is what gives the chunky, authentic pixel
   look without needing giant sprite sheets, and it keeps old
   phones at 60fps.
   ============================================================ */
(function (root) {
  "use strict";

  var PA = root.PA, U = PA.U;
  var A = (PA.art = {});

  A.sprites = {};
  A.bgs = {};
  A.ready = false;

  A.SPRITES = ["rowan", "luna", "nixie", "fox", "slime", "mimic", "boss"];
  A.BGS = {
    farm_land: "assets/sprites/../raw/../ui/title_land", // replaced below
  };

  /* Sprite files live next to the atlas; the build pipeline emits webp. */
  function assetUrl(base, ext) {
    var path = base + "." + (ext || "webp");
    return path;
  }

  A.imgUrl = function (name) {
    return assetUrl("assets/sprites/" + name);
  };

  /* ------------------------------------------------------------
     Loading
     ------------------------------------------------------------ */
  function loadImage(url) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.decoding = "async";
      img.onload = function () { resolve(img); };
      img.onerror = function () {
        // Fall back to the PNG the build also emits.
        if (/\.webp$/.test(url)) {
          var alt = new Image();
          alt.onload = function () { resolve(alt); };
          alt.onerror = function () { resolve(null); };
          alt.src = url.replace(/\.webp$/, ".png");
        } else resolve(null);
      };
      img.src = url;
    });
  }

  A.BG_FILES = {
    title_port: "assets/ui/title_port",
    title_land: "assets/ui/title_land",
    farm_land: "assets/scene/farm_land",
    farm_port: "assets/scene/farm_port",
    battle_land: "assets/scene/battle_land",
    battle_port: "assets/scene/battle_port"
  };

  A.load = function (onProgress) {
    var jobs = [];
    A.SPRITES.forEach(function (name) {
      jobs.push(loadImage(A.imgUrl(name)).then(function (img) { A.sprites[name] = img; }));
    });
    Object.keys(A.BG_FILES).forEach(function (key) {
      jobs.push(loadImage(assetUrl(A.BG_FILES[key])).then(function (img) { A.bgs[key] = img; }));
    });
    var done = 0, total = jobs.length;
    return Promise.all(
      jobs.map(function (p) {
        return p.then(function (r) {
          done++;
          if (onProgress) onProgress(done / total);
          return r;
        });
      })
    ).then(function () { A.ready = true; });
  };

  /* ------------------------------------------------------------
     Canvas sizing: keep a chunky pixel grid, scale with CSS.
     ------------------------------------------------------------ */
  A.resize = function (canvas, cssW, cssH) {
    var landscape = cssW > cssH;
    // target internal width: lower on landscape so the wide view still reads
    var targetW = landscape ? 620 : 460;
    var ps = Math.max(1, Math.round(cssW / targetW));
    var w = Math.max(120, Math.round(cssW / ps));
    var h = Math.max(120, Math.round(cssH / ps));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w; canvas.height = h;
    }
    var ctx = canvas.getContext("2d", { alpha: false });
    ctx.imageSmoothingEnabled = false;
    ctx.imageSmoothingQuality = "low";
    A.lastLandscape = landscape;
    return { ctx: ctx, W: w, H: h, ps: ps, landscape: landscape, cssW: cssW, cssH: cssH };
  };

  /* ------------------------------------------------------------
     tiny drawing helpers (all hard-edged, 3-tone shading)
     ------------------------------------------------------------ */
  function px(ctx, x, y, w, h, color) {
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  }
  A.px = px;

  function rrect(ctx, x, y, w, h, r, fill) {
    if (w <= 0 || h <= 0) return;
    r = Math.max(0, r);
    w = Math.max(1, w); h = Math.max(1, h);
    ctx.beginPath();
    var rr = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  }
  A.rrect = rrect;

  A.drawShadow = function (ctx, cx, cy, rx, ry, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha == null ? 0.24 : alpha;
    ctx.fillStyle = "#1d2a12";
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };

  /**
   * Draw a loaded sprite centred on its feet, preserving aspect.
   */
  A.drawSprite = function (ctx, img, cx, footY, height, opts) {
    if (!img) return;
    opts = opts || {};
    var w = (img.width / img.height) * height;
    var x = cx - w / 2;
    var y = footY - height;
    ctx.save();
    if (opts.flip) {
      ctx.translate(cx, 0);
      ctx.scale(-1, 1);
      ctx.translate(-cx, 0);
    }
    if (opts.alpha != null) ctx.globalAlpha = opts.alpha;
    if (opts.rot) {
      ctx.translate(cx, footY);
      ctx.rotate(opts.rot);
      ctx.translate(-cx, -footY);
    }
    if (opts.scale && opts.scale !== 1) {
      ctx.translate(cx, footY);
      ctx.scale(opts.scale, opts.scale);
      ctx.translate(-cx, -footY);
    }
    ctx.drawImage(img, Math.round(x), Math.round(y), Math.round(w), Math.round(height));
    ctx.restore();
  };

  A.spriteSize = function (img, height) {
    if (!img) return { w: 0, h: height };
    return { w: (img.width / img.height) * height, h: height };
  };

  /* ------------------------------------------------------------
     Palette
     ------------------------------------------------------------ */
  var C = {
    grass: "#5cab3c", grassLo: "#3f8a2b", grassHi: "#7cc94c", grassHi2: "#93d95e",
    soil: "#8a5a34", soilLo: "#6b4427", soilHi: "#a8743f",
    wood: "#a5703e", woodLo: "#7a4f2a", woodHi: "#c99156",
    stone: "#8e94a3", stoneLo: "#6a7180", stoneHi: "#b6bcc9",
    roof: "#d8663f", roofLo: "#a84a2c", roofHi: "#f08a5e",
    leaf: "#3f8f36", leafLo: "#2a6525", leafHi: "#6ec24a",
    sky: "#7fc9f2"
  };
  A.C = C;

  /* ------------------------------------------------------------
     Static scenery: painted once per size into an offscreen
     canvas, then blitted. Handles both scenes and orientations.
     ------------------------------------------------------------ */
  var staticCache = { key: "", canvas: null };

  function makeCanvas(w, h) {
    var c = root.document.createElement("canvas");
    c.width = w; c.height = h;
    return c;
  }

  function grassTexture(ctx, W, y0, y1, seed) {
    // base band
    var g = ctx.createLinearGradient(0, y0, 0, y1);
    g.addColorStop(0, "#6dbb46");
    g.addColorStop(0.35, C.grass);
    g.addColorStop(1, "#4b9633");
    ctx.fillStyle = g;
    ctx.fillRect(0, y0, W, y1 - y0);

    var rnd = U.seeded(seed);
    // dither bands for that SNES look
    for (var y = y0; y < y1; y += 3) {
      var t = (y - y0) / Math.max(1, y1 - y0);
      var alpha = 0.05 + t * 0.12;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = t < 0.5 ? "#8ed85f" : "#3d7f28";
      for (var x = (y % 6 === 0 ? 0 : 2); x < W; x += 3) {
        if (rnd() > 0.55) ctx.fillRect(x, y, 1, 1);
      }
    }
    ctx.globalAlpha = 1;

    // grass tufts
    var tufts = Math.round(W * (y1 - y0) / 900);
    for (var i = 0; i < tufts; i++) {
      var tx = Math.floor(rnd() * W);
      var ty = y0 + Math.floor(rnd() * (y1 - y0));
      var shade = rnd() > 0.5 ? "#3f8a2b" : "#74c04a";
      ctx.fillStyle = shade;
      ctx.fillRect(tx, ty, 1, 2);
      ctx.fillRect(tx + 1, ty + 1, 1, 1);
      if (rnd() > 0.7) {
        ctx.fillStyle = U.pick(["#ffe066", "#ff9ec3", "#fff6e0", "#a8e2ff"]);
        ctx.fillRect(tx + 2, ty - 1, 1, 1);
      }
    }
  }

  function drawTree(ctx, x, baseY, h, seed) {
    var rnd = U.seeded(seed);
    var trunkW = Math.max(3, Math.round(h * 0.11));
    // trunk
    px(ctx, x - trunkW / 2, baseY - h * 0.42, trunkW, h * 0.42, C.woodLo);
    px(ctx, x - trunkW / 2, baseY - h * 0.42, Math.max(1, trunkW / 2), h * 0.42, C.wood);
    // canopy: stacked blobs
    var cy = baseY - h * 0.62;
    var r = h * 0.30;
    var blobs = [
      [0, 0, 1.0], [-r * 0.8, r * 0.25, 0.72], [r * 0.8, r * 0.2, 0.76],
      [-r * 0.35, -r * 0.55, 0.66], [r * 0.4, -r * 0.5, 0.62]
    ];
    ctx.fillStyle = C.leafLo;
    blobs.forEach(function (b) {
      ctx.beginPath();
      ctx.arc(x + b[0], cy + b[1] + 2, r * b[2] + 2, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.fillStyle = C.leaf;
    blobs.forEach(function (b) {
      ctx.beginPath();
      ctx.arc(x + b[0], cy + b[1], r * b[2], 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.fillStyle = C.leafHi;
    blobs.forEach(function (b, i) {
      if (i === 0) return;
      ctx.beginPath();
      ctx.arc(x + b[0] - r * 0.16, cy + b[1] - r * 0.22, r * b[2] * 0.62, 0, Math.PI * 2);
      ctx.fill();
    });
    // blossom season sparkle
    for (var i = 0; i < 10; i++) {
      px(ctx, x + (rnd() - 0.5) * r * 2.1, cy + (rnd() - 0.5) * r * 1.5, 1, 1, "#ffd6e6");
    }
  }

  function drawBush(ctx, x, y, w, h, seed) {
    h = Math.max(6, h); w = Math.max(8, w);
    var rnd = U.seeded(seed);
    ctx.fillStyle = C.leafLo;
    rrect(ctx, x - w / 2, y - h, w, h, h / 2, C.leafLo);
    rrect(ctx, x - w / 2 + 1, y - h + 1, w - 2, h - 2, h / 2, C.leaf);
    rrect(ctx, x - w / 2 + 2, y - h + 3, w * 0.55, h * 0.45, h / 3, C.leafHi);
    for (var i = 0; i < 4; i++) {
      px(ctx, x + (rnd() - 0.5) * w * 0.9, y - h * (0.3 + rnd() * 0.6), 1, 1, rnd() > 0.5 ? "#fff3c4" : "#ffb3d1");
    }
  }

  function drawRock(ctx, x, y, w, h, seed) {
    var rnd = U.seeded(seed);
    rrect(ctx, x - w / 2, y - h, w, h, 4, C.stoneLo);
    rrect(ctx, x - w / 2 + 1, y - h + 1, w - 2, h - 2, 4, C.stone);
    rrect(ctx, x - w / 2 + 2, y - h + 2, w * 0.5, h * 0.4, 3, C.stoneHi);
    ctx.fillStyle = "#4e8a3a";
    for (var i = 0; i < 3; i++) px(ctx, x - w / 3 + rnd() * w * 0.6, y - 1 - rnd() * 2, 2, 1, "#5cab3c");
  }

  function drawFence(ctx, x0, x1, y, h) {
    ctx.fillStyle = C.woodLo;
    ctx.fillRect(x0, y - 1, x1 - x0, 2);
    for (var x = x0; x < x1; x += Math.max(9, h * 0.9)) {
      px(ctx, x, y - h, 4, h, C.woodLo);
      px(ctx, x, y - h, 2, h, C.woodHi);
      px(ctx, x, y - h, 4, 2, C.woodLo);
    }
    px(ctx, x0, y - h * 0.66, x1 - x0, 2, C.wood);
    px(ctx, x0, y - h * 0.30, x1 - x0, 2, C.wood);
  }

  function drawWell(ctx, x, y, s) {
    // stone base
    rrect(ctx, x - s * 0.5, y - s * 0.62, s, s * 0.62, 3, C.stoneLo);
    rrect(ctx, x - s * 0.44, y - s * 0.56, s * 0.88, s * 0.5, 3, C.stone);
    for (var i = 0; i < 3; i++) {
      px(ctx, x - s * 0.44, y - s * 0.5 + i * (s * 0.16), s * 0.88, 1, C.stoneLo);
    }
    // water
    px(ctx, x - s * 0.3, y - s * 0.55, s * 0.6, s * 0.1, "#2f7fb8");
    px(ctx, x - s * 0.24, y - s * 0.54, s * 0.3, 1, "#7fd3ff");
    // frame + roof
    px(ctx, x - s * 0.44, y - s * 1.5, 3, s * 0.95, C.woodLo);
    px(ctx, x + s * 0.34, y - s * 1.5, 3, s * 0.95, C.woodLo);
    ctx.fillStyle = C.roofLo;
    ctx.beginPath();
    ctx.moveTo(x - s * 0.66, y - s * 1.44);
    ctx.lineTo(x, y - s * 2.05);
    ctx.lineTo(x + s * 0.66, y - s * 1.44);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = C.roof;
    ctx.beginPath();
    ctx.moveTo(x - s * 0.6, y - s * 1.46);
    ctx.lineTo(x, y - s * 1.98);
    ctx.lineTo(x + s * 0.42, y - s * 1.46);
    ctx.closePath();
    ctx.fill();
    // bucket
    px(ctx, x - 2, y - s * 1.1, 5, 4, C.wood);
    px(ctx, x - 2, y - s * 1.1, 5, 1, C.woodHi);
  }

  function drawCottage(ctx, x, baseY, w) {
    var h = w * 0.66;
    // stone footing
    px(ctx, x - w / 2, baseY - h * 0.12, w, h * 0.12, C.stoneLo);
    px(ctx, x - w / 2, baseY - h * 0.12, w, 1, C.stoneHi);
    // walls
    px(ctx, x - w * 0.42, baseY - h * 0.68, w * 0.84, h * 0.58, C.woodLo);
    px(ctx, x - w * 0.42, baseY - h * 0.68, w * 0.84, h * 0.56, "#d8b184");
    // timber frame
    ctx.fillStyle = C.woodLo;
    ctx.fillRect(x - w * 0.42, baseY - h * 0.68, w * 0.84, 2);
    ctx.fillRect(x - w * 0.10, baseY - h * 0.68, 2, h * 0.56);
    // thatched roof
    ctx.fillStyle = "#b8813f";
    ctx.beginPath();
    ctx.moveTo(x - w * 0.56, baseY - h * 0.66);
    ctx.lineTo(x, baseY - h * 1.12);
    ctx.lineTo(x + w * 0.56, baseY - h * 0.66);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#d9a35a";
    ctx.beginPath();
    ctx.moveTo(x - w * 0.50, baseY - h * 0.66);
    ctx.lineTo(x, baseY - h * 1.06);
    ctx.lineTo(x + w * 0.30, baseY - h * 0.66);
    ctx.closePath();
    ctx.fill();
    // thatch strokes
    ctx.fillStyle = "#8d5f2c";
    for (var i = 0; i < 14; i++) {
      var tx = x - w * 0.5 + (i / 14) * w;
      var ty = baseY - h * (0.98 - i * 0.02);
      ctx.fillRect(tx, ty, 1, Math.max(2, h * 0.3 - Math.abs(i - 7) * 1.2));
    }
    // door + windows
    px(ctx, x - w * 0.09, baseY - h * 0.34, w * 0.18, h * 0.22, "#6b3f22");
    px(ctx, x - w * 0.07, baseY - h * 0.32, w * 0.14, h * 0.18, "#8a5430");
    px(ctx, x - w * 0.34, baseY - h * 0.52, w * 0.14, h * 0.14, "#3c6f8a");
    px(ctx, x - w * 0.34, baseY - h * 0.52, w * 0.14, 1, "#9fd8ee");
    px(ctx, x + w * 0.20, baseY - h * 0.52, w * 0.14, h * 0.14, "#3c6f8a");
    px(ctx, x + w * 0.20, baseY - h * 0.52, w * 0.14, 1, "#9fd8ee");
    // chimney + smoke puffs
    px(ctx, x + w * 0.24, baseY - h * 1.02, w * 0.10, h * 0.3, C.stoneLo);
    px(ctx, x + w * 0.24, baseY - h * 1.02, w * 0.10, 2, C.stoneHi);
    ctx.fillStyle = "rgba(240,240,235,.55)";
    for (var s = 0; s < 3; s++) {
      ctx.beginPath();
      ctx.arc(x + w * 0.30 + s * w * 0.05, baseY - h * (1.1 + s * 0.12), 3 + s * 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
    // flower boxes
    for (var f = 0; f < 9; f++) {
      px(ctx, x - w * 0.34 + f * 3, baseY - h * 0.36, 2, 2, U.pick(["#ff8ab3", "#ffd166", "#c9a3ff", "#ffffff"]));
    }
  }

  function drawPath(ctx, W, H, horizon, seed) {
    var rnd = U.seeded(seed);
    ctx.save();
    ctx.beginPath();
    var topY = horizon + (H - horizon) * 0.10;
    ctx.moveTo(W * 0.34, topY);
    ctx.bezierCurveTo(W * 0.30, H * 0.72, W * 0.62, H * 0.80, W * 0.52, H + 10);
    ctx.lineTo(W * 0.92, H + 10);
    ctx.bezierCurveTo(W * 0.98, H * 0.72, W * 0.46, H * 0.66, W * 0.52, topY);
    ctx.closePath();
    ctx.fillStyle = "#c9a86a";
    ctx.fill();
    ctx.clip();
    ctx.fillStyle = "#b8945a";
    for (var i = 0; i < 90; i++) {
      ctx.fillRect(rnd() * W, topY + rnd() * (H - topY), 2, 1);
    }
    ctx.fillStyle = "#dbbd85";
    for (var j = 0; j < 60; j++) {
      ctx.fillRect(rnd() * W, topY + rnd() * (H - topY), 1, 1);
    }
    ctx.restore();
  }

  /* Where the interactive meadow starts (fraction of canvas height).
     Shared by the backdrop painter and the plot layout so crops always
     land on empty grass instead of over the cottage. */
  A.fieldFrac = function (landscape) { return landscape ? 0.50 : 0.50; };
  /* Battle ground line: where the painted clearing starts, and where fighters
     stand. Both the art and the battle system read these, so sprites always
     sit on the floor instead of hovering above it. */
  A.battleFloorFrac = function (landscape) { return landscape ? 0.70 : 0.62; };
  A.arenaFrac = function (landscape) { return landscape ? 0.80 : 0.78; };
  A.fieldTop = function (H, landscape) { return Math.round(H * A.fieldFrac(landscape)); };

  /* Paint the static backdrop for the farm scene.

     The generated farm art carries the sky, cottage, trees and path, so we
     cover-fit it into a top band and extend the meadow downward with painted
     grass. That keeps the hand-drawn detail while guaranteeing the lower half
     of the screen is a clean, empty field for the player's plots. */
  function paintFarm(ctx, W, H, landscape) {
    var bg = A.bgs[landscape ? "farm_land" : "farm_port"];
    var haveArt = !!bg;

    // Landscape lets the art cover the full canvas; portrait crops it to a
    // band and extends the meadow downward so the field stays usable.
    var fieldTop = A.fieldTop(H, landscape);
    var bandH = landscape ? H : fieldTop;

    if (haveArt) {
      var sc = Math.max(W / bg.width, bandH / bg.height);
      var dw = bg.width * sc, dh = bg.height * sc;
      var dx = (W - dw) / 2;
      var dy = bandH - dh;            // anchor the art's ground to the band base
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, W, bandH);
      ctx.clip();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(bg, Math.round(dx), Math.round(dy), Math.round(dw), Math.round(dh));
      ctx.restore();

      if (!landscape) {
        // Field below the band, tinted to match the art's grass.
        grassTexture(ctx, W, bandH - 1, H, 1337);
        // seam: blend the art's own grass into the painted field
        var seamY = bandH - Math.round((H - bandH) * 0.10) - 2;
        var fade = ctx.createLinearGradient(0, seamY, 0, bandH + 4);
        fade.addColorStop(0, "rgba(109,187,70,0)");
        fade.addColorStop(0.75, "rgba(109,187,70,.9)");
        fade.addColorStop(1, "#6dbb46");
        ctx.fillStyle = fade;
        ctx.fillRect(0, seamY, W, bandH - seamY + 6);
      }
    } else {
      // No art: paint a complete sky so the scene still reads.
      var horizon = Math.round(H * (landscape ? 0.42 : 0.34));
      var g = ctx.createLinearGradient(0, 0, 0, horizon);
      g.addColorStop(0, "#7fc9f2");
      g.addColorStop(1, "#cdeeff");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, horizon + 4);
      ctx.fillStyle = "rgba(255,255,255,.92)";
      for (var c = 0; c < 4; c++) {
        var cw = W * (0.16 + c * 0.05);
        var cyy = horizon * (0.22 + (c % 2) * 0.16);
        ctx.beginPath();
        ctx.arc(W * (0.16 + c * 0.24), cyy, cw * 0.22, 0, Math.PI * 2);
        ctx.arc(W * (0.16 + c * 0.24) + cw * 0.22, cyy - 3, cw * 0.16, 0, Math.PI * 2);
        ctx.fill();
      }
      grassTexture(ctx, W, horizon, H, 99);
      drawPath(ctx, W, H, horizon, 7);
      drawTree(ctx, W * 0.07, horizon + (H - horizon) * 0.2, (H - horizon) * 0.7, 11);
      drawTree(ctx, W * 0.94, horizon + (H - horizon) * 0.2, (H - horizon) * 0.66, 12);
      drawCottage(ctx, W * 0.30, horizon + (H - horizon) * 0.18, W * 0.26);
      drawWell(ctx, W * 0.80, horizon + (H - horizon) * 0.24, W * 0.06);
    }

    drawFarmEdgeProps(ctx, W, H, fieldTop);

    // vignette
    var vg = ctx.createRadialGradient(W * 0.5, H * 0.5, Math.min(W, H) * 0.32, W * 0.5, H * 0.5, Math.max(W, H) * 0.8);
    vg.addColorStop(0, "rgba(20,30,10,0)");
    vg.addColorStop(1, "rgba(16,26,8,.34)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);
  }

  /* small decorative bits that frame the meadow without crowding it */
  function drawFarmEdgeProps(ctx, W, H, fieldTop) {
    var fh = Math.max(20, H - fieldTop);
    var y = Math.round(fieldTop + fh * 0.05);
    drawFence(ctx, 0, W * 0.13, y, Math.max(8, fh * 0.10));
    drawFence(ctx, W * 0.88, W, y, Math.max(8, fh * 0.10));
    drawBush(ctx, W * 0.03, H * 0.975, W * 0.09, fh * 0.11, 21);
    drawBush(ctx, W * 0.97, H * 0.975, W * 0.10, fh * 0.10, 22);
  }

  /* ------------------------------------------------------------
     Battle backdrop: a moonlit forest clearing painted in layers so the
     procedural version stands on its own if no art is available.
     ------------------------------------------------------------ */
  function paintBattle(ctx, W, H, landscape) {
    var bg = A.bgs[landscape ? "battle_land" : "battle_port"];
    var floorY = Math.round(H * A.battleFloorFrac(landscape));
    var rnd = U.seeded(5150);

    // sky gradient
    var sky = ctx.createLinearGradient(0, 0, 0, floorY);
    sky.addColorStop(0, "#12212e");
    sky.addColorStop(0.45, "#22415a");
    sky.addColorStop(0.78, "#2f6a63");
    sky.addColorStop(1, "#3b7f5e");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // moon + glow
    var mx = W * 0.72, my = H * 0.16, mr = Math.min(W, H) * 0.055;
    var glow = ctx.createRadialGradient(mx, my, mr * 0.4, mx, my, mr * 5);
    glow.addColorStop(0, "rgba(226,246,255,.5)");
    glow.addColorStop(1, "rgba(226,246,255,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#e8f6ff";
    ctx.beginPath(); ctx.arc(mx, my, mr, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#cfe6f5";
    ctx.beginPath(); ctx.arc(mx - mr * 0.3, my + mr * 0.25, mr * 0.22, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(mx + mr * 0.35, my - mr * 0.3, mr * 0.16, 0, Math.PI * 2); ctx.fill();

    // stars
    for (var i = 0; i < 60; i++) {
      var sx = rnd() * W, sy = rnd() * floorY * 0.75;
      ctx.globalAlpha = 0.25 + rnd() * 0.6;
      ctx.fillStyle = "#dff3ff";
      ctx.fillRect(Math.round(sx), Math.round(sy), 1, 1);
    }
    ctx.globalAlpha = 1;

    // distant mountain silhouettes
    function ridge(baseY, amp, color, seed) {
      var r = U.seeded(seed);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(0, H);
      var x = 0;
      ctx.lineTo(0, baseY);
      while (x < W) {
        var step = 20 + r() * 40;
        ctx.lineTo(x, baseY - r() * amp);
        x += step;
      }
      ctx.lineTo(W, baseY);
      ctx.lineTo(W, H);
      ctx.closePath();
      ctx.fill();
    }
    ridge(floorY - (H - floorY) * 0.36, H * 0.09, "#1d3a44", 12);
    ridge(floorY - (H - floorY) * 0.22, H * 0.06, "#17302f", 13);

    // light shafts
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (var sh = 0; sh < 5; sh++) {
      var x0 = W * (0.08 + sh * 0.2);
      var grad = ctx.createLinearGradient(x0, 0, x0 + W * 0.18, floorY);
      grad.addColorStop(0, "rgba(190,255,220,.16)");
      grad.addColorStop(1, "rgba(190,255,220,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(x0, 0);
      ctx.lineTo(x0 + W * 0.06, 0);
      ctx.lineTo(x0 + W * 0.22, floorY);
      ctx.lineTo(x0 + W * 0.06, floorY);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    // pine tree line
    function pine(x, baseY, h, color) {
      var w = h * 0.42;
      ctx.fillStyle = color;
      for (var l = 0; l < 4; l++) {
        var ly = baseY - h * (0.25 + l * 0.22);
        var lw = w * (1 - l * 0.18);
        ctx.beginPath();
        ctx.moveTo(x - lw / 2, ly);
        ctx.lineTo(x, ly - h * 0.34);
        ctx.lineTo(x + lw / 2, ly);
        ctx.closePath();
        ctx.fill();
      }
      ctx.fillRect(x - h * 0.035, baseY - h * 0.12, h * 0.07, h * 0.14);
    }
    // Two tree bands: a pale, moonlit far line and a nearer, darker one.
    var farBase = floorY - (H - floorY) * 0.30;
    for (var t2 = 0; t2 < 20; t2++) {
      var fx = (t2 / 19) * (W + 40) - 20 + rnd() * 8;
      pine(fx, farBase, H * (0.13 + rnd() * 0.06), "#264a49");
    }
    var treeBase = floorY - (H - floorY) * 0.08;
    for (var t = 0; t < 12; t++) {
      var tx = (t / 11) * (W + 30) - 15 + rnd() * 12;
      var centre = Math.abs(tx / W - 0.5) < 0.26;
      if (centre) continue;                       // keep the arena clear
      pine(tx, treeBase, H * (0.15 + rnd() * 0.08), "#16342c");
    }
    // moonlit rim on the near trees so they don't read as a black band
    ctx.save();
    ctx.globalAlpha = 0.10;
    ctx.fillStyle = "#bfe8d0";
    ctx.fillRect(0, treeBase - H * 0.2, W, 2);
    ctx.restore();

    // clearing floor
    var grass = ctx.createLinearGradient(0, floorY, 0, H);
    grass.addColorStop(0, "#2c5c3c");
    grass.addColorStop(0.5, "#3a7048");
    grass.addColorStop(1, "#244a32");
    ctx.fillStyle = grass;
    ctx.fillRect(0, floorY, W, H - floorY);
    // mossy dither
    for (var d = 0; d < W * 3; d++) {
      var dx = rnd() * W, dy = floorY + rnd() * (H - floorY);
      ctx.globalAlpha = 0.10 + rnd() * 0.16;
      ctx.fillStyle = rnd() > 0.5 ? "#8fd36a" : "#14331f";
      ctx.fillRect(Math.round(dx), Math.round(dy), 1, 1);
    }
    ctx.globalAlpha = 1;

    // glowing crystals near the edges
    function crystal(cx, cy, ch, hue) {
      var cw = ch * 0.34;
      ctx.fillStyle = "rgba(90,230,240,.18)";
      ctx.beginPath(); ctx.arc(cx, cy - ch * 0.5, ch * 0.9, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#1c6a72";
      ctx.beginPath();
      ctx.moveTo(cx, cy - ch); ctx.lineTo(cx + cw, cy - ch * 0.45);
      ctx.lineTo(cx + cw * 0.5, cy); ctx.lineTo(cx - cw * 0.6, cy);
      ctx.lineTo(cx - cw, cy - ch * 0.5);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = hue;
      ctx.beginPath();
      ctx.moveTo(cx, cy - ch * 0.92); ctx.lineTo(cx + cw * 0.55, cy - ch * 0.45);
      ctx.lineTo(cx + cw * 0.2, cy - ch * 0.06); ctx.lineTo(cx - cw * 0.7, cy - ch * 0.3);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#d9fdff";
      ctx.fillRect(cx - 1, cy - ch * 0.8, 2, Math.max(2, ch * 0.5));
    }
    var ch0 = Math.min(H - floorY, W * 0.30) * 0.52;
    crystal(W * 0.045, H - ch0 * 0.12, ch0, "#4fd6e0");
    crystal(W * 0.115, H - ch0 * 0.06, ch0 * 0.5, "#78e8ef");
    crystal(W * 0.955, H - ch0 * 0.10, ch0 * 0.9, "#4fd6e0");

    // mushrooms
    function mushroom(mx2, my2, s, cap) {
      ctx.fillStyle = "#e8dcc8";
      ctx.fillRect(mx2 - s * 0.16, my2 - s * 0.7, s * 0.32, s * 0.7);
      ctx.fillStyle = cap;
      ctx.beginPath();
      ctx.ellipse(mx2, my2 - s * 0.72, s * 0.55, s * 0.42, 0, Math.PI, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff3e0";
      ctx.fillRect(mx2 - s * 0.22, my2 - s * 0.9, 2, 2);
      ctx.fillRect(mx2 + s * 0.12, my2 - s * 0.84, 2, 2);
    }
    var mu = Math.min(W * 0.06, (H - floorY) * 0.20);
    mushroom(W * 0.20, floorY + (H - floorY) * 0.34, mu, "#e0654f");
    mushroom(W * 0.255, floorY + (H - floorY) * 0.40, mu * 0.62, "#d9553f");
    mushroom(W * 0.86, floorY + (H - floorY) * 0.30, mu * 0.8, "#e0654f");

    // Arena floor ellipse: the readable "stage" the fight happens on.
    var arenaY = Math.round(H * A.arenaFrac(landscape));
    var arx = W * 0.44;
    var ary = Math.max(10, (H - floorY) * 0.30);
    ctx.save();
    ctx.globalAlpha = 0.14;
    var ag = ctx.createRadialGradient(W * 0.5, arenaY, ary * 0.2, W * 0.5, arenaY, arx);
    ag.addColorStop(0, "#c8f0a8");
    ag.addColorStop(1, "#4f9160");
    ctx.fillStyle = ag;
    ctx.beginPath();
    ctx.ellipse(W * 0.5, arenaY, arx, ary, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.strokeStyle = "#d8f5b8";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(W * 0.5, arenaY, arx, ary, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // foreground tufts give the clearing depth
    for (var ft = 0; ft < 34; ft++) {
      var fxx = rnd() * W, fyy = H - rnd() * (H - floorY) * 0.35;
      ctx.fillStyle = rnd() > 0.5 ? "#1c3f2a" : "#4f9160";
      ctx.fillRect(Math.round(fxx), Math.round(fyy), 2, 3);
      ctx.fillRect(Math.round(fxx) + 2, Math.round(fyy) + 1, 1, 2);
    }

    // vignette
    var vg = ctx.createRadialGradient(W * 0.5, H * 0.5, Math.min(W, H) * 0.3, W * 0.5, H * 0.5, Math.max(W, H) * 0.8);
    vg.addColorStop(0, "rgba(0,10,8,0)");
    vg.addColorStop(1, "rgba(2,14,12,.62)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);

    if (bg) {
      // Real art present: paint it over the procedural layer at reduced
      // strength so the generated forest still sets the mood.
      ctx.save();
      ctx.globalAlpha = 0.92;
      var sc = Math.max(W / bg.width, H / bg.height);
      var dw = bg.width * sc, dh = bg.height * sc;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(bg, (W - dw) / 2, (H - dh) / 2, dw, dh);
      ctx.restore();
      var shade = ctx.createLinearGradient(0, floorY - (H - floorY) * 0.2, 0, H);
      shade.addColorStop(0, "rgba(6,20,18,0)");
      shade.addColorStop(1, "rgba(6,20,18,.5)");
      ctx.fillStyle = shade;
      ctx.fillRect(0, floorY - (H - floorY) * 0.2, W, H);
    }
  }

  A.ensureStatic = function (scene, W, H, landscape) {
    var key = scene + "|" + W + "x" + H + "|" + (landscape ? "L" : "P");
    if (staticCache.key === key && staticCache.canvas) return staticCache.canvas;
    var c = makeCanvas(W, H);
    var ctx = c.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    if (scene === "battle") paintBattle(ctx, W, H, landscape);
    else paintFarm(ctx, W, H, landscape);
    staticCache = { key: key, canvas: c };
    return c;
  };

  A.invalidate = function () { staticCache = { key: "", canvas: null }; };

  /* ------------------------------------------------------------
     Ambient particles: petals by day, spores in battle, embers at
     prestige. Purely cosmetic, capped for low-end devices.
     ------------------------------------------------------------ */
  A.Ambience = function (kind) {
    this.kind = kind || "petals";
    this.parts = [];
    this.t = 0;
    this.spawnAcc = 0;
  };
  A.Ambience.prototype.step = function (dt, W, H) {
    this.t += dt;
    var rate = this.kind === "spores" ? 11 : 7;
    this.spawnAcc += dt * rate;
    while (this.spawnAcc > 1) {
      this.spawnAcc -= 1;
      if (this.parts.length > 46) break;
      this.parts.push(this.make(W, H));
    }
    for (var i = this.parts.length - 1; i >= 0; i--) {
      var p = this.parts[i];
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.phase += dt * p.sway;
      if (p.life <= 0 || p.y > H + 8 || p.x < -12 || p.x > W + 12) this.parts.splice(i, 1);
    }
  };
  A.Ambience.prototype.make = function (W, H) {
    if (this.kind === "spores") {
      return {
        x: U.rand(0, W), y: U.rand(H * 0.3, H),
        vx: U.rand(-3, 3), vy: U.rand(-8, -2),
        life: U.rand(2.5, 6), max: 6, phase: U.rand(0, 6.28), sway: U.rand(1, 3),
        size: Math.random() > 0.8 ? 2 : 1,
        color: Math.random() > 0.5 ? "#a8ffd0" : "#d8ffe8"
      };
    }
    return {
      x: U.rand(-10, W), y: U.rand(-20, H * 0.2),
      vx: U.rand(6, 18), vy: U.rand(6, 14),
      life: U.rand(4, 9), max: 9, phase: U.rand(0, 6.28), sway: U.rand(1.2, 2.6),
      size: Math.random() > 0.75 ? 2 : 1,
      color: U.pick(["#ffd6e6", "#fff3c4", "#d8ffb0", "#ffffff"])
    };
  };
  A.Ambience.prototype.draw = function (ctx) {
    for (var i = 0; i < this.parts.length; i++) {
      var p = this.parts[i];
      var fade = U.clamp(p.life / 1.2, 0, 1);
      ctx.globalAlpha = fade * 0.9;
      ctx.fillStyle = p.color;
      var ox = Math.sin(p.phase) * 2;
      ctx.fillRect(Math.round(p.x + ox), Math.round(p.y), p.size, p.size);
    }
    ctx.globalAlpha = 1;
  };

  /* ------------------------------------------------------------
     Battle effects
     ------------------------------------------------------------ */
  A.fx = [];
  A.spawnFx = function (type, x, y, opts) {
    opts = opts || {};
    var f = { type: type, x: x, y: y, t: 0, life: opts.life || 0.4 };
    for (var k in opts) f[k] = opts[k];
    A.fx.push(f);
    if (A.fx.length > 60) A.fx.shift();
  };
  A.stepFx = function (dt) {
    for (var i = A.fx.length - 1; i >= 0; i--) {
      var f = A.fx[i];
      f.t += dt;
      if (f.t >= f.life) A.fx.splice(i, 1);
    }
  };
  A.drawFx = function (ctx) {
    for (var i = 0; i < A.fx.length; i++) {
      var f = A.fx[i];
      var p = f.t / f.life;
      if (f.type === "slash") {
        ctx.save();
        ctx.globalAlpha = (1 - p) * 0.95;
        ctx.strokeStyle = f.color || "#fff6c9";
        ctx.lineWidth = 3;
        ctx.beginPath();
        var r = (f.r || 16) * (0.6 + p * 0.7);
        ctx.arc(f.x, f.y, r, -1.1 + p * 0.3, 0.9 + p * 0.3);
        ctx.stroke();
        ctx.restore();
      } else if (f.type === "burst") {
        ctx.save();
        ctx.globalAlpha = (1 - p) * 0.9;
        var n = 8;
        for (var s = 0; s < n; s++) {
          var a = (s / n) * Math.PI * 2 + p * 0.6;
          var d = (f.r || 14) * p;
          ctx.fillStyle = f.color || "#ffd166";
          ctx.fillRect(f.x + Math.cos(a) * d, f.y + Math.sin(a) * d, 2, 2);
        }
        ctx.restore();
      } else if (f.type === "heal") {
        ctx.save();
        ctx.globalAlpha = (1 - p) * 0.9;
        ctx.fillStyle = f.color || "#a6f08a";
        for (var h = 0; h < 5; h++) {
          var hx = f.x - 10 + h * 5;
          var hy = f.y + 6 - p * 26 - (h % 2) * 5;
          ctx.fillRect(hx, hy, 2, 2);
        }
        ctx.restore();
      } else if (f.type === "beam") {
        // A short glowing dart rather than a long flat line: it travels a
        // fraction of the way so it reads as a projectile, not a stick.
        ctx.save();
        ctx.globalAlpha = (1 - p) * 0.85;
        ctx.strokeStyle = f.color || "#9ee6ff";
        ctx.lineCap = "round";
        ctx.lineWidth = 2.4 * (1 - p) + 1;
        var head = Math.min(1, p * 1.6);
        var tail = Math.max(0, head - 0.35);
        ctx.beginPath();
        ctx.moveTo(U.lerp(f.x, f.x2, tail), U.lerp(f.y, f.y2, tail));
        ctx.lineTo(U.lerp(f.x, f.x2, head), U.lerp(f.y, f.y2, head));
        ctx.stroke();
        // spark at the head
        ctx.fillStyle = f.color || "#9ee6ff";
        var hx = U.lerp(f.x, f.x2, head), hy = U.lerp(f.y, f.y2, head);
        ctx.fillRect(Math.round(hx) - 1, Math.round(hy) - 1, 2, 2);
        ctx.restore();
      } else if (f.type === "rise") {
        // level-up / prestige ring
        ctx.save();
        ctx.globalAlpha = (1 - p) * 0.8;
        ctx.strokeStyle = f.color || "#ffe07a";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(f.x, f.y, (f.r || 20) * (0.4 + p), (f.r || 20) * (0.16 + p * 0.4), 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }
  };

  /* coin icon drawn on canvas (kept in sync with the CSS one) */
  A.drawCoinIcon = function (ctx, x, y, r) {
    ctx.fillStyle = "#7a4a10";
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#ffc531";
    ctx.beginPath(); ctx.arc(x, y, r - 1, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#fff1b0";
    ctx.beginPath(); ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.34, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "rgba(122,74,16,.5)";
    ctx.fillRect(x - 1, y - r * 0.4, 2, r * 0.8);
  };
})(typeof window !== "undefined" ? window : globalThis);
