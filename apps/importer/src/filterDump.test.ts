import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { filterDump } from "./filterDump.ts";
import { importWiktextract } from "./Importer.ts";

const FIXTURE = join(import.meta.dirname, "fixtures", "pl-sample.jsonl");

const tempDir = Effect.acquireRelease(
  Effect.promise(() => mkdtemp(join(tmpdir(), "dict-filter-"))),
  (dir) => Effect.promise(() => rm(dir, { recursive: true, force: true })),
);

describe("filterDump", () => {
  it.effect("keeps the language's lines unchanged and imports the same", () =>
    Effect.gen(function* () {
      const dir = yield* tempDir;
      const out = join(dir, "pl.jsonl");
      const stats = yield* filterDump({
        langs: ["pl"],
        input: FIXTURE,
        outDir: dir,
      });
      assert.strictEqual(stats.linesScanned, 18);
      assert.deepStrictEqual(
        stats.languages.map((l) => [l.lang, l.out, l.languageLines]),
        [["pl", out, 17]],
      );

      const original = yield* Effect.promise(() => readFile(FIXTURE, "utf8"));
      const filtered = yield* Effect.promise(() => readFile(out, "utf8"));
      const kept = filtered.trimEnd().split("\n");
      assert.strictEqual(kept.length, 17);
      for (const line of kept) assert.include(original, line);

      const fromFull = yield* importWiktextract({
        lang: "pl",
        input: FIXTURE,
        out: join(dir, "full.sqlite"),
      });
      const fromFiltered = yield* importWiktextract({
        lang: "pl",
        input: out,
        out: join(dir, "filtered.sqlite"),
      });
      assert.strictEqual(fromFiltered.entries, fromFull.entries);
      assert.deepStrictEqual(fromFiltered.forms, fromFull.forms);
    }).pipe(Effect.scoped),
  );

  it.effect("splits several languages in one pass", () =>
    Effect.gen(function* () {
      const dir = yield* tempDir;
      const polish = yield* Effect.promise(() => readFile(FIXTURE, "utf8"));
      // Two Polish lines passed off as German.
      const german = polish
        .trimEnd()
        .split("\n")
        .filter((line) => line.includes('"lang_code": "pl"'))
        .slice(0, 2)
        .map((line) =>
          line
            .replace('"lang_code": "pl"', '"lang_code": "de"')
            .replace('"lang": "Polish"', '"lang": "German"'),
        );
      const input = join(dir, "dump.jsonl");
      yield* Effect.promise(() =>
        writeFile(input, polish + german.join("\n") + "\n"),
      );

      const stats = yield* filterDump({
        langs: ["pl", "de"],
        input,
        outDir: join(dir, "raw"),
      });
      assert.strictEqual(stats.linesScanned, 20);
      assert.deepStrictEqual(
        stats.languages.map((l) => [l.lang, l.languageLines]),
        [
          ["pl", 17],
          ["de", 2],
        ],
      );
      const kept = yield* Effect.promise(() =>
        readFile(join(dir, "raw", "de.jsonl"), "utf8"),
      );
      assert.deepStrictEqual(kept.trimEnd().split("\n"), german);
    }).pipe(Effect.scoped),
  );

  it.effect("refuses to overwrite an existing file unless forced", () =>
    Effect.gen(function* () {
      const dir = yield* tempDir;
      const out = join(dir, "pl.jsonl");
      yield* Effect.promise(() => writeFile(out, "existing"));
      const refused = yield* Effect.flip(
        filterDump({ langs: ["pl"], input: FIXTURE, outDir: dir }),
      );
      assert.include(refused.message, "already exists");

      const stats = yield* filterDump({
        langs: ["pl"],
        input: FIXTURE,
        outDir: dir,
        force: true,
      });
      assert.strictEqual(stats.languages[0]?.languageLines, 17);
    }).pipe(Effect.scoped),
  );
});
