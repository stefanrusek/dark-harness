# Container deployment

DH-0036: HANDOFF.md §1/§11 name a container as `dh`'s canonical deployment shape — "the
canonical deployment is a container that starts `dh` with an instructions file telling it
to check out a repo and branch and work unattended until done" — and README's security
posture section names containers as the recommended air-gapping boundary. This doc is the
reference for actually doing that: the `Dockerfile` at the repo root, plus the run/volume/
secret patterns below.

This is a starting point, not the only valid setup — adapt the base image, volume layout,
and secret-injection mechanism to your own infrastructure as needed.

## What's in the reference image

`Dockerfile` (repo root) is a two-stage build:

1. **Build stage** (`oven/bun:1.3.14`): installs dependencies, then runs
   `bun scripts/build.ts --outfile /out/dh` to produce a stamped, compiled binary (see ADR
   0005's build-identity amendment). This stage needs `git` on PATH — `scripts/build.ts`
   shells out to `git rev-parse HEAD` / `git status --porcelain` to stamp the binary's
   build identity, and does so in a way that throws if `git` is missing entirely, not just
   a soft fallback — so the Dockerfile installs it before running the build script.
2. **Runtime stage** (`debian:bookworm-slim`): only what the compiled binary and its tools
   need at runtime:
   - `bash` — the Bash tool runs every command via `bash -c` (`src/agent/tools/bash.ts`);
     without a real `bash` on PATH, every Bash tool call fails.
   - `git` — the canonical dark-factory use case is "check out a repo and branch," which
     the agent does via the Bash tool's own `git` invocations, not a built-in git client.
   - `ca-certificates` — outbound HTTPS to the model provider (Anthropic direct or AWS
     Bedrock) and to whatever git remote the agent clones/pushes to.

  `tmux` is deliberately **not** included — it's only a dependency of this repo's own e2e
  PTY test harness (`e2e/support/tmux-pty.ts`), never of the shipped `dh` binary.

Build it yourself:

```bash
docker build -t dh:local .
```

## Run modes

`dh` doesn't hardcode a mode in the image's `ENTRYPOINT` — per ADR 0001 (one binary, modes
composed by flags), the operator picks the mode via the container's command/args. The
default `CMD` is `--help`, so `docker run dh:local` alone is self-documenting instead of
silently hanging (headless server with no `--job`) or erroring.

### Unattended dark-factory run (the canonical case)

```bash
docker run --rm \
  -v "$(pwd)/workspace":/workspace \
  -e ANTHROPIC_API_KEY \
  dh:local --instructions /workspace/instructions.md --job
```

- `-v "$(pwd)/workspace":/workspace` mounts the container's working directory (where
  `.dh-logs/` and any repo the agent checks out land — see below) onto the host, so both
  survive the container exiting and are inspectable without `docker cp`.
- `--job` makes the process exit once the root agent finishes, with the harness's
  documented exit-code contract (ADR 0006): `0` success, `1` self-reported task failure,
  `2+` harness error — the signal a wrapping script or CI job should check.
- `instructions.md` (and any repo checkout it references) should live under the mounted
  volume, not be baked into the image, so a given image can be reused across jobs.

### Headless server (e.g. behind your own client/orchestration)

```bash
docker run --rm -p 4000:4000 \
  -v "$(pwd)/workspace":/workspace \
  -e ANTHROPIC_API_KEY \
  dh:local --server --port 4000
```

Then connect a console client from the host (or another container) with
`dh --connect <host>:4000` (or `--connect <host>:4000 --web` for the web UI). Per the
security posture (README's "Security posture, up front" / ADR 0003), this is plaintext
HTTP with no auth by default — only expose `-p 4000:4000` on a network you already trust
(a private network, an SSH tunnel, or `dh.json`'s opt-in `security.token`/`security.tls`,
covered in README's Configuration section), never directly on the open internet.

## Persisting logs (`.dh-logs`)

JSONL-per-agent session logs (ADR 0004: one file per agent, metadata header + timestamped
event lines) are written under `.dh-logs/<sessionId>/` relative to the process's working
directory — which is `/workspace` in this image (`WORKDIR /workspace` in the `Dockerfile`).
Mount a host directory (or a named volume) at `/workspace` — as in the examples above — to:

- keep logs after the container exits or is removed,
- read/tail them live from the host while a long unattended run is in progress,
- and hand them to log-analysis tooling without needing a running container at all.

## Injecting secrets

`dh.json`'s provider entries reference credentials via `$(VAR)` interpolation against
`process.env` at load time (HANDOFF.md §5) — e.g. an Anthropic provider's `apiKey` is
typically `"$(ANTHROPIC_API_KEY)"`. Inject those the same way you'd inject any container
secret — nothing `dh`-specific is required:

- **Plain env vars** (shown above): `-e ANTHROPIC_API_KEY` (reads from the host shell's
  environment) or `-e ANTHROPIC_API_KEY=sk-...` (inline — avoid this in shell history/CI
  logs; prefer the host-env form or an env file).
- **An env file**: `docker run --env-file secrets.env ...`, or `dh`'s own `--env <file>`
  flag, which loads dotenv-style variables from a file *before* `dh.json` is read (so
  `$(VAR)` interpolation sees them) — useful when you'd rather ship a secrets file into
  the mounted volume than rely on the container runtime's env-injection.
- **Bedrock credentials**: if using the `bedrock` provider type, standard AWS credential
  resolution applies (env vars, `~/.aws/credentials`, or — most idiomatic in a container
  orchestrator — an instance/task role, which needs no secret injection into the container
  at all). See README's Configuration section for the full provider schema.

Never bake credentials into the image itself (an `ENV` line in a Dockerfile, or a
`dh.json`/`.env` file `COPY`'d in at build time) — that puts them in the image's layer
history, retrievable by anyone who can pull or inspect the image.

## Signal handling

At the time of writing, `dh` does not install its own SIGTERM/SIGINT handling or
process-group reaping (tracked separately — see `tracking/DH-0011-*.md`). Until that lands,
a `docker stop` mid-run relies on the default container runtime behavior (SIGTERM, then
SIGKILL after the grace period) rather than a graceful agent-level shutdown; plan job
timeouts accordingly. This doc will get a "graceful shutdown" section once DH-0011 closes.
