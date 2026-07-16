---
spile: ticket
id: DH-0046
type: feature
status: refining
owner: stefan
resolution:
blocked_by: ["architect design pass in progress"]
created: 2026-07-15
relations:
  depends_on: []
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0046: No image/multimodal input, and no screenshot tool — blocks visual web-testing/verification workflows

## Summary

`ProviderContentBlock`/`ProviderMessage` have no image block type, and no tool in `ALL_TOOLS`
captures or attaches a screenshot/image to the conversation. This blocks a category of workflow
(e.g. "take a screenshot and check the layout") that comparable harnesses support via multimodal
messages — relevant for a coding-agent harness where the agent may need to visually verify web UI
changes it makes.

## User Stories

### As an agent verifying a web UI change, I want to capture and reason about a screenshot

- Given a running web app under test, when the agent needs visual verification, then a
  screenshot-capture tool exists and images can be attached to the conversation as a content block
  the model can see.

## Notes

> [!NOTE]
> Source: Competitive-differentiation sweep finding #10.

> [!NOTE]
> Owner decision (2026-07-15): queue now — real capability gap for verifying web UI changes,
> not speculative. Needs an architect pass (new content-block type, screenshot tool design).
