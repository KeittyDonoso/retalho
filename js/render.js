// Draws one frame of the project at output time T onto a 2D canvas.
// The preview and the export both use this, so what you see is what you get.

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const ease = (p) => 1 - Math.pow(1 - clamp(p, 0, 1), 3);
const back = (p) => { p = clamp(p, 0, 1); const c = 1.7; return 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2); };
const tri = (p) => 1 - Math.abs(2 * clamp(p, 0, 1) - 1); // 0 → 1 → 0
const rnd = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

export const TR_LEN = 0.5;

const STYLE = {
  limpa: { family: "Figtree", weight: 800, fill: "#ffffff", hl: "#ffffff", dim: 0.72, shadow: "rgba(0,0,0,.85)" },
  impacto: { family: "Anton", weight: 400, upper: true, fill: "#ffffff", hl: "#ffd60a", stroke: "#000000", size: 1.15 },
  manuscrita: { family: "Caveat", weight: 700, fill: "#ffffff", hl: "#ff8a52", shadow: "rgba(0,0,0,.8)", size: 1.3 },
  marcador: { family: "Figtree", weight: 800, fill: "#111111", hl: "#111111", box: "#ffffff", hlBox: "#d4ff3a" },
  neon: { family: "Figtree", weight: 800, fill: "#ffffff", hl: "#ffffff", glow: "#ff4f12", dim: 0.8 },
  etiqueta: { family: "Figtree", weight: 800, upper: true, fill: "#050506", hl: "#050506", pill: "#ff4f12", size: 0.85 },
};

export function fitRect(iw, ih, W, H, mode) {
  const s = mode === "cover" ? Math.max(W / iw, H / ih) : Math.min(W / iw, H / ih);
  return [(W - iw * s) / 2, (H - ih * s) / 2, iw * s, ih * s];
}

/**
 * env: { proj, layout, total, sources, lib(kind,id) -> HTMLVideoElement, hits?: [] }
 */
export function drawFrame(g, W, H, T, env) {
  const k = Math.min(W, H) / 1080;
  const { proj, layout } = env;
  g.save();
  g.fillStyle = "#000"; g.fillRect(0, 0, W, H);
  const i = layout.findIndex((it) => T < it.t1);
  const it = layout[i < 0 ? layout.length - 1 : i];
  const active = (list) => list.filter((x) => T >= x.t0 && T < x.t1);
  const fx = active(proj.fx);

  if (it) drawClip(g, W, H, k, T, it, fx, env);

  // light overlays from the editonny library, blended like light on film
  for (const f of fx) {
    if (f.type !== "light") continue;
    const el = env.lib("light", f.ref);
    if (el && el.readyState >= 2) {
      g.save(); g.globalCompositeOperation = "screen"; g.globalAlpha = fadeIn(f, T) * (f.amount ?? 0.8);
      const [x, y, w, h] = fitRect(el.videoWidth, el.videoHeight, W, H, "cover"); g.drawImage(el, x, y, w, h); g.restore();
    }
  }
  for (const f of fx) drawEffect(g, W, H, k, T, f);
  for (const f of fx) if (f.type === "mark") drawMark(g, W, H, k, T, f, env);

  // captions follow the source footage, so they stay right after cuts and reordering
  if (it && it.clip.type === "video" && proj.cap.on) {
    const c = it.clip, st = c.s + (T - it.t0) * c.speed;
    for (const cap of proj.captions) {
      if (cap.src === c.src && st >= cap.s0 && st < cap.s1) {
        drawText(g, W, H, k, { ...proj.cap, id: cap.id, kind: "caption", text: cap.text, words: cap.words, x: 0.5, t0: it.t0 + (cap.s0 - c.s) / c.speed, t1: it.t0 + (cap.s1 - c.s) / c.speed }, T, st, env);
      }
    }
  }
  for (const t of active(proj.texts)) drawText(g, W, H, k, t, T, null, env);

  // transitions sit on the cut, strongest at the cut itself
  for (let n = 1; n < layout.length; n++) {
    const tr = layout[n].clip.tr; if (!tr || tr === "none" || tr === "zoom") continue;
    const p = (T - (layout[n].t0 - TR_LEN / 2)) / TR_LEN; if (p <= 0 || p >= 1) continue;
    drawTransition(g, W, H, k, tr, p, T);
  }
  g.restore();
}

function fadeIn(f, T) { return clamp((T - f.t0) / 0.3, 0, 1) * clamp((f.t1 - T) / 0.3, 0, 1); }

function drawClip(g, W, H, k, T, it, fx, env) {
  const c = it.clip;
  let el, iw, ih, mode;
  if (c.type === "video") {
    const s = env.sources.get(c.src); if (!s) return;
    el = s.el; iw = s.w; ih = s.h; mode = c.fit || "contain";
  } else {
    el = env.lib("bg", c.bg); iw = el && el.videoWidth || 1080; ih = el && el.videoHeight || 1920; mode = "cover";
  }
  // movement: slow zoom, shake, zoom transition
  let scale = 1, dx = 0, dy = 0;
  for (const f of fx) {
    if (f.type === "zoomin") scale *= 1 + 0.15 * (f.amount ?? 0.7) * clamp((T - f.t0) / (f.t1 - f.t0), 0, 1);
    if (f.type === "shake") { const a = 22 * k * (f.amount ?? 0.7); dx += Math.sin(T * 61) * a; dy += Math.cos(T * 47) * a; }
  }
  const tz = zoomTransition(env.layout, T); scale *= 1 + 0.3 * tz;
  const filter = filterFor(fx);
  g.save();
  g.translate(W / 2 + dx, H / 2 + dy); g.scale(scale, scale); g.translate(-W / 2, -H / 2);
  if (el && el.readyState >= 2) {
    if (mode === "blur") {
      const [x, y, w, h] = fitRect(iw, ih, W, H, "cover");
      g.save(); g.filter = "blur(" + Math.round(40 * k) + "px) brightness(0.6)"; g.globalAlpha = g.filter === "none" ? 0.35 : 1;
      g.drawImage(el, x - 40 * k, y - 40 * k, w + 80 * k, h + 80 * k); g.restore();
    }
    const [x, y, w, h] = fitRect(iw, ih, W, H, mode === "cover" ? "cover" : "contain");
    if (filter) g.filter = filter;
    g.drawImage(el, x, y, w, h);
    g.filter = "none";
  } else if (c.type === "card") {
    g.fillStyle = "#17171b"; g.fillRect(0, 0, W, H);
  }
  g.restore();
  if (c.type === "card") drawCard(g, W, H, k, T, it);
}

function zoomTransition(layout, T) {
  let z = 0;
  for (let n = 1; n < layout.length; n++) {
    if (layout[n].clip.tr !== "zoom") continue;
    const p = (T - (layout[n].t0 - TR_LEN / 2)) / TR_LEN;
    if (p > 0 && p < 1) z = Math.max(z, tri(p));
  }
  return z;
}

function filterFor(fx) {
  const f = [];
  for (const e of fx) {
    const a = e.amount ?? 0.7;
    if (e.type === "noir") f.push(`grayscale(1) contrast(${1 + 0.25 * a})`);
    if (e.type === "warm") f.push(`sepia(${0.45 * a}) saturate(${1 + 0.3 * a})`);
    if (e.type === "cool") f.push(`hue-rotate(${-18 * a}deg) saturate(${1 - 0.15 * a}) brightness(1.03)`);
    if (e.type === "glow") f.push(`brightness(${1 + 0.18 * a}) saturate(${1 + 0.4 * a}) contrast(1.05)`);
    if (e.type === "blur") f.push(`blur(${Math.round(4 + 14 * a)}px)`);
  }
  return f.join(" ");
}

function drawCard(g, W, H, k, T, it) {
  const c = it.clip, t = T - it.t0;
  g.save();
  g.textAlign = "center"; g.textBaseline = "middle";
  const p1 = back(t / 0.45), a1 = clamp(t / 0.25, 0, 1);
  const fs = 110 * k;
  g.font = `800 ${fs}px Figtree, system-ui, sans-serif`;
  const lines = wrap(g, c.title || "", W * 0.84);
  const lh = fs * 1.05, top = H / 2 - (lines.length * lh) / 2 - (c.sub ? 40 * k : 0);
  g.globalAlpha = a1;
  lines.forEach((l, n) => {
    g.save(); g.translate(W / 2, top + lh * (n + 0.5)); g.scale(0.7 + 0.3 * p1, 0.7 + 0.3 * p1);
    g.shadowColor = "rgba(0,0,0,.45)"; g.shadowBlur = 30 * k; g.fillStyle = "#fff"; g.fillText(l, 0, 0); g.restore();
  });
  if (c.sub) {
    const p2 = ease((t - 0.3) / 0.4);
    g.globalAlpha = clamp((t - 0.3) / 0.3, 0, 1);
    g.font = `600 ${fs * 0.4}px Figtree, system-ui, sans-serif`;
    const y = top + lh * lines.length + 50 * k + (1 - p2) * 30 * k;
    const tw = g.measureText(c.sub).width + 60 * k;
    g.fillStyle = "rgba(255,255,255,.14)"; roundRect(g, W / 2 - tw / 2, y - 34 * k, tw, 68 * k, 34 * k); g.fill();
    g.fillStyle = "#fff"; g.fillText(c.sub, W / 2, y);
  }
  g.restore();
}

function drawEffect(g, W, H, k, T, f) {
  const a = f.amount ?? 0.7, t = T - f.t0, alpha = fadeIn(f, T);
  if (f.type === "vignette") {
    const r = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.75);
    r.addColorStop(0, "rgba(0,0,0,0)"); r.addColorStop(1, `rgba(0,0,0,${0.85 * a * alpha})`);
    g.fillStyle = r; g.fillRect(0, 0, W, H);
  } else if (f.type === "cinema") {
    const h = H * 0.11 * ease(t / 0.5) * clamp((f.t1 - T) / 0.5, 0, 1) ** 0.5;
    g.fillStyle = "#000"; g.fillRect(0, 0, W, h); g.fillRect(0, H - h, W, h);
  } else if (f.type === "vhs") {
    g.save(); g.globalAlpha = alpha;
    g.fillStyle = "rgba(0,0,0,0.18)";
    for (let y = 0; y < H; y += 6 * k) g.fillRect(0, y, W, 2 * k);
    const band = ((T * 0.35) % 1.2) * H - 0.1 * H;
    g.fillStyle = "rgba(255,255,255,0.07)"; g.fillRect(0, band, W, H * 0.06);
    g.globalCompositeOperation = "screen"; g.fillStyle = "rgba(255,0,80,0.08)"; g.fillRect(3 * k, 0, W, H);
    g.globalCompositeOperation = "source-over";
    g.font = `700 ${46 * k}px "JetBrains Mono", ui-monospace, monospace`; g.fillStyle = "#fff"; g.textBaseline = "top";
    g.shadowColor = "#000"; g.shadowBlur = 6 * k;
    if (Math.floor(T * 1.5) % 2 === 0) g.fillText("▶ PLAY", 50 * k, 60 * k);
    const s = Math.floor(T), mm = String(Math.floor(s / 60)).padStart(2, "0"), ss = String(s % 60).padStart(2, "0");
    g.fillText(`0:${mm}:${ss}`, 50 * k, 120 * k);
    g.restore();
  } else if (f.type === "confetti" || f.type === "money" || f.type === "emojirain") {
    const n = Math.round(40 + 100 * a), colors = ["#ff4f12", "#d4ff3a", "#ffd60a", "#4dc3ff", "#ff3b5c", "#ffffff"];
    g.save(); g.globalAlpha = clamp((f.t1 - T) / 0.4, 0, 1);
    for (let i = 0; i < n; i++) {
      const sp = 0.25 + rnd(i) * 0.35, delay = rnd(i + 99) * 1.2;
      const y = -0.08 * H + (t - delay) * sp * H; if (y < -0.1 * H || y > H * 1.1) continue;
      const x = rnd(i + 7) * W + Math.sin(t * (1 + rnd(i + 3) * 2) + i) * 40 * k;
      g.save(); g.translate(x, y); g.rotate(t * (rnd(i + 5) * 6 - 3));
      if (f.type === "confetti") { g.fillStyle = colors[i % colors.length]; g.fillRect(-9 * k, -5 * k, 18 * k, 10 * k); }
      else { g.font = `${(f.type === "money" ? 64 : 58) * k * (0.7 + rnd(i + 11) * 0.6)}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(f.type === "money" ? "💵" : (f.emoji || "🔥"), 0, 0); }
      g.restore();
    }
    g.restore();
  }
}

function drawMark(g, W, H, k, T, f, env) {
  const t = T - f.t0, p = ease(t / 0.45), x = f.x * W, y = f.y * H, s = (f.size || 1) * k, col = f.color || "#ff4f12";
  const out = clamp((f.t1 - T) / 0.25, 0, 1);
  g.save(); g.globalAlpha = out; g.lineCap = "round"; g.lineJoin = "round";
  g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 14 * s;
  g.shadowColor = "rgba(0,0,0,.45)"; g.shadowBlur = 12 * s;
  let box = 130 * s;
  if (f.mark === "arrow") {
    const bob = Math.sin(t * 6) * 14 * s, tipY = y - 20 * s + bob, len = 170 * s * p;
    g.beginPath(); g.moveTo(x, tipY - len); g.lineTo(x, tipY); g.stroke();
    if (p > 0.6) { g.beginPath(); g.moveTo(x - 45 * s, tipY - 45 * s); g.lineTo(x, tipY); g.lineTo(x + 45 * s, tipY - 45 * s); g.stroke(); }
    box = 200 * s;
  } else if (f.mark === "circle") {
    g.beginPath(); g.ellipse(x, y, 170 * s, 120 * s, -0.12, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2.1 * p); g.stroke();
    box = 180 * s;
  } else if (f.mark === "check" || f.mark === "cross") {
    const b = back(t / 0.35), r = 90 * s * b;
    g.fillStyle = f.mark === "check" ? "#30d158" : "#ff453a";
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    g.shadowBlur = 0; g.strokeStyle = "#fff"; g.lineWidth = 16 * s * b;
    g.beginPath();
    if (f.mark === "check") { g.moveTo(x - 40 * s * b, y); g.lineTo(x - 10 * s * b, y + 30 * s * b); g.lineTo(x + 42 * s * b, y - 30 * s * b); }
    else { g.moveTo(x - 32 * s * b, y - 32 * s * b); g.lineTo(x + 32 * s * b, y + 32 * s * b); g.moveTo(x + 32 * s * b, y - 32 * s * b); g.lineTo(x - 32 * s * b, y + 32 * s * b); }
    g.stroke(); box = 100 * s;
  } else if (f.mark === "underline") {
    const w = 380 * s;
    g.beginPath(); g.moveTo(x - w / 2, y); g.quadraticCurveTo(x, y + 18 * s, x - w / 2 + w * p, y - 4 * s); g.stroke();
    box = 200 * s;
  } else if (f.mark === "box") {
    const w = 420 * s, h = 220 * s, per = 2 * (w + h), d = per * p;
    g.setLineDash([d, per]); roundRect(g, x - w / 2, y - h / 2, w, h, 26 * s); g.stroke(); g.setLineDash([]);
    box = 220 * s;
  } else if (f.mark === "spotlight") {
    g.shadowBlur = 0;
    g.fillStyle = `rgba(0,0,0,${0.72 * p})`;
    g.beginPath(); g.rect(0, 0, W, H); g.arc(x, y, 220 * s, 0, Math.PI * 2, true); g.fill("evenodd");
    box = 220 * s;
  } else if (f.mark === "sticker") {
    const b = back(t / 0.4);
    g.translate(x, y); g.scale(b, b); g.rotate(Math.sin(t * 3) * 0.08);
    g.font = `${200 * s}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(f.emoji || "😍", 0, 0);
  }
  g.restore();
  if (env.hits) env.hits.push({ kind: "fx", id: f.id, x0: x - box, y0: y - box, x1: x + box, y1: y + box });
}

function drawText(g, W, H, k, t, T, srcT, env) {
  const st = STYLE[t.style] || STYLE.limpa;
  const fs = 64 * k * (t.size || 1) * (st.size || 1);
  const raw = t.text || "";
  const words = (t.words && t.words.length ? t.words.map((w) => w.w) : raw.split(/\s+/)).filter(Boolean).map((w) => (st.upper ? w.toUpperCase() : w));
  if (!words.length) return;
  const life = T - t.t0, anim = t.anim || "pop";
  let shown = words.length;
  if (anim === "digitar") shown = Math.max(1, Math.ceil(words.length * clamp(life / Math.max(0.4, Math.min(1.2, words.length * 0.12)), 0, 1)));
  g.save();
  g.font = `${st.weight} ${fs}px "${st.family}", Figtree, system-ui, sans-serif`;
  g.textBaseline = "middle"; g.textAlign = "left";
  const space = g.measureText(" ").width, maxW = W * 0.86;
  // lay out words into lines
  const lines = [[]]; let lw = 0;
  words.forEach((w, n) => {
    const ww = g.measureText(w).width;
    if (lw > 0 && lw + space + ww > maxW) { lines.push([]); lw = 0; }
    lines[lines.length - 1].push({ w, ww, n }); lw += (lw > 0 ? space : 0) + ww;
  });
  const lh = fs * 1.22, padX = fs * 0.32;
  const cx = (t.x ?? 0.5) * W, cy = (t.y ?? 0.8) * H, blockH = lines.length * lh;
  let scale = 1, oy = 0, alpha = clamp((t.t1 - T) / 0.12, 0, 1);
  if (anim === "pop") scale = 0.6 + 0.4 * back(life / 0.28);
  if (anim === "subir") { const e = ease(life / 0.35); oy = (1 - e) * 50 * k; alpha *= e; }
  g.globalAlpha = alpha;
  g.translate(cx, cy + oy); g.scale(scale, scale);
  let curWord = -1;
  if (t.words && srcT != null) curWord = t.words.findIndex((w) => srcT >= w.s0 && srcT < w.s1);
  let maxLine = 0;
  lines.forEach((line, li) => {
    const width = line.reduce((a, x) => a + x.ww, 0) + space * (line.length - 1);
    maxLine = Math.max(maxLine, width);
    const y = -blockH / 2 + lh * (li + 0.5);
    let x = -width / 2;
    if (st.box || st.pill) {
      g.fillStyle = st.pill || st.box;
      roundRect(g, x - padX, y - lh / 2 + fs * 0.04, width + padX * 2, lh - fs * 0.08, st.pill ? lh / 2 : fs * 0.16); g.fill();
    }
    for (const wd of line) {
      if (wd.n >= shown) break;
      const on = wd.n === curWord;
      if (on && st.hlBox) { g.fillStyle = st.hlBox; roundRect(g, x - fs * 0.08, y - lh / 2 + fs * 0.1, wd.ww + fs * 0.16, lh - fs * 0.2, fs * 0.12); g.fill(); }
      g.save();
      if (st.glow) { g.shadowColor = st.glow; g.shadowBlur = fs * (on ? 0.6 : 0.35); }
      else if (st.shadow) { g.shadowColor = st.shadow; g.shadowBlur = fs * 0.25; g.shadowOffsetY = fs * 0.05; }
      if (st.stroke) { g.lineWidth = fs * 0.16; g.strokeStyle = st.stroke; g.lineJoin = "round"; g.strokeText(wd.w, x, y); }
      g.fillStyle = on ? st.hl : st.fill;
      if (curWord >= 0 && !on && st.dim) g.globalAlpha = alpha * st.dim;
      const bump = on && (t.style === "impacto") ? 1.08 : 1;
      if (bump !== 1) { g.translate(x + wd.ww / 2, y); g.scale(bump, bump); g.fillText(wd.w, -wd.ww / 2, 0); }
      else g.fillText(wd.w, x, y);
      g.restore();
      x += wd.ww + space;
    }
  });
  g.restore();
  if (env.hits && t.kind !== "caption") {
    const hw = (maxLine / 2 + padX) * scale, hh = (blockH / 2) * scale;
    env.hits.push({ kind: "text", id: t.id, x0: cx - hw, y0: cy - hh, x1: cx + hw, y1: cy + hh });
  }
  if (env.hits && t.kind === "caption") {
    const hw = maxLine / 2 + padX, hh = blockH / 2;
    env.hits.push({ kind: "caption", id: t.id, x0: cx - hw, y0: cy - hh, x1: cx + hw, y1: cy + hh });
  }
}

function drawTransition(g, W, H, k, tr, p, T) {
  const v = tri(p);
  if (tr === "fade") { g.fillStyle = `rgba(0,0,0,${v})`; g.fillRect(0, 0, W, H); }
  else if (tr === "flash") { g.fillStyle = `rgba(255,255,255,${v * v})`; g.fillRect(0, 0, W, H); }
  else if (tr === "blinds") {
    const n = 9, bh = H / n; g.fillStyle = "#000";
    for (let i = 0; i < n; i++) g.fillRect(0, i * bh, W, bh * v);
  } else if (tr === "glitch") {
    const slices = 14;
    for (let i = 0; i < slices; i++) {
      if (rnd(i + Math.floor(T * 30)) > v) continue;
      const y = rnd(i * 3 + Math.floor(T * 24)) * H, h = (8 + rnd(i * 5) * 60) * k, off = (rnd(i * 7 + Math.floor(T * 40)) - 0.5) * 160 * k * v;
      g.drawImage(g.canvas, 0, y, W, h, off, y, W, h);
    }
    g.save(); g.globalCompositeOperation = "screen";
    g.fillStyle = `rgba(255,0,90,${0.25 * v})`; g.fillRect(0, 0, W, H);
    g.fillStyle = `rgba(0,220,255,${0.18 * v})`; g.fillRect(0, (rnd(Math.floor(T * 20)) * H), W, 30 * k);
    g.restore();
  }
}

function wrap(g, text, maxW) {
  const out = []; let line = "";
  for (const w of text.split(/\s+/).filter(Boolean)) {
    const t = line ? line + " " + w : w;
    if (g.measureText(t).width > maxW && line) { out.push(line); line = w; } else line = t;
  }
  if (line) out.push(line);
  return out.length ? out : [""];
}

function roundRect(g, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
