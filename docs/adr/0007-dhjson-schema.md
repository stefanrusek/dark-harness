# ADR 0007: `dh.json` configuration schema

**Status:** Accepted

## Context

Dark Harness needs one config file covering model/provider selection, tool defaults,
skill/MCP discovery, and (per ADR 0004) optional security settings — owner-specified, kept
minimal and extended only as needed.

## Decision

`dh.json` (default location: `dh.json` in the working directory; overridable via
`--config <path>`):

```json
{
  "options": { "defaultModel": "sonnet" },
  "models": [
    { "name": "sonnet", "provider": "anthropic", "model": "sonnet-5" },
    { "name": "gemma4", "provider": "bedrock", "model": "gemma4" }
  ],
  "provider": [
    { "name": "anthropic", "type": "anthropic" },
    { "name": "bedrock", "type": "bedrock" },
    { "name": "local", "type": "anthropic" }
  ],
  "skillPaths": ["./skills"],
  "mcpServers": {},
  "systemPrompt": null,
  "security": { "token": null, "tls": null }
}
```

- **`models`**: named entries mapping to a named provider + a provider-side model id. Tools
  and options refer to models by `name`, never by provider-side id directly.
- **`provider`**: `type: "anthropic"` (Anthropic SDK, supports custom `baseURL` so a "local"
  provider can point at any Anthropic-compatible endpoint) or `type: "bedrock"` (AWS
  Bedrock, standard AWS credential chain). Provider entries carry whatever fields their type
  needs.
- **`$(VAR)`** in any string value resolves against the environment at load time.
- **`skillPaths`**: directories scanned for skill folders (each containing a `SKILL.md`,
  Claude Code convention).
- **`mcpServers`**: Claude Code-style map of MCP server definitions (stdio and HTTP).
- **`systemPrompt`**: optional path overriding the built-in system prompt.
- **`options`**: `defaultModel` plus the config-level override for the `run_in_background`
  default (HANDOFF.md §4).
- **`security`**: see ADR 0004.

## Consequences

- This is the schema every domain codes against; `src/config/` owns loading/validation,
  `src/contracts/` owns the TypeScript type. Restructuring it (not just additive fields) is
  an ADR-amending change (CLAUDE.md §6 escalation trigger 1).
- Unknown top-level keys should be rejected or warned on (fleet's call at implementation
  time, not re-litigated here) to catch config typos early.
