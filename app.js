// RAG vs keyword search vs an agent, on Anthropic's S-1.
// Preset questions use the exact rankings from the recorded test; custom
// questions run BM25 and the embedding model live in the browser.

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => s.replace(/\u2019/g, "'").toLowerCase();
const K = 8;

let DOC, CHUNKS, META, EMB, bm25, run = 0, embedder = null;

async function load() {
  const [doc, chunks, meta, emb] = await Promise.all([
    fetch("data/doc.json").then((r) => r.json()),
    fetch("data/chunks.json").then((r) => r.json()),
    fetch("data/questions.json").then((r) => r.json()),
    fetch("data/emb.i8").then((r) => r.arrayBuffer()),
  ]);
  DOC = doc.lines; CHUNKS = chunks; META = meta; EMB = new Int8Array(emb);
  bm25 = buildBM25(CHUNKS.map((c) => c.text));
  $("filingLink").href = META.filing;
  const chips = $("chips");
  META.questions.forEach((q, i) => {
    const b = document.createElement("button");
    b.className = "chip"; b.textContent = q.q;
    b.onclick = () => { selectChip(b); play(i); };
    chips.appendChild(b);
  });
}

function selectChip(b) {
  document.querySelectorAll(".chip").forEach((c) => c.classList.toggle("on", c === b));
}

// ---- BM25 (Okapi, same settings as rank_bm25 and the test) ----
function tokenize(t) { return t.toLowerCase().replace(/,/g, "").match(/[a-z0-9.]+/g) || []; }
function buildBM25(docs, k1 = 1.5, b = 0.75, eps = 0.25) {
  const toks = docs.map(tokenize), N = toks.length;
  const avg = toks.reduce((s, d) => s + d.length, 0) / N;
  const df = new Map(), tf = toks.map((d) => { const m = new Map(); d.forEach((w) => m.set(w, (m.get(w) || 0) + 1)); m.forEach((_, w) => df.set(w, (df.get(w) || 0) + 1)); return m; });
  const idf = new Map(); let sum = 0, neg = [];
  df.forEach((n, w) => { const v = Math.log(N - n + 0.5) - Math.log(n + 0.5); idf.set(w, v); sum += v; if (v < 0) neg.push(w); });
  const floor = eps * (sum / idf.size); neg.forEach((w) => idf.set(w, floor));
  return (q) => {
    const qt = tokenize(q);
    return toks.map((d, i) => {
      let s = 0;
      for (const w of qt) { const f = tf[i].get(w) || 0; if (f) s += (idf.get(w) || 0) * (f * (k1 + 1)) / (f + k1 * (1 - b + b * d.length / avg)); }
      return s;
    });
  };
}
const topK = (scores, k) => scores.map((s, i) => [s, i]).sort((a, b) => b[0] - a[0]).slice(0, k).map((x) => x[1]);

// ---- Live embeddings for custom questions ----
async function embed(q) {
  if (!embedder) {
    const { pipeline, env } = await import("https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2");
    env.allowLocalModels = false;
    embedder = await pipeline("feature-extraction", "Xenova/bge-base-en-v1.5", { quantized: true });
  }
  const out = await embedder(META.prefix + q, { pooling: "cls", normalize: true });
  return out.data;
}
function denseScores(v) {
  const d = META.dim, s = new Array(META.n).fill(0);
  for (let i = 0; i < META.n; i++) { let a = 0; for (let j = 0; j < d; j++) a += EMB[i * d + j] * v[j]; s[i] = a; }
  return s;
}

// ---- Rendering ----
function highlight(text, golds, terms) {
  let h = esc(text);
  for (const g of golds || []) {
    const re = new RegExp(esc(g).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/'/g, "['\u2019]"), "gi");
    h = h.replace(re, (m) => `<mark>${m}</mark>`);
  }
  for (const t of terms || []) {
    if (t.length < 4) continue;
    h = h.replace(new RegExp(`\\b(${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})\\b`, "gi"), "<mark>$1</mark>");
  }
  return h;
}
function snippet(text, golds, terms) {
  const lower = norm(text);
  let at = -1;
  for (const g of golds || []) { at = lower.indexOf(norm(g)); if (at >= 0) break; }
  if (at < 0) for (const t of terms || []) { if (t.length >= 4) { at = lower.indexOf(t); if (at >= 0) break; } }
  const s = Math.max(0, at - 110);
  return (s > 0 ? "…" : "") + text.slice(s, s + 320);
}

async function showChunks(col, st, ids, golds, terms, my) {
  const body = $("col-" + col); body.innerHTML = "";
  const status = $("st-" + col); status.className = "status"; status.textContent = "ranking chunks…";
  await sleep(350);
  let found = -1;
  for (let r = 0; r < ids.length; r++) {
    if (my !== run) return;
    const c = CHUNKS[ids[r]];
    const hit = golds && golds.some((g) => norm(c.text).includes(norm(g)));
    if (hit && found < 0) found = r;
    const el = document.createElement("div");
    el.className = "chunk" + (hit ? " hit" : "");
    el.innerHTML = `<div class="meta"><span>#${r + 1} · chunk ${c.id}</span><span>lines ${c.start}–${c.end}</span></div><div class="txt">${highlight(snippet(c.text, golds, terms), golds, terms)}</div>`;
    el.onclick = () => openViewer(c.start, c.end, `Chunk ${c.id}, lines ${c.start}–${c.end}`);
    body.appendChild(el);
    await sleep(110);
  }
  if (!golds) { status.textContent = `top ${K} chunks`; return; }
  const v = document.createElement("div");
  v.className = "verdict " + (found >= 0 ? "hit" : "miss");
  v.textContent = found >= 0 ? `The answer reached the model (chunk #${found + 1}).` : "The answer never reached the model.";
  body.appendChild(v);
  status.textContent = found >= 0 ? "found" : "missed"; status.className = "status " + (found >= 0 ? "good" : "bad");
}

function callText(s) {
  const i = s.input || {};
  if (s.tool === "grep") return `grep "${i.query ?? i.pattern ?? ""}"`;
  if (s.tool === "read") return `read lines ${i.start_line ?? i.start ?? "?"}–${i.end_line ?? i.end ?? "?"}`;
  if (s.tool === "outline") return "outline";
  if (s.tool === "list") return "list files";
  return s.tool;
}

async function showAgent(q, my) {
  const body = $("col-ag"), status = $("st-ag"); body.innerHTML = ""; status.className = "status";
  const a = q.agent, steps = a.steps, total = a.ms || 8000;
  const pace = Math.max(500, Math.min(2200, (total * 0.85) / (steps.length + 1)));
  const t0 = performance.now();
  const tick = setInterval(() => { if (my !== run) return clearInterval(tick); status.textContent = ((performance.now() - t0) / 1000).toFixed(1) + " s"; }, 100);
  for (let n = 0; n < steps.length; n++) {
    const thinking = document.createElement("div"); thinking.className = "step typing"; thinking.innerHTML = `<div class="meta"><span>step ${n + 1}</span></div>`;
    body.appendChild(thinking);
    await sleep(pace);
    if (my !== run) return clearInterval(tick);
    const s = steps[n];
    thinking.className = "step"; thinking.title = "Show what came back";
    thinking.innerHTML = `<div class="meta"><span>step ${n + 1} · ${esc(s.tool)}</span><span>tap to see result</span></div><div class="call">${esc(callText(s))}</div><div class="res">${esc(s.result || "(no result text)")}</div>`;
    thinking.onclick = () => thinking.classList.toggle("open");
  }
  await sleep(pace);
  clearInterval(tick);
  if (my !== run) return;
  const ans = document.createElement("div"); ans.className = "answer";
  ans.innerHTML = esc(a.answer).replace(/\b(lines?)\s+(\d{1,4})/gi, (m, w, n) => `<span class="lnk" data-l="${n}">${w} ${n}</span>`);
  ans.querySelectorAll(".lnk").forEach((x) => (x.onclick = () => { const l = +x.dataset.l; openViewer(l, l, `Line ${l}`); }));
  body.appendChild(ans);
  status.textContent = `${(total / 1000).toFixed(1)} s · ${steps.length} tool calls`; status.className = "status good";
}

async function play(i) {
  const my = ++run, q = META.questions[i];
  $("race").hidden = false; $("raceQ").textContent = q.q;
  $("race").scrollIntoView({ behavior: "smooth", block: "start" });
  showChunks("rag", null, q.rag.ids.slice(0, K), q.gold, null, my);
  showChunks("kw", null, q.kw.ids.slice(0, K), q.gold, null, my);
  showAgent(q, my);
}

async function playCustom(text) {
  const my = ++run; selectChip(null);
  $("race").hidden = false; $("raceQ").textContent = text; $("customNote").hidden = false;
  $("race").scrollIntoView({ behavior: "smooth", block: "start" });
  const terms = tokenize(text).filter((t) => !STOP.has(t));
  showChunks("kw", null, topK(bm25(text), K), null, terms, my);
  const ag = $("col-ag"); ag.innerHTML = `<div class="verdict">The agent replays cover the ten tested questions. To run it on your own question, use the <a href="https://github.com/twospoon/READ" target="_blank" rel="noopener">READ tools</a> with Claude Code.</div>`;
  $("st-ag").textContent = "";
  const body = $("col-rag"), st = $("st-rag"); body.innerHTML = ""; st.className = "status";
  st.textContent = embedder ? "embedding…" : "loading model (110 MB)…";
  try {
    const v = await embed(text);
    if (my !== run) return;
    showChunks("rag", null, topK(denseScores(v), K), null, terms, my);
  } catch (e) {
    st.textContent = "model failed to load"; body.innerHTML = `<div class="verdict miss">Couldn't load the embedding model in this browser.</div>`;
  }
}
const STOP = new Set("the a an of to and or in on for is are was were how what when who whom which does do did much many will be by with from at its it this that than more after before about".split(" "));

// ---- Document viewer ----
function openViewer(start, end, title) {
  const from = Math.max(1, start - 12), to = Math.min(DOC.length, end + 12);
  let h = "";
  for (let l = from; l <= to; l++) h += `<div class="ln${l >= start && l <= end ? " focus" : ""}"><span>${l}</span><span>${esc(DOC[l - 1] || " ")}</span></div>`;
  $("viewerBody").innerHTML = h; $("viewerTitle").textContent = title; $("viewer").hidden = false;
  const f = $("viewerBody").querySelector(".focus"); if (f) f.scrollIntoView({ block: "center" });
}
$("viewerClose").onclick = () => ($("viewer").hidden = true);
$("viewer").onclick = (e) => { if (e.target.id === "viewer") $("viewer").hidden = true; };
document.addEventListener("keydown", (e) => { if (e.key === "Escape") $("viewer").hidden = true; });
$("custom").onsubmit = (e) => { e.preventDefault(); const t = $("customQ").value.trim(); if (t) playCustom(t); };

load();
