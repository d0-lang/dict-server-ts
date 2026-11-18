import { assert, describe, it } from "@effect/vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

/**
 * The two lookup paths (`lookup.ts`): the analyzer's features, for a script
 * without spaces, and the features of a language written with spaces. Each
 * may use `common/`, never the other's features, so a change for one kind of
 * language can't reach the other. Only `lookup.ts` picks a path, and
 * `Dictionaries.ts` loads the analyzer at startup.
 */
const LOOKUP = import.meta.dirname;
const ANALYZER = ["features/analyzedWords/", "common/analyzer.ts"];
const PICKERS = ["lookup.ts", "Dictionaries.ts"];

const isAnalyzer = (file: string) =>
  ANALYZER.some((part) => file.startsWith(part));
const isSpacedFeature = (file: string) =>
  file.startsWith("features/") && !isAnalyzer(file);

const sources = (dir: string): Array<string> =>
  readdirSync(join(LOOKUP, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")
      ? [path]
      : [];
  });

const IMPORT = /^(?:import|export)[^"']*from\s+["']([^"']+)["']/gm;

describe("lookup paths", () => {
  it("keeps the analyzer's features and the spaced-language features apart", () => {
    const wrong: Array<string> = [];
    for (const file of sources(".")) {
      const text = readFileSync(join(LOOKUP, file), "utf8");
      for (const [, spec] of text.matchAll(IMPORT)) {
        if (!spec!.startsWith(".")) continue;
        const target = relative(LOOKUP, resolve(LOOKUP, dirname(file), spec!));
        const crosses = isAnalyzer(file)
          ? isSpacedFeature(target)
          : isAnalyzer(target) && !PICKERS.includes(file);
        if (crosses) wrong.push(`${file} -> ${target}`);
      }
    }
    assert.deepStrictEqual(wrong, []);
  });
});
