# AI Summarizer

**Complexity:** Intermediate
**Category:** AI Interop, Model Effect, File System

## Description

Reads arbitrary text from stdin and asks the LLM to produce a concise summary.
Shows how to combine `FileSystem` (stdin) and `Model` effects in a single program,
and how to check for errors with `is_ok` / `error_of`.

## What This Example Demonstrates

- **`read_all_stdin()`** — reading multi-line input from stdin
- **`chat(model, system, user)`** — structured system + user prompt
- **`is_ok` / `error_of`** — inspecting a `Result<String, String>` explicitly
- **String concatenation** with `++`
- **Multiple effects** — `effect[Model, FileSystem]`

## Usage

```bash
export OPENAI_API_KEY=sk-...

# Summarize a file
cat long-article.txt | clarityc run main.clarity -f run

# Summarize from heredoc
clarityc run main.clarity -f run << 'EOF'
Clarity is a strongly-typed functional language that compiles to WebAssembly.
It is designed so that LLMs can generate correct code on the first try.
EOF
```

## Configuration

| Variable | Default | Description |
|---|---|---|
| `OPENAI_API_KEY` | *(required)* | API key for your LLM provider |
| `OPENAI_BASE_URL` | `https://api.openai.com` | Override for any OpenAI-compatible endpoint (Ollama, Groq, …) |
