import { assert, describe, it } from "@effect/vitest";
import { Database } from "bun:sqlite";
import { Effect } from "effect";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { diffDictionaries } from "./dictDiff.ts";
import { importWiktextract } from "./Importer.ts";

const FIXTURE = join(import.meta.dirname, "fixtures", "pl-sample.jsonl");

const tempDir = Effect.acquireRelease(
  Effect.promise(() => mkdtemp(join(tmpdir(), "dict-diff-"))),
  (dir) => Effect.promise(() => rm(dir, { recursive: true, force: true })),
);

describe("diffDictionaries", () => {
  it.effect("finds nothing between two builds of the same input", () =>
    Effect.gen(function* () {
      const dir = yield* tempDir;
      const a = join(dir, "a.sqlite");
      const b = join(dir, "b.sqlite");
      yield* importWiktextract({ lang: "pl", input: FIXTURE, out: a });
      yield* importWiktextract({ lang: "pl", input: FIXTURE, out: b });
      const diff = diffDictionaries(a, b);
      assert.deepStrictEqual(diff.entries, {
        added: 0,
        removed: 0,
        changed: 0,
      });
      assert.deepStrictEqual(diff.forms, { added: 0, removed: 0 });
    }).pipe(Effect.scoped),
  );

  it.effect("counts entries and forms added, removed and changed", () =>
    Effect.gen(function* () {
      const dir = yield* tempDir;
      const small = join(dir, "small.sqlite");
      const full = join(dir, "full.sqlite");
      const edited = join(dir, "edited.sqlite");
      yield* importWiktextract({
        lang: "pl",
        input: FIXTURE,
        out: small,
        limit: 5,
      });
      yield* importWiktextract({ lang: "pl", input: FIXTURE, out: full });

      const grown = diffDictionaries(small, full);
      assert.isAbove(grown.entries.added, 0);
      assert.strictEqual(grown.entries.removed, 0);
      assert.isAbove(grown.forms.added, 0);
      assert.isAtMost(grown.examples.addedEntries.length, 10);
      const shrunk = diffDictionaries(full, small);
      assert.strictEqual(shrunk.entries.removed, grown.entries.added);
      assert.strictEqual(shrunk.forms.removed, grown.forms.added);

      // One gloss reworded: the same entry, changed.
      yield* Effect.promise(() => copyFile(full, edited));
      const db = new Database(edited);
      const { entry_id } = db
        .query<{ entry_id: number }, []>(
          "SELECT entry_id FROM senses ORDER BY entry_id, idx LIMIT 1",
        )
        .get()!;
      const { lemma } = db
        .query<{ lemma: string }, [number]>(
          "SELECT lemma FROM entries WHERE id = ?",
        )
        .get(entry_id)!;
      db.run(
        `UPDATE senses SET glosses = '["reworded"]' WHERE entry_id = ${entry_id} AND idx = 0`,
      );
      db.close();
      const reworded = diffDictionaries(full, edited);
      assert.deepStrictEqual(reworded.entries, {
        added: 0,
        removed: 0,
        changed: 1,
      });
      assert.match(
        reworded.examples.changedEntries[0]!,
        new RegExp(`^${lemma} \\(`),
      );
    }).pipe(Effect.scoped),
  );
});
