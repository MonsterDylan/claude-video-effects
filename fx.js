/* ==========================================================================
   Claude Video Effects (v1)
   30 one-call motion effects for Hyperframes (HTML + CSS + GSAP), in the "Signal" palette.
   MIT licensed (see LICENSE).

   Usage (inside a project's index.html, AFTER gsap + fx.js load):
     const tl = gsap.timeline({ paused: true });
     FX.init({ zone: "left" });            // "left" = leave room for the chapter list, "full" = centered
     FX.kineticHook(tl, 0.3, { lines: ["KINETIC", "HOOK"] });
     FX.promptBar(tl, 2.0, { text: "prompt bar" });
     ...
     FX.finalize(tl);                      // REQUIRED: wires HUD dimming windows
     window.__timelines["main"] = tl;

   Every effect: FX.<name>(tl, at, opts) -> returns the end time.
   All DOM is built synchronously at load; all motion lives on `tl` (seekable, deterministic).
   Catalog + params: README.md
   ========================================================================== */
(function () {
  "use strict";
  const FX = {};
  const W = 1080, H = 1920;
  const C = {
    violet: "#7A4DFF", magenta: "#C44DF0", cyan: "#35D6E6", red: "#FF3B4E",
    white: "#FFFFFF", lav: "#8D869A", lavHi: "#B9B2C8", ink: "#07111F", redFill: "#351C25",
  };
  FX.C = C;

  // ---------------------------------------------------------------- state
  const S = {
    zone: { x: 50, w: 640 },  // UI column
    low: { x: 60, w: 960 },   // lower-third band (below the chapter list)
    top: 200,                 // first safe y below IG top chrome
    lowY: 1160,               // lower band y
    plateOffset: 0,           // composition time -> plate media time offset (face tracking)
    face: { cx: 620, cy: 720, w: 340, h: 420 },
    dims: [],                 // HUD dim windows, merged in finalize()
    cues: [],                 // SFX cues {t, id, gain} -> tools/sfx-bed.mjs builds the bed
    sfx: true,
    pending: [],              // async loads (3D models) the renderer must wait for
    seed: 7,
  };
  const L = {};
  FX.S = S; FX.L = L;

  // ---------------------------------------------------------------- utils
  const q = (s) => (typeof s === "string" ? document.querySelector(s) : s);
  function mk(tag, cls, parent, css, html) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (css) Object.assign(el.style, css);
    if (html != null) el.innerHTML = html;
    if (parent) parent.appendChild(el);
    return el;
  }
  const px = (n) => n + "px";
  function rng(seed) { // mulberry32, deterministic
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const nextRng = () => rng(S.seed++ * 9973);
  // SFX: every effect drops default cues (sounds/ui-*.wav). FX.init({ sfx: false }) or opts.sfx=false to skip.
  function cue(t, id, gain = 1) { if (S.sfx) S.cues.push({ t: Math.max(0, +t.toFixed(3)), id, gain }); }
  FX.cue = cue;
  FX.cues = () => S.cues.slice().sort((a, b) => a.t - b.t);
  function fitPx(text, maxW, maxPx, ratio) {
    return Math.max(24, Math.min(maxPx, Math.floor(maxW / (Math.max(1, text.length) * ratio))));
  }
  function chars(parent, text, cls) {
    return Array.from(text).map((ch) => mk("span", "fx-ch " + (cls || ""), parent, null, ch === " " ? "&nbsp;" : ch));
  }
  function root(layer, id) {
    const r = mk("div", "fx-root", L[layer] || L.ui);
    if (id) r.dataset.fx = id;
    return r;
  }
  // root visibility: on at `at`, off at `end` (hard set, so nothing bleeds)
  function life(tl, r, at, end, fadeIn = 0.12, fadeOut = 0.16) {
    // Short dur overrides can squeeze a window below its fades (or invert it). Without this the
    // fade-in lands after the hide and the layer sticks on screen for the rest of the video.
    const span = Math.max(0.06, end - at);
    if (fadeIn + fadeOut > span) { const k = span / (fadeIn + fadeOut); fadeIn *= k; fadeOut *= k; }
    end = at + span;
    tl.fromTo(r, { opacity: 0 }, { opacity: 1, duration: fadeIn, ease: "power1.out", immediateRender: false }, at);
    tl.to(r, { opacity: 0, duration: fadeOut, ease: "power1.in" }, end - fadeOut);
    tl.set(r, { opacity: 0 }, end);
  }
  function typeInto(tl, el, text, at, dur) {
    const p = { n: 0 };
    el.textContent = "";
    tl.to(p, { n: text.length, duration: dur, ease: "none",
      onUpdate() { el.textContent = text.slice(0, Math.round(p.n)); } }, at);
  }
  function counter(tl, el, from, to, at, dur, fmt, ease = "power2.out") {
    const p = { v: from };
    el.textContent = fmt(from);
    tl.to(p, { v: to, duration: dur, ease, onUpdate() { el.textContent = fmt(p.v); } }, at);
  }
  const commas = (v) => Math.round(v).toLocaleString("en-US");
  function caret(tl, el, at, dur) {
    const n = Math.max(1, Math.floor(dur / 0.36));
    tl.fromTo(el, { opacity: 1 }, { opacity: 0, duration: 0.18, ease: "steps(1)", yoyo: true, repeat: n * 2 - 1, immediateRender: false }, at);
  }
  // dim the HUD (caption, optionally chapter list) while an effect owns the lower band / whole frame
  function dimHud(at, end, toc) { S.dims.push({ at, end, toc: !!toc }); }

  // place a plate copy (.fx-copy wrapper) so source rect `src` lands on screen rect `dst`
  function copyGeo(src, dst, radius = 0) {
    const s = dst.w / src.w;
    return {
      x: dst.x - src.x * s, y: dst.y - src.y * s, scale: s,
      clipPath: `inset(${src.y}px ${W - src.x - src.w}px ${H - src.y - src.h}px ${src.x}px round ${radius / s}px)`,
    };
  }
  FX.faceAt = function (t) {
    const F = window.FX_FACE;
    if (!F || !F.frames || !F.frames.length) return S.face;
    const vt = t + S.plateOffset, fr = F.frames;
    if (vt <= fr[0][0]) return box(fr[0]);
    for (let i = 1; i < fr.length; i++) {
      if (fr[i][0] >= vt) {
        const a = fr[i - 1], b = fr[i], k = (vt - a[0]) / Math.max(1e-6, b[0] - a[0]);
        return { cx: a[1] + (b[1] - a[1]) * k, cy: a[2] + (b[2] - a[2]) * k, w: a[3] + (b[3] - a[3]) * k, h: a[4] + (b[4] - a[4]) * k };
      }
    }
    return box(fr[fr.length - 1]);
    function box(f) { return { cx: f[1], cy: f[2], w: f[3], h: f[4] }; }
  };

  // ---------------------------------------------------------------- icons (inline SVG)
  const I = {
    up: '<svg viewBox="0 0 24 24" width="100%" height="100%"><path d="M12 19V5M5 12l7-7 7 7" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    check: '<svg viewBox="0 0 24 24" width="100%" height="100%"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="#07111F" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    drop: '<svg viewBox="0 0 48 48" width="100%" height="100%"><path d="M24 6v24M14 21l10 10 10-10" fill="none" stroke="#35D6E6" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 32v6a4 4 0 004 4h24a4 4 0 004-4v-6" fill="none" stroke="#35D6E6" stroke-width="3.5" stroke-linecap="round"/></svg>',
    heart: '<svg viewBox="0 0 24 24" width="100%" height="100%"><path d="M12 20.5s-7.5-4.6-9.3-9.2C1.4 7.8 3.6 4.5 7 4.5c2 0 3.6 1.1 5 3 1.4-1.9 3-3 5-3 3.4 0 5.6 3.3 4.3 6.8-1.8 4.6-9.3 9.2-9.3 9.2z" fill="currentColor" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
    heartO: '<svg viewBox="0 0 24 24" width="100%" height="100%"><path d="M12 20.5s-7.5-4.6-9.3-9.2C1.4 7.8 3.6 4.5 7 4.5c2 0 3.6 1.1 5 3 1.4-1.9 3-3 5-3 3.4 0 5.6 3.3 4.3 6.8-1.8 4.6-9.3 9.2-9.3 9.2z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
    bubble: '<svg viewBox="0 0 24 24" width="100%" height="100%"><path d="M20.5 11.6a8.4 8.4 0 01-12.3 7.5L3.5 20.5l1.4-4.6a8.4 8.4 0 1115.6-4.3z" fill="none" stroke="#fff" stroke-width="1.9" stroke-linejoin="round"/></svg>',
    send: '<svg viewBox="0 0 24 24" width="100%" height="100%"><path d="M21 3L10 14M21 3l-7 18-4-7-7-4 18-7z" fill="none" stroke="#fff" stroke-width="1.9" stroke-linejoin="round"/></svg>',
    save: '<svg viewBox="0 0 24 24" width="100%" height="100%"><path d="M6 3.5h12v17l-6-4.5-6 4.5z" fill="none" stroke="#fff" stroke-width="1.9" stroke-linejoin="round"/></svg>',
    play: '<svg viewBox="0 0 24 24" width="100%" height="100%"><circle cx="12" cy="12" r="11" fill="rgba(7,17,31,.55)" stroke="#fff" stroke-width="1.4"/><path d="M10 8l6 4-6 4z" fill="#fff"/></svg>',
    chev: '<svg viewBox="0 0 24 24" width="100%" height="100%"><path d="M9.5 7l-5 5 5 5M14.5 7l5 5-5 5" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    dropper: '<svg viewBox="0 0 64 64" width="100%" height="100%"><path d="M44 6l14 14-7 7-3-3-22 22-9 3-5 5-3-3 5-5 3-9 22-22-3-3z" fill="#fff" stroke="#07111F" stroke-width="3" stroke-linejoin="round"/><path d="M14 47l3-9 6 6z" fill="#35D6E6"/></svg>',
  };
  FX.icons = I;

  // ================================================================= INIT
  FX.init = function (o = {}) {
    if (o.zone === "full") S.zone = { x: 90, w: 900 };
    else if (o.zone && typeof o.zone === "object") S.zone = o.zone;
    if (o.top != null) S.top = o.top;
    if (o.lowY != null) S.lowY = o.lowY;
    if (o.face) S.face = o.face;
    if (o.plateOffset != null) S.plateOffset = o.plateOffset;
    if (o.seed != null) S.seed = o.seed;
    if (o.sfx === false) S.sfx = false;
    const stage = q(o.stage || "#fx-stage");
    L.stage = stage;
    L.scene = q(o.scene || "#fx-scene");
    for (const k of ["under", "behind", "grade", "ui", "hud"]) {
      L[k] = q("#fx-" + k) || mk("div", "", stage, null);
      if (!L[k].id) L[k].id = "fx-" + k;
    }
    L.cutout = q("#fx-cutout");
    FX.hasCutout = !!L.cutout;
    return FX;
  };

  // ================================================================= HUD
  /** Chapter list (the "IN THIS VIDEO 01 / 18" panel). items: [{name, at, isNew}] */
  FX.toc = function (tl, o) {
    const items = o.items, x = o.x ?? 724, y = o.y ?? 210, w = o.w ?? 326;
    const from = o.from ?? 0, to = o.to;
    const wrap = mk("div", "fx-abs", L.hud, { left: 0, top: 0, width: px(W), height: px(H) });
    S.tocWrap = wrap;
    const panel = mk("div", "fx-toc", wrap, { left: px(x), top: px(y), width: px(w) });
    const head = mk("div", "fx-toc-head", panel);
    mk("span", "", head, null, o.title || "IN THIS VIDEO");
    const ctr = mk("span", "fx-tnum", head, null, "01 / " + String(items.length).padStart(2, "0"));
    const list = mk("div", "", panel, { position: "relative" });
    const hl = mk("div", "fx-toc-hl", list, { left: 0, right: 0, top: 0 });
    const rows = items.map((it, i) => {
      const r = mk("div", "fx-toc-row" + (it.isNew ? " fx-new" : ""), list);
      mk("b", "", r, null, String(i + 1).padStart(2, "0"));
      mk("span", "", r, null, it.name);
      return r;
    });
    const foot = mk("div", "fx-toc-foot", panel);
    const footSpan = mk("span", "", foot, null, o.footer || items.length + " effects");
    if (o.ticks !== false) items.forEach((it, i) => i && cue(it.at, "ui-click-soft", 0.55));
    tl.fromTo(panel, { x: 60, opacity: 0 }, { x: 0, opacity: 1, duration: 0.35, ease: "power3.out" }, from);
    let last = -2;
    const p = { v: 0 }, span = (to ?? from + 60) - from;
    tl.to(p, { v: 1, duration: span, ease: "none", onUpdate() {
      const t = from + p.v * span;
      let idx = -1;
      for (let i = 0; i < items.length; i++) if (t >= items[i].at - 0.02) idx = i;
      const cur = Math.max(0, idx), prev = Math.max(0, cur - 1);
      const k = idx < 0 ? 0 : Math.min(1, (t - items[cur].at) / 0.16);
      const ease = 1 - Math.pow(1 - k, 3);
      hl.style.transform = `translateY(${(prev + (cur - prev) * ease) * 30}px)`;
      hl.style.opacity = idx < 0 ? 0 : 1;
      if (idx !== last) {
        last = idx;
        ctr.textContent = String(cur + 1).padStart(2, "0") + " / " + String(items.length).padStart(2, "0");
        rows.forEach((r, i) => { r.style.color = i === idx ? "#fff" : i < idx ? "rgba(255,255,255,.72)" : "rgba(255,255,255,.42)"; });
      }
    } }, from);
    if (o.finaleAt != null) {
      tl.to(footSpan, { backgroundColor: C.cyan, color: C.ink, duration: 0.2, ease: "power2.out" }, o.finaleAt);
    }
    if (to != null) tl.to(panel, { x: 60, opacity: 0, duration: 0.25, ease: "power2.in" }, to - 0.25);
    return to ?? from;
  };

  /** Locked caption. segs: [{at, end, html}] (use <em> for the cyan word). */
  FX.caption = function (tl, segs, o = {}) {
    const y = o.y ?? 1270;
    const wrap = mk("div", "fx-abs", L.hud, { left: 0, top: 0, width: px(W), height: px(H) });
    S.capWrap = wrap;
    segs.forEach((sg) => {
      const el = mk("div", "fx-cap", wrap, { top: px(y), opacity: 0 }, sg.html);
      tl.fromTo(el, { opacity: 0, scale: 0.92, y: 14 }, { opacity: 1, scale: 1, y: 0, duration: 0.22, ease: "back.out(2)", immediateRender: false }, sg.at);
      tl.to(el, { opacity: 0, duration: 0.12, ease: "power1.in" }, sg.end - 0.12);
      tl.set(el, { opacity: 0 }, sg.end);
    });
  };

  /** REQUIRED last call: merges HUD dim windows so back-to-back effects don't flicker the caption. */
  FX.finalize = function (tl) {
    window.__fxCues = FX.cues();
    if (S.pending.length) {
      window.__hfTimelinesBuilding = true;
      Promise.all(S.pending).then(() => { window.__hfTimelinesBuilding = false; window.dispatchEvent(new Event("hf-timelines-built")); });
    }
    const merge = (list) => {
      const out = [];
      list.slice().sort((a, b) => a.at - b.at).forEach((d) => {
        const l = out[out.length - 1];
        if (l && d.at <= l.end + 0.25) l.end = Math.max(l.end, d.end); else out.push({ at: d.at, end: d.end });
      });
      return out;
    };
    if (S.capWrap) merge(S.dims).forEach((d) => {
      tl.to(S.capWrap, { opacity: 0, duration: 0.12, ease: "power1.in" }, d.at);
      tl.to(S.capWrap, { opacity: 1, duration: 0.18, ease: "power1.out" }, d.end - 0.04);
    });
    if (S.tocWrap) merge(S.dims.filter((d) => d.toc)).forEach((d) => {
      tl.to(S.tocWrap, { opacity: 0, duration: 0.12, ease: "power1.in" }, d.at);
      tl.to(S.tocWrap, { opacity: 1, duration: 0.18, ease: "power1.out" }, d.end - 0.04);
    });
  };

  // ================================================================= OPENER
  /** Big serif headline that shrinks into a header ("18 effects. 20 seconds.") */
  FX.opener = function (tl, at, o = {}) {
    const d = o.dur ?? 1.4, lines = o.lines || ["25 effects.", "30 seconds."];
    const r = root("ui", "opener");
    const box = mk("div", "fx-abs", r, { left: px(S.zone.x), top: px(S.top + 40), transformOrigin: "0 0" });
    const size = fitPx(lines.reduce((a, b) => (a.length > b.length ? a : b)), S.zone.w, 150, 0.42);
    const els = lines.map((t) => mk("div", "fx-serif-i fx-chrome-text", box, { fontStyle: "normal", fontSize: px(size), lineHeight: "1.02" }, t));
    life(tl, r, at, at + d, 0.05);
    els.forEach((e, i) => tl.from(e, { y: 50, opacity: 0, filter: "blur(10px)", duration: 0.4, ease: "power3.out" }, at + 0.05 + i * 0.12));
    tl.to(box, { scale: 0.42, y: -(S.top - 120), duration: 0.4, ease: "power3.inOut" }, at + d * 0.55);
    return at + d;
  };

  // ================================================================= CORE EFFECTS
  /** 01 Kinetic hook: heavy letters rise in through a mask, line by line (behind the head if a cutout exists). */
  FX.kineticHook = function (tl, at, o = {}) {
    const d = o.dur ?? 1.2, lines = o.lines || ["KINETIC", "HOOK"];
    const r = root(o.layer || "behind", "kineticHook");
    const longest = lines.reduce((a, b) => (a.length > b.length ? a : b));
    const size = o.size || fitPx(longest, S.zone.w, 220, 0.8);
    const box = mk("div", "fx-abs", r, { left: px(S.zone.x), top: px(o.y ?? S.top + 10) });
    const charEls = [];
    lines.forEach((t, li) => {
      const line = mk("div", "", box, { position: "relative", overflow: "hidden", height: px(size * 0.92), marginBottom: px(size * 0.04) });
      const bar = mk("div", "fx-abs", line, { left: 0, bottom: px(size * 0.08), height: px(size * 0.16), width: "100%",
        background: li % 2 ? C.cyan : C.magenta, transformOrigin: "0 50%", opacity: 0.9 });
      tl.fromTo(bar, { scaleX: 0 }, { scaleX: 1, duration: 0.3, ease: "power3.out" }, at + 0.08 + li * 0.14);
      const inner = mk("div", "fx-display", line, { position: "relative", fontSize: px(size) });
      charEls.push(chars(inner, t, "fx-chrome-text"));
    });
    life(tl, r, at, at + d, 0.01);
    charEls.forEach((cs, li) => tl.from(cs, { yPercent: 110, duration: 0.42, ease: "power4.out", stagger: 0.035 }, at + 0.05 + li * 0.14));
    tl.to(charEls.flat(), { yPercent: -110, duration: 0.22, ease: "power2.in", stagger: 0.012 }, at + d - 0.3);
    return at + d;
  };

  /** 02 Gravity drop: italic kicker + serif letters fall and bounce into place. */
  FX.gravityDrop = function (tl, at, o = {}) {
    const d = o.dur ?? 1.2, word = o.word || "DROP", kicker = o.kicker ?? "gravity";
    const R = nextRng();
    const r = root(o.layer || "behind", "gravityDrop");
    const box = mk("div", "fx-abs", r, { left: px(S.zone.x), top: px(o.y ?? S.top) });
    const k = mk("div", "fx-serif-i", box, { fontSize: px(72), color: C.cyan, marginLeft: px(8), textShadow: "0 0 18px rgba(53,214,230,.55)" }, kicker);
    const size = fitPx(word, S.zone.w, 280, 0.62);
    const w = mk("div", "", box, { fontFamily: "var(--fx-serif)", fontSize: px(size), lineHeight: "0.86", whiteSpace: "nowrap" });
    const cs = chars(w, word, "fx-chrome-text");
    life(tl, r, at, at + d, 0.01);
    tl.from(k, { opacity: 0, y: 20, duration: 0.25, ease: "power2.out" }, at + 0.02);
    cs.forEach((c, i) => tl.from(c, { y: -1100, rotation: (R() - 0.5) * 50, duration: 0.62, ease: "bounce.out" }, at + 0.06 + i * 0.07));
    return at + d;
  };

  /** 03 Giant captions: node-card slab with a BIG word + italic accent word. */
  FX.giantCaption = function (tl, at, o = {}) {
    const d = o.dur ?? 1.15, big = o.big || "GIANT", accent = o.accent ?? "captions.";
    const r = root(o.layer || "ui", "giantCaption");
    const size = fitPx(big, S.zone.w - 80, 150, 0.8);
    const card = mk("div", "fx-card", r, { left: px(S.zone.x), top: px(o.y ?? S.top), padding: "22px 36px 18px", transformOrigin: "0 50%" });
    const b = mk("div", "fx-display", card, { fontSize: px(size), color: "#fff" });
    const bc = chars(b, big);
    const a = mk("div", "fx-serif-i", card, { fontSize: px(Math.round(size * 0.8)), color: C.cyan, lineHeight: "1.05", marginTop: px(4) }, accent);
    life(tl, r, at, at + d, 0.01);
    tl.from(card, { scaleX: 0, duration: 0.32, ease: "power3.out" }, at + 0.02);
    tl.from(bc, { y: 40, opacity: 0, duration: 0.3, ease: "back.out(2)", stagger: 0.03 }, at + 0.14);
    tl.fromTo(a, { clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0% 0 0)", duration: 0.35, ease: "power2.out" }, at + 0.38);
    return at + d;
  };

  /** 04 Prompt bar: chat input types, sends, morphs into a done pill. */
  FX.promptBar = function (tl, at, o = {}) {
    const d = o.dur ?? 1.25, text = o.text || "prompt bar", label = o.label || "PROMPT";
    const r = root("ui", "promptBar");
    const bw = o.w ?? S.zone.w, h = 120;
    const bar = mk("div", "fx-glass", r, { left: px(S.zone.x), top: px(o.y ?? S.top), width: px(bw), height: px(h), borderRadius: px(60) });
    mk("div", "fx-pill-label fx-abs", bar, { left: px(44), top: px(16), fontSize: px(17) }, label);
    const line = mk("div", "fx-abs fx-ui-txt", bar, { left: px(44), top: px(46), fontSize: px(42), fontWeight: 500, color: "#fff", whiteSpace: "nowrap" });
    const t = mk("span", "", line);
    const car = mk("span", "", line, { display: "inline-block", width: px(4), height: px(44), background: C.cyan, marginLeft: px(4), verticalAlign: "-6px" });
    const done = mk("div", "fx-abs fx-serif-i", bar, { left: px(44), top: px(26), fontSize: px(58), color: "#fff", opacity: 0 }, text);
    const btn = mk("div", "fx-abs", bar, { right: px(20), top: px(20), width: px(80), height: px(80), borderRadius: "50%", background: C.violet, boxShadow: "0 0 24px rgba(122,77,255,.8)" });
    const up = mk("div", "fx-abs", btn, { inset: px(20) }, I.up);
    const ck = mk("div", "fx-abs", btn, { inset: px(18), opacity: 0 }, I.check);
    life(tl, r, at, at + d, 0.01);
    tl.from(bar, { y: -30, opacity: 0, scale: 0.94, duration: 0.25, ease: "power3.out" }, at);
    typeInto(tl, t, text, at + 0.16, 0.42);
    caret(tl, car, at + 0.1, 0.55);
    tl.to(btn, { scale: 0.82, duration: 0.07, ease: "power2.in", yoyo: true, repeat: 1 }, at + 0.62);
    const m = at + 0.78;
    tl.to(bar, { width: Math.round(bw * 0.72), background: "linear-gradient(120deg,#7A4DFF,#C44DF0)", borderColor: "rgba(255,255,255,.5)", duration: 0.3, ease: "power3.inOut" }, m);
    tl.to([line, bar.firstChild], { opacity: 0, duration: 0.12 }, m);
    tl.to(done, { opacity: 1, duration: 0.2 }, m + 0.12);
    tl.to(btn, { background: C.cyan, boxShadow: "0 0 26px rgba(53,214,230,.9)", duration: 0.2 }, m + 0.08);
    tl.to(up, { opacity: 0, duration: 0.1 }, m + 0.08);
    tl.fromTo(ck, { opacity: 0, scale: 0.4 }, { opacity: 1, scale: 1, duration: 0.25, ease: "back.out(3)" }, m + 0.12);
    return at + d;
  };

  /** 05 Storyboard deck: phone-shaped thumbnails deal in like cards (lower band). */
  FX.storyboardDeck = function (tl, at, o = {}) {
    const d = o.dur ?? 1.2, imgs = o.images || [];
    const R = nextRng();
    const r = root("ui", "storyboardDeck");
    const n = Math.max(1, imgs.length), gap = 18, tw = o.w ?? S.low.w;
    const cw = (tw - gap * (n - 1)) / n, ch = Math.min(cw * 16 / 9, 340);
    const x0 = S.low.x + (S.low.w - tw) / 2, y = o.y ?? S.lowY + 20;
    const cards = imgs.map((src, i) => {
      const c = mk("div", "fx-thumb", r, { left: px(x0 + i * (cw + gap)), top: px(y), width: px(cw), height: px(ch) });
      mk("img", "", c).src = src;
      return c;
    });
    life(tl, r, at, at + d, 0.01);
    cards.forEach((c, i) => {
      tl.fromTo(c, { x: 700 - i * 40, rotation: 22, opacity: 0 },
        { x: 0, rotation: (R() - 0.5) * 6, opacity: 1, duration: 0.42, ease: "power3.out" }, at + 0.04 + i * 0.07);
    });
    tl.to(cards, { y: 80, opacity: 0, duration: 0.2, ease: "power2.in", stagger: 0.025 }, at + d - 0.3);
    dimHud(at, at + d);
    return at + d;
  };

  /** 06 Icon strike: app icons pop, a red slash crosses them out, they fall away. icons: [{src,label}] */
  FX.iconStrike = function (tl, at, o = {}) {
    const d = o.dur ?? 1.25, icons = o.icons || [], word = o.word ?? "strike.";
    const R = nextRng();
    const r = root("ui", "iconStrike");
    const sz = 150, gap = 56, n = icons.length;
    const rowW = n * sz + (n - 1) * gap, x0 = S.zone.x + (S.zone.w - rowW) / 2, y = o.y ?? S.top + 20;
    const tiles = icons.map((ic, i) => {
      const g = mk("div", "fx-abs", r, { left: px(x0 + i * (sz + gap)), top: px(y), width: px(sz), height: px(sz + 44) });
      const t = mk("div", "fx-icon" + (ic.full ? " fx-full" : ""), g, { left: 0, top: 0, background: ic.bg || "#fff" });
      mk("img", "", t).src = ic.src;
      mk("div", "fx-icon-label", g, { left: px(-25), top: px(sz + 8) }, ic.label || "");
      return g;
    });
    const svg = mk("div", "fx-abs", r, { left: px(x0 - 30), top: px(y - 20), width: px(rowW + 60), height: px(sz + 40) },
      `<svg width="100%" height="100%" viewBox="0 0 ${rowW + 60} ${sz + 40}" preserveAspectRatio="none"><path pathLength="100" d="M6 ${sz + 30} L${rowW + 54} 10" stroke="${C.red}" stroke-width="16" stroke-linecap="round" fill="none" style="filter:drop-shadow(0 0 10px rgba(255,59,78,.9))" stroke-dasharray="100" stroke-dashoffset="100"/></svg>`);
    const path = svg.querySelector("path");
    const wd = mk("div", "fx-abs fx-serif-i", r, { left: px(S.zone.x), top: px(y + 20), width: px(S.zone.w), textAlign: "center", fontSize: px(130), color: "#fff", textShadow: "0 0 22px rgba(122,77,255,.8)" }, word);
    life(tl, r, at, at + d, 0.01);
    tiles.forEach((tile, i) => tl.from(tile, { scale: 0, opacity: 0, duration: 0.3, ease: "back.out(2.2)" }, at + 0.03 + i * 0.08));
    tl.to(path, { attr: { "stroke-dashoffset": 0 }, duration: 0.2, ease: "power2.out" }, at + 0.4);
    tl.to(tiles, { y: 1500, rotation: () => (R() - 0.5) * 70, duration: 0.5, ease: "power2.in", stagger: 0.05 }, at + 0.68);
    tl.to(svg, { y: 1400, rotation: 12, duration: 0.5, ease: "power2.in" }, at + 0.7);
    tl.from(wd, { opacity: 0, y: 40, filter: "blur(10px)", duration: 0.3, ease: "power3.out" }, at + 0.8);
    return at + d;
  };

  /** 07 File drop: drop zone > file chip > a live preview of the take grows into the real frame.
      Needs a plate copy (o.copy, e.g. "#fx-copy-1") for the live preview. */
  FX.fileDrop = function (tl, at, o = {}) {
    const d = o.dur ?? 1.4, copy = q(o.copy || "#fx-copy-1");
    const r = root("ui", "fileDrop");
    const cx = S.zone.x, cy = o.y ?? S.top, cw = S.zone.w, ch = 470;
    const card = mk("div", "fx-glass", r, { left: px(cx), top: px(cy), width: px(cw), height: px(ch) });
    mk("div", "fx-abs", card, { inset: px(18), border: "3px dashed rgba(53,214,230,.75)", borderRadius: px(20) });
    const hint = mk("div", "fx-abs", card, { left: 0, right: 0, top: px(150), textAlign: "center" });
    mk("div", "", hint, { width: px(84), height: px(84), margin: "0 auto 18px" }, I.drop);
    mk("div", "fx-ui-txt", hint, { fontSize: px(36), fontWeight: 700, color: "#fff" }, o.hint || "Drop raw footage");
    const chip = mk("div", "fx-card", r, { left: px(cx + 40), top: px(cy + ch / 2 - 70), width: px(cw - 80), height: px(140), display: "flex", alignItems: "center", gap: "22px", padding: "0 22px" });
    const th = mk("div", "", chip, { width: px(64), height: px(108), borderRadius: px(10), background: "linear-gradient(160deg,#35D6E6,#7A4DFF)", flex: "none", overflow: "hidden" });
    if (o.thumb) { const im = mk("img", "", th, { width: "100%", height: "100%", objectFit: "cover" }); im.src = o.thumb; }
    const meta = mk("div", "", chip, { minWidth: 0 });
    mk("div", "fx-mono", meta, { fontSize: px(24), color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }, o.filename || "D81E379D-F82D-4071.MP4");
    mk("div", "fx-mono", meta, { fontSize: px(18), color: C.lavHi, marginTop: px(6) }, o.fileMeta || "0:21 · 182 MB · 1080×1920");
    const pill = mk("div", "fx-abs fx-ui-txt", r, { left: px(cx), width: px(cw), top: px(cy + ch + 22), textAlign: "center" });
    const pin = mk("span", "", pill, { display: "inline-block", padding: "10px 22px", borderRadius: px(16), background: "rgba(7,17,31,.85)", border: "2px solid rgba(53,214,230,.7)", fontSize: px(30), fontWeight: 800, color: "#fff" }, `<span style="color:${C.cyan}">${o.duration || "0:21"}</span> ${o.label || "of raw footage"}`);
    life(tl, r, at, at + d, 0.01);
    tl.from(card, { scale: 0.9, opacity: 0, duration: 0.25, ease: "power3.out" }, at);
    tl.from(chip, { x: -620, opacity: 0, duration: 0.3, ease: "power3.out" }, at + 0.26);
    tl.to(hint, { opacity: 0, duration: 0.12 }, at + 0.3);
    const g = at + 0.6;
    tl.to(chip, { scale: 0.7, opacity: 0, duration: 0.18, ease: "power2.in" }, g);
    if (copy) {
      const s = (ch - 40) / H, dw = W * s, dst = { x: cx + (cw - dw) / 2, y: cy + 20, w: dw, h: H * s };
      tl.set(copy, Object.assign({ zIndex: 21, opacity: 0 }, copyGeo({ x: 0, y: 0, w: W, h: H }, dst, 22)), g);
      tl.to(copy, { opacity: 1, duration: 0.15 }, g + 0.05);
      tl.from(pin, { y: 20, opacity: 0, duration: 0.22, ease: "back.out(2)" }, g + 0.12);
      tl.to(copy, { x: 0, y: 0, scale: 1, clipPath: `inset(0px 0px 0px 0px round 0px)`, duration: 0.42, ease: "power3.inOut" }, at + d - 0.55);
      tl.to(card, { opacity: 0, duration: 0.15 }, at + d - 0.55);
      tl.to(copy, { opacity: 0, duration: 0.1 }, at + d - 0.11);
      tl.set(copy, { zIndex: 3, x: 0, y: 0, scale: 1, clipPath: "none", opacity: 0 }, at + d);
    } else tl.from(pin, { y: 20, opacity: 0, duration: 0.22, ease: "back.out(2)" }, g + 0.12);
    return at + d;
  };

  /** 08 NLE timeline: a fake editor timeline builds left to right while the playhead sweeps (lower band). */
  FX.nleTimeline = function (tl, at, o = {}) {
    const d = o.dur ?? 1.25, R = nextRng();
    const r = root("ui", "nleTimeline");
    const x = S.low.x, y = o.y ?? S.lowY, w = S.low.w, h = 340;
    const p = mk("div", "fx-glass", r, { left: px(x), top: px(y), width: px(w), height: px(h), borderRadius: px(22), overflow: "hidden" });
    const hdr = mk("div", "fx-abs", p, { left: px(24), right: px(24), top: px(14), height: px(36), display: "flex", alignItems: "center", gap: "20px" });
    mk("div", "fx-ui-txt", hdr, { fontSize: px(24), fontWeight: 700, color: "#fff" }, o.title || "Timeline");
    const tc = mk("div", "fx-mono fx-tnum", hdr, { fontSize: px(24), color: C.cyan, marginLeft: "auto" });
    mk("div", "fx-mono", hdr, { fontSize: px(22), color: C.lavHi }, "◀◀ ▶ ▶▶");
    const tx = 90, tw = w - tx - 24, rowsY = [96, 150, 204, 258], labels = ["V2", "C1", "V1", "A1"];
    for (let i = 0; i <= 8; i++) mk("div", "fx-abs fx-mono", p, { left: px(tx + (tw / 8) * i), top: px(62), fontSize: px(13), color: "rgba(185,178,200,.6)" }, "00:" + String(i * 3).padStart(2, "0"));
    labels.forEach((l, i) => mk("div", "fx-abs fx-mono", p, { left: px(28), top: px(rowsY[i] + 12), fontSize: px(18), color: C.lavHi }, l));
    const blocks = [];
    const title = mk("div", "fx-abs", p, { left: px(tx + tw * 0.28), top: px(rowsY[0]), width: px(tw * 0.3), height: px(44), borderRadius: px(8), background: "linear-gradient(90deg,#C44DF0,#7A4DFF)", transformOrigin: "0 50%" });
    mk("div", "fx-abs fx-mono", title, { left: px(10), top: px(11), fontSize: px(16), color: "#fff" }, "TITLE · kinetic");
    const words = ["the", "AI", "edit", "this", "whole", "video", "for", "me", "in", "one", "shot", "no", "editor", "at", "all", "ever"];
    let cxp = 0, wi = 0;
    while (cxp < tw - 20) {
      const bw = 44 + Math.floor(R() * 40);
      const b = mk("div", "fx-abs fx-mono", p, { left: px(tx + cxp), top: px(rowsY[1]), width: px(Math.min(bw, tw - cxp)), height: px(44), borderRadius: px(7), background: "rgba(122,77,255,.55)", border: "1px solid rgba(122,77,255,.9)", fontSize: px(14), color: "#fff", padding: "13px 6px", overflow: "hidden", whiteSpace: "nowrap", transformOrigin: "0 50%" }, words[wi++ % words.length]);
      blocks.push(b); cxp += bw + 5;
    }
    let vx = 0;
    while (vx < tw - 10) {
      const bw = 120 + Math.floor(R() * 160);
      blocks.push(mk("div", "fx-abs", p, { left: px(tx + vx), top: px(rowsY[2]), width: px(Math.min(bw, tw - vx)), height: px(44), borderRadius: px(7), background: "repeating-linear-gradient(135deg,rgba(53,214,230,.35) 0 10px,rgba(53,214,230,.18) 10px 20px)", border: "1px solid rgba(53,214,230,.8)", transformOrigin: "0 50%" }));
      vx += bw + 4;
    }
    const wave = mk("div", "fx-abs", p, { left: px(tx), top: px(rowsY[3]), width: px(tw), height: px(54), display: "flex", alignItems: "center", gap: "3px", overflow: "hidden" });
    const bars = [];
    for (let i = 0; i < tw / 6; i++) bars.push(mk("i", "", wave, { display: "block", width: px(3), height: px(6 + Math.pow(R(), 1.6) * 46), background: C.cyan, borderRadius: px(2), opacity: 0.85, flex: "none" }));
    const ph = mk("div", "fx-abs", p, { left: px(tx), top: px(56), width: px(3), height: px(h - 66), background: C.magenta, boxShadow: "0 0 12px rgba(196,77,240,.9)" });
    mk("div", "fx-abs", ph, { left: px(-9), top: px(-6), width: 0, height: 0, borderLeft: "10px solid transparent", borderRight: "10px solid transparent", borderTop: `14px solid ${C.magenta}` });
    life(tl, r, at, at + d, 0.01);
    tl.from(p, { y: 60, opacity: 0, duration: 0.25, ease: "power3.out" }, at);
    tl.from(blocks, { scaleX: 0, duration: 0.18, ease: "power2.out", stagger: 0.012 }, at + 0.1);
    tl.from(bars, { scaleY: 0, duration: 0.15, ease: "power2.out", stagger: 0.0025 }, at + 0.12);
    tl.from(title, { scaleX: 0, opacity: 0, duration: 0.22, ease: "back.out(1.6)" }, at + 0.55);
    tl.fromTo(ph, { x: 0 }, { x: tw * 0.92, duration: d - 0.2, ease: "none" }, at + 0.1);
    counter(tl, tc, 4 * 30 + 12, 9 * 30 + 3, at + 0.1, d - 0.2, (f) => { f = Math.round(f); return "00:00:" + String(Math.floor(f / 30)).padStart(2, "0") + ":" + String(f % 30).padStart(2, "0"); }, "none");
    dimHud(at, at + d);
    return at + d;
  };

  /** 09 Jiggle delete: iOS edit-mode tray, icons wobble, minus badges pop, icons vanish (lower band). icons: [{src,label,bg}] */
  FX.jiggleDelete = function (tl, at, o = {}) {
    const d = o.dur ?? 1.15, icons = o.icons || [];
    const R = nextRng();
    const r = root("ui", "jiggleDelete");
    const x = S.low.x, y = o.y ?? S.lowY, w = S.low.w, h = 300;
    const tray = mk("div", "fx-glass", r, { left: px(x), top: px(y), width: px(w), height: px(h), borderRadius: px(30) });
    mk("div", "fx-pill-label fx-abs", tray, { left: px(30), top: px(20) }, o.label || "EDIT HOME SCREEN");
    mk("div", "fx-abs fx-ui-txt", tray, { right: px(30), top: px(14), fontSize: px(26), fontWeight: 700, color: C.cyan }, "Done");
    const n = icons.length, sz = 140, gap = (w - 60 - n * sz) / Math.max(1, n - 1);
    const outers = [];
    icons.forEach((ic, i) => {
      const outer = mk("div", "fx-abs", tray, { left: px(30 + i * (sz + gap)), top: px(78), width: px(sz), height: px(sz + 50) });
      const inner = mk("div", "fx-abs", outer, { inset: 0 });
      const t = mk("div", "fx-icon" + (ic.full ? " fx-full" : ""), inner, { width: px(sz), height: px(sz), background: ic.bg || "#fff" });
      mk("img", "", t).src = ic.src;
      mk("div", "fx-icon-label", inner, { left: px(-30), top: px(sz + 8), fontSize: px(22) }, ic.label || "");
      const badge = mk("div", "fx-abs", inner, { left: px(-12), top: px(-12), width: px(42), height: px(42), borderRadius: "50%", background: "#3d3a49", border: "2px solid rgba(255,255,255,.6)" });
      mk("div", "fx-abs", badge, { left: px(10), top: px(18), width: px(18), height: px(4), background: "#fff", borderRadius: px(2) });
      const del = at + 0.5 + i * 0.09, jig = del - (at + 0.08);
      tl.fromTo(inner, { rotation: -3 }, { rotation: 3, duration: 0.07, ease: "sine.inOut", yoyo: true, repeat: Math.max(1, Math.floor(jig / 0.07) | 1) }, at + 0.08 + R() * 0.04);
      tl.from(badge, { scale: 0, duration: 0.18, ease: "back.out(3)" }, at + 0.14 + i * 0.03);
      tl.to(outer, { scale: 0, rotation: 25, opacity: 0, duration: 0.2, ease: "back.in(2)" }, del);
      outers.push(outer);
    });
    life(tl, r, at, at + d, 0.01);
    tl.from(tray, { y: 60, opacity: 0, duration: 0.25, ease: "power3.out" }, at);
    tl.to(tray, { scaleY: 0.4, opacity: 0, duration: 0.2, ease: "power2.in" }, at + d - 0.22);
    dimHud(at, at + d);
    return at + d;
  };

  /** 10 Grade slider: before/after wipe with a handle. Pure overlay (backdrop-filter), no copy needed. */
  FX.gradeSlider = function (tl, at, o = {}) {
    const d = o.dur ?? 1.2, after = o.after || "contrast(1.14) saturate(1.45) brightness(1.07) hue-rotate(-8deg)";
    const r = root("grade", "gradeSlider");
    const ov = mk("div", "fx-abs", r, { inset: 0, backdropFilter: after, webkitBackdropFilter: after, clipPath: "inset(0% 0% 0% 100%)" });
    mk("div", "fx-abs", ov, { inset: 0, background: o.tint || "rgba(122,77,255,.06)", mixBlendMode: "screen" });
    const ui = root("ui", "gradeSliderUI");
    const hy = o.handleY ?? 1060;
    const line = mk("div", "fx-abs", ui, { left: 0, top: 0, width: px(4), height: px(H), marginLeft: px(-2), background: "#fff", boxShadow: "0 0 18px rgba(255,255,255,.8)" });
    const knob = mk("div", "fx-abs", line, { left: px(-40), top: px(hy - 42), width: px(84), height: px(84), borderRadius: "50%", background: C.violet, border: "3px solid #fff", boxShadow: "0 0 26px rgba(122,77,255,.9)", padding: px(18) }, I.chev);
    const tagCss = { top: px(hy - 22), padding: "6px 14px", borderRadius: px(8), background: "rgba(7,17,31,.75)", fontSize: px(20), color: "#fff", letterSpacing: ".2em" };
    mk("div", "fx-abs fx-mono", line, Object.assign({ right: px(56) }, tagCss), "BEFORE");
    mk("div", "fx-abs fx-mono", line, Object.assign({ left: px(60), color: C.cyan }, tagCss), "AFTER");
    life(tl, r, at, at + d, 0.01, 0.12);
    life(tl, ui, at, at + d - 0.15, 0.08, 0.12);
    const pos = [0.94, 0.52, 0.04];
    tl.fromTo(ov, { clipPath: `inset(0% 0% 0% ${pos[0] * 100}%)` }, { clipPath: `inset(0% 0% 0% ${pos[1] * 100}%)`, duration: 0.36, ease: "power2.out" }, at + 0.05);
    tl.fromTo(line, { x: W * pos[0] }, { x: W * pos[1], duration: 0.36, ease: "power2.out" }, at + 0.05);
    tl.to(ov, { clipPath: `inset(0% 0% 0% ${pos[2] * 100}%)`, duration: 0.34, ease: "power2.inOut" }, at + 0.62);
    tl.to(line, { x: W * pos[2], duration: 0.34, ease: "power2.inOut" }, at + 0.62);
    return at + d;
  };

  /** 11 Eyedropper grade: cursor samples the frame, swatches pop with hex codes, the whole frame regrades. */
  FX.eyedropperGrade = function (tl, at, o = {}) {
    const d = o.dur ?? 1.3, hexes = o.hexes || ["#0F1219", "#3B3F4A", "#8A7F78", "#C9B7A6", "#E9E4DE"];
    const grade = o.grade || "saturate(.45) contrast(1.16) brightness(.95)";
    const f = FX.faceAt(at + 0.4), pt = o.point || { x: f.cx - f.w * 0.12, y: f.cy - f.h * 0.05 };
    const g = root("grade", "eyedropperGrade");
    const ov = mk("div", "fx-abs", g, { inset: 0, backdropFilter: grade, webkitBackdropFilter: grade, opacity: 0 });
    mk("div", "fx-abs", ov, { inset: 0, background: o.tint || "#35D6E6", mixBlendMode: "color", opacity: 0.14 });
    const r = root("ui", "eyedropperUI");
    const cur = mk("div", "fx-abs", r, { left: px(pt.x - 6), top: px(pt.y - 84), width: px(90), height: px(90) }, I.dropper);
    const ring = mk("div", "fx-abs", r, { left: px(pt.x - 50), top: px(pt.y - 50), width: px(100), height: px(100), borderRadius: "50%", border: `4px solid ${C.cyan}`, opacity: 0 });
    const bar = mk("div", "fx-glass", r, { left: px(S.low.x), top: px(o.y ?? S.lowY + 40), width: px(S.low.w), height: px(150), display: "flex", alignItems: "center", gap: "22px", padding: "0 28px" });
    const sw = hexes.map((hx) => {
      const c = mk("div", "", bar, { display: "flex", alignItems: "center", gap: "12px", flex: "1" });
      mk("div", "", c, { width: px(62), height: px(62), borderRadius: px(14), background: hx, border: "2px solid rgba(255,255,255,.55)", flex: "none" });
      mk("div", "fx-mono", c, { fontSize: px(19), color: "#fff" }, hx.toUpperCase());
      return c;
    });
    life(tl, g, at, at + d, 0.01, 0.15);
    life(tl, r, at, at + d, 0.01);
    tl.from(cur, { x: 360, y: 420, rotation: 25, duration: 0.4, ease: "power2.inOut" }, at);
    tl.fromTo(ring, { scale: 0.3, opacity: 1 }, { scale: 1.3, opacity: 0, duration: 0.35, ease: "power2.out" }, at + 0.4);
    tl.to(cur, { scale: 0.86, duration: 0.06, yoyo: true, repeat: 1 }, at + 0.38);
    tl.from(bar, { y: 40, opacity: 0, duration: 0.22, ease: "power3.out" }, at + 0.4);
    tl.from(sw, { scale: 0.4, opacity: 0, duration: 0.2, ease: "back.out(2.5)", stagger: 0.06 }, at + 0.48);
    tl.to(ov, { opacity: 1, duration: 0.3, ease: "power2.inOut" }, at + 0.72);
    dimHud(at + 0.35, at + d);
    return at + d;
  };

  /** 12 Film look: light-leak flash, warm crushed grade, vignette, grain, letterbox. */
  FX.filmLook = function (tl, at, o = {}) {
    const d = o.dur ?? 1.15, R = nextRng();
    const grade = o.grade || "sepia(.42) contrast(1.2) saturate(1.18) brightness(.93)";
    const r = root("grade", "filmLook");
    const ov = mk("div", "fx-abs", r, { inset: 0, backdropFilter: grade, webkitBackdropFilter: grade });
    const vig = mk("div", "fx-abs", r, { inset: 0, background: "radial-gradient(ellipse 70% 60% at 50% 45%, rgba(0,0,0,0) 40%, rgba(0,0,0,.78) 100%)" });
    const grain = mk("div", "fx-abs", r, { inset: px(-60), opacity: 0.2, mixBlendMode: "overlay",
      backgroundImage: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")" });
    const lbT = mk("div", "fx-abs", r, { left: 0, top: 0, width: px(W), height: px(120), background: "#000", transformOrigin: "50% 0" });
    const lbB = mk("div", "fx-abs", r, { left: 0, bottom: 0, width: px(W), height: px(120), background: "#000", transformOrigin: "50% 100%" });
    const flash = mk("div", "fx-abs", r, { left: 0, top: 0, width: px(W), height: px(10), background: "#FFF3DA", boxShadow: "0 0 40px 18px rgba(255,214,160,.85)" });
    life(tl, r, at, at + d, 0.01, 0.15);
    tl.fromTo(flash, { y: -40 }, { y: H + 40, duration: 0.24, ease: "power1.in" }, at);
    tl.from([ov, vig], { opacity: 0, duration: 0.14 }, at + 0.1);
    tl.from([lbT, lbB], { scaleY: 0, duration: 0.25, ease: "power3.out" }, at + 0.12);
    for (let t = 0; t < d; t += 0.066) tl.set(grain, { x: Math.round((R() - 0.5) * 60), y: Math.round((R() - 0.5) * 60) }, at + t);
    return at + d;
  };

  /** 13 Title card: full-frame timecode + serif title, the take shrinks into a phone with a scrub bar, then expands back. */
  FX.titleCard = function (tl, at, o = {}) {
    const d = o.dur ?? 1.5, lines = o.lines || ["TITLE", "CARD"];
    const u = root("under", "titleCard");
    u.style.background = "#000";
    mk("div", "fx-abs", u, { inset: 0, backgroundImage: "linear-gradient(rgba(122,77,255,.08) 1px,transparent 1px),linear-gradient(90deg,rgba(122,77,255,.08) 1px,transparent 1px)", backgroundSize: "90px 90px" });
    mk("div", "fx-abs", u, { inset: 0, background: "radial-gradient(ellipse at 50% 45%, rgba(122,77,255,.22), rgba(0,0,0,0) 60%)" });
    const zc = S.zone.x + S.zone.w / 2;
    const tbox = mk("div", "fx-abs", u, { left: px(S.zone.x), width: px(S.zone.w), top: px(600), textAlign: "center" });
    const tc = mk("div", "fx-mono fx-tnum", tbox, { fontSize: px(32), color: C.cyan, letterSpacing: ".22em", marginBottom: px(26) });
    const size = fitPx(lines.reduce((a, b) => (a.length > b.length ? a : b)), S.zone.w, 210, 0.6);
    const lineEls = lines.map((t) => chars(mk("div", "", tbox, { fontFamily: "var(--fx-serif)", fontSize: px(size), lineHeight: "0.95" }), t, "fx-chrome-text"));
    const ul = mk("div", "", tbox, { width: px(160), height: px(4), margin: "26px auto 0", background: C.violet, boxShadow: "0 0 14px rgba(122,77,255,.9)", transformOrigin: "50% 50%" });
    // phone bezel + scrub bar (ui layer, transparent inside)
    const s = o.phoneScale ?? 0.56, pw = W * s, ph = H * s, pl = zc - pw / 2, pt = 960 - ph / 2;
    const ui = root("ui", "titleCardPhone");
    const bez = mk("div", "fx-abs", ui, { left: px(pl - 14), top: px(pt - 14), width: px(pw + 28), height: px(ph + 28), borderRadius: px(64), border: "14px solid #E9E5F2", boxShadow: "0 0 0 2px rgba(122,77,255,.8), 0 0 60px rgba(122,77,255,.55)" });
    const scrub = mk("div", "fx-abs", ui, { left: px(pl + 26), top: px(pt + ph - 110), width: px(pw - 52), height: px(84), borderRadius: px(18), background: "rgba(7,17,31,.72)" });
    const st = mk("div", "fx-abs fx-mono fx-tnum", scrub, { left: px(20), top: px(12), fontSize: px(22), color: "#fff" });
    const track = mk("div", "fx-abs", scrub, { left: px(20), right: px(20), top: px(56), height: px(6), borderRadius: px(3), background: "rgba(255,255,255,.25)" });
    const fill = mk("div", "fx-abs", track, { left: 0, top: 0, bottom: 0, width: "100%", background: C.cyan, transformOrigin: "0 50%", borderRadius: px(3) });
    life(tl, u, at, at + d, 0.01, 0.1);
    const tc0 = Math.round((o.tcFrom ?? 14) * 30);
    counter(tl, tc, tc0, tc0 + Math.round(d * 30), at, d, (f) => { f = Math.round(f); return "00:00:" + String(Math.floor(f / 30)).padStart(2, "0") + ":" + String(f % 30).padStart(2, "0"); }, "none");
    const sc = L.scene;
    tl.to(sc, { opacity: 0, duration: 0.14, ease: "power1.in" }, at);
    lineEls.forEach((cs, i) => tl.from(cs, { opacity: 0, y: 30, duration: 0.25, ease: "power3.out", stagger: 0.035 }, at + 0.1 + i * 0.12));
    tl.from(ul, { scaleX: 0, duration: 0.3, ease: "power3.out" }, at + 0.35);
    const p2 = at + d * 0.42;
    tl.to(tbox, { y: -80, opacity: 0, duration: 0.18, ease: "power2.in" }, p2 - 0.05);
    tl.set(sc, { x: zc - 540, scale: s * 0.9, borderRadius: 50 / s }, p2);
    tl.to(sc, { opacity: 1, scale: s, duration: 0.3, ease: "back.out(1.6)" }, p2);
    life(tl, ui, p2, at + d - 0.32, 0.12, 0.08);
    tl.from(bez, { scale: 0.9, duration: 0.3, ease: "back.out(1.6)" }, p2);
    counter(tl, st, 15, 18, p2, d * 0.45, (v) => "0:" + String(Math.round(v)).padStart(2, "0") + " / 0:21", "none");
    tl.fromTo(fill, { scaleX: 0.68 }, { scaleX: 0.86, duration: d * 0.45, ease: "none" }, p2);
    tl.to(sc, { x: 0, scale: 1, borderRadius: 0, duration: 0.32, ease: "power3.inOut" }, at + d - 0.34);
    tl.set(sc, { clearProps: "borderRadius" }, at + d);
    dimHud(at, at + d);
    return at + d;
  };

  /** 14 Playing grid: a wall of thumbnails flips in (behind the head when a cutout exists). */
  FX.playingGrid = function (tl, at, o = {}) {
    const d = o.dur ?? 1.15, imgs = o.images || [];
    const R = nextRng();
    const r = root(o.layer || "behind", "playingGrid");
    const rows = o.rows ?? (FX.hasCutout ? 2 : 1), cols = Math.ceil(imgs.length / rows);
    const gw = o.w ?? 960, gap = 24, cw = (gw - gap * (cols - 1)) / cols, ch = cw * 1.42;
    const x0 = o.x ?? 60, y0 = o.y ?? (rows === 1 ? 150 : 130);
    const cards = imgs.map((src, i) => {
      const c = mk("div", "fx-thumb", r, { left: px(x0 + (i % cols) * (cw + gap)), top: px(y0 + Math.floor(i / cols) * (ch + gap)), width: px(cw), height: px(ch), border: "3px solid rgba(122,77,255,.9)" });
      mk("img", "", c).src = src;
      return c;
    });
    life(tl, r, at, at + d, 0.01);
    cards.forEach((c, i) => tl.fromTo(c, { rotationY: -100, scale: 0.6, opacity: 0, transformPerspective: 900 },
      { rotationY: 0, scale: 1, rotation: (R() - 0.5) * 8, opacity: 1, duration: 0.42, ease: "back.out(1.4)" }, at + 0.03 + i * 0.06));
    tl.to(cards, { rotationY: 90, opacity: 0, duration: 0.2, ease: "power2.in", stagger: 0.02 }, at + d - 0.32);
    return at + d;
  };

  /** 15 Reel feed: vertical motion-blur whip into a full-screen reel (image) and back. */
  FX.reelFeed = function (tl, at, o = {}) {
    const d = o.dur ?? 1.0, sc = L.scene;
    const r = root("ui", "reelFeed");
    const panel = mk("div", "fx-abs", r, { left: 0, top: 0, width: px(W), height: px(H), background: "#000", overflow: "hidden" });
    const im = mk("img", "", panel, { position: "absolute", inset: 0, width: px(W), height: px(H), objectFit: "cover" }); im.src = o.src || "";
    mk("div", "fx-abs", panel, { left: 0, right: 0, bottom: 0, height: px(700), background: "linear-gradient(0deg, rgba(0,0,0,.75), rgba(0,0,0,0))" });
    const rail = mk("div", "fx-abs", panel, { right: px(34), top: px(1060), width: px(80), display: "flex", flexDirection: "column", alignItems: "center", gap: "34px" });
    [[I.heart, o.likes || "24.1K", "#fff"], [I.bubble, o.comments || "3,094"], [I.send, o.shares || "1,210"], [I.save, o.saves || "8,866"]].forEach(([ic, n, col]) => {
      const c = mk("div", "", rail, { textAlign: "center", color: col || "#fff" });
      mk("div", "", c, { width: px(62), height: px(62), margin: "0 auto", color: "#fff" }, ic);
      mk("div", "fx-ui-txt", c, { fontSize: px(22), fontWeight: 600, marginTop: px(6), color: "#fff" }, n);
    });
    const who = mk("div", "fx-abs", panel, { left: px(36), bottom: px(250), display: "flex", alignItems: "center", gap: "16px" });
    mk("div", "", who, { width: px(64), height: px(64), borderRadius: "50%", background: "linear-gradient(140deg,#7A4DFF,#35D6E6)", border: "3px solid #fff" });
    mk("div", "fx-ui-txt", who, { fontSize: px(30), fontWeight: 700, color: "#fff" }, o.handle || "your_handle");
    mk("div", "fx-ui-txt", who, { fontSize: px(24), fontWeight: 600, color: "#fff", border: "2px solid rgba(255,255,255,.8)", borderRadius: px(10), padding: "4px 14px" }, "Follow");
    mk("div", "fx-abs fx-ui-txt", panel, { left: px(36), right: px(160), bottom: px(190), fontSize: px(26), color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }, o.caption || "");
    life(tl, r, at, at + d, 0.02, 0.02);
    tl.fromTo(sc, { y: 0, filter: "blur(0px)" }, { y: -760, filter: "blur(26px)", duration: 0.22, ease: "power2.in", immediateRender: false }, at);
    tl.fromTo(panel, { y: H, filter: "blur(30px)" }, { y: 0, filter: "blur(0px)", duration: 0.3, ease: "power3.out" }, at + 0.06);
    tl.to(panel, { y: H, filter: "blur(24px)", duration: 0.22, ease: "power2.in" }, at + d - 0.36);
    tl.fromTo(sc, { y: -760, filter: "blur(26px)" }, { y: 0, filter: "blur(0px)", duration: 0.28, ease: "power3.out", immediateRender: false }, at + d - 0.3);
    tl.set(sc, { clearProps: "filter" }, at + d);
    dimHud(at, at + d);
    return at + d;
  };

  /** 16 Video card: titled card with the live take playing inside, subtitle steps raw > finished.
      Needs a plate copy (o.copy). o.src = region of the take to show (16:9). */
  FX.videoCard = function (tl, at, o = {}) {
    const d = o.dur ?? 1.3, copy = q(o.copy || "#fx-copy-1");
    const subs = o.subs || ["The raw take", "The finished reel"];
    const f = FX.faceAt(at);
    const r = root("ui", "videoCard");
    const cx = S.zone.x, cy = o.y ?? S.top, cw = S.zone.w, mh = Math.round(cw * 9 / 16);
    const card = mk("div", "fx-card", r, { left: px(cx), top: px(cy), width: px(cw), height: px(mh + 150) });
    const media = { x: cx + 2, y: cy + 2, w: cw - 4, h: mh };
    const prog = mk("div", "fx-abs", card, { left: 0, top: px(mh - 4), width: "100%", height: px(6), background: "rgba(255,255,255,.2)" });
    const pf = mk("div", "fx-abs", prog, { inset: 0, background: C.cyan, transformOrigin: "0 50%" });
    mk("div", "fx-abs", card, { left: px(30), top: px(mh + 18), fontFamily: "var(--fx-serif)", fontSize: px(58), color: "#fff", whiteSpace: "nowrap" }, o.title || "Video card");
    const s1 = mk("div", "fx-abs fx-mono", card, { left: px(32), top: px(mh + 96), fontSize: px(22), color: C.cyan }, "01 · " + subs[0]);
    const s2 = mk("div", "fx-abs fx-mono", card, { left: px(32), top: px(mh + 96), fontSize: px(22), color: C.magenta, opacity: 0 }, "02 · " + subs[1]);
    const play = mk("div", "fx-abs", r, { left: px(cx + cw / 2 - 50), top: px(cy + mh / 2 - 50), width: px(100), height: px(100), zIndex: 2 }, I.play);
    life(tl, r, at, at + d, 0.01);
    tl.from(card, { y: -40, opacity: 0, scale: 0.95, duration: 0.28, ease: "power3.out" }, at);
    if (copy) {
      const sw = Math.min(W, f.h * 2.0 * 16 / 9), sh = sw * 9 / 16, src = o.src || { x: Math.max(0, Math.min(W - sw, f.cx - sw / 2)), y: Math.max(0, f.cy - sh * 0.45), w: sw, h: sh };
      tl.set(copy, Object.assign({ zIndex: 21, opacity: 0, filter: "none" }, copyGeo(src, media, 26)), at);
      tl.to(copy, { opacity: 1, duration: 0.2 }, at + 0.06);
      tl.set(copy, { filter: "contrast(1.14) saturate(1.4) brightness(1.06)" }, at + d * 0.55);
      tl.to(copy, { opacity: 0, duration: 0.14 }, at + d - 0.16);
      tl.set(copy, { zIndex: 3, x: 0, y: 0, scale: 1, clipPath: "none", filter: "none", opacity: 0 }, at + d);
    }
    tl.to(play, { scale: 1.3, opacity: 0, duration: 0.2, ease: "power2.in" }, at + 0.3);
    tl.fromTo(pf, { scaleX: 0.05 }, { scaleX: 0.95, duration: d - 0.3, ease: "none" }, at + 0.2);
    tl.to(s1, { opacity: 0, y: -12, duration: 0.14 }, at + d * 0.55);
    tl.fromTo(s2, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.18 }, at + d * 0.55 + 0.06);
    return at + d;
  };

  /** 17 Comment CTA: comment box types the keyword, posts, gets a heart, reply drops in. */
  FX.commentCTA = function (tl, at, o = {}) {
    const d = o.dur ?? 1.6, kw = o.keyword || "KEYWORD";
    const r = root("ui", "commentCTA");
    const x = S.zone.x, y = o.y ?? S.top, w = S.zone.w;
    const inp = mk("div", "fx-glass", r, { left: px(x), top: px(y), width: px(w), height: px(100), borderRadius: px(50), display: "flex", alignItems: "center", gap: "18px", padding: "0 18px" });
    mk("div", "", inp, { width: px(62), height: px(62), borderRadius: "50%", background: "linear-gradient(140deg,#8D869A,#3b3848)", flex: "none" });
    const ph = mk("div", "fx-ui-txt", inp, { fontSize: px(30), color: C.lavHi }, "Add a comment…");
    const ty = mk("div", "fx-ui-txt", inp, { fontSize: px(38), fontWeight: 800, color: "#fff", position: "absolute", left: px(98) });
    const btn = mk("div", "", inp, { marginLeft: "auto", width: px(64), height: px(64), borderRadius: "50%", background: C.violet, padding: px(16), flex: "none" }, I.up);
    const bub = mk("div", "fx-glass", r, { left: px(x), top: px(y), width: px(w), height: px(118), display: "flex", alignItems: "center", gap: "18px", padding: "0 24px" });
    mk("div", "", bub, { width: px(62), height: px(62), borderRadius: "50%", background: "linear-gradient(140deg,#8D869A,#3b3848)", flex: "none" });
    const bt = mk("div", "", bub);
    mk("div", "fx-mono", bt, { fontSize: px(18), color: C.lavHi }, "you · now");
    mk("div", "fx-ui-txt", bt, { fontSize: px(42), fontWeight: 800, color: "#fff", lineHeight: "1.1" }, kw);
    const heart = mk("div", "", bub, { marginLeft: "auto", width: px(48), height: px(48), color: "#fff", position: "relative", flex: "none" });
    const ho = mk("div", "fx-abs", heart, { inset: 0 }, I.heartO);
    const hf = mk("div", "fx-abs", heart, { inset: 0, color: C.magenta, opacity: 0 }, I.heart);
    const rep = mk("div", "fx-glass", r, { left: px(x + 60), top: px(y + 136), width: px(w - 60), height: px(104), display: "flex", alignItems: "center", gap: "16px", padding: "0 22px", borderColor: "rgba(53,214,230,.75)" });
    mk("div", "fx-ui-txt", rep, { width: px(56), height: px(56), borderRadius: "50%", background: "linear-gradient(140deg,#7A4DFF,#35D6E6)", flex: "none", fontSize: px(22), fontWeight: 800, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }, o.initials || "ME");
    const rt = mk("div", "", rep, { minWidth: 0 });
    mk("div", "fx-mono", rt, { fontSize: px(18), color: C.lavHi }, (o.handle || "your_handle") + " · now");
    const rtx = mk("div", "fx-ui-txt", rt, { fontSize: px(30), fontWeight: 600, color: "#fff", whiteSpace: "nowrap" });
    life(tl, r, at, at + d, 0.01);
    tl.from(inp, { y: -30, opacity: 0, duration: 0.24, ease: "power3.out" }, at);
    tl.to(ph, { opacity: 0, duration: 0.06 }, at + 0.22);
    typeInto(tl, ty, kw, at + 0.24, 0.3);
    tl.to(btn, { scale: 0.8, duration: 0.07, yoyo: true, repeat: 1 }, at + 0.58);
    tl.to(inp, { opacity: 0, scale: 0.96, duration: 0.12 }, at + 0.72);
    tl.fromTo(bub, { opacity: 0, y: 16, scale: 0.96 }, { opacity: 1, y: 0, scale: 1, duration: 0.22, ease: "back.out(2)" }, at + 0.74);
    tl.to(ho, { opacity: 0, duration: 0.05 }, at + 0.98);
    tl.fromTo(hf, { opacity: 0, scale: 1.7 }, { opacity: 1, scale: 1, duration: 0.25, ease: "back.out(3)" }, at + 0.98);
    tl.fromTo(rep, { opacity: 0, y: -20 }, { opacity: 1, y: 0, duration: 0.22, ease: "power3.out" }, at + 1.08);
    typeInto(tl, rtx, o.reply || "Sent. Check your DMs.", at + 1.14, 0.3);
    return at + d;
  };

  /** 18 Comment drop: the keyword slams in big (behind the head), a fresh comment posts it. */
  FX.commentDrop = function (tl, at, o = {}) {
    const d = o.dur ?? 1.4, kw = o.keyword || "KEYWORD";
    const r = root(o.layer || "behind", "commentDrop");
    const size = o.size || fitPx(kw, S.zone.w, 230, 0.8);
    const big = mk("div", "fx-abs fx-display", r, { left: px(S.zone.x), top: px(o.y ?? S.top - 10), fontSize: px(size) });
    const cs = chars(big, kw, "fx-chrome-text");
    const u = root("ui", "commentDropUI");
    const y = (o.y ?? S.top - 10) + size + 20;
    const box = mk("div", "fx-glass", u, { left: px(S.zone.x), top: px(y), width: px(S.zone.w), height: px(96), borderRadius: px(48), display: "flex", alignItems: "center", gap: "18px", padding: "0 18px" });
    mk("div", "", box, { width: px(58), height: px(58), borderRadius: "50%", background: "linear-gradient(140deg,#8D869A,#3b3848)", flex: "none" });
    const ph = mk("div", "fx-ui-txt", box, { fontSize: px(30), color: C.lavHi }, "Add a comment…");
    const posted = mk("div", "fx-abs", box, { left: px(94), top: px(16), opacity: 0 });
    mk("div", "fx-mono", posted, { fontSize: px(16), color: C.lavHi }, "you · now");
    mk("div", "fx-ui-txt", posted, { fontSize: px(36), fontWeight: 800, color: "#fff", lineHeight: "1.05" }, kw);
    const post = mk("div", "fx-ui-txt", box, { marginLeft: "auto", fontSize: px(24), fontWeight: 700, color: C.lavHi, padding: "8px 18px", borderRadius: px(14), background: "rgba(141,134,154,.25)" }, "Post");
    life(tl, r, at, at + d, 0.01);
    life(tl, u, at + 0.3, at + d, 0.1);
    cs.forEach((c, i) => tl.fromTo(c, { opacity: 0, scale: 1.5, filter: "blur(12px)" }, { opacity: 1, scale: 1, filter: "blur(0px)", duration: 0.17, ease: "back.out(2)" }, at + 0.05 + i * 0.07));
    tl.from(box, { y: 30, duration: 0.24, ease: "power3.out" }, at + 0.3);
    tl.to(ph, { opacity: 0, duration: 0.08 }, at + 0.62);
    tl.to(posted, { opacity: 1, duration: 0.15 }, at + 0.66);
    tl.to(post, { backgroundColor: C.violet, color: "#fff", duration: 0.15 }, at + 0.66);
    return at + d;
  };

  // ================================================================= CLAUDE CODE-NATIVE
  /** 19 Terminal reveal: a Claude Code terminal types the prompt, thinks, then the result flies out of it. */
  FX.terminalReveal = function (tl, at, o = {}) {
    const d = o.dur ?? 1.8, prompt = o.prompt || "make a kinetic title that says SHIP IT", result = o.result || "SHIP IT";
    const r = root("ui", "terminalReveal");
    const x = S.zone.x, y = o.y ?? S.top, w = S.zone.w, h = 440;
    const win = mk("div", "", r, { position: "absolute", left: px(x), top: px(y), width: px(w), height: px(h), borderRadius: px(20), background: "#0B0D14", border: "2px solid rgba(122,77,255,.75)", boxShadow: "0 0 44px rgba(122,77,255,.4), 0 26px 60px rgba(0,0,0,.6)", overflow: "hidden" });
    const bar = mk("div", "", win, { height: px(50), display: "flex", alignItems: "center", gap: "10px", padding: "0 20px", background: "rgba(122,77,255,.13)", borderBottom: "1px solid rgba(122,77,255,.3)" });
    ["#ff5f57", "#febc2e", "#28c840"].forEach((c) => mk("i", "", bar, { display: "block", width: px(14), height: px(14), borderRadius: "50%", background: c }));
    mk("span", "fx-mono", bar, { marginLeft: px(14), fontSize: px(18), color: C.lavHi }, o.cwd || "claude  ~/hyperframes");
    const body = mk("div", "fx-mono", win, { padding: "24px 28px", fontSize: px(26), lineHeight: "1.45", color: "#fff" });
    mk("div", "", body, { color: C.magenta, fontWeight: 700 }, "✻ Claude Code");
    const pl = mk("div", "", body, { marginTop: px(12), whiteSpace: "normal", wordBreak: "break-word" });
    mk("span", "", pl, { color: C.cyan }, "&gt; ");
    const pt = mk("span", "", pl);
    const car = mk("span", "", pl, { display: "inline-block", width: px(13), height: px(28), background: "#fff", verticalAlign: "-5px", marginLeft: px(2) });
    const think = mk("div", "", body, { marginTop: px(14), color: C.lavHi, opacity: 0 });
    const glyph = mk("span", "", think, { color: C.magenta }, "✻");
    mk("span", "", think, null, " Thinking…");
    const done = mk("div", "", body, { marginTop: px(4), opacity: 0 }, `<span style="color:${C.cyan}">⏺</span> ${o.status || "Built 1 composition · rendered"}`);
    const size = fitPx(result, w, 190, 0.8);
    const out = mk("div", "fx-abs fx-display fx-chrome-text", r, { left: px(x), width: px(w), textAlign: "center", top: px(y + h / 2 - size / 2), fontSize: px(size), opacity: 0 }, result);
    const burst = mk("div", "fx-abs", r, { left: px(x + w / 2 - 160), top: px(y + h / 2 - 160), width: px(320), height: px(320), borderRadius: "50%", border: `6px solid ${C.magenta}`, opacity: 0 });
    life(tl, r, at, at + d, 0.01);
    tl.from(win, { y: 30, opacity: 0, scale: 0.96, duration: 0.25, ease: "power3.out" }, at);
    typeInto(tl, pt, prompt, at + 0.18, Math.min(0.55, prompt.length * 0.014));
    tl.set(car, { opacity: 0 }, at + 0.78);
    tl.set(think, { opacity: 1 }, at + 0.8);
    const gl = ["✢", "✳", "✶", "✻", "✽", "✻", "✶", "✳"], gp = { v: 0 };
    tl.to(gp, { v: 1, duration: 0.3, ease: "none", onUpdate() { glyph.textContent = gl[Math.floor(gp.v * 15) % gl.length]; } }, at + 0.8);
    tl.set(think, { opacity: 0 }, at + 1.1);
    tl.set(done, { opacity: 1 }, at + 1.1);
    tl.to(win, { scale: 0.92, opacity: 0.25, filter: "blur(3px)", duration: 0.25, ease: "power2.in" }, at + 1.2);
    tl.fromTo(out, { opacity: 0, scale: 0.3, filter: "blur(16px)" }, { opacity: 1, scale: 1, filter: "blur(0px)", duration: 0.32, ease: "back.out(2.2)" }, at + 1.22);
    tl.fromTo(burst, { opacity: 1, scale: 0.2 }, { opacity: 0, scale: 1.8, duration: 0.45, ease: "power2.out" }, at + 1.24);
    return at + d;
  };

  /** 20 Lab panel: biomarkers count and slide from out-of-range (red) into range (cyan). DEMO data only. */
  FX.labPanel = function (tl, at, o = {}) {
    const d = o.dur ?? 1.7;
    const markers = o.markers || [
      { name: "Vitamin D", unit: "ng/mL", from: 18, to: 52, lo: 30, hi: 80, max: 100, dec: 0 },
      { name: "ApoB", unit: "mg/dL", from: 128, to: 78, lo: 0, hi: 90, max: 160, dec: 0 },
      { name: "HbA1c", unit: "%", from: 6.1, to: 5.2, lo: 4.0, hi: 5.6, max: 7, dec: 1 },
    ];
    const r = root("ui", "labPanel");
    const x = S.zone.x, y = o.y ?? S.top, w = S.zone.w, rh = 128;
    const card = mk("div", "fx-card", r, { left: px(x), top: px(y), width: px(w), height: px(110 + markers.length * rh) });
    const hd = mk("div", "fx-abs", card, { left: px(30), right: px(30), top: px(26), display: "flex", alignItems: "center", gap: "14px" });
    mk("div", "fx-ui-txt", hd, { fontSize: px(30), fontWeight: 800, color: "#fff" }, o.title || "Lab panel");
    mk("div", "fx-mono", hd, { fontSize: px(15), letterSpacing: ".16em", color: C.cyan, border: "1.5px solid rgba(53,214,230,.7)", borderRadius: px(8), padding: "4px 10px" }, o.tag || "DEMO DATA");
    mk("div", "fx-mono", hd, { marginLeft: "auto", fontSize: px(18), color: C.lavHi }, o.date || "BEFORE → 90 DAYS");
    markers.forEach((m, i) => {
      const ry = 96 + i * rh;
      mk("div", "fx-abs fx-ui-txt", card, { left: px(30), top: px(ry), fontSize: px(30), fontWeight: 600, color: "#fff" }, m.name);
      const val = mk("div", "fx-abs fx-mono fx-tnum", card, { right: px(30), top: px(ry - 4), fontSize: px(36), fontWeight: 700, color: "#fff" });
      const vt = mk("span", "", val);
      mk("span", "", val, { fontSize: px(18), color: C.lavHi, marginLeft: px(8) }, m.unit);
      const rg = mk("div", "fx-range", card, { left: px(30), right: px(30), top: px(ry + 62) });
      mk("i", "", rg, { left: (m.lo / m.max) * 100 + "%", width: ((m.hi - m.lo) / m.max) * 100 + "%" });
      const dot = mk("s", "", rg, { left: (m.from / m.max) * 100 + "%" });
      const t0 = at + 0.3 + i * 0.13, dur = 0.8;
      counter(tl, vt, m.from, m.to, t0, dur, (v) => v.toFixed(m.dec || 0), "power2.inOut");
      tl.fromTo(dot, { left: (m.from / m.max) * 100 + "%" }, { left: (m.to / m.max) * 100 + "%", duration: dur, ease: "power2.inOut" }, t0);
      tl.to(dot, { backgroundColor: C.cyan, boxShadow: "0 0 16px rgba(53,214,230,.9)", duration: 0.15 }, t0 + dur * 0.62);
      tl.from([rg], { opacity: 0, scaleX: 0.6, transformOrigin: "0 50%", duration: 0.25, ease: "power3.out" }, at + 0.12 + i * 0.08);
    });
    life(tl, r, at, at + d, 0.01);
    tl.from(card, { y: 40, opacity: 0, duration: 0.28, ease: "power3.out" }, at);
    return at + d;
  };

  /** 21 Face-tracked callout: punch-in on the face + reticle and label that follow the head.
      Uses window.FX_FACE from tools/face-track.sh (falls back to a static box). */
  FX.faceCallout = function (tl, at, o = {}) {
    const d = o.dur ?? 1.4, punch = o.punch ?? 1.22, sc = L.scene;
    const r = root("ui", "faceCallout");
    const corners = [0, 1, 2, 3].map((k) => mk("div", "fx-abs", r, {
      width: px(46), height: px(46), borderColor: C.cyan, borderStyle: "solid", borderWidth: 0,
      [k < 2 ? "borderTopWidth" : "borderBottomWidth"]: px(6), [k % 2 ? "borderRightWidth" : "borderLeftWidth"]: px(6),
      filter: "drop-shadow(0 0 8px rgba(53,214,230,.9))" }));
    const lead = mk("div", "fx-abs", r, { height: px(3), background: C.cyan, transformOrigin: "0 50%", boxShadow: "0 0 10px rgba(53,214,230,.9)" });
    const lab = mk("div", "fx-glass", r, { padding: "14px 22px", borderRadius: px(16), borderColor: "rgba(53,214,230,.85)" });
    mk("div", "fx-ui-txt", lab, { fontSize: px(34), fontWeight: 800, color: "#fff", whiteSpace: "nowrap" }, o.label || "Tracked");
    if (o.sub !== "") mk("div", "fx-mono", lab, { fontSize: px(17), color: C.cyan, marginTop: px(2) }, o.sub || "FACE LOCK · 30 FPS");
    const f0 = FX.faceAt(at), org = { x: f0.cx, y: f0.cy };
    const place = (t) => {
      const f = FX.faceAt(t), s = gsap.getProperty(sc, "scale") || 1;
      const cx = org.x + (f.cx - org.x) * s, cy = org.y + (f.cy - org.y) * s, bw = f.w * s * 1.05, bh = f.h * s * 1.1;
      const L0 = cx - bw / 2, T0 = cy - bh / 2;
      [[L0, T0], [L0 + bw - 46, T0], [L0, T0 + bh - 46], [L0 + bw - 46, T0 + bh - 46]].forEach(([xx, yy], i) => { corners[i].style.left = px(xx); corners[i].style.top = px(yy); });
      const lw = lab.offsetWidth, lh = lab.offsetHeight;
      const lx = Math.max(S.zone.x, Math.min(S.zone.x + S.zone.w - lw, L0 + 20)), ly = Math.max(S.top - 40, T0 - lh - 70);
      lab.style.left = px(lx); lab.style.top = px(ly);
      const ax = L0 + 23, ay = T0, ex = lx + 40, ey = ly + lh, dx = ex - ax, dy = ey - ay;
      lead.style.left = px(ax); lead.style.top = px(ay); lead.style.width = px(Math.hypot(dx, dy));
      lead.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
    };
    const p = { v: 0 };
    tl.set(sc, { transformOrigin: `${org.x}px ${org.y}px` }, at);
    tl.fromTo(sc, { scale: 1 }, { scale: punch, duration: 0.35, ease: "power3.out", immediateRender: false }, at);
    tl.to(sc, { scale: 1, duration: 0.25, ease: "power2.inOut" }, at + d - 0.28);
    tl.set(sc, { transformOrigin: "540px 960px" }, at + d);
    tl.to(p, { v: 1, duration: d, ease: "none", onUpdate() { place(at + p.v * d); } }, at);
    life(tl, r, at + 0.12, at + d - 0.05, 0.1, 0.12);
    tl.from(corners, { scale: 1.6, opacity: 0, duration: 0.25, ease: "back.out(2)", stagger: 0.03 }, at + 0.12);
    tl.from(lead, { scaleX: 0, duration: 0.2, ease: "power2.out" }, at + 0.3);
    tl.from(lab, { opacity: 0, x: 20, duration: 0.22, ease: "power3.out" }, at + 0.38);
    return at + d;
  };

  /** 22 Thanos snap: a word (or icon) disintegrates into drifting particles, left to right. */
  FX.thanosSnap = function (tl, at, o = {}) {
    const d = o.dur ?? 1.4, text = o.text || "OLD WAY";
    const R = nextRng();
    const r = root("ui", "thanosSnap");
    const cw = S.zone.w + 200, chh = 420, x = S.zone.x, y = o.y ?? S.top;
    const cv = mk("canvas", "fx-abs", r, { left: px(x), top: px(y), width: px(cw), height: px(chh) });
    cv.width = cw; cv.height = chh;
    const size = o.size || fitPx(text, S.zone.w, 200, 0.82);
    let img = null;
    if (o.img) { img = mk("img", "", r, { display: "none" }); img.src = o.img; }
    let src = null, parts = null;
    const build = () => {
      const off = document.createElement("canvas"); off.width = cw; off.height = chh;
      const c = off.getContext("2d");
      if (img) {
        if (!img.complete || !img.naturalWidth) return false;
        const s = Math.min(260 / img.naturalWidth, 260 / img.naturalHeight);
        c.drawImage(img, 40, chh / 2 - (img.naturalHeight * s) / 2, img.naturalWidth * s, img.naturalHeight * s);
      } else {
        const g = c.createLinearGradient(0, chh / 2 - size / 2, 0, chh / 2 + size / 2);
        g.addColorStop(0, "#ffffff"); g.addColorStop(0.6, "#cfc9dd"); g.addColorStop(1, "#ffffff");
        c.fillStyle = g; c.font = `900 ${size}px Montserrat, Arial, sans-serif`; c.textBaseline = "middle";
        c.fillText(text, 0, chh / 2);
      }
      const data = c.getImageData(0, 0, cw, chh).data, step = 3, out = [];
      let maxX = 1;
      for (let yy = 0; yy < chh; yy += step) for (let xx = 0; xx < cw; xx += step) {
        const i = (yy * cw + xx) * 4;
        if (data[i + 3] > 120) { out.push([xx, yy, data[i], data[i + 1], data[i + 2]]); if (xx > maxX) maxX = xx; }
      }
      parts = out.map(([px0, py0, rr, gg, bb]) => ({ x: px0, y: py0, c: `rgb(${rr},${gg},${bb})`, alt: R() < 0.22 ? (R() < 0.5 ? C.violet : C.cyan) : null,
        dl: (px0 / maxX) * 0.5 + R() * 0.18, vx: 90 + R() * 260, vy: -(40 + R() * 220), wob: R() * 6.28, sz: 2 + R() * 2.5 }));
      src = off; return true;
    };
    const ctx = cv.getContext("2d");
    const draw = (p) => {
      if (!src && !build()) return;
      ctx.clearRect(0, 0, cw, chh);
      const snapP = Math.max(0, (p - 0.3) / 0.7);
      if (snapP <= 0) { ctx.drawImage(src, 0, 0); return; }
      for (const q0 of parts) {
        const k = Math.min(1, Math.max(0, (snapP - q0.dl) / 0.42));
        if (k <= 0) { ctx.fillStyle = q0.c; ctx.fillRect(q0.x, q0.y, 3, 3); continue; }
        if (k >= 1) continue;
        const e = k * k;
        ctx.globalAlpha = 1 - k;
        ctx.fillStyle = q0.alt || q0.c;
        ctx.fillRect(q0.x + q0.vx * e + Math.sin(q0.wob + k * 6) * 10 * k, q0.y + q0.vy * e, q0.sz, q0.sz);
        ctx.globalAlpha = 1;
      }
    };
    const p = { v: 0 };
    life(tl, r, at, at + d, 0.08, 0.05);
    tl.fromTo(cv, { scale: 1.25, filter: "blur(10px)" }, { scale: 1, filter: "blur(0px)", duration: 0.25, ease: "back.out(2)" }, at);
    tl.to(p, { v: 1, duration: d, ease: "none", onUpdate() { draw(p.v); } }, at);
    return at + d;
  };

  /** 23 Number climb: big counter + a line chart that draws itself. Use your own numbers only. */
  FX.numberClimb = function (tl, at, o = {}) {
    const d = o.dur ?? 1.5, from = o.from ?? 0, to = o.to ?? 248000;
    const R = nextRng();
    const r = root("ui", "numberClimb");
    const x = S.zone.x, y = o.y ?? S.top, w = S.zone.w, h = 500;
    const card = mk("div", "fx-card", r, { left: px(x), top: px(y), width: px(w), height: px(h) });
    mk("div", "fx-abs fx-pill-label", card, { left: px(32), top: px(28) }, o.label || "VIEWS · LAST 30 DAYS");
    const num = mk("div", "fx-abs fx-display fx-tnum", card, { left: px(30), top: px(66), fontSize: px(o.size || 112), color: C.cyan, textShadow: "0 0 28px rgba(53,214,230,.6)" });
    const delta = mk("div", "fx-abs fx-ui-txt", card, { right: px(30), top: px(30), fontSize: px(26), fontWeight: 800, color: "#fff", background: C.magenta, borderRadius: px(12), padding: "6px 14px", boxShadow: "0 0 20px rgba(196,77,240,.7)" }, o.delta || "+312%");
    const pts = o.points || (() => { const a = []; let v = 0.08; for (let i = 0; i < 12; i++) { v = Math.min(1, v + 0.02 + R() * 0.11 * (i / 6 + 0.3) - (R() < 0.25 ? 0.07 : 0)); a.push(Math.max(0.03, v)); } a[a.length - 1] = 1; return a; })();
    const cw = w - 60, chh = 240, cy = h - chh - 30;
    const xy = pts.map((v, i) => [(i / (pts.length - 1)) * cw, chh - v * (chh - 16) - 4]);
    const dpath = "M" + xy.map((p) => p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" L");
    const svg = mk("div", "fx-abs", card, { left: px(30), top: px(cy), width: px(cw), height: px(chh) },
      `<svg width="${cw}" height="${chh}" viewBox="0 0 ${cw} ${chh}"><defs><linearGradient id="fxg${S.seed}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.cyan}" stop-opacity=".45"/><stop offset="1" stop-color="${C.cyan}" stop-opacity="0"/></linearGradient></defs>` +
      [0.25, 0.5, 0.75].map((g) => `<line x1="0" x2="${cw}" y1="${chh * g}" y2="${chh * g}" stroke="rgba(185,178,200,.18)" stroke-width="1"/>`).join("") +
      `<path class="a" d="${dpath} L${cw} ${chh} L0 ${chh} Z" fill="url(#fxg${S.seed})"/><path class="l" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100" d="${dpath}" fill="none" stroke="${C.cyan}" stroke-width="5" stroke-linejoin="round" stroke-linecap="round" style="filter:drop-shadow(0 0 8px rgba(53,214,230,.9))"/>` +
      `<circle class="e" cx="${xy[xy.length - 1][0]}" cy="${xy[xy.length - 1][1]}" r="11" fill="${C.magenta}" stroke="#fff" stroke-width="3"/></svg>`);
    const area = svg.querySelector(".a"), line = svg.querySelector(".l"), end = svg.querySelector(".e");
    life(tl, r, at, at + d, 0.01);
    tl.from(card, { y: 40, opacity: 0, duration: 0.26, ease: "power3.out" }, at);
    counter(tl, num, from, to, at + 0.15, 0.95, (v) => (o.prefix || "") + commas(v) + (o.suffix || ""), "power3.out");
    tl.to(line, { attr: { "stroke-dashoffset": 0 }, duration: 0.95, ease: "power3.out" }, at + 0.15);
    tl.from(area, { opacity: 0, duration: 0.5 }, at + 0.5);
    tl.from(end, { scale: 0, transformOrigin: "50% 50%", duration: 0.25, ease: "back.out(3)" }, at + 1.0);
    tl.from(delta, { scale: 0, opacity: 0, duration: 0.25, ease: "back.out(3)" }, at + 1.05);
    return at + d;
  };

  /** 24 Multiverse: the take splits into three panels, each graded differently, then collapses back.
      Needs two plate copies (o.copies). */
  FX.multiverse = function (tl, at, o = {}) {
    const d = o.dur ?? 1.6, sc = L.scene;
    const copies = (o.copies || ["#fx-copy-1", "#fx-copy-2"]).map(q);
    const labels = o.labels || ["COOL", "ORIGINAL", "WARM"];
    const filters = o.filters || ["saturate(.55) hue-rotate(18deg) brightness(.95) contrast(1.1)", "sepia(.4) saturate(1.35) contrast(1.08) brightness(1.04)"];
    const u = root("under", "multiverse");
    u.style.background = "#000";
    mk("div", "fx-abs", u, { inset: 0, backgroundImage: "linear-gradient(rgba(122,77,255,.08) 1px,transparent 1px),linear-gradient(90deg,rgba(122,77,255,.08) 1px,transparent 1px)", backgroundSize: "90px 90px" });
    const s = o.scale ?? 0.31, pw = W * s, gap = 22, offs = pw + gap, ph = H * s;
    const ui = root("ui", "multiverseUI");
    const labs = labels.map((t, i) => mk("div", "fx-abs fx-mono", ui, { left: px(540 + (i - 1) * offs - pw / 2), width: px(pw), top: px(960 + ph / 2 + 24), textAlign: "center", fontSize: px(22), letterSpacing: ".2em", color: i === 1 ? "#fff" : C.cyan }, t));
    life(tl, u, at, at + d, 0.01, 0.05);
    life(tl, ui, at + 0.42, at + d - 0.3, 0.12, 0.1);
    tl.to(sc, { scale: s, borderRadius: 34 / s, duration: 0.38, ease: "power3.inOut" }, at);
    copies.forEach((c, i) => {
      if (!c) return;
      const dir = i === 0 ? -1 : 1;
      tl.set(c, { zIndex: 3, opacity: 0, transformOrigin: "540px 960px", x: 0, y: 0, scale: s, borderRadius: 34 / s, clipPath: "none", filter: filters[i] }, at + 0.36);
      tl.to(c, { opacity: 1, x: dir * offs, duration: 0.34, ease: "power3.out" }, at + 0.36);
      tl.to(c, { x: 0, opacity: 0, duration: 0.26, ease: "power2.in" }, at + d - 0.56);
      tl.set(c, { transformOrigin: "0 0", scale: 1, x: 0, borderRadius: 0, filter: "none", opacity: 0 }, at + d);
    });
    tl.to(sc, { scale: 1, borderRadius: 0, duration: 0.32, ease: "power3.inOut" }, at + d - 0.34);
    tl.set(sc, { clearProps: "borderRadius" }, at + d);
    tl.from(labs, { y: 20, opacity: 0, duration: 0.2, stagger: 0.05 }, at + 0.45);
    dimHud(at, at + d, true);
    return at + d;
  };

  /** 25 3D orbit: a three.js object (molecule / icosa) spins behind the head. Needs three.js loaded. */
  FX.orbit3D = function (tl, at, o = {}) {
    const d = o.dur ?? 1.5;
    const r = root(o.layer || "behind", "orbit3D");
    const x = o.x ?? 90, y = o.y ?? 110, w = o.w ?? 900, h = o.h ?? 680;
    const cv = mk("canvas", "fx-abs", r, { left: px(x), top: px(y), width: px(w), height: px(h) });
    cv.width = w; cv.height = h;
    const T = window.THREE;
    if (!T) { console.warn("[FX.orbit3D] three.js not loaded"); return at + d; }
    const R = nextRng();
    const ren = new T.WebGLRenderer({ canvas: cv, alpha: true, antialias: true, preserveDrawingBuffer: true });
    ren.setPixelRatio(1); ren.setSize(w, h, false);
    const scn = new T.Scene(), cam = new T.PerspectiveCamera(36, w / h, 0.1, 100);
    cam.position.set(0, 0, 9);
    scn.add(new T.AmbientLight(0xffffff, 0.45));
    const l1 = new T.PointLight(0x7A4DFF, 2.2, 40); l1.position.set(-5, 4, 6); scn.add(l1);
    const l2 = new T.PointLight(0x35D6E6, 2.0, 40); l2.position.set(5, -3, 6); scn.add(l2);
    const l3 = new T.DirectionalLight(0xffffff, 0.8); l3.position.set(0, 5, 8); scn.add(l3);
    const grp = new T.Group(); scn.add(grp);
    const mat = (c, e) => new T.MeshStandardMaterial({ color: c, emissive: e || 0x000000, emissiveIntensity: 0.35, roughness: 0.32, metalness: 0.35 });
    if ((o.kind || "molecule") === "molecule") {
      const core = new T.Mesh(new T.SphereGeometry(0.62, 40, 40), mat(0x7A4DFF, 0x7A4DFF)); grp.add(core);
      const n = o.atoms || 7, cols = [0x35D6E6, 0xC44DF0, 0xffffff];
      for (let i = 0; i < n; i++) {
        const phi = Math.acos(1 - (2 * (i + 0.5)) / n), th = Math.PI * (1 + Math.sqrt(5)) * i + R() * 0.4;
        const v = new T.Vector3(Math.sin(phi) * Math.cos(th), Math.cos(phi), Math.sin(phi) * Math.sin(th)).multiplyScalar(2.1);
        const a = new T.Mesh(new T.SphereGeometry(0.32 + R() * 0.12, 32, 32), mat(cols[i % 3], cols[i % 3])); a.position.copy(v); grp.add(a);
        const bond = new T.Mesh(new T.CylinderGeometry(0.06, 0.06, v.length(), 12), new T.MeshStandardMaterial({ color: 0xcfc9dd, roughness: 0.4, metalness: 0.6 }));
        bond.position.copy(v.clone().multiplyScalar(0.5)); bond.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), v.clone().normalize()); grp.add(bond);
      }
    } else {
      grp.add(new T.Mesh(new T.IcosahedronGeometry(1.9, 1), new T.MeshStandardMaterial({ color: 0x7A4DFF, wireframe: true })));
      grp.add(new T.Mesh(new T.IcosahedronGeometry(1.2, 0), mat(0x35D6E6, 0x35D6E6)));
    }
    const p = { v: 0 };
    const draw = () => {
      const k = p.v, ein = Math.min(1, k / 0.22), eout = Math.min(1, (1 - k) / 0.15);
      const sc0 = Math.max(0.001, (1 - Math.pow(1 - ein, 3)) * Math.min(1, eout * 1.2));
      grp.scale.setScalar(sc0);
      grp.rotation.set(0.35 + k * 0.6, k * Math.PI * 1.6, 0.15);
      ren.render(scn, cam);
    };
    draw();
    life(tl, r, at, at + d, 0.05, 0.05);
    tl.to(p, { v: 1, duration: d, ease: "none", onUpdate: draw }, at);
    return at + d;
  };


  // ================================================================= SYSTEMS + 3D
  function nodeIcon(parent, n, size) {
    const t = mk("div", "", parent, { width: px(size), height: px(size), borderRadius: px(size * 0.26), overflow: "hidden", flex: "none",
      background: n.src && !n.bg ? "#fff" : (n.bg || "linear-gradient(140deg,#7A4DFF,#35D6E6)"), display: "flex", alignItems: "center", justifyContent: "center",
      boxShadow: "0 8px 22px rgba(0,0,0,.45)" });
    if (n.src) { const im = mk("img", "", t, { width: n.full ? "100%" : "72%", height: n.full ? "100%" : "72%", objectFit: n.full ? "cover" : "contain" }); im.src = n.src; }
    else mk("div", "fx-display", t, { fontSize: px(size * 0.36), color: "#fff" }, (n.glyph || n.label || "?").slice(0, 2));
    return t;
  }

  /** 26 System map: a hub with spokes that trace out one by one, then data pulses along them. */
  FX.systemMap = function (tl, at, o = {}) {
    const d = o.dur ?? 2.0;
    const hub = o.hub || { label: "My OS", glyph: "OS" };
    const spokes = (o.spokes || [{ label: "Inbox" }, { label: "Calendar" }, { label: "Notes" }, { label: "CRM" }, { label: "Docs" }, { label: "Tasks" }]).slice(0, 8);
    const r = root(o.layer || "ui", "systemMap");
    const W0 = S.zone.w, H0 = o.h ?? 680, x0 = S.zone.x, y0 = o.y ?? S.top - 10, cx = W0 / 2, cy = H0 / 2;
    const box = mk("div", "fx-abs", r, { left: px(x0), top: px(y0), width: px(W0), height: px(H0) });
    const rad = Math.min(W0, H0) / 2 - 92, n = spokes.length;
    const pts = spokes.map((_, i) => { const a = -Math.PI / 2 + (i / n) * Math.PI * 2; return [cx + Math.cos(a) * rad * 1.08, cy + Math.sin(a) * rad]; });
    const svg = mk("div", "fx-abs", box, { inset: 0 }, `<svg width="${W0}" height="${H0}">` + pts.map(([x, y]) =>
      `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100" stroke="${C.cyan}" stroke-width="4" stroke-linecap="round" style="filter:drop-shadow(0 0 6px rgba(53,214,230,.9))"/>`).join("") + `</svg>`);
    const lines = [...svg.querySelectorAll("line")];
    const dots = pts.map(() => mk("div", "fx-abs", box, { width: px(14), height: px(14), marginLeft: px(-7), marginTop: px(-7), borderRadius: "50%", background: "#fff", boxShadow: `0 0 14px ${C.cyan}`, opacity: 0 }));
    const nodes = spokes.map((sp, i) => {
      const g = mk("div", "fx-abs", box, { left: px(pts[i][0] - 75), top: px(pts[i][1] - 56), width: px(150), display: "flex", flexDirection: "column", alignItems: "center", gap: "8px" });
      nodeIcon(g, sp, 86);
      mk("div", "fx-ui-txt", g, { fontSize: px(28), fontWeight: 700, color: "#fff", whiteSpace: "nowrap", textShadow: "0 2px 8px rgba(0,0,0,.9)" }, sp.label || "");
      return g;
    });
    const hb = mk("div", "fx-card", box, { left: px(cx - 112), top: px(cy - 112), width: px(224), height: px(224), borderRadius: "50%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "6px" });
    if (hub.src) nodeIcon(hb, hub, 70); else mk("div", "fx-display fx-chrome-text", hb, { fontSize: px(66) }, hub.glyph || "");
    mk("div", "fx-ui-txt", hb, { fontSize: px(28), fontWeight: 800, color: "#fff", whiteSpace: "nowrap" }, hub.label);
    life(tl, r, at, at + d, 0.01);
    tl.from(hb, { scale: 0, duration: 0.35, ease: "back.out(2)" }, at + 0.02);
    const step = Math.min(0.11, 0.9 / n);
    lines.forEach((ln, i) => {
      const t0 = at + 0.25 + i * step;
      tl.to(ln, { attr: { "stroke-dashoffset": 0 }, duration: 0.22, ease: "power2.out" }, t0);
      tl.from(nodes[i], { scale: 0, opacity: 0, duration: 0.25, ease: "back.out(2.4)" }, t0 + 0.16);
    });
    const p = { v: 0 }, pulse0 = at + 0.25 + n * step + 0.15;
    tl.to(p, { v: 1, duration: Math.max(0.3, at + d - 0.2 - pulse0), ease: "none", onUpdate() {
      dots.forEach((dt, i) => {
        const k = ((p.v * 2.2 + i / n) % 1), [x, y] = pts[i];
        dt.style.left = px(cx + (x - cx) * k); dt.style.top = px(cy + (y - cy) * k); dt.style.opacity = p.v > 0 ? Math.sin(k * Math.PI).toFixed(2) : 0;
      });
    } }, pulse0);
    return at + d;
  };

  /** 27 Tool orbit: a big count in the middle, tool icons circling it on a tilted ellipse. */
  FX.toolOrbit = function (tl, at, o = {}) {
    const d = o.dur ?? 2.0, icons = o.icons || [];
    const count = o.count ?? icons.length, label = o.label ?? "tools";
    const r = root(o.layer || "ui", "toolOrbit");
    const W0 = S.zone.w, H0 = o.h ?? 520, x0 = S.zone.x, y0 = o.y ?? S.top, cx = W0 / 2, cy = H0 / 2;
    const box = mk("div", "fx-abs", r, { left: px(x0), top: px(y0), width: px(W0), height: px(H0) });
    const ring = mk("div", "fx-abs", box, { left: px(cx - W0 * 0.46), top: px(cy - H0 * 0.27), width: px(W0 * 0.92), height: px(H0 * 0.54), borderRadius: "50%", border: "2px solid rgba(122,77,255,.55)", boxShadow: "0 0 30px rgba(122,77,255,.35)" });
    const mid = mk("div", "fx-abs", box, { left: 0, width: px(W0), top: px(cy - 110), textAlign: "center", zIndex: 50 });
    const num = mk("div", "fx-display fx-chrome-text fx-tnum", mid, { fontSize: px(210), display: "inline-block" });
    mk("div", "fx-serif-i", mid, { fontSize: px(66), color: C.cyan, marginTop: px(-6) }, label);
    const tiles = icons.map((ic) => { const t = mk("div", "fx-abs", box, { width: px(110), height: px(110), marginLeft: px(-55), marginTop: px(-55) }); nodeIcon(t, ic, 110); return t; });
    life(tl, r, at, at + d, 0.01);
    tl.from(ring, { scale: 0.4, opacity: 0, duration: 0.4, ease: "power3.out" }, at);
    counter(tl, num, 0, count, at + 0.1, 0.6, (v) => String(Math.round(v)), "power2.out");
    const p = { v: 0 }, n = Math.max(1, tiles.length), rx = W0 * 0.46, ry = H0 * 0.27;
    tl.to(p, { v: 1, duration: d, ease: "none", onUpdate() {
      const appear = Math.min(1, p.v * d / 0.5);
      tiles.forEach((t, i) => {
        const a = (i / n) * Math.PI * 2 + p.v * d * 0.9, z = Math.sin(a);
        const k = Math.min(1, Math.max(0, appear * n - i * 0.6));
        t.style.left = px(cx + Math.cos(a) * rx); t.style.top = px(cy + z * ry);
        t.style.transform = `scale(${((0.62 + 0.38 * (z + 1) / 2) * (0.3 + 0.7 * k)).toFixed(3)})`;
        t.style.opacity = (k * (0.45 + 0.55 * (z + 1) / 2)).toFixed(2);
        t.style.zIndex = z > 0 ? 60 : 10;
      });
    } }, at);
    return at + d;
  };

  /** 28 Funnel in: several input cards fly into one document that writes itself. */
  FX.funnelIn = function (tl, at, o = {}) {
    const d = o.dur ?? 2.0;
    const inputs = (o.inputs || [{ label: "Docs", sub: "PDF · 12 pages" }, { label: "Email", sub: "40 threads" }, { label: "Notes", sub: "voice memos" }, { label: "Calendar", sub: "this week" }]).slice(0, 4);
    const out = o.output || { title: "One summary", sub: "DEMO" };
    const r = root(o.layer || "ui", "funnelIn");
    const x0 = S.zone.x, y0 = o.y ?? S.top, W0 = S.zone.w;
    const cw = (W0 - 18) / 2, ch = 92;
    const doc = mk("div", "fx-card", r, { left: px(x0 + W0 * 0.14), top: px(y0 + 230), width: px(W0 * 0.72), height: px(300), padding: "24px 28px" });
    mk("div", "fx-ui-txt", doc, { fontSize: px(32), fontWeight: 800, color: "#fff" }, out.title);
    mk("div", "fx-mono", doc, { fontSize: px(16), letterSpacing: ".16em", color: C.cyan, margin: "6px 0 18px" }, out.sub || "");
    const bars = inputs.map((_, i) => mk("div", "", doc, { height: px(16), borderRadius: px(8), marginBottom: px(16), width: [92, 78, 86, 64][i] + "%", background: i % 2 ? "rgba(185,178,200,.45)" : "rgba(53,214,230,.65)", transformOrigin: "0 50%" }));
    const stamp = mk("div", "fx-abs fx-ui-txt", doc, { right: px(22), bottom: px(18), fontSize: px(22), fontWeight: 800, color: C.ink, background: C.cyan, borderRadius: px(10), padding: "6px 14px" }, "✓ " + (out.stamp || "1 file"));
    const cards = inputs.map((it, i) => {
      const c = mk("div", "fx-glass", r, { left: px(x0 + (i % 2) * (cw + 18)), top: px(y0 + Math.floor(i / 2) * (ch + 14)), width: px(cw), height: px(ch), borderRadius: px(18), display: "flex", alignItems: "center", gap: "14px", padding: "0 16px" });
      nodeIcon(c, it, 56);
      const t = mk("div", "", c, { minWidth: 0 });
      mk("div", "fx-ui-txt", t, { fontSize: px(26), fontWeight: 700, color: "#fff", whiteSpace: "nowrap" }, it.label);
      mk("div", "fx-mono", t, { fontSize: px(15), color: C.lavHi, whiteSpace: "nowrap" }, it.sub || "");
      return c;
    });
    life(tl, r, at, at + d, 0.01);
    cards.forEach((c, i) => tl.from(c, { y: -30, opacity: 0, duration: 0.25, ease: "power3.out" }, at + i * 0.06));
    tl.from(doc, { y: 40, opacity: 0, duration: 0.3, ease: "power3.out" }, at + 0.25);
    tl.set(bars, { scaleX: 0 }, at);
    cards.forEach((c, i) => {
      const t0 = at + 0.65 + i * 0.16;
      const dx = (x0 + W0 / 2) - (parseFloat(c.style.left) + cw / 2), dy = (y0 + 330) - (parseFloat(c.style.top) + ch / 2);
      tl.to(c, { x: dx, y: dy, scale: 0.25, opacity: 0, duration: 0.32, ease: "power2.in" }, t0);
      tl.to(bars[i], { scaleX: 1, duration: 0.25, ease: "power3.out" }, t0 + 0.28);
    });
    tl.from(stamp, { scale: 0, duration: 0.25, ease: "back.out(3)" }, at + 0.65 + inputs.length * 0.16 + 0.3);
    return at + d;
  };

  // Procedural 3D fallbacks, built from three.js primitives (no model files, no licensing questions).
  function rrShape(T, w, h, r) {
    const s = new T.Shape(), x = -w / 2, y = -h / 2;
    s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
    s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
    s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
    return s;
  }
  function flatPanel(T, w, h, r, mat) { // rounded flat panel with 0..1 UVs (so a canvas texture maps edge to edge)
    const g = new T.ShapeGeometry(rrShape(T, w, h, r), 12), uv = g.attributes.uv, pos = g.attributes.position;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / w + 0.5, pos.getY(i) / h + 0.5);
    uv.needsUpdate = true;
    return new T.Mesh(g, mat);
  }
  function slab(T, w, h, r, depth, mat) {
    const g = new T.ExtrudeGeometry(rrShape(T, w, h, r), { depth, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 4, curveSegments: 12 });
    return new T.Mesh(g, mat);
  }
  // A generic phone: body + glass screen (named like the GLB's screen node so phoneFeed can find it) + camera bump.
  function proceduralPhone(T) {
    const g = new T.Group();
    g.add(slab(T, 2.0, 4.1, 0.34, 0.2, new T.MeshStandardMaterial({ color: 0x2a2833, metalness: 0.85, roughness: 0.28 })));
    const scr = flatPanel(T, 1.86, 3.96, 0.27, new T.MeshBasicMaterial({ color: 0x000000 }));
    scr.name = "replaceable-screen-content"; scr.position.z = 0.245; g.add(scr);
    const island = flatPanel(T, 0.5, 0.14, 0.07, new T.MeshBasicMaterial({ color: 0x000000 }));
    island.position.set(0, 1.78, 0.25); g.add(island);
    const bump = slab(T, 0.82, 0.82, 0.2, 0.06, new T.MeshStandardMaterial({ color: 0x3a3846, metalness: 0.7, roughness: 0.3 }));
    bump.position.set(-0.45, 1.45, -0.1); bump.rotation.y = Math.PI; g.add(bump);
    return g;
  }
  // A generic terminal window: graphite shell, three window dots, a lit display drawn on a canvas.
  function proceduralTerminal(T, o) {
    const g = new T.Group(), cw = 1024, ch = 600, cv = document.createElement("canvas");
    cv.width = cw; cv.height = ch;
    const c = cv.getContext("2d"), tex = new T.CanvasTexture(cv); tex.encoding = T.sRGBEncoding;
    const paint = () => {
      c.fillStyle = "#0B0D14"; c.fillRect(0, 0, cw, ch);
      c.font = "700 54px 'JetBrains Mono', Menlo, monospace"; c.fillStyle = C.magenta; c.fillText("✻ Claude Code", 60, 120);
      c.font = "500 46px 'JetBrains Mono', Menlo, monospace"; c.fillStyle = C.cyan; c.fillText(">", 60, 230);
      c.fillStyle = "#fff"; c.fillText(o.line || "make it move", 110, 230);
      c.fillStyle = C.lavHi; c.fillText(o.status || "⏺ Built 1 composition", 60, 330);
      c.fillStyle = "#fff"; c.fillRect(60, 380, 26, 50);
      tex.needsUpdate = true;
    };
    g.userData.paint = paint;
    g.add(slab(T, 4.4, 3.0, 0.3, 0.32, new T.MeshStandardMaterial({ color: 0x16151c, metalness: 0.5, roughness: 0.42 })));
    const scr = flatPanel(T, 4.0, 2.3, 0.14, new T.MeshBasicMaterial({ map: tex, toneMapped: false }));
    scr.position.set(0, -0.2, 0.37); g.add(scr);
    [0xff5f57, 0xfebc2e, 0x28c840].forEach((col, i) => {
      const dot = new T.Mesh(new T.SphereGeometry(0.09, 24, 24), new T.MeshStandardMaterial({ color: col, roughness: 0.3 }));
      dot.position.set(-1.85 + i * 0.3, 1.18, 0.38); g.add(dot);
    });
    return g;
  }

  /** 29 Real 3D model: loads your GLB (o.src) or, with no src, builds a procedural terminal (or o.kind: "phone").
      Recolors to Signal, turns once then drifts. Needs three.js + GLTFLoader (+ RoomEnvironment) scripts.
      The renderer waits until models load. */
  FX.model3D = function (tl, at, o = {}) {
    const d = o.dur ?? 2.2, T = window.THREE;
    const r = root(o.layer || "behind", "model3D");
    const x = o.x ?? 90, y = o.y ?? 100, w = o.w ?? 900, h = o.h ?? 760;
    const cv = mk("canvas", "fx-abs", r, { left: px(x), top: px(y), width: px(w), height: px(h) });
    cv.width = w; cv.height = h;
    if (!T || !T.GLTFLoader) { console.warn("[FX.model3D] three.js / GLTFLoader not loaded"); return at + d; }
    const ren = new T.WebGLRenderer({ canvas: cv, alpha: true, antialias: true, preserveDrawingBuffer: true });
    ren.setPixelRatio(1); ren.setSize(w, h, false);
    ren.outputEncoding = T.sRGBEncoding; ren.toneMapping = T.ACESFilmicToneMapping; ren.toneMappingExposure = 1.05;
    const scn = new T.Scene(), cam = new T.PerspectiveCamera(30, w / h, 0.1, 100);
    cam.position.set(0, 0.35, 9.5); cam.lookAt(0, 0, 0);
    if (T.RoomEnvironment) scn.environment = new T.PMREMGenerator(ren).fromScene(new T.RoomEnvironment(), 0.04).texture;
    scn.add(new T.AmbientLight(0xffffff, 0.35));
    const k = new T.DirectionalLight(0xffffff, 1.4); k.position.set(3, 5, 6); scn.add(k);
    const l1 = new T.PointLight(0x7A4DFF, 3, 40); l1.position.set(-5, 2, 4); scn.add(l1);
    const l2 = new T.PointLight(0x35D6E6, 2.4, 40); l2.position.set(5, -2, 4); scn.add(l2);
    const grp = new T.Group(); scn.add(grp);
    const pal = [0x7A4DFF, 0x35D6E6, 0xC44DF0];
    const tint = o.tint ?? "signal";
    const job = new Promise((res) => {
      const loadModel = (onLoad, onErr) => {
        if (!o.src) {
          const m = o.kind === "phone" ? proceduralPhone(T) : proceduralTerminal(T, o);
          const done = () => { if (m.userData.paint) m.userData.paint(); onLoad({ scene: m }); };
          return document.fonts && document.fonts.ready ? document.fonts.ready.then(done) : done();
        }
        new T.GLTFLoader().load(o.src, onLoad, undefined, onErr);
      };
      loadModel((g) => {
        const m = g.scene, bb = new T.Box3().setFromObject(m), sz = bb.getSize(new T.Vector3()), c = bb.getCenter(new T.Vector3());
        m.position.sub(c); const wrap = new T.Group(); wrap.add(m); wrap.scale.setScalar((o.size ?? 4.2) / Math.max(sz.x, sz.y, sz.z));
        let pi = 0; const seen = new Map();
        if (tint === "signal") m.traverse((ch) => {
          if (!ch.isMesh || !ch.material) return;
          const mats = Array.isArray(ch.material) ? ch.material : [ch.material];
          ch.material = mats.map((mt) => {
            if (seen.has(mt)) return seen.get(mt);
            const nm = mt.clone(), hsl = {}; nm.color && nm.color.getHSL(hsl);
            if (nm.color && !nm.map && hsl.s > 0.3) { nm.color.setHex(pal[pi++ % pal.length]); if (nm.emissive) { nm.emissive.setHex(nm.color.getHex()); nm.emissiveIntensity = 0.12; } }
            seen.set(mt, nm); return nm;
          });
          if (ch.material.length === 1) ch.material = ch.material[0];
        });
        grp.add(wrap); res();
      }, (e) => { console.warn("[FX.model3D] load failed", o.src, e); res(); });
    });
    S.pending.push(job);
    const p = { v: 0 };
    const draw = () => {
      const t = p.v * d, ein = Math.min(1, t / 0.18), eout = Math.min(1, (d - t) / 0.2);
      const spin = 1 - Math.pow(1 - Math.min(1, t / 0.6), 3);
      grp.scale.setScalar(Math.max(0.001, Math.min(ein, eout) * (0.85 + 0.15 * spin)));
      grp.rotation.set((o.tilt ?? 0.18) + Math.sin(t * 0.8) * 0.06, -Math.PI * 2 * (1 - spin) + (o.face ?? -0.35) + t * 0.18, 0);
      ren.render(scn, cam);
    };
    job.then(draw);
    life(tl, r, at, at + d, 0.05, 0.08);
    tl.to(p, { v: 1, duration: d, ease: "none", onUpdate: draw }, at);
    return at + d;
  };


  /** 30 Phone feed: a 3D phone spins in with a reel feed scrolling on its screen, then the camera dives
      into the screen and the feed takes over the whole frame. Needs the 3D scripts. Uses a built-in
      procedural phone unless you pass your own GLB (o.src, screen mesh named o.screenNode).
      opts: images[] (your own reels, 9:16), captions[], handle, src (GLB), screenNode */
  const FEED_ICONS = {
    heart: "M12 20.5s-7.5-4.6-9.3-9.2C1.4 7.8 3.6 4.5 7 4.5c2 0 3.6 1.1 5 3 1.4-1.9 3-3 5-3 3.4 0 5.6 3.3 4.3 6.8-1.8 4.6-9.3 9.2-9.3 9.2z",
    bubble: "M20.5 11.6a8.4 8.4 0 01-12.3 7.5L3.5 20.5l1.4-4.6a8.4 8.4 0 1115.6-4.3z",
    send: "M21 3L10 14M21 3l-7 18-4-7-7-4 18-7z",
    save: "M6 3.5h12v17l-6-4.5-6 4.5z",
  };
  function drawFeed(c, W0, H0, scroll, t, imgs, o) {
    c.fillStyle = "#000"; c.fillRect(0, 0, W0, H0);
    const n = imgs.length, u = W0 / 100;
    const i0 = Math.floor(scroll), fr = scroll - i0;
    for (const k of [i0, i0 + 1]) {
      const y = (k - scroll) * H0;
      if (y >= H0 || y <= -H0) continue;
      const im = imgs[((k % n) + n) % n];
      c.save(); c.beginPath(); c.rect(0, y, W0, H0); c.clip();
      if (im && im.complete && im.naturalWidth) {
        const zoom = 1 + 0.04 * Math.min(1, Math.max(0, t - k * 0.3) * 0.5);
        const s = Math.max(W0 / im.naturalWidth, H0 / im.naturalHeight) * zoom;
        const dw = im.naturalWidth * s, dh = im.naturalHeight * s;
        c.drawImage(im, (W0 - dw) / 2, y + (H0 - dh) / 2, dw, dh);
      }
      const g = c.createLinearGradient(0, y + H0 * 0.55, 0, y + H0);
      g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0,.72)");
      c.fillStyle = g; c.fillRect(0, y + H0 * 0.55, W0, H0 * 0.45);
      // right rail
      const counts = o.counts || ["24.1K", "3,094", "1,210", "8,866"];
      ["heart", "bubble", "send", "save"].forEach((key, j) => {
        const cx = W0 - 9 * u, cy = y + H0 * 0.6 + j * 13.5 * u, sc = 7 * u / 24;
        c.save(); c.translate(cx - 3.5 * u, cy - 3.5 * u); c.scale(sc, sc);
        const pth = new Path2D(FEED_ICONS[key]);
        c.lineWidth = 1.9; c.strokeStyle = "#fff"; c.lineJoin = "round";
        if (key === "heart" && k === i0 && o.likeAt != null && t > o.likeAt) { c.fillStyle = C.magenta; c.fill(pth); }
        c.stroke(pth); c.restore();
        c.fillStyle = "#fff"; c.font = `600 ${3.1 * u}px Inter, Arial`; c.textAlign = "center";
        c.fillText(counts[j], cx, cy + 6.4 * u);
      });
      // handle row + caption
      c.textAlign = "left";
      const ay = y + H0 * 0.86;
      const ag = c.createLinearGradient(4 * u, ay - 4 * u, 12 * u, ay + 4 * u);
      ag.addColorStop(0, C.violet); ag.addColorStop(1, C.cyan);
      c.fillStyle = ag; c.beginPath(); c.arc(8.5 * u, ay, 4.4 * u, 0, Math.PI * 2); c.fill();
      c.lineWidth = 0.5 * u; c.strokeStyle = "#fff"; c.stroke();
      c.fillStyle = "#fff"; c.font = `700 ${3.9 * u}px Inter, Arial`; c.fillText(o.handle || "your_handle", 15.5 * u, ay + 1.4 * u);
      const hw = c.measureText(o.handle || "your_handle").width;
      c.strokeStyle = "rgba(255,255,255,.85)"; c.lineWidth = 0.35 * u;
      c.beginPath(); c.roundRect ? c.roundRect(17.5 * u + hw, ay - 3.1 * u, 15 * u, 5.8 * u, 1.4 * u) : c.rect(17.5 * u + hw, ay - 3.1 * u, 15 * u, 5.8 * u); c.stroke();
      c.font = `600 ${3.1 * u}px Inter, Arial`; c.fillText("Follow", 19.4 * u + hw, ay + 1.1 * u);
      const caps = o.captions || [];
      c.font = `500 ${3.4 * u}px Inter, Arial`; c.fillStyle = "rgba(255,255,255,.95)";
      c.fillText(caps.length ? caps[((k % caps.length) + caps.length) % caps.length] : "", 4.5 * u, ay + 9 * u);
      // progress bar
      c.fillStyle = "rgba(255,255,255,.3)"; c.fillRect(0, y + H0 - 0.6 * u, W0, 0.6 * u);
      c.fillStyle = "#fff"; c.fillRect(0, y + H0 - 0.6 * u, W0 * (k === i0 ? Math.min(1, 0.2 + (t % 0.6) / 0.6 * 0.6) : 0.05), 0.6 * u);
      c.restore();
    }
    // top bar (fixed)
    c.fillStyle = "#fff"; c.textAlign = "left"; c.font = `800 ${5.2 * u}px Inter, Arial`;
    c.fillText(o.title || "Reels", 5 * u, (o.topPad ?? 13) * u);
  }

  FX.phoneFeed = function (tl, at, o = {}) {
    const d = o.dur ?? 3.6, T = window.THREE;
    const imgsSrc = o.images || [];
    const r = root("ui", "phoneFeed");
    const imgs = imgsSrc.map((src) => { const im = mk("img", "", r, { position: "absolute", width: px(2), height: px(2), opacity: 0.01, left: 0, top: 0 }); im.src = src; return im; });
    const cv = mk("canvas", "fx-abs", r, { left: 0, top: 0, width: px(W), height: px(H) });
    cv.width = W; cv.height = H;
    const flat = mk("canvas", "fx-abs", r, { left: 0, top: 0, width: px(W), height: px(H), opacity: 0 });
    flat.width = W; flat.height = H;
    const fctx = flat.getContext("2d");
    const SW = 720, SH = 1560, sc = document.createElement("canvas"); sc.width = SW; sc.height = SH;
    const sctx = sc.getContext("2d");
    if (!T || !T.GLTFLoader) { console.warn("[FX.phoneFeed] three.js / GLTFLoader not loaded"); return at + d; }
    // timing (fractions of d)
    const tSpin = 0.7, tDolly0 = d * 0.47, tDolly1 = d * 0.7, tFlat = tDolly1 - 0.04, tOut = d - 0.34;
    const swipes = o.swipes || [0.95, 1.5, d * 0.62, d * 0.8];
    const scrollAt = (t) => swipes.reduce((acc, s0) => acc + Math.min(1, Math.max(0, (t - s0) / 0.3)) ** 2 * (3 - 2 * Math.min(1, Math.max(0, (t - s0) / 0.3))), 0);
    const ren = new T.WebGLRenderer({ canvas: cv, alpha: true, antialias: true, preserveDrawingBuffer: true });
    ren.setPixelRatio(1); ren.setSize(W, H, false);
    ren.outputEncoding = T.sRGBEncoding; ren.toneMapping = T.ACESFilmicToneMapping;
    const scn = new T.Scene(), FOV = 30, tanH = Math.tan((FOV / 2) * Math.PI / 180), asp = W / H;
    const cam = new T.PerspectiveCamera(FOV, asp, 0.05, 100);
    if (T.RoomEnvironment) scn.environment = new T.PMREMGenerator(ren).fromScene(new T.RoomEnvironment(), 0.04).texture;
    scn.add(new T.AmbientLight(0xffffff, 0.3));
    const kl = new T.DirectionalLight(0xffffff, 1.2); kl.position.set(3, 5, 8); scn.add(kl);
    const l1 = new T.PointLight(0x7A4DFF, 3, 60); l1.position.set(-6, 3, 6); scn.add(l1);
    const l2 = new T.PointLight(0x35D6E6, 2.4, 60); l2.position.set(6, -3, 6); scn.add(l2);
    const grp = new T.Group(); scn.add(grp);
    const tex = new T.CanvasTexture(sc); tex.encoding = T.sRGBEncoding;
    tex.flipY = o.flipY ?? true; // built-in phone screen UVs run bottom-up; set false if your GLB's screen shows upside down
    const PH = 4.0, zFar = (PH * H / (o.phonePx ?? 980)) / 2 / tanH, yUp = ((960 - (o.phoneY ?? 640)) / H) * (2 * zFar * tanH);
    let screen = null, target = null;
    const job = new Promise((res) => {
      const onModel = (g) => {
        const m = g.scene, bb = new T.Box3().setFromObject(m), sz = bb.getSize(new T.Vector3()), c0 = bb.getCenter(new T.Vector3());
        m.position.sub(c0);
        const wrap = new T.Group(); wrap.add(m); wrap.scale.setScalar(PH / sz.y); grp.add(wrap); grp.position.y = yUp;
        m.traverse((ch) => { if (ch.isMesh && (ch.name === (o.screenNode || "replaceable-screen-content") || (ch.parent && ch.parent.name === (o.screenNode || "replaceable-screen-content")))) screen = ch; });
        if (screen) screen.material = new T.MeshBasicMaterial({ map: tex, toneMapped: false });
        grp.updateMatrixWorld(true);
        const sb = screen ? new T.Box3().setFromObject(screen) : new T.Box3().setFromObject(grp);
        const ssz = sb.getSize(new T.Vector3()), sc0 = sb.getCenter(new T.Vector3());
        const dist = Math.min((ssz.y / 2) / tanH, (ssz.x / 2) / (tanH * asp)) * 0.94;
        target = { x: sc0.x, y: sc0.y, z: sb.max.z + dist };
        res();
      };
      if (o.src) new T.GLTFLoader().load(o.src, onModel, undefined, (e) => { console.warn("[FX.phoneFeed] load failed, using the built-in phone", e); onModel({ scene: proceduralPhone(T) }); });
      else onModel({ scene: proceduralPhone(T) });
    });
    S.pending.push(job);
    const ease = (k) => (k <= 0 ? 0 : k >= 1 ? 1 : k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
    const p = { v: 0 };
    const draw = () => {
      const t = p.v * d, scroll = scrollAt(t);
      drawFeed(sctx, SW, SH, scroll, t, imgs, Object.assign({ topPad: 15 }, o)); tex.needsUpdate = true;
      const kin = Math.min(1, t / 0.2), spin = 1 - Math.pow(1 - Math.min(1, t / tSpin), 3);
      const dz = ease((t - tDolly0) / (tDolly1 - tDolly0));
      grp.scale.setScalar(Math.max(0.001, kin * (0.8 + 0.2 * spin)));
      grp.rotation.set((0.16 + Math.sin(t * 0.9) * 0.05) * (1 - dz), (-Math.PI * 2 * (1 - spin) + Math.sin(t * 0.7) * 0.18 * spin) * (1 - dz), 0);
      const tg = target || { x: 0, y: yUp, z: 4 };
      cam.position.set(tg.x * dz, tg.y * dz, zFar + (tg.z - zFar) * dz);
      cam.lookAt(cam.position.x, cam.position.y, cam.position.z - 1);
      ren.render(scn, cam);
      if (t >= tFlat - 0.05) drawFeed(fctx, W, H, scroll, t, imgs, Object.assign({ topPad: 11 }, o));
    };
    job.then(draw);
    life(tl, r, at, at + d, 0.05, 0.05);
    tl.to(p, { v: 1, duration: d, ease: "none", onUpdate: draw }, at);
    tl.to(flat, { opacity: 1, duration: 0.14, ease: "power1.inOut" }, at + tFlat);
    tl.set(cv, { opacity: 0 }, at + tFlat + 0.15);
    tl.to(flat, { y: -H, filter: "blur(26px)", duration: 0.3, ease: "power2.in" }, at + tOut);
    if (o.dimHud !== false) dimHud(at, at + d, true);
    return at + d;
  };

  // ---------------------------------------------------------------- default sound per effect
  // [time from start (negative = from end), sound-fx id, gain]
  FX.DEFAULT_CUES = {
    kineticHook: [[0.05, "ui-toggle", 0.8]], gravityDrop: [[0.55, "ui-drop"]], giantCaption: [[0.05, "ui-pluck"]],
    promptBar: [[0.62, "ui-click-precise"], [0.8, "ui-confirm-chime"]], storyboardDeck: [[0.05, "ui-swipe"]],
    iconStrike: [[0.03, "ui-pluck"], [0.4, "ui-back"]], fileDrop: [[0.0, "ui-open"], [0.4, "ui-drop"], [-0.55, "ui-expand"]],
    nleTimeline: [[0.0, "ui-open"]], jiggleDelete: [[0.14, "ui-pluck"], [0.5, "ui-back"]], gradeSlider: [[0.05, "ui-toggle"]],
    eyedropperGrade: [[0.4, "ui-click-precise"], [0.72, "ui-toggle"]], filmLook: [[0.0, "ui-toggle"]],
    titleCard: [[0.6, "ui-collapse"], [-0.34, "ui-expand"]], playingGrid: [[0.03, "ui-swipe"]], reelFeed: [[0.0, "ui-scroll", 0.8]],
    videoCard: [[0.0, "ui-open"]], commentCTA: [[0.58, "ui-click-precise"], [0.98, "ui-confirm-chime"]], commentDrop: [[0.05, "ui-glass-tick"]],
    terminalReveal: [[0.0, "ui-open"], [1.22, "ui-confirm-chime"]], labPanel: [[0.0, "ui-open"], [1.0, "ui-glass-tick"]],
    faceCallout: [[0.12, "ui-pluck"]], thanosSnap: [[0.42, "ui-swipe"]], numberClimb: [[1.0, "ui-glass-tick"]],
    multiverse: [[0.36, "ui-expand"], [-0.56, "ui-collapse"]], orbit3D: [[0.0, "ui-pluck"]],
    systemMap: [[0.02, "ui-open"], [0.9, "ui-confirm-chime", 0.7]], toolOrbit: [[0.1, "ui-pluck"], [0.7, "ui-glass-tick"]],
    funnelIn: [[0.65, "ui-swipe"], [1.6, "ui-drop"]], model3D: [[0.0, "ui-toggle", 0.8]],
    phoneFeed: [[0.0, "ui-toggle", 0.8], [0.95, "ui-scroll", 0.6], [-1.15, "ui-expand"], [-0.34, "ui-swipe"]],
  };
  Object.keys(FX.DEFAULT_CUES).forEach((name) => {
    const f = FX[name];
    FX[name] = function (tl, at, o = {}) {
      const end = f(tl, at, o);
      if (o.sfx !== false) FX.DEFAULT_CUES[name].forEach(([rt, id, g]) => cue(rt < 0 ? end + rt : at + rt, id, g ?? 1));
      return end;
    };
  });

  /** Resolves when every async asset (3D models) is ready; Hyperframes waits on it too. */
  FX.ready = function () { return Promise.all(S.pending); };

  // ---------------------------------------------------------------- catalog (for tooling)
  FX.catalog = [
    ["kineticHook", "behind", "hook line"], ["gravityDrop", "behind", "playful title"], ["giantCaption", "ui", "emphasis word"],
    ["promptBar", "ui", "show a prompt"], ["storyboardDeck", "ui-low", "show past work"], ["iconStrike", "ui", "kill an old tool"],
    ["fileDrop", "ui+copy", "raw footage in"], ["nleTimeline", "ui-low", "editing claim"], ["jiggleDelete", "ui-low", "delete apps"],
    ["gradeSlider", "grade", "before/after"], ["eyedropperGrade", "grade+ui", "color/brand pull"], ["filmLook", "grade", "cinematic beat"],
    ["titleCard", "under+scene", "chapter / section"], ["playingGrid", "behind", "volume of work"], ["reelFeed", "ui+scene", "cut to a reference post"],
    ["videoCard", "ui+copy", "raw vs finished"], ["commentCTA", "ui", "CTA"], ["commentDrop", "behind+ui", "CTA finale"],
    ["terminalReveal", "ui", "show the prompt that made it"], ["labPanel", "ui", "health data (demo)"], ["faceCallout", "ui+scene", "point at yourself"],
    ["thanosSnap", "ui", "make a thing disappear"], ["numberClimb", "ui", "proof numbers"], ["multiverse", "under+scene+copies", "versions / options"],
    ["orbit3D", "behind", "3D object (molecule)"],
    ["systemMap", "ui", "a system: hub + spokes"], ["toolOrbit", "ui", "\"N tools\" count with logos circling"],
    ["funnelIn", "ui", "many inputs -> one output"], ["model3D", "behind", "3D model (your GLB or the built-in terminal)"],
    ["phoneFeed", "ui", "3D phone with a scrolling reel feed, dives into a full-frame takeover"],
  ];
  window.FX = FX;
})();
