import { assert, describe, it } from "@effect/vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

/**
 * Which code may import which: the file format in `core` is shared, the
 * importer and the server only meet through it. The server's tests may use
 * the importer to build dictionaries. TypeScript would compile a relative
 * import across these lines, so this test is what keeps them.
 */
const ROOT = resolve(import.meta.dirname, "..");
const PACKAGES = {
  core: "src/core/",
  importer: "src/importer/",
  server: "src/",
} as const;
type Package = keyof typeof PACKAGES;

const ALLOWED: Readonly<Record<Package, ReadonlyArray<Package>>> = {
  core: ["core"],
  importer: ["importer", "core"],
  server: ["server", "core"],
};
/** Extra imports allowed from test files. */
const ALLOWED_IN_TESTS: Readonly<Record<Package, ReadonlyArray<Package>>> = {
  core: [],
  importer: [],
  server: ["importer"],
};

const packageOf = (file: string): Package =>
  (Object.keys(PACKAGES) as Array<Package>).find((name) =>
    file.startsWith(PACKAGES[name]),
  )!;

const sources = (dir: string): Array<string> =>
  readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return entry.name.endsWith(".ts") ? [path] : [];
  });

const IMPORT = /^(?:import|export)[^"']*from\s+["'](\.[^"']+)["']/gm;

describe("package boundaries", () => {
  it("imports only across allowed boundaries", () => {
    const wrong: Array<string> = [];
    for (const file of sources("src")) {
      const from = packageOf(file);
      const test = file.endsWith(".test.ts");
      const allowed = [...ALLOWED[from], ...(test ? ALLOWED_IN_TESTS[from] : [])];
      const text = readFileSync(join(ROOT, file), "utf8");
      for (const [, spec] of text.matchAll(IMPORT)) {
        const target = relative(ROOT, resolve(ROOT, dirname(file), spec!));
        const to = packageOf(target);
        if (to === undefined || !allowed.includes(to)) {
          wrong.push(`${file} -> ${target}`);
        }
      }
    }
    assert.deepStrictEqual(wrong, []);
  });
});
