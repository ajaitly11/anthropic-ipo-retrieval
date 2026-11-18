#!/bin/zsh
# Asks each question to Claude Code with ONLY the READ tools (search, outline, read, list).
# Needs: Claude Code logged in, and READ installed (see experiment/README.md).
cd "$(dirname $0)"
: ${READ_DIR:?Set READ_DIR to your READ checkout, e.g. export READ_DIR=~/READ}
cat > mcp.json <<JSON
{"mcpServers":{"read":{"command":"$READ_DIR/.venv/bin/memory-mcp","args":["--transport","stdio","--root","$READ_DIR/memory/ANTHROPIC_S1"]}}}
JSON
mkdir -p answers; i=0
while IFS= read -r q; do
  i=$((i+1))
  ( claude -p "Answer from the Anthropic S-1 in the read tools only. Question: $q  Reply in one sentence with the figure and the line number you read it from." \
      --mcp-config mcp.json --strict-mcp-config --model sonnet \
      --allowedTools "mcp__read__memory_grep,mcp__read__memory_outline,mcp__read__memory_read,mcp__read__memory_list" \
      --disallowedTools "Bash,Read,Grep,Glob,WebSearch,WebFetch,Edit,Write,Agent" \
      < /dev/null > "answers/q$i.txt" 2>&1 ) &
done < questions.txt
wait
for f in answers/q*.txt; do echo "== $f"; cat $f; done
