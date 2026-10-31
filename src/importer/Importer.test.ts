import { assert, describe, it } from "@effect/vitest";
import { Database } from "bun:sqlite";
import { Effect } from "effect";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDictionary } from "../dictionary/DictionaryDb.ts";
import { findEntriesByForm } from "../dictionary/queries.ts";
import { SCHEMA_VERSION } from "../dictionary/schema.ts";
import { importWiktextract } from "./Importer.ts";

/**
 * Real (trimmed) lines from the raw English Wiktionary extract, plus one
 * English entry whose translations mention `"lang_code": "pl"`.
 */
const FIXTURE = join(import.meta.dirname, "fixtures", "pl-sample.jsonl");

const tempDir = Effect.acquireRelease(
  Effect.promise(() => mkdtemp(join(tmpdir(), "dict-import-"))),
  (dir) => Effect.promise(() => rm(dir, { recursive: true, force: true })),
);

const lemmas = (db: Parameters<typeof findEntriesByForm>[0], word: string) =>
  findEntriesByForm(db, word).map((e) => `${e.lemma}/${e.pos}`);

describe("importWiktextract", () => {
  it.effect("imports the Polish fixture into a lookup-ready file", () =>
    Effect.gen(function* () {
      const dir = yield* tempDir;
      const out = join(dir, "pl_en.sqlite");
      const stats = yield* importWiktextract({
        lang: "pl",
        input: FIXTURE,
        out,
      });

      assert.strictEqual(stats.linesScanned, 18);
      assert.strictEqual(stats.languageLines, 17); // the English line is dropped
      assert.strictEqual(stats.entries, 10);
      assert.strictEqual(stats.mergedLines, 3); // pies x3, robić x2 -> one entry each
      assert.strictEqual(stats.linesWithoutEntry, 4); // domu, człowieki, matka 2, kolera
      assert.strictEqual(stats.forms.formOf, 1);
      assert.strictEqual(stats.skippedSenses.archaic, 1);

      const db = yield* openDictionary(out);
      // inflection tables
      assert.deepStrictEqual(lemmas(db, "domu"), ["dom/NOUN"]);
      assert.deepStrictEqual(lemmas(db, "PSA"), ["pies/NOUN"]);
      assert.deepStrictEqual(lemmas(db, "robiłem"), ["robić/VERB"]);
      assert.deepStrictEqual(lemmas(db, "lepszy"), ["dobry/ADJ"]);
      // one entry per etymology, in source order
      assert.deepStrictEqual(lemmas(db, "zamkami"), [
        "zamek/NOUN",
        "zamek/NOUN",
      ]);
      // only reachable through the form-of fallback (missing from the table)
      assert.deepStrictEqual(lemmas(db, "człowieki"), ["człowiek/NOUN"]);
      // junk and multi-word forms are not indexed
      assert.deepStrictEqual(lemmas(db, "no-table-tags"), []);
      assert.deepStrictEqual(lemmas(db, "kolera"), []);

      const [dom] = findEntriesByForm(db, "dom");
      assert.deepStrictEqual(dom?.pron, { ipa: ["/ˈdɔm/"] });
      assert.strictEqual(
        dom?.senses[0]?.translations[0],
        "house (building for living)",
      );
      // lapis keeps its sense but drops the archaic one
      assert.deepStrictEqual(
        findEntriesByForm(db, "lapis")[0]?.senses.map((s) => s.translations),
        [["silver nitrate (silver salt of nitric acid, AgNO3)"]],
      );

      const version = db.$client
        .query<{ user_version: number }, []>("PRAGMA user_version")
        .get()?.user_version;
      assert.strictEqual(version, SCHEMA_VERSION);
    }).pipe(Effect.scoped),
  );

  it.effect("streams gzip input and can skip the form-of fallback", () =>
    Effect.gen(function* () {
      const dir = yield* tempDir;
      const gz = join(dir, "pl.jsonl.gz");
      yield* Effect.promise(async () =>
        writeFile(gz, Bun.gzipSync(await Bun.file(FIXTURE).bytes())),
      );
      const out = join(dir, "pl_en.sqlite");
      const stats = yield* importWiktextract({
        lang: "pl",
        input: gz,
        out,
        formOfFallback: false,
        batchSize: 3,
      });
      assert.strictEqual(stats.entries, 10);
      assert.strictEqual(stats.forms.formOf, 0);

      const db = new Database(out, { readonly: true });
      const meta = db.query<{ value: string }, [string]>(
        "SELECT value FROM meta WHERE key = ?",
      );
      assert.strictEqual(meta.get("pair")?.value, "pl_en");
      assert.strictEqual(meta.get("form_of_fallback")?.value, "off");
      const hit = db
        .query("SELECT 1 FROM forms WHERE form = 'człowieki'")
        .get();
      assert.isNull(hit);
      db.close();
    }).pipe(Effect.scoped),
  );

  it.effect("fails on an unknown language or a missing file", () =>
    Effect.gen(function* () {
      const dir = yield* tempDir;
      const unknown = yield* Effect.flip(
        importWiktextract({
          lang: "xx",
          input: FIXTURE,
          out: join(dir, "x.sqlite"),
        }),
      );
      assert.include(unknown.message, 'no import rules for "xx"');
      const missing = yield* Effect.flip(
        importWiktextract({
          lang: "pl",
          input: join(dir, "nope.jsonl"),
          out: join(dir, "y.sqlite"),
        }),
      );
      assert.include(missing.message, "cannot open");
    }).pipe(Effect.scoped),
  );
});
