# AI Prompt

**Complexity:** Beginner
**Category:** AI Interop, Model Effect

## Description

Send a question to the default LLM (GPT-4o-mini) and print the answer.
Demonstrates the simplest possible usage of the `std/llm` library.

## What This Example Demonstrates

- **Model effect** — declaring LLM access with `effect[Model]`
- **`std/llm` import** — using the standard LLM library
- **`prompt(text)`** — single-turn question to the default model
- **`unwrap_or`** — fallback value on error

## Usage

```bash
export OPENAI_API_KEY=sk-...

# Optional: use a local Ollama instance instead
# export OPENAI_BASE_URL=http://localhost:11434

clarityc run main.clarity -f run -a "What is the capital of France?"
```

## Configuration

| Variable | Default | Description |
|---|---|---|
| `OPENAI_API_KEY` | *(required)* | API key for your LLM provider |
| `OPENAI_BASE_URL` | `https://api.openai.com` | Override for any OpenAI-compatible endpoint |
