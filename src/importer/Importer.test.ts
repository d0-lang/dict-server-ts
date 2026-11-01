import { assert, describe, it } from "@effect/vitest";
import { Database } from "bun:sqlite";
import { Effect } from "effect";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

  it.effect("gives derived words self-contained entries", () =>
    Effect.gen(function* () {
      const dir = yield* tempDir;
      const input = join(dir, "pl.jsonl");
      const line = (
        word: string,
        pos: string,
        senses: ReadonlyArray<object>,
        extra: object = {},
      ) => JSON.stringify({ word, pos, lang_code: "pl", senses, ...extra });
      const link = (gloss: string, target: string) => ({
        glosses: [gloss],
        tags: ["form-of"],
        form_of: [{ word: target }],
      });
      // Derived words come first: a base may appear later in the dump.
      yield* Effect.promise(() =>
        writeFile(
          input,
          [
            line("koteczek", "noun", [link("diminutive of kotek", "kotek")], {
              forms: [{ form: "koteczka", source: "declension" }],
            }),
            line("kotek", "noun", [link("diminutive of kot", "kot")]),
            line("kot", "noun", [
              { glosses: ["cat"] },
              { glosses: ["synonym of kocur"] },
            ]),
            line("psa", "noun", [link("genitive singular of pies", "pies")]),
            line("pies", "noun", [{ glosses: ["dog"] }]),
            line("bieganie", "noun", [link("verbal noun of biegać", "biegać")]),
            line("biegać", "verb", [{ glosses: ["to run"] }], {
              forms: [
                {
                  form: "bieganie",
                  tags: ["noun-from-verb"],
                  source: "conjugation",
                },
                {
                  form: "bieżenie",
                  tags: ["noun-from-verb"],
                  source: "conjugation",
                },
              ],
            }),
            line("USA", "name", [
              link(
                "initialism of the United States: a country",
                "the United States",
              ),
            ]),
            line("kotosio", "noun", [link("diminutive of kotoś", "kotoś")]),
            line("tańsi", "adj", [link("plural of tańszy", "tańszy")]),
            line(
              "tańszy",
              "adj",
              [link("comparative degree of tani", "tani")],
              {
                forms: [{ form: "tańsza", source: "declension" }],
              },
            ),
            line("tani", "adj", [{ glosses: ["cheap"] }]),
            line("książę", "noun", [
              { glosses: ["prince"], tags: ["Middle", "Polish"] },
            ]),
            line("księcia", "noun", [link("genitive of książę", "książę")]),
            line("bal", "noun", [{ glosses: ["dance"] }], {
              etymology_number: 1,
            }),
            line("bal", "noun", [{ glosses: ["log"] }], {
              etymology_number: 2,
            }),
            line("balik", "noun", [link("diminutive of bal", "bal")]),
          ].join("\n"),
        ),
      );
      const out = join(dir, "pl_en.sqlite");
      const stats = yield* importWiktextract({ lang: "pl", input, out });
      const db = yield* openDictionary(out);
      const senses = (word: string) =>
        findEntriesByForm(db, word).map((e) => [
          e.lemma,
          ...e.senses.map((s) => s.translations[0]),
        ]);

      // chain across lines, skipping the pointer sense, with its own table
      assert.deepStrictEqual(senses("koteczek"), [
        ["koteczek", "diminutive of kotek: cat"],
      ]);
      assert.deepStrictEqual(senses("koteczka"), senses("koteczek"));
      // true inflections still redirect
      assert.deepStrictEqual(senses("psa"), [["pies", "dog"]]);
      // the base's part of speech differs: fall back to it
      assert.deepStrictEqual(senses("bieganie"), [
        ["bieganie", "verbal noun of biegać: to run"],
      ]);
      // a verbal noun with no line of its own still reaches the verb
      assert.deepStrictEqual(senses("bieżenie"), [["biegać", "to run"]]);
      // kept when the base has no entry
      assert.deepStrictEqual(senses("usa"), [
        ["USA", "initialism of the United States: a country"],
      ]);
      assert.deepStrictEqual(senses("kotosio"), [
        ["kotosio", "diminutive of kotoś"],
      ]);
      // word with no entry: its form, and its table, reach the final word
      assert.deepStrictEqual(senses("tańsi"), [["tani", "cheap"]]);
      assert.deepStrictEqual(senses("tańsza"), [["tani", "cheap"]]);
      // historical-only word survives, with its forms
      assert.deepStrictEqual(senses("księcia"), [["książę", "prince"]]);
      // several etymologies: all of them are copied
      assert.deepStrictEqual(senses("balik"), [
        ["balik", "diminutive of bal: dance", "diminutive of bal: log"],
      ]);
      assert.strictEqual(stats.historicalEntries, 1);
      assert.strictEqual(stats.derivedBare, 1);
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
      assert.strictEqual(stats.entries, 11);
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

  it.effect("refuses to overwrite an existing file unless forced", () =>
    Effect.gen(function* () {
      const dir = yield* tempDir;
      const out = join(dir, "pl_en.sqlite");
      yield* Effect.promise(() => writeFile(out, "existing"));

      const refused = yield* Effect.flip(
        importWiktextract({ lang: "pl", input: FIXTURE, out }),
      );
      assert.include(refused.message, "already exists");
      const untouched = yield* Effect.promise(() => readFile(out, "utf8"));
      assert.strictEqual(untouched, "existing");

      const stats = yield* importWiktextract({
        lang: "pl",
        input: FIXTURE,
        out,
        force: true,
      });
      assert.strictEqual(stats.entries, 11);
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
