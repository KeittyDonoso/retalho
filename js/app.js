import { drawFrame, TR_LEN } from "./render.js";
import { BACKGROUNDS, LIGHTS, MUSIC, SOUNDS, EFFECTS, MARKS, TRANSITIONS, TEXT_STYLES, TEXT_ANIMS, FORMATS } from "./library.js";
import { extractAudio, transcribe, toCaptions } from "./captions.js";

/* ---------- helpers ---------- */
const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const even = (n) => Math.round(n / 2) * 2;
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmt = (s) => { s = Math.max(0, s || 0); const m = Math.floor(s / 60); return String(m).padStart(2, "0") + ":" + (s - m * 60).toFixed(1).padStart(4, "0"); };
const opts = (list, cur) => list.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(cur) ? " selected" : ""}>${esc(l)}</option>`).join("");
let toastTimer;
function toast(msg) { const t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 2800); }

/* ---------- state ---------- */
// Everything in `proj` can be undone. Video files live in `sources`.
let proj = {
  format: "auto", clips: [], texts: [], fx: [], audio: [], captions: [],
  cap: { on: true, style: "impacto", size: 1, y: 0.78, words: 3, anim: "pop" },
};
const sources = new Map();      // id -> { id, name, url, el, file, w, h, duration, thumbs, gain, transcript }
const audioFiles = new Map();   // id -> { id, name, url }
let nextId = 1;
const uid = (p) => p + nextId++;
let T = 0, lastT = 0, sel = null;      // sel = { kind, id }
let undoStack = [], redoStack = [];

function snapshot() { return JSON.stringify(proj); }
function commit() { undoStack.push(snapshot()); if (undoStack.length > 150) undoStack.shift(); redoStack = []; if (playing) pause(); }
function restore(json) { proj = JSON.parse(json); if (sel && !findSel()) sel = null; setT(T); renderAll(); }

/* ---------- time ---------- */
const clipDur = (c) => (c.type === "card" ? c.dur : (c.e - c.s) / c.speed);
function layout() { let acc = 0; return proj.clips.map((c) => { const d = clipDur(c), it = { clip: c, t0: acc, t1: acc + d }; acc += d; return it; }); }
const total = () => proj.clips.reduce((a, c) => a + clipDur(c), 0);
function itemAt(t, L = layout()) { const i = L.findIndex((it) => t < it.t1); return L[i < 0 ? L.length - 1 : i]; }

function dims(long) {
  let ar = 9 / 16;
  if (proj.format === "auto") {
    const v = proj.clips.find((c) => c.type === "video"), s = v && sources.get(v.src);
    if (s) ar = s.w / s.h;
  } else { const [a, b] = proj.format.split(":").map(Number); ar = a / b; }
  return ar >= 1 ? [even(long), even(long / ar)] : [even(long * ar), even(long)];
}

/* ---------- media ---------- */
function mediaEl(tag) { const el = document.createElement(tag); el.playsInline = true; el.preload = "auto"; $("media").append(el); return el; }

async function addVideoFile(file, name) {
  const s = { id: uid("s"), name: name || file.name, file, url: URL.createObjectURL(file), thumbs: [], gain: null, transcript: null };
  s.el = mediaEl("video"); s.el.src = s.url;
  await new Promise((res, rej) => { s.el.onloadedmetadata = res; s.el.onerror = () => rej(new Error("format")); });
  if (!isFinite(s.el.duration)) {   // some recorded files don't report a duration until the end is read
    s.el.currentTime = 1e9;
    await new Promise((r) => s.el.addEventListener("durationchange", r, { once: true }));
    s.el.currentTime = 0;
  }
  s.duration = s.el.duration; s.w = s.el.videoWidth || 1280; s.h = s.el.videoHeight || 720;
  sources.set(s.id, s); connectSource(s); makeThumbs(s);
  return s;
}
async function makeThumbs(s) {
  const v = document.createElement("video"); v.muted = true; v.playsInline = true; v.preload = "auto"; v.src = s.url;
  await new Promise((r) => { v.onloadeddata = r; v.onerror = r; });
  const n = clamp(Math.round(s.duration / 1.5), 6, 40), c = document.createElement("canvas");
  c.height = 80; c.width = Math.round((80 * s.w) / s.h); const g = c.getContext("2d");
  for (let k = 0; k < n; k++) {
    const t = ((k + 0.5) * s.duration) / n;
    v.currentTime = t;
    await new Promise((r) => { v.onseeked = r; setTimeout(r, 2000); });
    try { g.drawImage(v, 0, 0, c.width, c.height); s.thumbs.push({ t, url: c.toDataURL("image/jpeg", 0.6) }); } catch (e) { break; }
    if (k % 5 === 4 || k === n - 1) renderTimeline();
  }
  v.removeAttribute("src"); v.load();
}

// editonny backgrounds and lights: one looping muted video each
const pool = new Map();
function lib(kind, id) {
  const key = kind + ":" + id;
  if (!pool.has(key)) {
    const item = (kind === "bg" ? BACKGROUNDS : LIGHTS).find((x) => x.id === id); if (!item) return null;
    const el = mediaEl("video"); el.muted = true; el.loop = true; el.src = item.video; pool.set(key, el);
  }
  return pool.get(key);
}
function ready(el) { return el.readyState >= 2 ? Promise.resolve() : new Promise((r) => { el.addEventListener("loadeddata", r, { once: true }); setTimeout(r, 4000); }); }
function syncLib() {
  const want = new Map();
  const it = itemAt(T);
  if (it && it.clip.type === "card") want.set("bg:" + it.clip.bg, T - it.t0);
  for (const f of proj.fx) if (f.type === "light" && T >= f.t0 - 0.5 && T < f.t1) want.set("light:" + f.ref, T - f.t0);
  for (const [key, el] of pool) {
    if (!want.has(key)) { if (!el.paused) el.pause(); continue; }
    if (playing || exporting) { if (el.paused) el.play().catch(() => {}); }
    else {
      if (!el.paused) el.pause();
      const t = Math.max(0, want.get(key)) % (el.duration || 8);
      if (!el.seeking && Math.abs(el.currentTime - t) > 0.15) el.currentTime = t;
    }
  }
}

/* ---------- sound ---------- */
let AC = null, mix = null, speaker = null, dest = null;
function ensureAudio() {
  if (AC) { if (AC.state !== "running") AC.resume(); return; }
  try {
    AC = new (window.AudioContext || window.webkitAudioContext)();
    mix = AC.createGain(); speaker = AC.createGain(); dest = AC.createMediaStreamDestination();
    mix.connect(speaker); speaker.connect(AC.destination); mix.connect(dest);
    for (const s of sources.values()) connectSource(s);
  } catch (e) { AC = null; }
}
function connectSource(s) {
  if (!AC || s.gain) return;
  try { const n = AC.createMediaElementSource(s.el); s.gain = AC.createGain(); n.connect(s.gain); s.gain.connect(mix); } catch (e) {}
}
const musicEls = new Map();
function musicFor(item) {
  const url = item.ref.startsWith("file:") ? audioFiles.get(item.ref.slice(5))?.url : MUSIC.find((m) => m.id === item.ref)?.file;
  if (!url) return null;
  let m = musicEls.get(item.id);
  if (!m || m.url !== url) {
    if (m) m.el.pause();
    const el = mediaEl("audio"); el.loop = true; el.src = url;
    m = { url, el, gain: null }; musicEls.set(item.id, m);
  }
  if (AC && !m.gain) { try { const n = AC.createMediaElementSource(m.el); m.gain = AC.createGain(); n.connect(m.gain); m.gain.connect(mix); } catch (e) {} }
  return m;
}
const sfxBuffers = new Map();
function sfxBuffer(ref) {
  if (!sfxBuffers.has(ref)) {
    const s = SOUNDS.find((x) => x.id === ref);
    sfxBuffers.set(ref, fetch(s.file).then((r) => r.arrayBuffer()).then((b) => AC.decodeAudioData(b)).catch(() => null));
  }
  return sfxBuffers.get(ref);
}
async function playSfx(ref, vol = 1) {
  ensureAudio(); if (!AC) return;
  const buf = await sfxBuffer(ref); if (!buf) return;
  const src = AC.createBufferSource(), g = AC.createGain(); g.gain.value = vol;
  src.buffer = buf; src.connect(g); g.connect(mix); src.start();
}
let held = false;
function syncAudio() {
  const live = (playing || exporting) && !held;
  const ids = new Set();
  for (const a of proj.audio) {
    if (a.type === "sfx") {
      if (live && lastT < a.t0 && a.t0 <= T && T - a.t0 < 0.3) playSfx(a.ref, a.vol);
      continue;
    }
    ids.add(a.id);
    const m = musicFor(a); if (!m) continue;
    const inside = T >= a.t0 && T < a.t1;
    if (live && inside) {
      const dur = m.el.duration || 1e9, want = (a.offset + (T - a.t0)) % dur;
      if (m.el.paused) { m.el.currentTime = want; m.el.play().catch(() => {}); }
      else if (Math.abs(m.el.currentTime - want) > 0.35) m.el.currentTime = want;
      const fade = a.fade ? Math.min(1, (T - a.t0) / 1, (a.t1 - T) / 1) : 1;
      if (m.gain) m.gain.gain.value = a.vol * clamp(fade, 0, 1);
      else m.el.volume = clamp(a.vol * fade, 0, 1);
    } else if (!m.el.paused) m.el.pause();
  }
  for (const [id, m] of musicEls) if (!ids.has(id) && !m.el.paused) m.el.pause();
}
function pauseAll() {
  for (const s of sources.values()) s.el.pause();
  for (const m of musicEls.values()) m.el.pause();
}

/* ---------- playback ---------- */
let playing = false, exporting = false, tok = 0;
function seekEl(el, t) {
  return new Promise((r) => {
    if (Math.abs(el.currentTime - t) < 0.01 && el.readyState >= 2) return r();
    const done = () => { el.removeEventListener("seeked", done); r(); };
    el.addEventListener("seeked", done); el.currentTime = t; setTimeout(done, 3000);
  });
}
async function runSegment(it, from, my, rec) {
  const c = it.clip;
  held = true;
  if (rec && rec.state === "recording") rec.pause();
  for (const m of musicEls.values()) m.el.pause();
  let el = null;
  if (c.type === "video") {
    const s = sources.get(c.src); el = s.el;
    for (const o of sources.values()) if (o.el !== el) o.el.pause();
    el.playbackRate = c.speed;
    if (s.gain) s.gain.gain.value = c.vol; else el.volume = clamp(c.vol, 0, 1);
    await seekEl(el, c.s + (from - it.t0) * c.speed);
  } else {
    for (const o of sources.values()) o.el.pause();
    const bg = lib("bg", c.bg); if (bg) await ready(bg);
  }
  if (my !== tok) return;
  T = from; lastT = from; held = false;
  if (rec) { if (rec.state === "inactive") rec.start(250); else if (rec.state === "paused") rec.resume(); }
  if (el) { try { await el.play(); } catch (e) { tok++; toast("O navegador não deixou tocar. Toque em ▶ de novo."); return; } }
  const start = performance.now();
  await new Promise((res) => {
    const loop = () => {
      if (my !== tok) { if (el) el.pause(); return res(); }
      if (el) {
        const ct = el.currentTime;
        if (ct >= c.e - 0.02 || el.ended) { el.pause(); T = it.t1; return res(); }
        T = it.t0 + (ct - c.s) / c.speed;
      } else {
        T = from + (performance.now() - start) / 1000;
        if (T >= it.t1) { T = it.t1; return res(); }
      }
      requestAnimationFrame(loop);
    };
    loop();
  });
}
async function play() {
  if (playing || exporting || !proj.clips.length) return;
  ensureAudio();
  if (T >= total() - 0.05) setT(0);
  playing = true; const my = ++tok; setPlayIcon();
  try {
    const L = layout(); let i = L.findIndex((it) => T < it.t1 - 0.01); if (i < 0) i = 0;
    for (; i < L.length && my === tok; i++) await runSegment(L[i], Math.max(T, L[i].t0), my, null);
  } finally {
    if (my === tok) { playing = false; pauseAll(); setPlayIcon(); }
  }
}
function pause() { if (!playing) return; tok++; playing = false; pauseAll(); setPlayIcon(); }
function setPlayIcon() {
  $("playBtn").innerHTML = `<svg class="i"><use href="#i-${playing ? "pause" : "play"}"/></svg>`;
  $("playBtn").setAttribute("aria-label", playing ? "Pausar" : "Tocar");
}
function setT(t) {
  T = clamp(t, 0, total()); lastT = T;
  const it = itemAt(T);
  if (it && it.clip.type === "video") {
    const s = sources.get(it.clip.src), want = it.clip.s + (T - it.t0) * it.clip.speed;
    if (s && Math.abs(s.el.currentTime - want) > 0.03) s.el.currentTime = want;
  }
}
$("playBtn").onclick = () => (playing ? pause() : play());

/* ---------- preview ---------- */
const view = $("view"), vg = view.getContext("2d");
let hits = [];
function fitView() {
  const wrap = $("stageWrap"), [pw, ph] = dims(1920), ar = pw / ph;
  const maxW = wrap.clientWidth - 20;
  const maxH = innerWidth <= 640 ? innerHeight * 0.46 : Math.min(innerHeight * 0.62, 680);
  const w = Math.max(80, Math.min(maxW, maxH * ar)), h = w / ar;
  view.style.width = Math.round(w) + "px"; view.style.height = Math.round(h) + "px";
  const scale = Math.min(Math.min(devicePixelRatio || 1, 2), 1080 / Math.min(w, h));
  view.width = even(w * scale); view.height = even(h * scale);
}
new ResizeObserver(() => fitView()).observe($("stageWrap"));
const env = (hitList) => ({ proj, layout: layout(), sources, lib, hits: hitList });

let exportJob = null;
function frame() {
  if (exportJob) drawFrame(exportJob.g, exportJob.W, exportJob.H, T, env(null));
  else {
    hits = [];
    drawFrame(vg, view.width, view.height, T, env(hits));
    const h = sel && hits.find((x) => x.id === sel.id);
    if (h) {
      vg.save(); vg.strokeStyle = "#ff4f12"; vg.lineWidth = 2 * (view.width / parseFloat(view.style.width)); vg.setLineDash([8, 6]);
      vg.strokeRect(h.x0, h.y0, h.x1 - h.x0, h.y1 - h.y0); vg.restore();
    }
  }
  syncLib(); if (AC) syncAudio();
  lastT = T;
  $("tcNow").textContent = fmt(T);
  drawHead();
  requestAnimationFrame(frame);
}

// drag texts, captions and marks on the preview; a plain tap plays or pauses
view.addEventListener("pointerdown", (e) => {
  if (exporting) return;
  const r = view.getBoundingClientRect(), sx = view.width / r.width, sy = view.height / r.height;
  const px = (e.clientX - r.left) * sx, py = (e.clientY - r.top) * sy;
  const h = [...hits].reverse().find((x) => px >= x.x0 && px <= x.x1 && py >= x.y0 && py <= x.y1);
  let moved = false;
  if (h) { pause(); select({ kind: h.kind, id: h.id }); }
  const target = h && (h.kind === "caption" ? proj.cap : h.kind === "text" ? proj.texts.find((t) => t.id === h.id) : proj.fx.find((f) => f.id === h.id));
  const ox = target && target.x != null ? target.x * view.width - px : 0, oy = target ? target.y * view.height - py : 0;
  view.setPointerCapture(e.pointerId);
  const move = (ev) => {
    if (!target) return;
    const qx = (ev.clientX - r.left) * sx, qy = (ev.clientY - r.top) * sy;
    if (!moved && Math.hypot(qx - px, qy - py) < 5) return;
    if (!moved) { commit(); moved = true; }
    if (h.kind !== "caption") target.x = clamp((qx + ox) / view.width, 0.03, 0.97);
    target.y = clamp((qy + oy) / view.height, 0.04, 0.96);
  };
  const up = () => {
    view.removeEventListener("pointermove", move); view.removeEventListener("pointerup", up);
    if (!h && !moved) playing ? pause() : play();
  };
  view.addEventListener("pointermove", move); view.addEventListener("pointerup", up);
});

/* ---------- selection & editing ---------- */
function findSel() {
  if (!sel) return null;
  const list = { clip: proj.clips, text: proj.texts, fx: proj.fx, audio: proj.audio, caption: proj.captions }[sel.kind];
  return list && list.find((x) => x.id === sel.id);
}
function select(s) { sel = s; renderTimeline(); renderInspector(); updateButtons(); }

function split() {
  const L = layout(), it = itemAt(T, L); if (!it) return;
  const c = it.clip, off = T - it.t0;
  if (off < 0.1 || it.t1 - T < 0.1) { toast("Leve a agulha para o meio de um trecho para dividir."); return; }
  commit();
  const right = { ...c, id: uid("c"), tr: "none" };
  if (c.type === "video") { const cut = c.s + off * c.speed; right.s = cut; c.e = cut; }
  else { right.dur = c.dur - off; c.dur = off; }
  proj.clips.splice(proj.clips.indexOf(c) + 1, 0, right);
  sel = { kind: "clip", id: right.id }; renderAll();
  toast("Dividido. Toque num pedaço e em Apagar para tirar.");
}
function removeClip(c) {
  if (proj.clips.length === 1) { toast("O vídeo precisa ter pelo menos um trecho."); return false; }
  const L = layout(), it = L.find((x) => x.clip === c), a = it.t0, d = it.t1 - it.t0, b = it.t1;
  proj.clips.splice(proj.clips.indexOf(c), 1);
  // things placed after the removed piece slide left with the video
  const shift = (list) => list
    .filter((x) => !(x.t0 >= a && x.t1 <= b))
    .map((x) => { const t0 = x.t0 >= b ? x.t0 - d : x.t0 >= a ? a : x.t0, t1 = x.t1 >= b ? x.t1 - d : x.t1 >= a ? a : x.t1; return { ...x, t0, t1: Math.max(t1, t0 + 0.3) }; });
  proj.texts = shift(proj.texts); proj.fx = shift(proj.fx); proj.audio = shift(proj.audio);
  return true;
}
function del() {
  const x = findSel(); if (!x) { toast("Toque em algo na linha do tempo para escolher o que apagar."); return; }
  commit();
  if (sel.kind === "clip") { if (!removeClip(x)) { undoStack.pop(); return; } }
  else {
    const key = { text: "texts", fx: "fx", audio: "audio", caption: "captions" }[sel.kind];
    proj[key] = proj[key].filter((y) => y.id !== x.id);
  }
  sel = null; setT(Math.min(T, total())); renderAll();
}
function duplicate() {
  const x = findSel(); if (!x) { toast("Escolha algo na linha do tempo para duplicar."); return; }
  if (sel.kind === "caption") return;
  commit();
  const copy = { ...x, id: uid(sel.kind[0]) };
  if (sel.kind === "clip") { copy.tr = "none"; proj.clips.splice(proj.clips.indexOf(x) + 1, 0, copy); }
  else { const d = x.t1 - x.t0; copy.t0 = x.t1; copy.t1 = x.t1 + d; proj[{ text: "texts", fx: "fx", audio: "audio" }[sel.kind]].push(copy); }
  sel = { kind: sel.kind, id: copy.id }; renderAll();
}
$("splitBtn").onclick = split; $("delBtn").onclick = del; $("dupBtn").onclick = duplicate;
$("undoBtn").onclick = () => { if (!undoStack.length) return; redoStack.push(snapshot()); restore(undoStack.pop()); };
$("redoBtn").onclick = () => { if (!redoStack.length) return; undoStack.push(snapshot()); restore(redoStack.pop()); };
$("addBtn").onclick = () => openAdd("midia");

function placeAt(d) { const len = total(); const t0 = clamp(T, 0, Math.max(0, len - 0.5)); return { t0, t1: Math.min(Math.max(len, t0 + 0.5), t0 + d) }; }
function addItem(kind, item) {
  commit();
  item.id = uid(kind[0]);
  proj[{ text: "texts", fx: "fx", audio: "audio" }[kind]].push(item);
  sel = { kind, id: item.id }; closeSheet(); renderAll();
}
function addText(preset = {}) {
  addItem("text", { ...placeAt(3), text: "Seu texto aqui", style: "limpa", anim: "pop", size: 1, x: 0.5, y: 0.5, ...preset });
  setTimeout(() => { const i = $("f-text"); if (i) { i.focus(); i.select(); } }, 50);
}

async function addVideos(files) {
  if (!files.length) return;
  closeSheet();
  toast(files.length > 1 ? "Abrindo os vídeos…" : "Abrindo o vídeo…");
  const added = [];
  for (const f of files) {
    try { added.push(await addVideoFile(f)); }
    catch (e) { toast(`"${f.name}" não abre neste navegador. Tente um arquivo MP4.`); }
  }
  if (!added.length) return;
  commit();
  const first = proj.clips.length === 0;
  for (const s of added) proj.clips.push({ id: uid("c"), type: "video", src: s.id, s: 0, e: s.duration, speed: 1, vol: 1, fit: "blur", tr: "none" });
  if (first) setT(0);
  sel = null; fitView(); renderAll();
  toast(added.length > 1 ? `${added.length} vídeos adicionados no fim.` : "Vídeo adicionado no fim.");
}
$("videoInput").addEventListener("change", (e) => { addVideos([...e.target.files]); e.target.value = ""; });
$("audioInput").addEventListener("change", (e) => {
  const f = e.target.files[0]; e.target.value = ""; if (!f) return;
  const id = uid("a"); audioFiles.set(id, { id, name: f.name, url: URL.createObjectURL(f) });
  const len = total();
  addItem("audio", { type: "music", ref: "file:" + id, t0: 0, t1: Math.max(1, len), vol: 0.6, offset: 0, fade: true });
});
// drop video files anywhere
addEventListener("dragover", (e) => e.preventDefault());
addEventListener("drop", (e) => { e.preventDefault(); const fs = [...e.dataTransfer.files].filter((f) => f.type.startsWith("video/")); if (fs.length) addVideos(fs); });

/* ---------- timeline ---------- */
let pps = 50;
const ROW = 28;
function rowsFor(list) {
  const rows = [], placed = [];
  for (const x of [...list].sort((a, b) => a.t0 - b.t0)) {
    let r = rows.findIndex((end) => end <= x.t0 + 0.001);
    if (r < 0) { r = rows.length; rows.push(0); }
    rows[r] = x.t1; placed.push([x, r]);
  }
  return { placed, n: Math.max(1, rows.length) };
}
function captionBlocks(L) {
  const out = [];
  for (const it of L) {
    const c = it.clip; if (c.type !== "video") continue;
    for (const cap of proj.captions) {
      if (cap.src !== c.src || cap.s1 <= c.s || cap.s0 >= c.e) continue;
      out.push({ cap, t0: it.t0 + (Math.max(cap.s0, c.s) - c.s) / c.speed, t1: it.t0 + (Math.min(cap.s1, c.e) - c.s) / c.speed });
    }
  }
  return out;
}
const fxName = (f) => f.type === "mark" ? MARKS.find((m) => m.id === f.mark)?.name : f.type === "light" ? LIGHTS.find((l) => l.id === f.ref)?.name : EFFECTS.find((e) => e.id === f.type)?.name;
const audioName = (a) => a.type === "sfx" ? "🔊 " + (SOUNDS.find((s) => s.id === a.ref)?.name || "") : "♪ " + (a.ref.startsWith("file:") ? audioFiles.get(a.ref.slice(5))?.name : MUSIC.find((m) => m.id === a.ref)?.title);

function renderTimeline() {
  const L = layout(), len = Math.max(total(), 1), zoom = +$("zoom").value;
  const w = Math.max(200, ($("scroller").clientWidth - 24) * zoom);
  pps = w / len;
  const lanes = $("lanes"); lanes.style.width = w + "px";
  const isSel = (kind, id) => sel && sel.kind === kind && sel.id === id ? " sel" : "";
  let h = "";
  // ruler
  const step = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600].find((s) => s * pps >= 70) || 600;
  h += '<div class="ruler" data-lane="ruler">';
  for (let t = 0; t <= len + 0.001; t += step) h += `<i style="left:${t * pps}px"></i>` + (t * pps > w - 44 ? "" : `<span style="left:${t * pps}px">${fmt(t).replace(/\.0$/, "")}</span>`);
  h += "</div>";
  // video lane
  h += '<div class="lane" data-lane="video" style="height:64px">';
  L.forEach((it, n) => {
    const c = it.clip, cw = Math.max(3, (it.t1 - it.t0) * pps);
    if (c.type === "video") {
      const s = sources.get(c.src), tileW = 64 * (s ? s.w / s.h : 1.7);
      let imgs = "";
      if (s && s.thumbs.length) for (let k = 0; k < Math.ceil(cw / tileW); k++) {
        const t = c.s + ((k + 0.5) * tileW / pps) * c.speed;
        let best = s.thumbs[0]; for (const th of s.thumbs) if (Math.abs(th.t - t) < Math.abs(best.t - t)) best = th;
        imgs += `<img src="${best.url}" alt="" style="width:${tileW}px">`;
      }
      h += `<div class="item clip${isSel("clip", c.id)}" data-kind="clip" data-id="${c.id}" style="left:${it.t0 * pps}px;width:${cw}px">${imgs}<span class="lbl">${(it.t1 - it.t0).toFixed(1)} s${c.speed !== 1 ? " · " + c.speed + "×" : ""}</span>${c.tr && c.tr !== "none" ? '<span class="tr">⇢</span>' : ""}</div>`;
    } else {
      h += `<div class="item clip card${isSel("clip", c.id)}" data-kind="clip" data-id="${c.id}" style="left:${it.t0 * pps}px;width:${cw}px">${esc(c.title || "Cartão")}${c.tr && c.tr !== "none" ? '<span class="tr">⇢</span>' : ""}</div>`;
    }
    if (n > 0) h += `<div class="cut" style="left:${it.t0 * pps - 1}px"></div>`;
  });
  h += "</div>";
  // captions lane
  const caps = captionBlocks(L);
  if (caps.length) {
    h += `<div class="lane" data-lane="caption" style="height:24px">`;
    for (const b of caps) h += `<div class="item caption${isSel("caption", b.cap.id)}" data-kind="caption" data-id="${b.cap.id}" style="top:2px;height:20px;left:${b.t0 * pps}px;width:${Math.max(4, (b.t1 - b.t0) * pps - 1)}px">${esc(b.cap.text)}</div>`;
    h += "</div>";
  }
  const lane = (kind, list, name, label) => {
    const { placed, n } = rowsFor(list);
    h += `<div class="lane" data-lane="${kind}" style="height:${n * ROW + 4}px">`;
    if (!list.length) h += `<span class="lane-name">${name}</span>`;
    for (const [x, r] of placed) {
      const grip = sel && sel.id === x.id && !(kind === "audio" && x.type === "sfx") ? '<span class="grip" data-grip="1"></span>' : "";
      h += `<div class="item ${kind}${isSel(kind, x.id)}" data-kind="${kind}" data-id="${x.id}" style="top:${2 + r * ROW}px;height:${ROW - 4}px;left:${x.t0 * pps}px;width:${Math.max(14, (x.t1 - x.t0) * pps)}px">${esc(label(x))}${grip}</div>`;
    }
    h += "</div>";
  };
  lane("text", proj.texts, "Textos", (x) => x.text);
  lane("fx", proj.fx, "Efeitos e marcações", fxName);
  lane("audio", proj.audio, "Música e sons", audioName);
  h += '<div class="head" id="head"></div>';
  lanes.innerHTML = h;
  drawHead();
}
function drawHead() { const hd = $("head"); if (hd) hd.style.left = T * pps + "px"; }
$("zoom").addEventListener("input", renderTimeline);
addEventListener("resize", () => { fitView(); renderTimeline(); });

function timeAt(e) { const r = $("lanes").getBoundingClientRect(); return clamp((e.clientX - r.left) / pps, 0, total()); }
$("lanes").addEventListener("pointerdown", (e) => {
  if (exporting) return;
  pause();
  const itemEl = e.target.closest(".item"), grip = e.target.closest("[data-grip]");
  const laneEl = e.target.closest("[data-lane]");
  if (!itemEl || itemEl.dataset.kind === "clip") {
    // scrub; tapping a video piece also selects it
    if (itemEl) select({ kind: "clip", id: itemEl.dataset.id });
    else if (laneEl && laneEl.dataset.lane !== "ruler") select(null);
    setT(timeAt(e));
    const move = (ev) => setT(timeAt(ev));
    const up = () => { removeEventListener("pointermove", move); removeEventListener("pointerup", up); };
    addEventListener("pointermove", move); addEventListener("pointerup", up);
    return;
  }
  const kind = itemEl.dataset.kind, id = itemEl.dataset.id;
  if (kind === "caption") {
    const b = captionBlocks(layout()).find((x) => x.cap.id === id);
    select({ kind, id }); if (b) setT(b.t0 + 0.01); return;
  }
  const x = findSelFor(kind, id); if (!x) return;
  if (!(sel && sel.id === id)) select({ kind, id });
  const startX = e.clientX, t0 = x.t0, t1 = x.t1; let moved = false;
  const move = (ev) => {
    if (!moved && Math.abs(ev.clientX - startX) < 4) return;
    if (!moved) { commit(); moved = true; }
    const dt = (ev.clientX - startX) / pps;
    if (grip) x.t1 = clamp(t1 + dt, t0 + 0.3, Math.max(total(), t0 + 0.3));
    else { const d = t1 - t0; x.t0 = clamp(t0 + dt, 0, Math.max(0, total() - Math.min(d, 0.5))); x.t1 = x.t0 + d; setT(x.t0); }
    renderTimeline();
  };
  const up = () => {
    removeEventListener("pointermove", move); removeEventListener("pointerup", up);
    if (!moved) setT(x.t0 + 0.01);
    renderInspector();
  };
  addEventListener("pointermove", move); addEventListener("pointerup", up);
});
function findSelFor(kind, id) { return ({ text: proj.texts, fx: proj.fx, audio: proj.audio }[kind] || []).find((x) => x.id === id); }

/* ---------- inspector ---------- */
function field(label, inner, full) { return `<label class="field${full ? " full" : ""}">${label}${inner}</label>`; }
function bind(id, obj, key, { num = false, after = null } = {}) {
  const el = $(id); if (!el) return;
  if (el.type === "checkbox") el.checked = !!obj[key]; else el.value = obj[key] ?? "";
  let started = false;
  const apply = () => {
    let v = el.type === "checkbox" ? el.checked : el.value;
    if (num) { v = parseFloat(v); if (!isFinite(v)) return; }
    if (!started) { commit(); started = true; }
    obj[key] = v; if (after) after(v); renderTimeline(); updateButtons();
  };
  el.addEventListener("input", apply); el.addEventListener("change", () => { started = false; });
}
function timeFields(x) {
  return field("Começa em (s)", `<input id="f-t0" type="number" min="0" step="0.1" inputmode="decimal">`) +
    field("Duração (s)", `<input id="f-dur" type="number" min="0.3" step="0.1" inputmode="decimal">`);
}
function bindTime(x) {
  const t0 = $("f-t0"), d = $("f-dur"); if (!t0) return;
  t0.value = x.t0.toFixed(1); d.value = (x.t1 - x.t0).toFixed(1);
  t0.onchange = () => { const v = parseFloat(t0.value); if (!(v >= 0)) return; commit(); const len = x.t1 - x.t0; x.t0 = v; x.t1 = v + len; renderTimeline(); };
  d.onchange = () => { const v = parseFloat(d.value); if (!(v >= 0.3)) return; commit(); x.t1 = x.t0 + v; renderTimeline(); };
}

function renderInspector() {
  const box = $("inspector"), x = findSel();
  if (!x) return renderProjectPanel(box);
  if (sel.kind === "clip") return x.type === "card" ? cardPanel(box, x) : clipPanel(box, x);
  if (sel.kind === "text") return textPanel(box, x);
  if (sel.kind === "caption") return captionPanel(box, x);
  if (sel.kind === "fx") return x.type === "mark" ? markPanel(box, x) : fxPanel(box, x);
  if (sel.kind === "audio") return audioPanel(box, x);
}

function captionControls() {
  return field("Estilo das legendas", `<select id="c-style">${opts(TEXT_STYLES, proj.cap.style)}</select>`) +
    field("Palavras por vez", `<select id="c-words">${opts([[1, "1"], [2, "2"], [3, "3"], [4, "4"], [5, "5"], [6, "6"], [8, "8"]], proj.cap.words)}</select>`) +
    field("Tamanho", `<input id="c-size" type="range" min="0.5" max="2" step="0.05">`) +
    field("Animação", `<select id="c-anim">${opts(TEXT_ANIMS, proj.cap.anim)}</select>`) +
    field("Altura na tela", `<input id="c-y" type="range" min="0.06" max="0.94" step="0.01">`, true) +
    field("Mostrar legendas", `<input id="c-on" type="checkbox">`);
}
function bindCaptionControls() {
  bind("c-style", proj.cap, "style"); bind("c-size", proj.cap, "size", { num: true }); bind("c-anim", proj.cap, "anim");
  bind("c-y", proj.cap, "y", { num: true }); bind("c-on", proj.cap, "on");
  bind("c-words", proj.cap, "words", { num: true, after: regroupCaptions });
}
function regroupCaptions() {
  const keep = proj.captions;
  const bySrc = new Map();
  for (const s of sources.values()) if (s.transcript) bySrc.set(s.id, s.transcript);
  if (!bySrc.size) return;
  proj.captions = [...bySrc].flatMap(([id, segs]) => toCaptions(segs, id, proj.cap.words)).map((c) => ({ ...c, id: uid("k") }));
  if (!proj.captions.length) proj.captions = keep;
}

function renderProjectPanel(box) {
  const hasCaps = proj.captions.length > 0;
  box.innerHTML = `<h2>Projeto</h2>
    <div class="fields">
      ${field("Formato do vídeo", `<select id="p-format">${opts(FORMATS, proj.format)}</select>`, true)}
    </div>
    <h2>Legendas</h2>
    ${hasCaps ? `<div class="fields">${captionControls()}</div>
      <div class="row"><button class="btn small" id="p-cap">Fazer de novo</button><button class="btn small danger" id="p-capdel">Apagar legendas</button></div>`
      : `<p>O editor escuta a fala dos seus vídeos e escreve as legendas sozinho.</p><div class="row"><button class="btn primary small" id="p-cap">Criar legendas automáticas</button></div>`}
    <h2>Transições</h2>
    <div class="fields">${field("Em todos os cortes", `<select id="p-tr">${opts(TRANSITIONS, "none")}</select>`, true)}</div>
    <p class="hint">Toque em algo na linha do tempo para mudar só aquilo. Arraste textos e marcações direto na prévia.</p>`;
  bind("p-format", proj, "format", { after: () => fitView() });
  $("p-cap").onclick = openCaptions;
  if (hasCaps) { bindCaptionControls(); $("p-capdel").onclick = () => { commit(); proj.captions = []; renderAll(); }; }
  $("p-tr").onchange = (e) => { commit(); proj.clips.forEach((c, i) => { if (i > 0) c.tr = e.target.value; }); renderTimeline(); toast("Transição aplicada em todos os cortes."); };
}

function moveButtons() { return `<div class="row"><button class="btn small" id="mv-l">← Mover</button><button class="btn small" id="mv-r">Mover →</button></div>`; }
function bindMove(c) {
  const mv = (d) => { const i = proj.clips.indexOf(c), j = i + d; if (j < 0 || j >= proj.clips.length) return; commit(); proj.clips.splice(i, 1); proj.clips.splice(j, 0, c); setT(layout()[j].t0 + 0.01); renderTimeline(); };
  $("mv-l").onclick = () => mv(-1); $("mv-r").onclick = () => mv(1);
}
function clipPanel(box, c) {
  const s = sources.get(c.src);
  box.innerHTML = `<h2>Trecho de vídeo</h2>
    <p>${esc(s ? s.name : "")} · do ${fmt(c.s)} ao ${fmt(c.e)}</p>
    <div class="fields">
      ${field("Começo no original (s)", `<input id="f-s" type="number" step="0.1" min="0" inputmode="decimal">`)}
      ${field("Fim no original (s)", `<input id="f-e" type="number" step="0.1" min="0" inputmode="decimal">`)}
      ${field("Velocidade", `<select id="f-speed">${opts([[0.25, "0,25× (bem lento)"], [0.5, "0,5× (câmera lenta)"], [0.75, "0,75×"], [1, "1× (normal)"], [1.25, "1,25×"], [1.5, "1,5×"], [2, "2× (rápido)"], [3, "3×"]], c.speed)}</select>`)}
      ${field("Volume", `<input id="f-vol" type="range" min="0" max="2" step="0.05">`)}
      ${field("Enquadramento", `<select id="f-fit">${opts([["blur", "Caber com fundo desfocado"], ["contain", "Caber com barras pretas"], ["cover", "Preencher a tela (corta bordas)"]], c.fit)}</select>`, true)}
      ${field("Transição ao entrar", `<select id="f-tr">${opts(TRANSITIONS, c.tr)}</select>`, true)}
    </div>${moveButtons()}`;
  const sIn = $("f-s"), eIn = $("f-e"); sIn.value = c.s.toFixed(1); eIn.value = c.e.toFixed(1);
  sIn.onchange = () => { const v = parseFloat(sIn.value); if (!(v >= 0) || v > c.e - 0.1) return toast("O começo precisa ser antes do fim."); commit(); c.s = v; renderAll(); };
  eIn.onchange = () => { const v = parseFloat(eIn.value); if (!(v > c.s + 0.1) || v > s.duration + 0.01) return toast(`O fim precisa ficar entre ${fmt(c.s)} e ${fmt(s.duration)}.`); commit(); c.e = Math.min(v, s.duration); renderAll(); };
  bind("f-speed", c, "speed", { num: true }); bind("f-vol", c, "vol", { num: true }); bind("f-fit", c, "fit"); bind("f-tr", c, "tr");
  bindMove(c);
}
function cardPanel(box, c) {
  box.innerHTML = `<h2>Cartão de título</h2><div class="fields">
    ${field("Título", `<input id="f-title" type="text">`, true)}
    ${field("Subtítulo", `<input id="f-sub" type="text">`, true)}
    ${field("Fundo animado", `<select id="f-bg">${opts(BACKGROUNDS.map((b) => [b.id, b.name]), c.bg)}</select>`, true)}
    ${field("Duração (s)", `<input id="f-cdur" type="number" min="0.5" step="0.5" inputmode="decimal">`)}
    ${field("Transição ao entrar", `<select id="f-tr">${opts(TRANSITIONS, c.tr)}</select>`)}
  </div>${moveButtons()}`;
  bind("f-title", c, "title"); bind("f-sub", c, "sub"); bind("f-bg", c, "bg"); bind("f-tr", c, "tr");
  bind("f-cdur", c, "dur", { num: true, after: () => { c.dur = Math.max(0.5, c.dur); } });
  bindMove(c);
}
function textPanel(box, t) {
  box.innerHTML = `<h2>Texto</h2><div class="fields">
    ${field("Texto", `<textarea id="f-text" rows="2"></textarea>`, true)}
    ${field("Estilo", `<select id="f-style">${opts(TEXT_STYLES, t.style)}</select>`)}
    ${field("Animação", `<select id="f-anim">${opts(TEXT_ANIMS, t.anim)}</select>`)}
    ${field("Tamanho", `<input id="f-size" type="range" min="0.4" max="3" step="0.05">`, true)}
    ${timeFields(t)}
  </div>
  <div class="row"><button class="btn small" data-y="0.14">Em cima</button><button class="btn small" data-y="0.5">No meio</button><button class="btn small" data-y="0.82">Embaixo</button></div>
  <p class="hint">Dica: arraste o texto na prévia para colocar onde quiser.</p>`;
  bind("f-text", t, "text"); bind("f-style", t, "style"); bind("f-anim", t, "anim"); bind("f-size", t, "size", { num: true });
  bindTime(t);
  box.querySelectorAll("[data-y]").forEach((b) => (b.onclick = () => { commit(); t.y = +b.dataset.y; t.x = 0.5; }));
}
function captionPanel(box, c) {
  box.innerHTML = `<h2>Legenda</h2><div class="fields">
    ${field("Texto desta legenda", `<textarea id="f-ctext" rows="2"></textarea>`, true)}
  </div><p class="hint">As opções abaixo valem para todas as legendas.</p>
  <div class="fields">${captionControls()}</div>`;
  const ta = $("f-ctext"); ta.value = c.text; let started = false;
  ta.addEventListener("input", () => {
    if (!started) { commit(); started = true; }
    c.text = ta.value;
    const ws = ta.value.split(/\s+/).filter(Boolean), d = (c.s1 - c.s0) / Math.max(1, ws.length);
    c.words = ws.map((w, i) => ({ w, s0: c.s0 + i * d, s1: c.s0 + (i + 1) * d }));
    renderTimeline();
  });
  ta.addEventListener("change", () => (started = false));
  bindCaptionControls();
}
function fxPanel(box, f) {
  const isLight = f.type === "light";
  box.innerHTML = `<h2>${esc(fxName(f))}</h2><div class="fields">
    ${isLight ? field("Luz", `<select id="f-ref">${opts(LIGHTS.map((l) => [l.id, l.name]), f.ref)}</select>`, true) : ""}
    ${f.type === "emojirain" ? field("Emoji", `<input id="f-emoji" type="text" maxlength="4">`, true) : ""}
    ${field("Intensidade", `<input id="f-amt" type="range" min="0.1" max="1" step="0.05">`, true)}
    ${timeFields(f)}
  </div>`;
  if (isLight) bind("f-ref", f, "ref");
  if (f.type === "emojirain") bind("f-emoji", f, "emoji");
  bind("f-amt", f, "amount", { num: true }); bindTime(f);
}
function markPanel(box, f) {
  box.innerHTML = `<h2>Marcação</h2><div class="fields">
    ${field("Tipo", `<select id="f-mark">${opts(MARKS.map((m) => [m.id, m.name]), f.mark)}</select>`)}
    ${field("Cor", `<input id="f-color" type="color">`)}
    ${f.mark === "sticker" ? field("Emoji", `<input id="f-emoji" type="text" maxlength="4">`, true) : ""}
    ${field("Tamanho", `<input id="f-msize" type="range" min="0.4" max="2.5" step="0.05">`, true)}
    ${timeFields(f)}
  </div><p class="hint">Arraste a marcação na prévia para apontar o lugar certo.</p>`;
  bind("f-mark", f, "mark", { after: () => renderInspector() }); bind("f-color", f, "color"); bind("f-msize", f, "size", { num: true });
  if (f.mark === "sticker") bind("f-emoji", f, "emoji");
  bindTime(f);
}
function audioPanel(box, a) {
  if (a.type === "sfx") {
    box.innerHTML = `<h2>Som</h2><div class="fields">
      ${field("Som", `<select id="f-sref">${opts(SOUNDS.map((s) => [s.id, s.name]), a.ref)}</select>`, true)}
      ${field("Volume", `<input id="f-svol" type="range" min="0" max="2" step="0.05">`)}
      ${field("Toca em (s)", `<input id="f-st0" type="number" min="0" step="0.1" inputmode="decimal">`)}
    </div><div class="row"><button class="btn small" id="f-hear">Ouvir</button></div>`;
    bind("f-sref", a, "ref"); bind("f-svol", a, "vol", { num: true });
    const t0 = $("f-st0"); t0.value = a.t0.toFixed(1);
    t0.onchange = () => { const v = parseFloat(t0.value); if (!(v >= 0)) return; commit(); a.t0 = v; a.t1 = v + 1; renderTimeline(); };
    $("f-hear").onclick = () => playSfx(a.ref, a.vol);
    return;
  }
  const choices = [...[...audioFiles.values()].map((f) => ["file:" + f.id, "Do aparelho: " + f.name]), ...MUSIC.map((m) => [m.id, `${m.title} (${m.mood})`])];
  box.innerHTML = `<h2>Música</h2><div class="fields">
    ${field("Música", `<select id="f-mref">${opts(choices, a.ref)}</select>`, true)}
    ${field("Volume", `<input id="f-mvol" type="range" min="0" max="1.5" step="0.05">`, true)}
    ${field("Começar a música no segundo", `<input id="f-off" type="number" min="0" step="1" inputmode="decimal">`, true)}
    ${timeFields(a)}
    ${field("Entrar e sair suave", `<input id="f-fade" type="checkbox">`)}
  </div>`;
  bind("f-mref", a, "ref"); bind("f-mvol", a, "vol", { num: true }); bind("f-off", a, "offset", { num: true }); bind("f-fade", a, "fade");
  bindTime(a);
}

function updateButtons() {
  $("tcTotal").textContent = fmt(total());
  $("undoBtn").disabled = !undoStack.length; $("redoBtn").disabled = !redoStack.length;
  $("delBtn").disabled = !sel; $("dupBtn").disabled = !sel || sel.kind === "caption";
  const nv = proj.clips.length, [w, h] = dims(1080);
  $("projInfo").textContent = `${nv} ${nv === 1 ? "trecho" : "trechos"} · ${w > h ? "horizontal" : w < h ? "vertical" : "quadrado"}`;
  $("tlInfo").textContent = `${fmt(total())} no total`;
}
function renderAll() { renderTimeline(); renderInspector(); updateButtons(); }

/* ---------- add sheet ---------- */
function sheet(html) { $("sheet").innerHTML = html; $("modal").hidden = false; }
function closeSheet() { $("modal").hidden = true; $("sheet").innerHTML = ""; }
$("modal").addEventListener("pointerdown", (e) => { if (e.target === $("modal") && !exporting && !busy) closeSheet(); });
let busy = false;

const TABS = [["midia", "Vídeos"], ["texto", "Textos"], ["efeitos", "Efeitos"], ["luzes", "Luzes"], ["marcas", "Marcações"], ["musica", "Música"], ["sons", "Sons"]];
function openAdd(tab) {
  const pick = (attrs, title, sub = "", img = "") => `<button class="pick${img ? " img" : ""}" ${attrs}${img ? ` style="background-image:url('${img}')"` : ""}><span>${esc(title)}</span>${sub ? `<small>${esc(sub)}</small>` : ""}</button>`;
  let body = "";
  if (tab === "midia") body = `<div class="grid"><button class="pick wide" data-act="video">＋ Vídeos do aparelho (pode escolher vários)</button></div>
    <p>Cartão de título com fundo animado do editonny:</p>
    <div class="grid">${BACKGROUNDS.map((b) => pick(`data-act="card" data-ref="${b.id}"`, b.name, "", b.cover)).join("")}</div>`;
  if (tab === "texto") body = `<div class="grid">
    <button class="pick wide" data-act="captions">Legendas automáticas</button>
    ${pick('data-act="text" data-style="limpa"', "Texto simples", "Limpo, com sombra")}
    ${pick('data-act="text" data-style="etiqueta" data-y="0.14"', "Título em etiqueta", "No alto da tela")}
    ${pick('data-act="text" data-style="impacto"', "Impacto", "Letras grandes")}
    ${pick('data-act="text" data-style="neon"', "Neon", "Brilho laranja")}
    ${pick('data-act="text" data-style="manuscrita"', "Manuscrita", "Escrito à mão")}
    ${pick('data-act="text" data-style="marcador"', "Marcador", "Fundo branco")}</div>`;
  if (tab === "efeitos") body = `<div class="grid">${EFFECTS.map((f) => pick(`data-act="fx" data-ref="${f.id}"`, f.name)).join("")}</div>`;
  if (tab === "luzes") body = `<p>Luzes e texturas do editonny, por cima do vídeo.</p><div class="grid">${LIGHTS.map((l) => pick(`data-act="light" data-ref="${l.id}"`, l.name, "", l.cover)).join("")}</div>`;
  if (tab === "marcas") body = `<p>Aparece no ponto onde você arrastar, na prévia.</p><div class="grid">${MARKS.map((m) => pick(`data-act="mark" data-ref="${m.id}"`, m.name)).join("")}</div>`;
  if (tab === "musica") body = `<div class="grid"><button class="pick wide" data-act="audiofile">＋ Música do aparelho</button>
    ${MUSIC.map((m) => pick(`data-act="music" data-ref="${m.id}"`, m.title, `${m.mood} · ${fmt(m.dur).slice(0, 5)}`)).join("")}</div>
    <p class="hint">Músicas livres (CC0) da biblioteca do editonny. Toque em ▶ depois de adicionar para ouvir junto do vídeo.</p>`;
  if (tab === "sons") body = `<p>O som entra onde está a agulha. Toque para ouvir e adicionar.</p><div class="grid">${SOUNDS.map((s) => pick(`data-act="sfx" data-ref="${s.id}"`, s.name)).join("")}</div>`;
  sheet(`<div class="sheet-head"><h2>Adicionar</h2><button class="icon-btn" id="sh-close" aria-label="Fechar"><svg class="i"><use href="#i-x"/></svg></button></div>
    <div class="tabs" role="tablist">${TABS.map(([id, n]) => `<button class="tab" role="tab" data-tab="${id}" aria-selected="${id === tab}">${n}</button>`).join("")}</div>
    ${body}`);
  $("sh-close").onclick = closeSheet;
  $("sheet").querySelectorAll("[data-tab]").forEach((b) => (b.onclick = () => openAdd(b.dataset.tab)));
  $("sheet").querySelectorAll("[data-act]").forEach((b) => (b.onclick = () => addFromSheet(b.dataset)));
}
function addFromSheet(d) {
  const { act, ref } = d;
  if (act === "video") return $("videoInput").click();
  if (act === "audiofile") return $("audioInput").click();
  if (act === "captions") { closeSheet(); return openCaptions(); }
  if (act === "card") {
    commit();
    const c = { id: uid("c"), type: "card", bg: ref, dur: 3, title: "Seu título aqui", sub: "", tr: "fade" };
    const L = layout(), it = itemAt(T, L), idx = it ? proj.clips.indexOf(it.clip) + (T - it.t0 > (it.t1 - it.t0) / 2 ? 1 : 0) : 0;
    proj.clips.splice(idx, 0, c); sel = { kind: "clip", id: c.id }; closeSheet(); renderAll();
    setT(layout()[idx].t0 + 0.5);
    return;
  }
  if (act === "text") return addText({ style: d.style, y: d.y ? +d.y : d.style === "etiqueta" ? 0.14 : 0.5 });
  if (act === "fx") return addItem("fx", { type: ref, ...placeAt(3), amount: 0.7, emoji: "🔥" });
  if (act === "light") return addItem("fx", { type: "light", ref, ...placeAt(4), amount: 0.8 });
  if (act === "mark") return addItem("fx", { type: "mark", mark: ref, ...placeAt(2.5), x: 0.5, y: 0.45, color: "#ff4f12", size: 1, emoji: "😍" });
  if (act === "music") { const len = total(); return addItem("audio", { type: "music", ref, t0: 0, t1: Math.max(1, len), vol: 0.5, offset: 0, fade: true }); }
  if (act === "sfx") { playSfx(ref, 1); return addItem("audio", { type: "sfx", ref, t0: T, t1: T + 1, vol: 1 }); }
}

/* ---------- automatic captions ---------- */
function openCaptions() {
  const used = [...new Set(proj.clips.filter((c) => c.type === "video").map((c) => c.src))];
  if (!used.length) return toast("Adicione um vídeo com fala primeiro.");
  const phone = matchMedia("(max-width: 640px)").matches;
  sheet(`<div class="sheet-head"><h2>Legendas automáticas</h2><button class="icon-btn" id="sh-close" aria-label="Fechar"><svg class="i"><use href="#i-x"/></svg></button></div>
    <p>O editor escuta a fala dos seus vídeos e escreve as legendas. Tudo acontece aqui no seu aparelho, o vídeo não é enviado para ninguém.</p>
    <div class="fields">
      ${field("Idioma da fala", `<select id="cap-lang">${opts([["portuguese", "Português"], ["english", "Inglês"], ["spanish", "Espanhol"], ["", "Descobrir sozinho"]], "portuguese")}</select>`)}
      ${field("Qualidade", `<select id="cap-model">${opts([["Xenova/whisper-tiny", "Rápida (baixa ~40 MB)"], ["Xenova/whisper-base", "Melhor (baixa ~80 MB)"]], phone ? "Xenova/whisper-tiny" : "Xenova/whisper-base")}</select>`)}
      ${field("Estilo", `<select id="cap-style">${opts(TEXT_STYLES, proj.cap.style)}</select>`)}
      ${field("Palavras por vez", `<select id="cap-words">${opts([[1, "1"], [2, "2"], [3, "3"], [4, "4"], [5, "5"], [6, "6"]], proj.cap.words)}</select>`)}
    </div>
    <p class="hint">Na primeira vez o reconhecimento de fala é baixado e fica guardado no navegador. Vídeos longos podem levar alguns minutos.</p>
    <div id="cap-prog" hidden><p id="cap-msg">Preparando…</p><div class="progress"><div id="cap-bar"></div></div></div>
    <div class="row" style="justify-content:flex-end"><button class="btn primary" id="cap-go">Criar legendas</button></div>`);
  $("sh-close").onclick = () => { if (!busy) closeSheet(); };
  $("cap-go").onclick = () => runCaptions(used, { language: $("cap-lang").value, model: $("cap-model").value, style: $("cap-style").value, words: +$("cap-words").value });
}
async function runCaptions(used, o) {
  busy = true; pause();
  $("cap-go").disabled = true; $("cap-prog").hidden = false;
  const msg = (m, f) => { $("cap-msg").textContent = m; $("cap-bar").style.width = f == null ? "100%" : (f * 100).toFixed(0) + "%"; };
  let made = 0, noSound = 0;
  try {
    for (const [n, id] of used.entries()) {
      const s = sources.get(id);
      const tag = used.length > 1 ? ` (vídeo ${n + 1} de ${used.length})` : "";
      if (!s.transcript || s.transcriptModel !== o.model + o.language) {
        msg("Separando o som do vídeo" + tag + "…", null);
        let audio;
        try { audio = await extractAudio(s.file); } catch (e) { noSound++; continue; }
        s.transcript = await transcribe(audio.samples, audio.duration, o, (m, f) => msg(m + tag, f));
        s.transcriptModel = o.model + o.language;
      }
      made++;
    }
    commit();
    proj.cap.style = o.style; proj.cap.words = o.words; proj.cap.on = true;
    regroupCaptions();
    busy = false; closeSheet(); sel = null; renderAll();
    if (!proj.captions.length) toast(noSound ? "Não encontrei som nos vídeos." : "Não encontrei fala nos vídeos.");
    else toast(`Pronto: ${proj.captions.length} legendas. Toque numa legenda para corrigir.`);
  } catch (e) {
    busy = false;
    const blocked = /fetch|network|load|import/i.test(e.message);
    msg(blocked ? "Não consegui baixar o reconhecimento de fala. Confira a internet. Se estiver abrindo o editor dentro do Claude, use o site: as legendas automáticas só funcionam lá." : "Deu um erro: " + e.message, 0);
    $("cap-go").disabled = false; $("cap-go").textContent = "Tentar de novo";
  }
}

/* ---------- export ---------- */
function pickMime() {
  if (!window.MediaRecorder) return null;
  return [["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "mp4"], ["video/mp4", "mp4"], ["video/webm;codecs=vp9,opus", "webm"], ["video/webm;codecs=vp8,opus", "webm"], ["video/webm", "webm"]]
    .find(([m]) => MediaRecorder.isTypeSupported(m)) || null;
}
$("exportBtn").onclick = () => {
  if (exporting || !proj.clips.length) return;
  pause();
  const mime = pickMime();
  if (!mime || !HTMLCanvasElement.prototype.captureStream) {
    sheet(`<h2>Exportar não funciona aqui</h2><p>Este navegador não consegue gravar vídeo. Use o Chrome, Edge ou Safari atualizado.</p><div class="row" style="justify-content:flex-end"><button class="btn" id="x-close">Fechar</button></div>`);
    return ($("x-close").onclick = closeSheet);
  }
  const phone = matchMedia("(max-width: 640px)").matches;
  sheet(`<h2>Exportar vídeo</h2><p>O vídeo final tem ${fmt(total())}. A gravação acontece aqui no seu aparelho e leva o mesmo tempo do vídeo. Deixe esta tela aberta até terminar.</p>
    <div class="fields">${field("Qualidade", `<select id="x-q">${opts([[1920, "Alta (1080p)"], [1280, "Leve (720p)"]], phone ? 1280 : 1920)}</select>`, true)}</div>
    <div class="row" style="justify-content:flex-end"><button class="btn" id="x-close">Cancelar</button><button class="btn primary" id="x-go">Começar</button></div>`);
  $("x-close").onclick = closeSheet;
  $("x-go").onclick = () => runExport(mime, +$("x-q").value);
};
async function runExport([mime, ext], long) {
  ensureAudio();
  await Promise.all(["400 64px Anton", "700 64px Caveat", "800 64px Figtree", "700 40px 'JetBrains Mono'"].map((f) => document.fonts.load(f).catch(() => {})));
  sheet(`<h2>Gravando…</h2><p id="x-msg">Preparando</p><div class="progress"><div id="x-bar"></div></div>
    <div class="row" style="justify-content:flex-end"><button class="btn" id="x-stop">Cancelar</button></div>`);
  const [W, H] = dims(long);
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  exportJob = { g: cv.getContext("2d"), W, H };
  exporting = true;
  if (speaker) speaker.gain.value = 0;
  const stream = cv.captureStream(30);
  if (dest) dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: Math.round(W * H * 30 * 0.11) });
  const chunks = []; rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise((r) => (rec.onstop = r));
  const my = ++tok, len = total();
  $("x-stop").onclick = () => { tok++; };
  const tick = setInterval(() => { const b = $("x-bar"), m = $("x-msg"); if (b) b.style.width = ((100 * T) / len).toFixed(1) + "%"; if (m) m.textContent = `${fmt(T)} de ${fmt(len)}`; }, 200);
  try { for (const it of layout()) { if (my !== tok) break; await runSegment(it, it.t0, my, rec); } }
  catch (e) { tok++; toast("A gravação parou: " + e.message); }
  const cancelled = my !== tok;
  clearInterval(tick);
  if (rec.state !== "inactive") rec.stop();
  await stopped;
  exporting = false; exportJob = null; pauseAll();
  if (speaker) speaker.gain.value = 1;
  if (cancelled) { closeSheet(); return; }
  const blob = new Blob(chunks, { type: mime.split(";")[0] }), url = URL.createObjectURL(blob);
  const first = proj.clips.find((c) => c.type === "video"), base = (first && sources.get(first.src)?.name || "video").replace(/\.[^.]+$/, "");
  const filename = `${base}-editado.${ext}`;
  sheet(`<h2>Pronto!</h2><video controls playsinline src="${url}"></video><p>${esc(filename)} · ${(blob.size / 1048576).toFixed(1)} MB</p>
    <div class="row" style="justify-content:flex-end"><button class="btn" id="x-close">Fechar</button><button class="btn primary" id="x-save"><svg class="i"><use href="#i-download"/></svg>Baixar vídeo</button></div>`);
  $("x-close").onclick = () => { URL.revokeObjectURL(url); closeSheet(); };
  $("x-save").onclick = () => saveFile(blob, filename, url);
}
async function saveFile(blob, filename, url) {
  // Inside Claude the page asks the viewer to confirm the save; on the website a normal download works.
  let dl = null;
  try { dl = window.claude && window.claude.use ? await window.claude.use("downloads") : null; } catch (e) { dl = null; }
  if (dl) {
    try { await dl.save({ filename, data: blob }); toast("Vídeo salvo."); }
    catch (e) { if (e && e.code !== "declined") toast("Não deu para salvar aqui (" + (e.code || "erro") + ")."); }
    return;
  }
  const a = document.createElement("a"); a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove();
}

/* ---------- keyboard ---------- */
addEventListener("keydown", (e) => {
  if (exporting || !$("modal").hidden || e.target.closest("input, textarea, select")) return;
  const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
  if (k === " ") { e.preventDefault(); playing ? pause() : play(); }
  else if (mod && k === "z") { e.preventDefault(); (e.shiftKey ? $("redoBtn") : $("undoBtn")).click(); }
  else if (mod && k === "y") { e.preventDefault(); $("redoBtn").click(); }
  else if (mod) return;
  else if (k === "s") split();
  else if (k === "d") duplicate();
  else if (k === "a") { e.preventDefault(); openAdd("midia"); }
  else if (k === "delete" || k === "backspace") del();
  else if (k === "escape") select(null);
  else if (k === "arrowleft" || k === "arrowright") { e.preventDefault(); pause(); setT(T + (k === "arrowleft" ? -1 : 1)); }
});

/* ---------- start ---------- */
(async function boot() {
  setPlayIcon(); fitView(); renderAll(); requestAnimationFrame(frame);
  try {
    const blob = await (await fetch("assets/exemplo.mp4")).blob();
    const s = await addVideoFile(new File([blob], "exemplo.mp4", { type: "video/mp4" }), "Vídeo de exemplo");
    proj.clips.push({ id: uid("c"), type: "video", src: s.id, s: 0, e: s.duration, speed: 1, vol: 1, fit: "blur", tr: "none" });
    proj.texts.push({ id: uid("t"), t0: 0.3, t1: 4, text: "Toque em Adicionar", style: "etiqueta", anim: "pop", size: 1, x: 0.5, y: 0.14 });
    setT(0); fitView(); renderAll();
  } catch (e) {
    toast("Toque em Adicionar para abrir um vídeo.");
  }
})();

// handy for checking things from the browser console
window.retalho = { get proj() { return proj; }, sources, setT, play, pause, regroupCaptions, renderAll, layout };
