// Reading Anthropic's S-1 three ways. Preset questions use the exact rankings
// from the recorded test; the tools section and custom questions run live.

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => s.replace(/’/g, "'").toLowerCase();
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
  const list = $("qlist");
  META.questions.forEach((q, i) => {
    const li = document.createElement("li");
    li.innerHTML = `<button><span class="qn">${String(i + 1).padStart(2, "0")}</span><span>${esc(q.q)}</span><span class="arrow">Run</span></button>`;
    li.firstChild.onclick = () => { mark(li.firstChild); play(i); };
    list.appendChild(li);
  });
  doGrep(); doOutline(); doRead();
  countUp();
}
function mark(b) { document.querySelectorAll(".qlist button").forEach((x) => x.classList.toggle("on", x === b)); }

function countUp() {
  document.querySelectorAll(".count").forEach((el) => {
    const to = +el.dataset.to, t0 = performance.now(), dur = 1200;
    const step = (t) => { const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3); el.textContent = Math.round(to * e); if (p < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  });
}

// ---- The three tools, mirroring READ's normalisation ----
const baseForm = (t) => t.normalize("NFKC").replace(/[*_]/g, "").replace(/<\/?u>/gi, "").toLowerCase();
const spaced = (t) => baseForm(t).replace(/\|/g, " ").replace(/\s+/g, " ").trim();
const squashed = (t) => baseForm(t).replace(/[|,\s]/g, "");

function grep(q, ctx = 2, max = 25) {
  const sp = spaced(q), sq = squashed(q); if (!sq) return [];
  const hits = [];
  for (let i = 0; i < DOC.length && hits.length < max; i++) if (spaced(DOC[i]).includes(sp) || squashed(DOC[i]).includes(sq)) hits.push(i + 1);
  return hits;
}
function rowsHTML(lines, hitSet, term) {
  let h = "", prev = 0;
  for (const l of lines) {
    if (prev && l > prev + 1) h += `<div class="gap">···</div>`;
    let t = esc(clip(DOC[l - 1] || "", 260));
    if (term && hitSet.has(l)) t = t.replace(new RegExp(reEsc(esc(term)), "gi"), (m) => `<mark>${m}</mark>`);
    h += `<div class="row click${hitSet.has(l) ? " hit" : ""}" data-l="${l}"><span class="ln">${l}</span><span>${t}</span></div>`;
    prev = l;
  }
  return h;
}
const clip = (s, n) => (s.length > n ? s.slice(0, n) + " …" : s);
function wireRows(box) { box.querySelectorAll(".row.click").forEach((r) => (r.onclick = () => { const l = +r.dataset.l; openViewer(l, l, `Line ${l}`); })); }

function doGrep() {
  const q = $("grepQ").value.trim(), box = $("grepOut");
  const hits = grep(q);
  if (!hits.length) { box.innerHTML = `<p class="empty">No lines match "${esc(q)}".</p>`; return; }
  const show = new Set(); hits.forEach((l) => { for (let k = l - 1; k <= l + 1; k++) if (k >= 1 && k <= DOC.length) show.add(k); });
  box.innerHTML = `<p class="label" style="margin-bottom:8px">${hits.length}${hits.length === 25 ? "+" : ""} matching lines</p>` + rowsHTML([...show].sort((a, b) => a - b), new Set(hits), q);
  wireRows(box);
}
const HEAD = /^(#{1,6})\s+(.*\S)/;
const headingText = (t) => t.replace(/<\/?u>/gi, "").replace(/[*_]/g, "").replace(/\s+/g, " ").trim();
function doOutline() {
  const q = $("outlineQ").value.trim().toLowerCase(), box = $("outlineOut");
  const out = [];
  DOC.forEach((line, i) => { const m = line.match(HEAD); if (!m) return; const t = headingText(m[2]); if (!t || /table of contents/i.test(t)) return; if (!q || t.toLowerCase().includes(q)) out.push([i + 1, t]); });
  if (!out.length) { box.innerHTML = `<p class="empty">No headings contain "${esc(q)}".</p>`; return; }
  box.innerHTML = `<p class="label" style="margin-bottom:8px">${out.length} headings</p>` + out.slice(0, 60).map(([l, t]) => `<div class="row click" data-l="${l}"><span class="ln">${l}</span><span>${esc(t)}</span></div>`).join("");
  box.querySelectorAll(".row").forEach((r) => (r.onclick = () => { const l = +r.dataset.l; $("readFrom").value = l; $("readTo").value = l + 6; doRead(); $("readOut").scrollIntoView({ behavior: "smooth", block: "nearest" }); }));
}
function doRead() {
  let a = parseInt($("readFrom").value, 10) || 1, b = parseInt($("readTo").value, 10) || a;
  a = Math.max(1, Math.min(a, DOC.length)); b = Math.max(a, Math.min(b, a + 399, DOC.length));
  const lines = []; for (let l = a; l <= b; l++) lines.push(l);
  $("readOut").innerHTML = `<p class="label" style="margin-bottom:8px">Lines ${a}–${b}</p>` + rowsHTML(lines, new Set(), null);
  wireRows($("readOut"));
}
$("grepForm").onsubmit = (e) => { e.preventDefault(); doGrep(); };
$("outlineForm").onsubmit = (e) => { e.preventDefault(); doOutline(); };
$("readForm").onsubmit = (e) => { e.preventDefault(); doRead(); };

// ---- BM25 (Okapi, same settings as rank_bm25 in the test) ----
function tokenize(t) { return t.toLowerCase().replace(/,/g, "").match(/[a-z0-9.]+/g) || []; }
function buildBM25(docs, k1 = 1.5, b = 0.75, eps = 0.25) {
  const toks = docs.map(tokenize), N = toks.length;
  const avg = toks.reduce((s, d) => s + d.length, 0) / N;
  const df = new Map(), tf = toks.map((d) => { const m = new Map(); d.forEach((w) => m.set(w, (m.get(w) || 0) + 1)); m.forEach((_, w) => df.set(w, (df.get(w) || 0) + 1)); return m; });
  const idf = new Map(); let sum = 0; const neg = [];
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
  return (await embedder(META.prefix + q, { pooling: "cls", normalize: true })).data;
}
function denseScores(v) {
  const d = META.dim, s = new Array(META.n).fill(0);
  for (let i = 0; i < META.n; i++) { let a = 0; for (let j = 0; j < d; j++) a += EMB[i * d + j] * v[j]; s[i] = a; }
  return s;
}

// ---- Arena ----
function highlight(text, golds, terms) {
  let h = esc(text);
  for (const g of golds || []) h = h.replace(new RegExp(reEsc(esc(g)).replace(/'/g, "['’]"), "gi"), (m) => `<mark>${m}</mark>`);
  for (const t of terms || []) if (t.length >= 4) h = h.replace(new RegExp(`\\b(${reEsc(t)})\\b`, "gi"), "<mark>$1</mark>");
  return h;
}
function snippet(text, golds, terms) {
  const lower = norm(text); let at = -1;
  for (const g of golds || []) { at = lower.indexOf(norm(g)); if (at >= 0) break; }
  if (at < 0) for (const t of terms || []) if (t.length >= 4) { at = lower.indexOf(t); if (at >= 0) break; }
  const s = Math.max(0, at - 110);
  return (s > 0 ? "…" : "") + text.slice(s, s + 320);
}
function setStatus(col, text, good) { const s = $("st-" + col); s.textContent = text; s.className = "status" + (good ? " good" : ""); }

async function showChunks(col, ids, golds, terms, my) {
  const body = $("col-" + col); body.innerHTML = ""; setStatus(col, "Ranking…");
  await sleep(300);
  let found = -1;
  for (let r = 0; r < ids.length; r++) {
    if (my !== run) return;
    const c = CHUNKS[ids[r]], hit = !!golds && golds.some((g) => norm(c.text).includes(norm(g)));
    if (hit && found < 0) found = r;
    const el = document.createElement("div");
    el.className = "item" + (hit ? " hit" : "");
    el.innerHTML = `<div class="meta"><span>#${r + 1}${hit ? " · answer" : ""}</span><span>Lines ${c.start}–${c.end}</span></div><div class="txt">${highlight(snippet(c.text, golds, terms), golds, terms)}</div>`;
    el.onclick = () => openViewer(c.start, c.end, `Chunk ${c.id} · lines ${c.start}–${c.end}`);
    body.appendChild(el);
    await sleep(90);
  }
  if (!golds) { setStatus(col, `Top ${K} chunks`); return; }
  const v = document.createElement("div");
  v.className = "verdict" + (found >= 0 ? " hit" : "");
  v.textContent = found >= 0 ? `Answer reached the model · #${found + 1}` : "Answer never reached the model";
  body.appendChild(v);
  setStatus(col, found >= 0 ? "Found" : "Missed", found >= 0);
}

function callText(s) {
  const i = s.input || {};
  if (s.tool === "grep") return `search "${i.query ?? i.pattern ?? ""}"`;
  if (s.tool === "read") return `read lines ${i.start_line ?? i.start ?? "?"}–${i.end_line ?? i.end ?? "?"}`;
  if (s.tool === "outline") return "table of contents";
  if (s.tool === "list") return "list files";
  return s.tool;
}

async function showAgent(q, my) {
  const body = $("col-ag"); body.innerHTML = "";
  const a = q.agent, steps = a.steps, total = a.ms || 8000;
  const pace = Math.max(500, Math.min(2200, (total * 0.85) / (steps.length + 1)));
  const t0 = performance.now();
  const tick = setInterval(() => { if (my !== run) return clearInterval(tick); setStatus("ag", ((performance.now() - t0) / 1000).toFixed(1) + " s"); }, 100);
  for (let n = 0; n < steps.length; n++) {
    const el = document.createElement("div"); el.className = "item thinking";
    el.innerHTML = `<div class="meta"><span>Step ${n + 1}</span></div>`; body.appendChild(el);
    await sleep(pace);
    if (my !== run) return clearInterval(tick);
    const s = steps[n];
    el.className = "item";
    el.innerHTML = `<div class="meta"><span>Step ${n + 1}</span><span>Show result</span></div><div class="call">${esc(callText(s))}</div><div class="res">${esc(s.result || "(no result text)")}</div>`;
    el.onclick = () => el.classList.toggle("open");
  }
  await sleep(pace); clearInterval(tick);
  if (my !== run) return;
  const ans = document.createElement("div"); ans.className = "answer";
  ans.innerHTML = esc(a.answer.replace(/`/g, "")).replace(/\b(lines?)\s+(\d{1,4})/gi, (m, w, n) => `<span class="lnk" data-l="${n}">${w} ${n}</span>`);
  ans.querySelectorAll(".lnk").forEach((x) => (x.onclick = () => { const l = +x.dataset.l; openViewer(l, l, `Line ${l}`); }));
  body.appendChild(ans);
  setStatus("ag", `${(total / 1000).toFixed(1)} s · ${steps.length} tool calls`, true);
}

function openArena(title) {
  $("arena").hidden = false; $("arenaQ").textContent = title;
  $("arena").scrollIntoView({ behavior: "smooth", block: "start" });
}
function play(i) {
  const my = ++run, q = META.questions[i];
  openArena(q.q);
  showChunks("rag", q.rag.ids.slice(0, K), q.gold, null, my);
  showChunks("kw", q.kw.ids.slice(0, K), q.gold, null, my);
  showAgent(q, my);
}
const STOP = new Set("the a an of to and or in on for is are was were how what when who whom which does do did much many will be by with from at its it this that than more after before about".split(" "));
async function playCustom(text) {
  const my = ++run; mark(null); $("customNote").hidden = false;
  openArena(text);
  const terms = tokenize(text).filter((t) => !STOP.has(t));
  showChunks("kw", topK(bm25(text), K), null, terms, my);
  $("col-ag").innerHTML = `<p class="note-card">The agent replays cover the ten tested questions. To run it on your own question, use the <a href="https://github.com/twospoon/READ" target="_blank" rel="noopener">READ tools</a> with Claude Code, or try them by hand in the section above.</p>`;
  setStatus("ag", "");
  $("col-rag").innerHTML = ""; setStatus("rag", embedder ? "Embedding…" : "Loading model…");
  try {
    const v = await embed(text);
    if (my !== run) return;
    showChunks("rag", topK(denseScores(v), K), null, terms, my);
  } catch (e) {
    setStatus("rag", "Model failed"); $("col-rag").innerHTML = `<p class="note-card">Couldn't load the embedding model in this browser.</p>`;
  }
}
$("custom").onsubmit = (e) => { e.preventDefault(); const t = $("customQ").value.trim(); if (t) playCustom(t); };

// ---- Document viewer ----
function openViewer(start, end, title) {
  const from = Math.max(1, start - 12), to = Math.min(DOC.length, end + 12);
  let h = "";
  for (let l = from; l <= to; l++) h += `<div class="row${l >= start && l <= end ? " focus" : ""}"><span class="ln">${l}</span><span>${esc(DOC[l - 1] || " ")}</span></div>`;
  $("viewerBody").innerHTML = h; $("viewerTitle").textContent = title; $("viewer").hidden = false;
  const f = $("viewerBody").querySelector(".focus"); if (f) f.scrollIntoView({ block: "center" });
}
$("viewerClose").onclick = () => ($("viewer").hidden = true);
$("viewer").onclick = (e) => { if (e.target.id === "viewer") $("viewer").hidden = true; };
document.addEventListener("keydown", (e) => { if (e.key === "Escape") $("viewer").hidden = true; });

load();
