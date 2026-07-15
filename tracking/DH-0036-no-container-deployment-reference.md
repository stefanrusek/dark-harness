---
spile: ticket
id: DH-0036
type: feature
status: implementing
owner: stefan
resolution:
blocked_by: []
created: 2026-07-15
relations:
  depends_on: []
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0036: No reference Dockerfile or container/deployment documentation for the canonical dark-factory use case

## Summary

HANDOFF.md §1/§11 name a container as the canonical deployment, and README mentions containers as
a security posture option, but there is no shipped Dockerfile, no base-image guidance (does it need
`git`, CA certificates, `tmux`?), no example `docker run`/Compose/Kubernetes manifest, and no
guidance on mounting `.dh-logs` as a volume or injecting secrets via env. This is the single
largest first-deployment gap for the primary stated use case — every operator currently has to
independently solve "how do I containerize this" from scratch.

## User Stories

### As an operator deploying `dh` for unattended dark-factory work, I want a reference container setup to start from

- Given the canonical container deployment scenario, when looking for guidance, then a minimal
  reference Dockerfile (Bun base image + git + CA certificates) and a short deployment doc exist,
  covering log-volume mounting, env-var secret injection, and (once DH-0011 lands) signal behavior.

## Notes

> [!NOTE]
> Source: dark-factory ops audit finding #11; overlaps with docs audit findings #13 and #15
> (missing container/deployment documentation, independently raised by both sweeps).
