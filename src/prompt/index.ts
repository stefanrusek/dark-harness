// Prompt domain public surface (CLAUDE.md §3). Core's agent loop imports `loadSystemPrompt`
// from here; nothing outside `src/prompt/` should reach into its internals directly.

export * from "./skills.ts";
export * from "./system-prompt.ts";
