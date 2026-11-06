import { assert, describe, it } from "@effect/vitest";
import { Database } from "bun:sqlite";
import { Effect } from "effect";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDictionary } from "@dict/core/DictionaryDb";
import { findEntriesByForm } from "../common/entries.ts";
import { SCHEMA_VERSION } from "@dict/core/schema";
import { PL_SAMPLE } from "@dict/importer/fixtures";
import { importWiktextract } from "@dict/importer/Importer";

/** The file format as data; its `metaKeys` are what an import writes to `meta`. */
const FORMAT: { readonly metaKeys: ReadonlyArray<string> } = JSON.parse(
  await readFile(
    join(
      import.meta.dirname,
      "..",
      "..",
      "..",
      "..",
      "..",
      "spec",
      "dictionary",
      "format.json",
    ),
    "utf8",
  ),
);

const FIXTURE = PL_SAMPLE;

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
        grammar: [],
        lang: "pl",
        input: FIXTURE,
        out,
      });

      assert.strictEqual(stats.linesScanned, 18);
      assert.strictEqual(stats.languageLines, 17); // the English line is dropped
      assert.strictEqual(stats.entries, 11);
      assert.strictEqual(stats.mergedLines, 3); // pies x3, robić x2 -> one entry each
      assert.strictEqual(stats.linesWithoutEntry, 3); // domu, człowieki, kolera
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
      // etymology 2 of matka is its own word's entry, not a redirect to mata
      assert.deepStrictEqual(lemmas(db, "matka"), ["matka/NOUN", "matka/NOUN"]);
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
        grammar: [],
        lang: "pl",
        input: gz,
        out,
        formOfFallback: false,
        batchSize: 3,
      });
      assert.strictEqual(stats.entries, 11);
      assert.strictEqual(stats.forms.formOf, 0);

      const db = new Database(out, { readonly: true });
      const meta = db.query<{ value: string }, [string]>(
        "SELECT value FROM meta WHERE key = ?",
      );
      assert.strictEqual(meta.get("pair")?.value, "pl_en");
      assert.strictEqual(meta.get("form_of_fallback")?.value, "off");
      const keys = db
        .query<{ key: string }, []>("SELECT key FROM meta ORDER BY key")
        .all()
        .map((row) => row.key);
      assert.deepStrictEqual(keys, [...FORMAT.metaKeys].sort());
      const hit = db
        .query("SELECT 1 FROM forms WHERE form = 'człowieki'")
        .get();
      assert.isNull(hit);
      db.close();
    }).pipe(Effect.scoped),
  );

  it.effect("refuses to overwrite an existing file unless forced", () =>
    Effect.gen(function* () {
      const dir = yield* tempDir;
      const out = join(dir, "pl_en.sqlite");
      yield* Effect.promise(() => writeFile(out, "existing"));

      const refused = yield* Effect.flip(
        importWiktextract({ lang: "pl", input: FIXTURE, out, grammar: [] }),
      );
      assert.include(refused.message, "already exists");
      const untouched = yield* Effect.promise(() => readFile(out, "utf8"));
      assert.strictEqual(untouched, "existing");

      const stats = yield* importWiktextract({
        grammar: [],
        lang: "pl",
        input: FIXTURE,
        out,
        force: true,
      });
      assert.strictEqual(stats.entries, 11);
    }).pipe(Effect.scoped),
  );

  it.effect(
    "ranks by case and spelling, and finds abbreviations without the period",
    () =>
      Effect.gen(function* () {
        const dir = yield* tempDir;
        const input = join(dir, "de.jsonl");
        const line = (word: string, pos: string, extra = {}) =>
          JSON.stringify({
            word,
            pos,
            lang_code: "de",
            senses: [{ glosses: [word] }],
            ...extra,
          });
        yield* Effect.promise(() =>
          writeFile(
            input,
            [
              line("Oder", "name"),
              line("oder", "conj"),
              line("AM", "noun"),
              line("an", "prep", {
                forms: [{ form: "am", source: "declension" }],
              }),
              line("fragen", "verb", {
                forms: [{ form: "frage", source: "conjugation" }],
              }),
              line("Frage", "noun"),
              line("bzw.", "adv"),
            ].join("\n"),
          ),
        );
        const out = join(dir, "de_en.sqlite");
        const stats = yield* importWiktextract({
          lang: "de",
          input,
          out,
          grammar: [],
        });
        assert.strictEqual(stats.abbreviations, 1);
        const db = yield* openDictionary(out);
        assert.deepStrictEqual(lemmas(db, "oder"), [
          "oder/CCONJ",
          "Oder/PROPN",
        ]);
        assert.deepStrictEqual(lemmas(db, "Oder"), [
          "Oder/PROPN",
          "oder/CCONJ",
        ]);
        assert.deepStrictEqual(lemmas(db, "Am"), ["an/ADP", "AM/NOUN"]);
        assert.deepStrictEqual(lemmas(db, "AM"), ["AM/NOUN", "an/ADP"]);
        assert.deepStrictEqual(lemmas(db, "Frage"), [
          "Frage/NOUN",
          "fragen/VERB",
        ]);
        assert.deepStrictEqual(lemmas(db, "bzw"), ["bzw./ADV"]);
      }).pipe(Effect.scoped),
  );

  it.effect("fails on an unknown language or a missing file", () =>
    Effect.gen(function* () {
      const dir = yield* tempDir;
      const unknown = yield* Effect.flip(
        importWiktextract({
          grammar: [],
          lang: "xx",
          input: FIXTURE,
          out: join(dir, "x.sqlite"),
        }),
      );
      assert.include(unknown.message, 'no import rules for "xx"');
      const missing = yield* Effect.flip(
        importWiktextract({
          grammar: [],
          lang: "pl",
          input: join(dir, "nope.jsonl"),
          out: join(dir, "y.sqlite"),
        }),
      );
      assert.include(missing.message, "cannot open");
    }).pipe(Effect.scoped),
  );
});
