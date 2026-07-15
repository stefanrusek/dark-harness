---
spile: ticket
id: DH-0039
type: feature
status: ready
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

# DH-0039: Git credential provisioning and workspace-directory convention are entirely undocumented

## Summary

HANDOFF.md's canonical instructions file tells the agent to "check out a repo and branch," and the
bundled `cli-tools` skill covers `git` usage patterns, but nothing documents how the container gets
git credentials (SSH key mount, `GIT_ASKPASS`, `.netrc`, HTTPS token) or where the repo is expected
to live (no `workspaceDir`-style convention in `dh.json`, no documented default cwd expectation).
Every dark-factory deployment currently has to independently solve this from scratch, increasing
operational inconsistency across fleets/operators.

## User Stories

### As an operator standing up a new dark-factory deployment, I want a documented, recommended pattern for git credentials and workspace location

- Given the canonical "clone a repo and work on it" scenario, when setting up a container, then
  README/docs describe a recommended credential-injection pattern (mounted SSH key, `GIT_ASKPASS`,
  or PAT via env) and state the expected working-directory convention.

## Notes

> [!NOTE]
> Source: dark-factory ops audit finding #14.
