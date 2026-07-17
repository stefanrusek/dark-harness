# Prompt: generate the GitHub social preview image

**Status:** not yet generated — this document is the instructions for whichever future agent
has image-generation tooling available to produce and set it. This is a natural-language
prompt for that agent to follow, not a script.

**Owner:** design crew (Muriel), per `CLAUDE.md` §3 (`docs/design/` is durable, reusable
design-system material).

---

## What you're making

A single **1280×640px** PNG (GitHub's fixed social preview size — do not deviate; GitHub
crops/scales anything else). This image is what renders when the `dark-harness` repo URL is
shared on Twitter/X, LinkedIn, Slack, Hacker News, or any other link-preview surface. Treat
it as a thumbnail: it has to read in under a second, at small size, often on a phone.

## What to communicate at a glance

**Autonomous multi-agent "dark factory" software automation.** The single most important
idea: an agent harness that runs unattended, coordinating multiple sub-agents, without a
human babysitting every step. Tone: **dark, technical, competent** — this is infrastructure
for people who ship things, not a cartoon mascot or a cutesy illustration. No robots-shaking-
hands clip art, no generic "AI brain" stock-photo imagery, no gratuitous glow/lens-flare.
Think: the calm confidence of a well-designed terminal UI or an ops dashboard at 2am, not a
marketing deck.

## Visual and brand elements to draw from

Read these source files before generating anything — they're the actual visual language of
the project, not a guess:

1. **The diamond glyph `◆`** — the project's only current brand mark (see
   `docs/design/style-guide.md` §0/§7 and `README.md`'s title, `# ◆ Dark Harness`). It's
   borrowed from the web UI's own `.brand::before` CSS rule (`src/web/client/styles.css`).
   Use it as the anchor mark — do not invent a new logo/symbol; this is the one identity
   element that exists. Look up `.brand::before` in `src/web/client/styles.css` for its exact
   current styling (weight, color, any glow/shadow) before rendering it larger.
2. **`docs/media/hero-web-dark.png`** (and `hero-web-light.png` for contrast) — the README's
   hero screenshot of the actual web UI: a real agent tree with running/waiting/done/failed
   status dots, a dark panel-on-dark-background layout, monospace transcript text. Use this
   as your **color palette and mood reference**, not as content to crop into the preview
   image directly (a literal screenshot at 1280×640 will be illegible at thumbnail size).
   Pull the actual hex values from `docs/design/style-guide.md` §2.1 rather than eyeballing
   the screenshot:
   - Background: `#0b0d12` (near-black), panels `#12151c` / `#171b24`
   - Borders: `#232838` / `#2f3648`
   - Accent (brand/amber): `#f5a524` — this is the one brand hue, use it for the diamond
     and/or the wordmark, sparingly
   - Status colors if you include any dots/nodes: running blue `#4f8cff`, done green
     `#35c469`, failed red `#f2545b`, stopped purple `#9a7bd1`, waiting amber `#f5a524`
   - Text: `#e7e9ee` primary, `#8b93a7` dim
3. **The project name** — render "Dark Harness" as the primary wordmark text (full name, not
   just `dh`) so it's legible as a project name to someone who's never heard of it; `dh` can
   appear as a secondary/smaller mark (e.g. near the diamond) since that's the actual binary
   name, but shouldn't replace the full name as the headline text.
4. **Optional supporting motif**: a faint suggestion of an agent tree / node graph (small
   dots connected by thin lines, using the status color palette above) in the background or
   corner — this is the one product concept ("multiple agents, coordinated, with visible
   status") worth hinting at visually, since it's what distinguishes this from a generic CLI
   tool. Keep it subtle — background texture, not the main subject. Do not attempt to render
   actual UI chrome, text, or a literal screenshot into the image; it won't survive
   thumbnail-scale compression.

## Composition guidance

- 1280×640px exactly, PNG.
- Near-black background (`#0b0d12`) — do not use a light/white background; this is a dark
  brand, not a coincidence of the current README image, and a light background would clash
  with `hero-web-dark.png` right below it.
- Diamond glyph + "Dark Harness" wordmark should be the dominant, immediately-legible
  element, roughly centered or left-third-aligned (GitHub sometimes crops preview edges in
  some surfaces — keep the primary mark and text within the center ~85% of the frame, away
  from the outer edges).
- Leave visual breathing room — this is not a dashboard screenshot, it's a title card.
  Resist the urge to cram in feature callouts, taglines, or a bullet list. One strong mark,
  one wordmark, maybe one quiet supporting motif (the node-graph hint above). That's it.
- No stock-photo people, no generic "AI" iconography (glowing brains, humanoid robots), no
  gradient-mesh backgrounds unrelated to the actual palette above.

## How to actually generate it

You (the agent executing this prompt) need real image-generation tooling to produce the
PNG — this document only specifies *what* to make, not a code path to make it. Use whatever
image-generation tool/model you have available (e.g. an image-generation API or tool call),
feeding it the composition guidance above translated into a generation prompt. A reasonable
starting generation prompt, adapt as needed for your tool's syntax:

> A minimalist dark-themed software brand title card, 1280x640px. Near-black background
> (#0b0d12). Center-left: a bold amber (#f5a524) diamond glyph (◆) next to the wordmark "Dark
> Harness" in clean modern sans-serif, off-white (#e7e9ee) text. Subtle background texture:
> a faint constellation of small connected dots in blue (#4f8cff), green (#35c469), and
> purple (#9a7bd1), suggesting a coordinated agent network, kept low-contrast and
> non-distracting. No people, no robots, no stock photography, no gradients unrelated to
> this palette. Technical, confident, understated — like a well-designed developer tool's
> title card, not a marketing illustration.

Iterate on the generated result against the composition guidance above (legibility at
thumbnail size is the main failure mode to check for — view it scaled down to roughly
280×140px, the size a Slack/Twitter link-preview thumbnail actually renders at).

## How to set it as the repo's social preview once generated

Two options — pick whichever is available in your session:

**Option A — GitHub UI (no API token needed beyond normal git push access):**

1. Save the generated PNG somewhere in the repo for provenance (e.g.
   `docs/media/social-preview.png`) and commit it, or keep it outside the repo if the owner
   prefers not to check in a large binary — either is fine, GitHub's social preview upload
   doesn't require the file to live in the repo.
2. Go to the repo on github.com → **Settings** → **General** → scroll to **Social preview**
   → **Edit** → upload the PNG.

**Option B — GitHub API (`gh api`, requires a token with repo admin scope):**

```bash
gh api \
  --method POST \
  -H "Accept: application/vnd.github+json" \
  /repos/stefanrusek/dark-harness/social-preview \
  -F "image=@docs/media/social-preview.png"
```

(As of this writing, GitHub's social-preview upload is a multipart form endpoint rather than
a plain JSON one — confirm the exact endpoint/method against GitHub's current REST API docs
before running this, since it's not part of the stable, versioned REST API surface and may
have changed.) Verify afterward by checking Settings → General → Social preview in the UI,
since the API path doesn't return a friendly confirmation.

Either way, confirm the change by viewing the repo URL through a link-preview tool (e.g.
paste the repo URL into a Slack message draft, or use a link-preview-debugger site) to see
the rendered thumbnail before considering this done.
