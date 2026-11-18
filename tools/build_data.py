"""Builds the site's data from the READ test in ~/Projects/read-keyword-search.
Run with that project's venv: ../read-keyword-search/.venv/bin/python tools/build_data.py"""
import json, sys
from pathlib import Path
import numpy as np
SRC = Path.home() / "Projects/read-keyword-search"
sys.path.insert(0, str(SRC))
from read_eval.corpus import Corpus
from read_eval.retrievers import chunk_corpus, BM25Retriever, DenseRetriever
from sentence_transformers import SentenceTransformer

OUT = Path(__file__).resolve().parent.parent / "data"
PREFIX = "Represent this sentence for searching relevant passages: "
QS = [
 ("How much of Anthropic's own code is written by Claude?", ["over 90%"], [1532]),
 ("How much money has Anthropic committed to spend on compute and data centres?", ["900.9 billion"], [768, 2300]),
 ("How much is Anthropic paying Elon Musk's company for compute?", ["120.5 billion"], [2006]),
 ("How many customers pay Anthropic more than a million dollars a year?", ["1,900 customers"], [1620]),
 ("What will Anthropic's stock ticker be?", ["“ANT.”", "“ANT”"], [33, 3669]),
 ("What price range are the IPO shares being sold at?", ["$70.00 and $78.00"], [33]),
 ("How much revenue did Anthropic make from API usage in the first nine months of 2026?", ["26.3 billion"], [1562]),
 ("Does Anthropic depend on one big customer for its revenue?", ["No single customer represented more than 10%"], [664, 1624]),
 ("How long before insiders can sell their shares after the IPO?", ["180 days"], [3601]),
 ("How much voting power do the founders keep after the IPO?", ["50.1%"], [35, 219]),
]
corpus = Corpus.load(SRC / "memory/ANTHROPIC_S1/anthropic-s1a3.md", memory_root=SRC / "memory")
lines = corpus.lines
chunks = chunk_corpus(corpus, chunk_chars=2000)
m = SentenceTransformer("BAAI/bge-base-en-v1.5")
emb = np.asarray(m.encode([c.text for c in chunks], batch_size=32, normalize_embeddings=True), dtype=np.float32)
bm25 = BM25Retriever(chunks)
dense = DenseRetriever(chunks, emb, query_prefix=PREFIX); dense._model = m
norm = lambda s: s.replace("’", "'").lower()

def has(text, golds): return any(norm(g) in norm(text) for g in golds)

def trajectory(i):
    steps, final, meta, t = [], "", {}, None
    pending = {}
    for raw in open(SRC / f"s1test/traj/q{i}.jsonl"):
        d = json.loads(raw)
        if d["type"] == "assistant":
            for c in d["message"]["content"]:
                if c["type"] == "tool_use" and c["name"].startswith("mcp__read__"):
                    s = {"tool": c["name"].replace("mcp__read__memory_", ""), "input": c["input"], "result": ""}
                    pending[c["id"]] = s; steps.append(s)
        elif d["type"] == "user":
            for c in d["message"]["content"]:
                if isinstance(c, dict) and c.get("type") == "tool_result" and c.get("tool_use_id") in pending:
                    x = c["content"]
                    if isinstance(x, list): x = "\n".join(p.get("text", "") for p in x if isinstance(p, dict))
                    try: x = json.loads(x).get("result", x)
                    except Exception: pass
                    pending[c["tool_use_id"]]["result"] = x[:1500]
        elif d["type"] == "result":
            final = d.get("result", ""); meta = {"ms": d.get("duration_ms"), "turns": d.get("num_turns"), "cost": round(d.get("total_cost_usd", 0), 4)}
    return steps, final, meta

qs = []
for i, (q, golds, gl) in enumerate(QS, 1):
    row = {"q": q, "gold": golds, "lines": gl}
    for name, r in (("rag", dense), ("kw", bm25)):
        hits = r.retrieve(q, 16)
        allr = r.retrieve(q, len(chunks))
        rank = next((n + 1 for n, h in enumerate(allr) if has(h.chunk.text, golds)), None)
        row[name] = {"ids": [h.chunk.chunk_id for h in hits], "hit8": has("\n".join(h.chunk.text for h in hits[:8]), golds), "hit16": has("\n".join(h.chunk.text for h in hits), golds), "rank": rank}
    steps, final, meta = trajectory(i)
    row["agent"] = {"steps": steps, "answer": final, **meta}
    qs.append(row)

OUT.mkdir(exist_ok=True)
json.dump({"lines": lines}, open(OUT / "doc.json", "w"))
json.dump([{"id": c.chunk_id, "start": c.start_line, "end": c.end_line, "text": c.text} for c in chunks], open(OUT / "chunks.json", "w"))
scale = 127.0
(np.clip(np.round(emb * scale), -127, 127).astype(np.int8)).tofile(OUT / "emb.i8")
json.dump({"questions": qs, "dim": int(emb.shape[1]), "n": len(chunks), "scale": scale, "prefix": PREFIX,
           "filing": "https://www.sec.gov/Archives/edgar/data/2130357/000162828026074338/0001628280-26-074338-index.htm"},
          open(OUT / "questions.json", "w"), indent=1, ensure_ascii=False)
print("chunks", len(chunks), "lines", len(lines))
for r in qs: print(f"rag#{r['rag']['rank']} kw#{r['kw']['rank']} steps={len(r['agent']['steps'])} {r['agent'].get('ms')}ms  {r['q']}")
