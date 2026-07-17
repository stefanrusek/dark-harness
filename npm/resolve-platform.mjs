// DH-0004: pure platform->package resolution used by npm/bin/dh.js. Kept dependency-free
// (no `require`/`import` of platforms.json at runtime — the published main package doesn't
// ship npm/platforms.json, only npm/bin/dh.js and npm/resolve-platform.mjs, per "files" in
// package.json) so it works identically whether run from the repo or from an installed
// node_modules/dark-harness tree.

const TARGETS = {
  "linux-x64": { packageName: "dark-harness-linux-x64", binaryName: "dh" },
  "linux-arm64": { packageName: "dark-harness-linux-arm64", binaryName: "dh" },
  "darwin-x64": { packageName: "dark-harness-darwin-x64", binaryName: "dh" },
  "darwin-arm64": { packageName: "dark-harness-darwin-arm64", binaryName: "dh" },
  "win32-x64": { packageName: "dark-harness-windows-x64", binaryName: "dh.exe" },
};

export function resolvePlatformPackage(platform, arch) {
  const key = `${platform}-${arch}`;
  const target = TARGETS[key];
  if (!target) {
    const supported = Object.keys(TARGETS).join(", ");
    throw new Error(
      `dark-harness: unsupported platform "${platform}-${arch}". Supported: ${supported}. Build from source instead: see README.md.`,
    );
  }
  return target;
}
