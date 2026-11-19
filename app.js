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
  const tb = document.querySelector("#matrix tbody");
  META.questions.forEach((q, i) => {
    const tr = document.createElement("tr");
    const cell = (m) => `<span class="cell"><span class="dot${q[m].hit8 ? " yes" : ""}"></span><span class="rk">#${q[m].rank ?? "–"}</span></span>`;
    tr.innerHTML = `<td><span class="q"><span class="qn">${String(i + 1).padStart(2, "0")}</span><span>${esc(q.q)}</span></span></td><td>${cell("rag")}</td><td>${cell("kw")}</td><td><span class="cell"><span class="dot win"></span><span class="rk">${q.agent.steps.length} steps</span></span></td>`;
    tr.onclick = () => { mark(tr); play(i); };
    tb.appendChild(tr);
  });
  doGrep(); doOutline(); doRead();
  countUp();
}
function mark(b) { document.querySelectorAll("#matrix tbody tr").forEach((x) => x.classList.toggle("on", x === b)); }

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
    const raw = tidy(DOC[l - 1] || "");
    if (!raw && !hitSet.has(l)) continue;
    if (prev && l > prev + 1) h += `<div class="gap">···</div>`;
    let t = esc(clip(raw, 260));
    if (term && hitSet.has(l)) t = t.replace(new RegExp(reEsc(esc(term)), "gi"), (m) => `<mark>${m}</mark>`);
    h += `<div class="row click${hitSet.has(l) ? " hit" : ""}" data-l="${l}"><span class="ln">${l}</span><span>${t}</span></div>`;
    prev = l;
  }
  return h;
}
const tidy = (s) => s.replace(/^#{1,6}\s+/, "").replace(/<\/?u>/gi, "").replace(/\*\*/g, "").replace(/(^|\s)_+|_+(\s|$)/g, "$1$2").replace(/\s+/g, " ").trim();
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
const AXIS = 50;
function strip(col, rank) {
  const el = $("strip-" + col);
  if (!rank) { el.innerHTML = ""; return; }
  const pos = (r) => (Math.min(r, AXIS) - 1) / (AXIS - 1) * 100;
  const out = rank > AXIS, seen = rank <= K;
  el.innerHTML = `<div class="cap"><span>Where the answer ranked</span><span>${seen ? "Model saw it" : "Model never saw it"}</span></div>
    <div class="track"><div class="rail"></div><div class="seen" style="width:${pos(K)}%"></div><div class="cut" style="left:${pos(K)}%"></div><div class="mk${out ? " out" : ""}" style="left:0%"></div></div>
    <div class="ticks"><span>#1</span><span>top ${K} go to the model</span><span>${out ? "#" + rank + " →" : "#" + AXIS}</span></div>`;
  requestAnimationFrame(() => requestAnimationFrame(() => { el.querySelector(".mk").style.left = pos(rank) + "%"; }));
  el.querySelector(".cap span").textContent = `Answer ranked #${rank}`;
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
  strip("rag", q.rag.rank); strip("kw", q.kw.rank);
  $("agLabel").textContent = "Claude + three tools";
  showChunks("rag", q.rag.ids.slice(0, K), q.gold, null, my);
  showChunks("kw", q.kw.ids.slice(0, K), q.gold, null, my);
  showAgent(q, my).then(() => { if (my === run) liveOffer(q.q, my, true); });
}
const STOP = new Set("the a an of to and or in on for is are was were how what when who whom which does do did much many will be by with from at its it this that than more after before about".split(" "));
async function playCustom(text) {
  const my = ++run; mark(null); $("customNote").hidden = false;
  openArena(text);
  const terms = tokenize(text).filter((t) => !STOP.has(t));
  showChunks("kw", topK(bm25(text), K), null, terms, my);
  strip("rag", null); strip("kw", null);
  $("col-ag").innerHTML = ""; setStatus("ag", ""); $("agLabel").textContent = "Open model + three tools";
  liveOffer(text, my, false);
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

// ---- Live agent on an open model (Qwen3 via WebLLM, weights from Hugging Face) ----
const MODELS = [
  ["Qwen3-1.7B-q4f16_1-MLC", "Qwen3 1.7B · about 1 GB download"],
  ["Qwen3-4B-q4f16_1-MLC", "Qwen3 4B · about 2.3 GB, better answers"],
];
let engine = null, engineId = null;
const SYSTEM = `You answer questions about Anthropic's IPO filing, an SEC S-1 of 4,733 lines. You cannot see the filing. You must use tools to find the answer.
Reply with exactly one JSON object and nothing else. The options are:
{"tool":"search","query":"..."} finds lines containing a word or number. Use 1 to 3 words in the filing's own wording, and try other words if nothing matches.
{"tool":"outline","filter":"..."} lists section headings containing a word, with their line numbers.
{"tool":"read","start":N,"end":M} reads lines N to M, at most 40 lines.
{"answer":"one sentence with the figure","line":N} gives your final answer, citing a line you actually saw.
Always start with a search. Never answer from memory.
Example. Question: How many customers pay Anthropic $10 million or more?
{"tool":"search","query":"$10 million or more"}
Result: line 1620: ...approximately 250 customers with $10 million or more of revenue on a TTM basis...
{"answer":"About 250 customers paid Anthropic $10 million or more over the trailing twelve months.","line":1620}`;

function liveOffer(question, my, afterReplay) {
  const body = $("col-ag");
  const box = document.createElement("div"); box.className = "live";
  if (!navigator.gpu) {
    box.innerHTML = `<p class="note-card">${afterReplay ? "Want to compare with an open model? " : ""}Running the agent live needs WebGPU, which this browser doesn't have. Try desktop Chrome or Edge.</p>`;
    body.appendChild(box); return;
  }
  box.innerHTML = `<p class="note-card">${afterReplay ? "Now try the same question on an open model running in your browser with the same three tools." : "Run the agent live on an open model from Hugging Face, inside your browser, with the same three tools."}</p>
    <select aria-label="Model">${MODELS.map(([id, l]) => `<option value="${id}"${id === engineId ? " selected" : ""}>${l}</option>`).join("")}</select>
    <button class="btn${afterReplay ? " ghost" : ""}">Run the agent live</button>`;
  box.querySelector("button").onclick = () => { const id = box.querySelector("select").value; box.remove(); runLive(question, id, my, afterReplay); };
  body.appendChild(box);
}

async function getEngine(id, onProgress) {
  if (engine && engineId === id) return engine;
  const webllm = await import("https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.86/+esm");
  if (engine) { await engine.unload(); engine = null; }
  engine = await webllm.CreateMLCEngine(id, { initProgressCallback: onProgress });
  engineId = id;
  return engine;
}

function toolRun(call) {
  const clipL = (l) => `line ${l}: ${clip(DOC[l - 1] || "", 220)}`;
  if (call.tool === "search") {
    const hits = grep(String(call.query || ""), 0, 10);
    return hits.length ? hits.map(clipL).join("\n") : `No lines contain "${call.query}". Try a different word.`;
  }
  if (call.tool === "outline") {
    const f = String(call.filter || "").toLowerCase(), out = [];
    DOC.forEach((line, i) => { const m = line.match(HEAD); if (!m) return; const t = headingText(m[2]); if (t && !/table of contents/i.test(t) && (!f || t.toLowerCase().includes(f))) out.push(`line ${i + 1}: ${t}`); });
    return out.length ? out.slice(0, 15).join("\n") : `No headings contain "${call.filter}".`;
  }
  if (call.tool === "read") {
    let a = Math.max(1, parseInt(call.start, 10) || 1), b = Math.min(DOC.length, parseInt(call.end, 10) || a + 10);
    if (b < a) b = a; b = Math.min(b, a + 39);
    const out = []; for (let l = a; l <= b; l++) if ((DOC[l - 1] || "").trim()) out.push(clipL(l));
    return clip(out.join("\n"), 2400) || "Those lines are empty.";
  }
  return 'Unknown tool. Use "search", "outline", "read", or give your "answer".';
}

function parseCall(text) {
  const t = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  const m = t.match(/\{[\s\S]*\}/); const raw = m ? m[0] : t;
  try { return JSON.parse(raw); } catch {}
  try { return JSON.parse(raw.replace(/(\d)"(?=\s*[,}])/g, "$1").replace(/:\s*"(\d+)(?=\s*[,}])/g, ":$1")); } catch {}
  const g = (k) => (raw.match(new RegExp(`"${k}"\\s*:\\s*"?([^",}]+)`)) || [])[1];
  if (g("tool")) return { tool: g("tool"), query: g("query"), filter: g("filter"), start: g("start"), end: g("end") };
  return null;
}

async function runLive(question, id, my, afterReplay) {
  const body = $("col-ag");
  if (afterReplay) { const hr = document.createElement("p"); hr.className = "label"; hr.style.margin = "22px 0 4px"; hr.textContent = `Live · ${id.split("-q4")[0].replace("-", " ")}`; body.appendChild(hr); }
  else $("agLabel").textContent = `${id.split("-q4")[0].replace("-", " ")} + three tools`;
  const prog = document.createElement("div"); prog.className = "live";
  prog.innerHTML = `<p class="note-card" id="progText">Loading the model…</p><div class="progress"><div></div></div>`;
  body.appendChild(prog);
  let eng;
  try {
    eng = await getEngine(id, (p) => { prog.querySelector("div > div").style.width = Math.round((p.progress || 0) * 100) + "%"; prog.querySelector("p").textContent = (p.text || "Loading…").replace(/\[.*?\]\s*/, ""); });
  } catch (e) {
    prog.innerHTML = `<p class="note-card">The download stopped (${esc(String(e.message || e).slice(0, 90))}). Finished parts are saved, so a retry picks up where it left off. It also needs enough free disk space and graphics memory.</p><button class="btn ghost">Retry</button>`;
    prog.querySelector("button").onclick = () => { prog.remove(); if (afterReplay) body.lastElementChild?.classList?.contains("label") && body.lastElementChild.remove(); runLive(question, id, my, afterReplay); };
    return;
  }
  if (my !== run) return;
  prog.remove();
  const t0 = performance.now();
  const tick = setInterval(() => { if (my !== run) return clearInterval(tick); setStatus("ag", ((performance.now() - t0) / 1000).toFixed(1) + " s"); }, 100);
  const head = [{ role: "system", content: SYSTEM }, { role: "user", content: `Question: ${question} /no_think` }];
  let turns = [], answer = null; const seen = new Set();
  const MAX = 8;
  for (let n = 0; n < MAX && !answer; n++) {
    const el = document.createElement("div"); el.className = "item thinking";
    el.innerHTML = `<div class="meta"><span>Step ${n + 1}</span></div>`; body.appendChild(el);
    const msgs = [...head, ...turns.slice(-6)];
    if (n === MAX - 1) msgs.push({ role: "user", content: "No steps left. Give your answer JSON now, from what you have seen. /no_think" });
    let text = "";
    try {
      const r = await eng.chat.completions.create({ messages: msgs, temperature: 0, max_tokens: 160, extra_body: { enable_thinking: false } });
      text = r.choices[0].message.content || "";
    } catch (e) { text = ""; }
    if (my !== run) return clearInterval(tick);
    const call = parseCall(text);
    if (!call) { el.className = "item"; el.innerHTML = `<div class="meta"><span>Step ${n + 1}</span></div><div class="call">unreadable reply</div><div class="res">${esc(text.slice(0, 300))}</div>`; el.onclick = () => el.classList.toggle("open"); turns.push({ role: "assistant", content: text || "{}" }, { role: "user", content: "Reply with one JSON object only. /no_think" }); continue; }
    if (call.answer) {
      const l = parseInt(call.line, 10);
      if (seen.size && seen.has(l)) { el.remove(); answer = call; break; }
      const why = seen.size ? `Line ${call.line} isn't one you have seen. Read it or search again before answering.` : "You haven't looked at the filing yet. Start with a search.";
      el.className = "item"; el.innerHTML = `<div class="meta"><span>Step ${n + 1}</span></div><div class="call">answer rejected</div><div class="res">${esc(why)}</div>`; el.onclick = () => el.classList.toggle("open");
      turns.push({ role: "assistant", content: JSON.stringify(call) }, { role: "user", content: why + " /no_think" });
      continue;
    }
    const result = toolRun(call);
    for (const m of result.matchAll(/^line (\d+):/gm)) seen.add(+m[1]);
    el.className = "item";
    el.innerHTML = `<div class="meta"><span>Step ${n + 1}</span><span>Show result</span></div><div class="call">${esc(callText({ tool: call.tool, input: { query: call.query, start_line: call.start, end_line: call.end } }) + (call.tool === "outline" && call.filter ? ` "${call.filter}"` : ""))}</div><div class="res">${esc(result)}</div>`;
    el.onclick = () => el.classList.toggle("open");
    turns.push({ role: "assistant", content: JSON.stringify(call) }, { role: "user", content: `Result:\n${result}\n\nNext JSON? /no_think` });
  }
  clearInterval(tick);
  const ans = document.createElement("div"); ans.className = "answer";
  if (answer) {
    const l = parseInt(answer.line, 10);
    ans.innerHTML = esc(String(answer.answer)) + (l ? ` <span class="lnk" data-l="${l}">line ${l}</span>` : "");
    const lk = ans.querySelector(".lnk"); if (lk) lk.onclick = () => openViewer(l, l, `Line ${l}`);
  } else ans.textContent = "The model ran out of steps without an answer.";
  body.appendChild(ans);
  const secs = ((performance.now() - t0) / 1000).toFixed(1);
  setStatus("ag", `${secs} s · live`, !!answer);
  const fine = document.createElement("p"); fine.className = "fine";
  fine.textContent = "Small open models can misread or invent figures. Click the line to check it.";
  body.appendChild(fine);
}
