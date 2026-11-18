"""Keyword search (BM25) vs vector RAG (bge-base, top-k chunks) on Anthropic's S-1/A.
Hit = the answer text appears in the chunks the retriever hands the model."""
import json, sys, time
from pathlib import Path
import numpy as np
from read_eval.corpus import Corpus
from read_eval.retrievers import chunk_corpus, BM25Retriever, DenseRetriever

ROOT = Path(__file__).resolve().parent.parent
Q = [
 ("How much of Anthropic's own code is written by Claude?", ["over 90%"]),
 ("How much money has Anthropic committed to spend on compute and data centres?", ["900.9 billion"]),
 ("How much is Anthropic paying Elon Musk's company for compute?", ["120.5 billion"]),
 ("How many customers pay Anthropic more than a million dollars a year?", ["1,900 customers"]),
 ("What will Anthropic's stock ticker be?", ["“ANT.”", "“ANT”"]),
 ("What price range are the IPO shares being sold at?", ["$70.00 and $78.00"]),
 ("How much revenue did Anthropic make from API usage in the first nine months of 2026?", ["26.3 billion"]),
 ("Does Anthropic depend on one big customer for its revenue?", ["No single customer represented more than 10%"]),
 ("How long before insiders can sell their shares after the IPO?", ["180 days"]),
 ("How much voting power do the founders keep after the IPO?", ["50.1%"]),
]
corpus = Corpus.load(ROOT / "memory/ANTHROPIC_S1/anthropic-s1a3.md", memory_root=ROOT / "memory")
chunks = chunk_corpus(corpus, chunk_chars=2000)
print(f"lines {len(corpus.lines)}  chunks {len(chunks)}")
bm25 = BM25Retriever(chunks)
from sentence_transformers import SentenceTransformer
t = time.time()
m = SentenceTransformer("BAAI/bge-base-en-v1.5")
emb = m.encode([c.text for c in chunks], batch_size=32, normalize_embeddings=True, show_progress_bar=False)
print(f"embedded in {time.time()-t:.0f}s")
dense = DenseRetriever(chunks, np.asarray(emb), query_prefix="Represent this sentence for searching relevant passages: ")
dense._model = m
def hit(r, q, golds, k):
    txt = "\n".join(h.chunk.text for h in r.retrieve(q, k))
    norm = lambda s: s.replace("’", "'")
    return any(norm(g).lower() in norm(txt).lower() for g in golds)
rows = []
for k in (8, 16):
    for q, g in Q:
        rows.append({"k": k, "q": q, "bm25": hit(bm25, q, g, k), "dense": hit(dense, q, g, k)})
for k in (8, 16):
    sub = [r for r in rows if r["k"] == k]
    print(f"\nk={k}: keyword {sum(r['bm25'] for r in sub)}/{len(sub)}   vector {sum(r['dense'] for r in sub)}/{len(sub)}")
    for r in sub:
        print(f"  {'Y' if r['bm25'] else '-'} {'Y' if r['dense'] else '-'}  {r['q']}")
json.dump(rows, open(ROOT / "s1test/results.json", "w"), indent=1)
