# Reference container for the canonical dark-factory deployment (HANDOFF.md §1/§11):
# a container that starts `dh` with an instructions file telling it to check out a repo
# and branch and work unattended until done. See docs/deployment.md for the full guide
# (volume mounts, secret injection, `docker run`/Compose examples).
#
# Multi-stage: build the compiled `dh` binary in a full Bun image, then ship it in a
# slim runtime image that only carries what the agent's tools actually need at runtime:
#   - bash          — the Bash tool runs every command via `bash -c` (src/agent/tools/bash.ts)
#   - git           — the canonical use case is "check out a repo and branch"; the Bash
#                     tool's git invocations need a real `git` on PATH
#   - ca-certificates — outbound HTTPS to the model provider (Anthropic/Bedrock) and to
#                     whatever git remote the agent clones/pushes to
# `tmux` is NOT included: it's only used by this repo's own e2e PTY test harness
# (e2e/support/tmux-pty.ts), never by the shipped `dh` binary itself.

FROM oven/bun:1.3.14 AS build
# scripts/build.ts shells out to `git rev-parse HEAD` / `git status --porcelain` to stamp
# build identity (ADR 0005 amendment) — and does so via Bun.spawnSync, which throws
# (uncaught) if `git` isn't even on PATH, not just a soft "unstamped" fallback. The base
# oven/bun image doesn't ship git, so install it here or the build stage crashes.
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun scripts/build.ts --outfile /out/dh

FROM debian:bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends bash git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /out/dh /usr/local/bin/dh
RUN chmod +x /usr/local/bin/dh

# HANDOFF.md §5/ADR 0004: JSONL-per-agent logs land under `.dh-logs` relative to the
# process's working directory. `/workspace` is that working directory here — mount it
# as a volume (see docs/deployment.md) to persist logs and the checked-out repo across
# container restarts, and to pull logs off the container without `docker cp`.
WORKDIR /workspace

# No ENTRYPOINT hardcoding a mode (--web/--server/--connect/--job/...): the operator
# picks the run mode via `docker run`'s CMD/args, per ADR 0001 (one binary, modes
# composed by flags). Default CMD is --help so `docker run <image>` alone is
# self-documenting rather than silently hanging or erroring.
ENTRYPOINT ["dh"]
CMD ["--help"]
