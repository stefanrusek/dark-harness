#!/usr/bin/env node
// DH-0004: main package's `bin` entry. The main "dark-harness" package ships no binary of
// its own — it lists all 5 per-platform packages as optionalDependencies (esbuild/swc-style)
// and npm/bun installs only the one matching the current os/cpu. This wrapper resolves which
// one that was and execs its binary, forwarding argv/stdio/exit code untouched. No
// postinstall script, no network fetch — the binary is already on disk by the time this runs.

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { resolvePlatformPackage } from "../resolve-platform.mjs";

const require = createRequire(import.meta.url);

function main() {
  const { packageName, binaryName } = resolvePlatformPackage(process.platform, process.arch);

  let binaryPath;
  try {
    const pkgJsonPath = require.resolve(`${packageName}/package.json`);
    binaryPath = pkgJsonPath.replace(/package\.json$/, binaryName);
  } catch {
    console.error(
      `dark-harness: optionalDependency "${packageName}" is not installed. This usually means npm/your package manager skipped optionalDependencies for your platform, or install was run with --no-optional. Reinstall without that flag, or build from source (see README.md).`,
    );
    process.exit(2);
  }

  const result = spawnSync(binaryPath, process.argv.slice(2), { stdio: "inherit" });
  if (result.error) {
    console.error(`dark-harness: failed to launch ${binaryPath}: ${result.error.message}`);
    process.exit(2);
  }
  process.exit(result.status ?? 1);
}

main();
