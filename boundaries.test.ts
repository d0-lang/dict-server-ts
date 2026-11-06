import { assert, describe, it } from "@effect/vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

/**
 * Which workspace may import which: the file format in `@dict/core` is
 * shared, the importer and the server only meet through it. The server's
 * tests may use the importer to build dictionaries. A relative import into
 * another workspace would compile, so this test is what keeps the lines.
 */
const ROOT = import.meta.dirname;
const PACKAGES = {
  "@dict/core": "packages/core/",
  "@dict/importer": "apps/importer/",
  "@dict/server": "apps/server/",
} as const;
type Package = keyof typeof PACKAGES;

const ALLOWED: Readonly<Record<Package, ReadonlyArray<Package>>> = {
  "@dict/core": [],
  "@dict/importer": ["@dict/core"],
  "@dict/server": ["@dict/core"],
};
/** Extra imports allowed from test files. */
const ALLOWED_IN_TESTS: Readonly<Record<Package, ReadonlyArray<Package>>> = {
  "@dict/core": [],
  "@dict/importer": [],
  "@dict/server": ["@dict/importer"],
};

const NAMES = Object.keys(PACKAGES) as Array<Package>;
const packageOf = (file: string): Package | undefined =>
  NAMES.find((name) => file.startsWith(PACKAGES[name]));

const sources = (dir: string): Array<string> =>
  readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "node_modules" || entry.name === "out"
        ? []
        : sources(path);
    }
    return entry.name.endsWith(".ts") ? [path] : [];
  });

const IMPORT = /^(?:import|export)[^"']*from\s+["']([^"']+)["']/gm;

describe("workspace boundaries", () => {
  it("imports other workspaces only by name, and only the allowed ones", () => {
    const wrong: Array<string> = [];
    for (const file of [...sources("packages"), ...sources("apps")]) {
      const from = packageOf(file)!;
      const allowed = [
        ...ALLOWED[from],
        ...(file.endsWith(".test.ts") ? ALLOWED_IN_TESTS[from] : []),
      ];
      const text = readFileSync(join(ROOT, file), "utf8");
      for (const [, spec] of text.matchAll(IMPORT)) {
        if (spec!.startsWith(".")) {
          const target = relative(ROOT, resolve(ROOT, dirname(file), spec!));
          if (packageOf(target) !== from) wrong.push(`${file} -> ${target}`);
        } else {
          const to = NAMES.find(
            (name) => spec === name || spec!.startsWith(`${name}/`),
          );
          if (to !== undefined && !allowed.includes(to))
            wrong.push(`${file} -> ${spec}`);
        }
      }
    }
    assert.deepStrictEqual(wrong, []);
  });
});
