# Three ways to make AI read Anthropic's IPO filing

Ten investor questions, one 92,000-word SEC filing (Anthropic's S-1/A, 17 Nov 2026), three retrieval methods:

| Method | Answer reached the model (top 8 chunks) |
|---|---|
| Vector RAG (bge-base, 504 chunks) | 6/10 |
| Keyword search (BM25) | 4/10 |
| Claude with only grep, outline and a line reader | 10/10 correct answers, each with a line citation |

The site replays the agent's recorded tool calls and runs RAG and BM25 live in your browser, including on your own questions. For your own questions the agent can also run live in the browser on Qwen3 (1.7B or 4B, Apache 2.0, weights from Hugging Face via WebLLM), with the same three tools. That needs WebGPU and a 1 to 2.3 GB one-time download, and small models answer less reliably than Claude.

The agent's tools are from [READ](https://github.com/twospoon/READ) ("Beyond Top-K", arXiv 2608.06305, IIT Patna and TwoSpoon). `tools/build_data.py` rebuilds `data/` from that repo's test setup. Ten questions on one document: a demo, not a benchmark.

## Run it yourself

[`experiment/`](experiment/README.md) has the test harness: RAG and BM25 retrieval (`run.py`), the agent run through Claude Code (`agent.sh`), and the ten questions. Swap in your own questions to compare the three retrieval methods.
