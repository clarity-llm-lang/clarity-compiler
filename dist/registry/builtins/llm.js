// LLM builtins: call_model, streaming, embedding, eval.
import { INT64, FLOAT64, STRING, BOOL, LIST_STRING, OPTION_STRING, } from "./types.js";
export const LLM_BUILTINS = [
    // --- Model operations (require Model effect) ---
    {
        name: "call_model", params: [STRING, STRING], paramNames: ["model", "prompt"],
        returnType: { kind: "Result", ok: STRING, err: STRING },
        effects: ["Model"], doc: "Call a language model with a user prompt. Returns Ok(response) on success or Err(message) on failure. The model name should be an OpenAI-compatible model identifier (e.g. \"gpt-4o\", \"gpt-4o-mini\"). Requires OPENAI_API_KEY (and optionally OPENAI_BASE_URL) environment variables.", category: "model",
    },
    {
        name: "call_model_system", params: [STRING, STRING, STRING], paramNames: ["model", "system_prompt", "user_prompt"],
        returnType: { kind: "Result", ok: STRING, err: STRING },
        effects: ["Model"], doc: "Call a language model with separate system and user prompts. Returns Ok(response) on success or Err(message) on failure. The system prompt sets the model's behavior/persona. Requires OPENAI_API_KEY environment variable.", category: "model",
    },
    {
        name: "list_models", params: [], paramNames: [],
        returnType: LIST_STRING,
        effects: ["Model"], doc: "List available model identifiers from the configured LLM provider. Returns an empty list on failure. Requires OPENAI_API_KEY environment variable.", category: "model",
    },
    {
        name: "stream_start", params: [STRING, STRING, STRING], paramNames: ["model", "prompt", "system"],
        returnType: { kind: "Result", ok: INT64, err: STRING },
        effects: ["Model"], doc: "Start a streaming LLM call. Returns Ok(handle) where handle is an opaque Int64 stream identifier, or Err(message) on failure. Pass the handle to stream_next() to receive tokens one at a time, and stream_close() when done. Use empty string for system if no system prompt is needed. Supports the same multi-provider routing as call_model (claude-* \u2192 Anthropic, others \u2192 OpenAI-compatible). Example: match stream_start(\"gpt-4o\", prompt, \"\") { Ok(h) -> ..., Err(e) -> ... }.", category: "model",
    },
    {
        name: "stream_next", params: [INT64], paramNames: ["handle"],
        returnType: OPTION_STRING,
        effects: ["Model"], doc: "Receive the next token from a streaming LLM call. Blocks until a token is available. Returns Some(token) when a token arrives, or None when the stream ends (either normally or due to an error). Call stream_close(handle) after None is returned to retrieve any error message and release resources. Example: match stream_next(handle) { Some(t) -> ..., None -> ... }.", category: "model",
    },
    {
        name: "stream_close", params: [INT64], paramNames: ["handle"],
        returnType: STRING,
        effects: ["Model"], doc: "Close a streaming LLM call and release its resources. Returns an empty string if the stream completed normally, or an error message if the stream ended due to an error. Always call this after stream_next() returns None. Example: let err = stream_close(handle).", category: "model",
    },
    // --- Embed operations (require Embed effect, except pure computation builtins) ---
    {
        name: "embed_text", params: [STRING], paramNames: ["text"],
        returnType: { kind: "Result", ok: STRING, err: STRING },
        effects: ["Embed"], doc: "Embed a text string using the configured embedding model (CLARITY_EMBED_MODEL, default text-embedding-ada-002) via OPENAI_BASE_URL/v1/embeddings. Returns Ok(json_float_array) or Err(message). The JSON array can be passed to cosine_similarity or embed_and_retrieve.", category: "embed",
    },
    {
        name: "cosine_similarity", params: [STRING, STRING], paramNames: ["a_json", "b_json"],
        returnType: FLOAT64,
        effects: [], doc: "Compute the cosine similarity between two embedding vectors represented as JSON float arrays (as returned by embed_text). Returns a value in [0.0, 1.0]. Pure computation \u2014 no network call. Example: cosine_similarity(vec_a, vec_b).", category: "embed",
    },
    {
        name: "chunk_text", params: [STRING, INT64], paramNames: ["text", "chunk_size"],
        returnType: STRING,
        effects: [], doc: "Split text into non-overlapping chunks of approximately chunk_size characters. Returns a JSON array of strings. Pure computation. Example: chunk_text(document, 512).", category: "embed",
    },
    {
        name: "embed_and_retrieve", params: [STRING, STRING, INT64], paramNames: ["query", "chunks_json", "top_k"],
        returnType: { kind: "Result", ok: STRING, err: STRING },
        effects: ["Embed"], doc: "Embed the query and all chunks in chunks_json (a JSON string array), rank chunks by cosine similarity to the query, and return the top_k most relevant chunks as a JSON string array. Example: embed_and_retrieve(query, chunk_text(doc, 512), 5).", category: "embed",
    },
    // --- Eval operations ---
    { name: "eval_exact", params: [STRING, STRING], paramNames: ["got", "expected"], returnType: BOOL, effects: [], doc: "Exact string equality check. Returns True when got == expected. Pure \u2014 no effect required. Example: eval_exact(response, \"Paris\").", category: "eval" },
    { name: "eval_contains", params: [STRING, STRING], paramNames: ["got", "expected"], returnType: BOOL, effects: [], doc: "Substring check. Returns True when got contains expected as a substring. Case-sensitive. Pure \u2014 no effect required. Example: eval_contains(response, \"France\").", category: "eval" },
    {
        name: "eval_llm_judge", params: [STRING, STRING, STRING, STRING], paramNames: ["model", "prompt", "response", "rubric"],
        returnType: { kind: "Result", ok: STRING, err: STRING },
        effects: ["Eval"], doc: "Ask a language model to judge a response against a rubric. Returns Ok(json) where json contains {\"score\": 0.0-1.0, \"pass\": true/false, \"reason\": \"...\"}. model is the judge model name, prompt is the original prompt given to the model under test, response is what it returned, rubric describes the evaluation criteria. Example: eval_llm_judge(\"gpt-4o\", prompt, response, \"Answer must name the capital of France.\").", category: "eval",
    },
    {
        name: "eval_semantic", params: [STRING, STRING], paramNames: ["got", "expected"],
        returnType: { kind: "Result", ok: FLOAT64, err: STRING },
        effects: ["Eval"], doc: "Measure semantic similarity between two strings using text embeddings. Embeds both strings and returns Ok(cosine_similarity) in [0.0, 1.0]. A value above ~0.85 typically indicates semantic equivalence. Requires OPENAI_API_KEY. Example: eval_semantic(response, \"The capital of France is Paris.\").", category: "eval",
    },
];
//# sourceMappingURL=llm.js.map