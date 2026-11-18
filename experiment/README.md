# Run the experiment yourself

Three retrieval methods, ten questions, Anthropic's S-1. Edit `questions.txt` to ask your own.

## 1. Get the tools and the filing

```bash
git clone https://github.com/twospoon/READ.git ~/READ && cd ~/READ
python3 -m venv .venv && . .venv/bin/activate && pip install -e ".[convert,eval]"
mkdir -p sources && curl -A "your-name your@email" -o sources/anthropic-s1a3.htm \
  https://www.sec.gov/Archives/edgar/data/2130357/000162828026074338/anthropicpbc-sx1ax3.htm
python -c "import pymupdf; pymupdf.open('sources/anthropic-s1a3.htm', filetype='html').save('sources/anthropic-s1a3.pdf')"
converter -i sources/anthropic-s1a3.pdf --type pymupdf4llm
mkdir -p memory/ANTHROPIC_S1 && cp output/anthropic-s1a3/pymupdf4llm.md memory/ANTHROPIC_S1/anthropic-s1a3.md
```

The SEC asks for a contact in the User-Agent, so put your own in the `curl` line.

## 2. RAG vs keyword search

```bash
# from this repo's folder
mkdir -p ~/READ/s1test && cp experiment/run.py experiment/questions.txt ~/READ/s1test/
cd ~/READ && .venv/bin/python s1test/run.py
```

It reports, for each question, whether the answer reached the model in the top 8 and top 16 chunks. Edit the `Q` list in `run.py` to add your own questions with the answer text to look for.

## 3. The agent

Needs [Claude Code](https://claude.com/claude-code) logged in. Each question runs on its own with every tool removed except READ's.

```bash
export READ_DIR=~/READ
./experiment/agent.sh
```

Answers, with the line each came from, land in `experiment/answers/`.
