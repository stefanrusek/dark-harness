// DH-0004: verifies the npm optionalDependencies packaging shape (package.json fields,
// platform resolution logic, generated-file drift) without touching a real registry.
// Not part of `bun test src` (npm/ isn't under src/, matching scripts/ being outside that
// gate too) — run directly with `bun test npm`. CLAUDE.md §9: package.json shape and
// resolver logic are exactly the kind of criterion this tier is meant to cover.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { renderPlatformPackageJson } from "../scripts/generate-npm-platform-packages.ts";
import { resolvePlatformPackage } from "./resolve-platform.mjs";

const ROOT = join(import.meta.dir, "..");
const platforms = readJson(join(ROOT, "npm/platforms.json")).targets;

function readJson(path: string) {
  return JSON.parse(readFileSync(path, "utf8"));
}

describe("npm optionalDependencies packaging", () => {
  const mainPkg = readJson(join(ROOT, "package.json"));

  test("main package.json bin points at the wrapper script", () => {
    expect(mainPkg.bin.dh).toBe("./npm/bin/dh.js");
    expect(existsSync(join(ROOT, "npm/bin/dh.js"))).toBe(true);
  });

  test("main package.json lists exactly the 5 platform packages as optionalDependencies, pinned to its own version", () => {
    const optionalDeps = mainPkg.optionalDependencies;
    expect(Object.keys(optionalDeps).sort()).toEqual(
      platforms.map((t: { packageName: string }) => t.packageName).sort(),
    );
    for (const target of platforms) {
      expect(optionalDeps[target.packageName]).toBe(mainPkg.version);
    }
  });

  test.each(platforms)(
    "npm/$packageName/package.json matches the generator template and declares correct os/cpu",
    (target: { packageName: string; os: string; cpu: string; binaryName: string }) => {
      const pkgPath = join(ROOT, "npm", target.packageName, "package.json");
      expect(existsSync(pkgPath)).toBe(true);
      const pkg = readJson(pkgPath);

      expect(pkg.name).toBe(target.packageName);
      expect(pkg.version).toBe(mainPkg.version);
      expect(pkg.os).toEqual([target.os]);
      expect(pkg.cpu).toEqual([target.cpu]);
      expect(pkg.files).toEqual([target.binaryName]);

      expect(readFileSync(pkgPath, "utf8")).toBe(
        renderPlatformPackageJson(target, mainPkg.version),
      );
    },
  );

  test("resolvePlatformPackage maps every released platform/arch to its package", () => {
    expect(resolvePlatformPackage("linux", "x64")).toEqual({
      packageName: "dark-harness-linux-x64",
      binaryName: "dh",
    });
    expect(resolvePlatformPackage("linux", "arm64")).toEqual({
      packageName: "dark-harness-linux-arm64",
      binaryName: "dh",
    });
    expect(resolvePlatformPackage("darwin", "x64")).toEqual({
      packageName: "dark-harness-darwin-x64",
      binaryName: "dh",
    });
    expect(resolvePlatformPackage("darwin", "arm64")).toEqual({
      packageName: "dark-harness-darwin-arm64",
      binaryName: "dh",
    });
    expect(resolvePlatformPackage("win32", "x64")).toEqual({
      packageName: "dark-harness-windows-x64",
      binaryName: "dh.exe",
    });
  });

  test("resolvePlatformPackage throws for an unsupported platform/arch", () => {
    expect(() => resolvePlatformPackage("freebsd", "x64")).toThrow(/unsupported platform/);
  });
});

describe(".github/workflows/release.yml", () => {
  test("is syntactically valid YAML and wires the publish-npm job to all 5 platform packages", async () => {
    const { parse } = await import("yaml");
    const raw = readFileSync(join(ROOT, ".github/workflows/release.yml"), "utf8");
    const doc = parse(raw);

    expect(doc.jobs["publish-npm"]).toBeDefined();
    for (const target of platforms) {
      expect(raw).toContain(target.packageName);
      expect(raw).toContain(target.artifact);
    }
  });
});
