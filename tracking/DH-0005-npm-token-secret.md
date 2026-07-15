---
spile: ticket
id: DH-0005
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

# DH-0005: `NPM_TOKEN` repository secret not yet set

## Summary

`release.yml`'s `publish-npm` job fails loudly (rather than silently skipping) if the
`NPM_TOKEN` secret is absent — that fail-loud behavior is intentional and already shipped.
This ticket just tracks the remaining action: the owner needs to add an npm automation token
as the `NPM_TOKEN` repository secret before the first `v*` tag push, or the publish step will
correctly fail.

## User Stories

### As the owner, I want the release pipeline to actually publish to npm on a tagged release

- Given a `v*` tag pushed with no `NPM_TOKEN` secret set, when `release.yml` runs, then the
  publish-npm job fails with a clear error (already true today).
- Given the secret is set, when the same tag is pushed, then the package publishes
  successfully.

## Notes

> [!NOTE]
> This is a pure owner-authority action item — no agent can create or set a repository
> secret. Nothing to delegate; just needs doing before the first real release tag.
