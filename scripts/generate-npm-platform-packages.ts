#!/usr/bin/env bun
// DH-0004: regenerates the 5 per-platform npm package.json files under npm/<pkg>/ from
// npm/platforms.json (the single source of truth) and the main package.json's version.
// esbuild/swc-style optionalDependencies packaging: each platform package ships nothing
// but a compiled `dh` binary + a minimal package.json restricting install to the matching
// os/cpu — no postinstall script, no network fetch.
//
// Usage: bun scripts/generate-npm-platform-packages.ts [--check]
//   --check   Don't write files; exit 1 if regenerating would change anything
//             (drift check, suitable for CI).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface PlatformTarget {
  buildTarget: string;
  artifact: string;
  packageName: string;
  os: string;
  cpu: string;
  binaryName: string;
}

const ROOT = join(import.meta.dir, "..");

function loadPlatforms(): PlatformTarget[] {
  const raw = readFileSync(join(ROOT, "npm/platforms.json"), "utf8");
  return JSON.parse(raw).targets;
}

function loadMainVersion(): string {
  const raw = readFileSync(join(ROOT, "package.json"), "utf8");
  return JSON.parse(raw).version;
}

// Matches biome's formatting of this repo's *.json files (short arrays collapsed to one
// line) so the generator's output is byte-identical to what `bun run lint:fix` would
// produce — avoids a lint/generator formatting fight.
export function renderPlatformPackageJson(target: PlatformTarget, version: string): string {
  const description = `Dark Harness (dh) precompiled binary for ${target.os}/${target.cpu}. Installed automatically as an optionalDependency of the main "dark-harness" package — not intended for direct use.`;
  return `{\n  "name": "${target.packageName}",\n  "version": "${version}",\n  "description": ${JSON.stringify(description)},\n  "license": "MIT",\n  "os": ["${target.os}"],\n  "cpu": ["${target.cpu}"],\n  "files": ["${target.binaryName}"]\n}\n`;
}

function main(): number {
  const check = process.argv.includes("--check");
  const platforms = loadPlatforms();
  const version = loadMainVersion();
  let drift = false;

  for (const target of platforms) {
    const dir = join(ROOT, "npm", target.packageName);
    const file = join(dir, "package.json");
    const rendered = renderPlatformPackageJson(target, version);

    if (check) {
      const existing = existsSync(file) ? readFileSync(file, "utf8") : null;
      if (existing !== rendered) {
        console.error(`npm/${target.packageName}/package.json is out of date (or missing).`);
        drift = true;
      }
      continue;
    }

    mkdirSync(dir, { recursive: true });
    writeFileSync(file, rendered);
    console.log(`wrote npm/${target.packageName}/package.json`);
  }

  if (check && drift) {
    console.error(
      "scripts/generate-npm-platform-packages.ts --check: drift detected. Run `bun scripts/generate-npm-platform-packages.ts` and commit the result.",
    );
    return 1;
  }

  return 0;
}

if (import.meta.main) {
  process.exit(main());
}
