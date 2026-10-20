// Automatic captions: speech recognition (Whisper) runs inside the browser.
// The model downloads once from Hugging Face and the browser keeps it cached. The video never leaves the device.

const LIB_URL = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js";

const WORKER = `
let asr = null, loaded = "";
self.onmessage = async (e) => {
  const { audio, model, language } = e.data;
  try {
    const { pipeline, env } = await import("${LIB_URL}");
    env.allowLocalModels = false;
    if (!asr || loaded !== model) {
      asr = await pipeline("automatic-speech-recognition", model, {
        progress_callback: (p) => self.postMessage({ type: "progress", p }),
      });
      loaded = model;
    }
    self.postMessage({ type: "status", text: "listening" });
    const opts = { task: "transcribe", return_timestamps: true, chunk_length_s: 30, stride_length_s: 5 };
    if (language) opts.language = language;
    const out = await asr(audio, opts);
    self.postMessage({ type: "done", chunks: out.chunks && out.chunks.length ? out.chunks : [{ text: out.text, timestamp: [0, null] }] });
  } catch (err) {
    self.postMessage({ type: "error", message: String((err && err.message) || err) });
  }
};`;

let worker = null;
function getWorker() {
  if (!worker) worker = new Worker(URL.createObjectURL(new Blob([WORKER], { type: "text/javascript" })), { type: "module" });
  return worker;
}

/** Decode a video's sound and resample to 16 kHz mono, which is what Whisper expects. */
export async function extractAudio(file) {
  const buf = await file.arrayBuffer();
  const AC = window.AudioContext || window.webkitAudioContext;
  const ac = new AC();
  let decoded;
  try { decoded = await ac.decodeAudioData(buf); } finally { ac.close(); }
  const len = Math.max(1, Math.ceil(decoded.duration * 16000));
  const off = new OfflineAudioContext(1, len, 16000);
  const bs = off.createBufferSource(); bs.buffer = decoded; bs.connect(off.destination); bs.start();
  const r = await off.startRendering();
  return { samples: new Float32Array(r.getChannelData(0)), duration: decoded.duration };
}

/**
 * Returns [{ text, s0, s1 }] in the source video's own time.
 * onProgress(message, fraction|null)
 */
export function transcribe(samples, duration, { model, language }, onProgress) {
  return new Promise((resolve, reject) => {
    const w = getWorker();
    const files = {};
    w.onmessage = (e) => {
      const m = e.data;
      if (m.type === "progress") {
        const p = m.p;
        if (p.status === "progress" && p.total) {
          files[p.file] = [p.loaded, p.total];
          const tot = Object.values(files).reduce((a, [, t]) => a + t, 0), got = Object.values(files).reduce((a, [l]) => a + l, 0);
          onProgress(`Baixando o reconhecimento de fala (só na primeira vez): ${(got / 1048576).toFixed(0)} de ${(tot / 1048576).toFixed(0)} MB`, got / tot);
        } else if (p.status === "ready") onProgress("Preparando…", null);
      } else if (m.type === "status") onProgress("Ouvindo o vídeo e escrevendo as falas…", null);
      else if (m.type === "done") {
        resolve(m.chunks.map((c) => ({ text: (c.text || "").trim(), s0: c.timestamp[0] ?? 0, s1: c.timestamp[1] ?? duration })).filter((c) => c.text));
      } else if (m.type === "error") reject(new Error(m.message));
    };
    w.onerror = (e) => reject(new Error(e.message || "falha ao carregar o reconhecimento de fala"));
    w.postMessage({ audio: samples, model, language }, [samples.buffer]);
  });
}

/** Split recognized segments into short captions with an estimated time for each word. */
export function toCaptions(segments, srcId, maxWords) {
  const words = [];
  for (const seg of segments) {
    const ws = seg.text.split(/\s+/).filter(Boolean);
    if (!ws.length) continue;
    const weight = ws.map((w) => w.length + 2), sum = weight.reduce((a, b) => a + b, 0);
    let t = seg.s0; const d = Math.max(0.2, seg.s1 - seg.s0);
    ws.forEach((w, i) => { const len = (d * weight[i]) / sum; words.push({ w, s0: t, s1: t + len }); t += len; });
  }
  const caps = []; let cur = [];
  const flush = () => { if (cur.length) caps.push(cur); cur = []; };
  words.forEach((w, i) => {
    const prev = words[i - 1];
    if (cur.length && (cur.length >= maxWords || /[.!?,;:]$/.test(prev.w) || w.s0 - prev.s1 > 0.5)) flush();
    cur.push(w);
  });
  flush();
  return caps.map((ws, i) => {
    const next = caps[i + 1];
    let s1 = ws[ws.length - 1].s1;
    if (next && next[0].s0 - s1 < 0.3) s1 = next[0].s0;
    return { src: srcId, s0: ws[0].s0, s1, text: ws.map((w) => w.w).join(" "), words: ws };
  });
}
