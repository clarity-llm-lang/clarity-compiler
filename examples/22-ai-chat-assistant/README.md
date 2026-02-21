# AI Chat Assistant

**Complexity:** Beginner
**Category:** AI Interop, Model Effect

## Description

A persona-driven assistant that combines a system prompt with user input.
The system prompt configures the model's behaviour (tone, role, constraints)
while the user supplies the actual question.

## What This Example Demonstrates

- **`chat(model, system, user)`** — system-prompt + user-message call
- **Custom model selection** — passing the model name explicitly
- **Model effect** — declaring LLM access in the function signature
- **`unwrap_or`** — graceful fallback on failure

## Usage

```bash
export OPENAI_API_KEY=sk-...

clarityc run main.clarity -f run -a "Explain recursion in one sentence"
```

## Configuration

| Variable | Default | Description |
|---|---|---|
| `OPENAI_API_KEY` | *(required)* | API key for your LLM provider |
| `OPENAI_BASE_URL` | `https://api.openai.com` | Override for any OpenAI-compatible endpoint |
