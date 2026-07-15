// Ambient module declaration for importing a `.md` file's raw contents as a string via
// Bun's `with { type: "text" }` import attribute (bun-types ships this for `*.txt` but not
// `*.md`; SKILL.md is a fixed filename by convention, so the extension can't just change).
// Bun embeds these text imports into `--compile` binaries, which is how the bundled
// cli-tools skill (`src/prompt/skills/cli-tools/SKILL.md`) ships inside the `dh` binary.
declare module "*.md" {
  let text: string;
  export = text;
}
