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
      const stats = yield* filterDump({ lang: "pl", input: FIXTURE, out });
      assert.strictEqual(stats.linesScanned, 18);
      assert.strictEqual(stats.languageLines, 17);

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

  it.effect("refuses to overwrite an existing file unless forced", () =>
    Effect.gen(function* () {
      const dir = yield* tempDir;
      const out = join(dir, "pl.jsonl");
      yield* Effect.promise(() => writeFile(out, "existing"));
      const refused = yield* Effect.flip(
        filterDump({ lang: "pl", input: FIXTURE, out }),
      );
      assert.include(refused.message, "already exists");

      const stats = yield* filterDump({
        lang: "pl",
        input: FIXTURE,
        out,
        force: true,
      });
      assert.strictEqual(stats.languageLines, 17);
    }).pipe(Effect.scoped),
  );
});
