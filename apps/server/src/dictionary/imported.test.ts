import { assert, describe, it } from "@effect/vitest";
import { Database } from "bun:sqlite";
import { Effect } from "effect";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDictionary } from "@dict/core/DictionaryDb";
import { findEntriesByForm } from "./queries.ts";
import { SCHEMA_VERSION } from "@dict/core/schema";
import { PL_SAMPLE } from "@dict/importer/fixtures";
import { importWiktextract } from "@dict/importer/Importer";

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
      const stats = yield* importWiktextract({
        lang: "pl",
        input,
        out,
        grammar: [],
      });
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
      // a comparative is a word of its own, with its base's meaning; its forms,
      // and its table, reach it
      assert.deepStrictEqual(senses("tańszy"), [["tańszy", "comparative degree of tani: cheap"]]);
      assert.deepStrictEqual(senses("tańsi"), senses("tańszy"));
      assert.deepStrictEqual(senses("tańsza"), senses("tańszy"));
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

  it.effect(
    "links synonyms to existing words and keeps groups when copying",
    () =>
      Effect.gen(function* () {
        const dir = yield* tempDir;
        const input = join(dir, "pl.jsonl");
        const line = (
          word: string,
          senses: ReadonlyArray<object>,
          extra = {},
        ) =>
          JSON.stringify({
            word,
            pos: "noun",
            lang_code: "pl",
            senses,
            ...extra,
          });
        const synonym = (target: string) => ({
          glosses: [`synonym of ${target}`],
          links: [[target, `${target}#Polish`]],
        });
        yield* Effect.promise(() =>
          writeFile(
            input,
            [
              line("królik", [
                {
                  glosses: ["diminutive of król"],
                  tags: ["form-of"],
                  form_of: [{ word: "król" }],
                },
              ]),
              line("król", [
                {
                  glosses: ["king", "synonym of państwo"],
                  links: [["państwo", "państwo#Polish"]],
                },
                { glosses: ["king", "royal couple"] },
              ]),
              line("państwo", [{ glosses: ["state"] }]),
              line("grządka", [synonym("zagon"), synonym("brak")]),
              line("zagon", [{ glosses: ["field"] }]),
              line("razu", [synonym("raz")]),
              line("raz", [{ glosses: ["once"] }], {
                forms: [{ form: "razu", source: "declension" }],
              }),
              line("sam", [synonym("tam")]),
              line("tam", [synonym("sam")], {
                forms: [{ form: "sam", source: "declension" }],
              }),
            ].join("\n"),
          ),
        );
        const out = join(dir, "pl_en.sqlite");
        const stats = yield* importWiktextract({
          lang: "pl",
          input,
          out,
          grammar: [],
        });
        const db = yield* openDictionary(out);
        const senses = (word: string) =>
          findEntriesByForm(db, word).map((e) => [e.lemma, e.senses]);

        assert.deepStrictEqual(senses("król"), [
          [
            "król",
            [
              {
                translations: ["king", "synonym of państwo", "royal couple"],
                see: ["państwo"],
              },
            ],
          ],
        ]);
        // the pointer is left out of the copy, and the group stays one sense
        assert.deepStrictEqual(senses("królik"), [
          [
            "królik",
            [{ translations: ["diminutive of król: king; royal couple"] }],
          ],
        ]);
        // a target with no entry gets no link
        assert.deepStrictEqual(senses("grządka"), [
          [
            "grządka",
            [
              { translations: ["synonym of zagon"], see: ["zagon"] },
              { translations: ["synonym of brak"] },
            ],
          ],
        ]);
        // the target is already in the result
        assert.deepStrictEqual(senses("razu"), [
          ["raz", [{ translations: ["once"] }]],
        ]);
        // words that only point at each other still return something
        assert.strictEqual(senses("sam").length, 2);
        assert.strictEqual(stats.seeLinks, 5);
      }).pipe(Effect.scoped),
  );

  it.effect("resolves pointer links only to new words of the same pos", () =>
    Effect.gen(function* () {
      const dir = yield* tempDir;
      const input = join(dir, "pl.jsonl");
      const line = (
        word: string,
        pos: string,
        senses: ReadonlyArray<object>,
        extra = {},
      ) => JSON.stringify({ word, pos, lang_code: "pl", senses, ...extra });
      const pointer = (gloss: string, target: string) => ({
        glosses: [gloss],
        links: [[target, `${target}#Polish`]],
      });
      yield* Effect.promise(() =>
        writeFile(
          input,
          [
            line("tych", "pron", [
              pointer("genitive/locative plural of ta", "ta"),
              pointer("genitive/locative plural of to", "to"),
            ]),
            line("ta", "intj", [{ glosses: ["yes"] }]),
            line("to", "pron", [{ glosses: ["this"] }]),
            line("prostu", "noun", [pointer("old dative of prosty", "prosty")]),
            line("prosty", "adj", [{ glosses: ["straight"] }], {
              forms: [{ form: "prostu", source: "declension" }],
            }),
            line("prosty", "noun", [{ glosses: ["jab"] }]),
            line("sensie", "noun", [pointer("locative of sens", "sens")]),
            line("sens", "noun", [{ glosses: ["sense"] }]),
          ].join("\n"),
        ),
      );
      const out = join(dir, "pl_en.sqlite");
      yield* importWiktextract({ lang: "pl", input, out, grammar: [] });
      const db = yield* openDictionary(out);

      assert.deepStrictEqual(lemmas(db, "tych"), ["to/PRON"]);
      assert.deepStrictEqual(lemmas(db, "prostu"), ["prosty/ADJ"]);
      assert.deepStrictEqual(lemmas(db, "sensie"), ["sens/NOUN"]);
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
    "resolves marked spellings only for words that reach nothing else",
    () =>
      Effect.gen(function* () {
        const dir = yield* tempDir;
        const input = join(dir, "de.jsonl");
        const line = (
          word: string,
          pos: string,
          senses: ReadonlyArray<object>,
          extra: object = {},
        ) => JSON.stringify({ word, pos, lang_code: "de", senses, ...extra });
        const alt = (target: string, ...tags: Array<string>) => ({
          glosses: [`alternative form of ${target}`],
          tags: ["alt-of", "alternative", ...tags],
          alt_of: [{ word: target }],
        });
        yield* Effect.promise(() =>
          writeFile(
            input,
            [
              line("für", "prep", [{ glosses: ["for"] }]),
              line("für", "prep", [alt("vor", "obsolete")], {
                etymology_number: 2,
              }),
              line("vor", "prep", [{ glosses: ["before"] }]),
              line("nich", "adv", [alt("nicht", "colloquial")]),
              line("nicht", "adv", [{ glosses: ["not"] }]),
              line("Mann", "noun", [{ glosses: ["man"] }], {
                forms: [
                  { form: "man", tags: ["alternative", "obsolete"] },
                  { form: "Mahn", tags: ["alternative", "obsolete"] },
                ],
              }),
              line("man", "pron", [{ glosses: ["one"] }]),
              line("sich", "pron", [
                {
                  glosses: ["Reflexive pronoun of the third person: oneself"],
                  tags: ["form-of", "reflexive"],
                  form_of: [{ word: "the third person" }],
                  links: [["third person", "third person"]],
                },
              ]),
            ].join("\n"),
          ),
        );
        const out = join(dir, "de_en.sqlite");
        yield* importWiktextract({ lang: "de", input, out, grammar: [] });
        const db = yield* openDictionary(out);

        // a word of its own keeps only its own entries
        assert.deepStrictEqual(lemmas(db, "für"), ["für/ADP"]);
        assert.deepStrictEqual(lemmas(db, "man"), ["man/PRON"]);
        // a spelling that is nothing else still finds its standard word
        assert.deepStrictEqual(lemmas(db, "nich"), ["nicht/ADV"]);
        assert.deepStrictEqual(lemmas(db, "mahn"), ["Mann/NOUN"]);
        // an English "target" leaves the gloss in place
        assert.deepStrictEqual(
          findEntriesByForm(db, "sich").map((e) => e.senses[0]?.translations),
          [["Reflexive pronoun of the third person: oneself"]],
        );
      }).pipe(Effect.scoped),
  );

  it.effect("lets the grammar file replace Wiktionary's grammar words", () =>
    Effect.gen(function* () {
      const dir = yield* tempDir;
      const input = join(dir, "de.jsonl");
      const line = (word: string, pos: string, gloss: string, extra = {}) =>
        JSON.stringify({
          word,
          pos,
          lang_code: "de",
          senses: [{ glosses: [gloss] }],
          ...extra,
        });
      yield* Effect.promise(() =>
        writeFile(
          input,
          [
            line("der", "article", "the", {
              forms: [{ form: "des", source: "declension" }],
            }),
            line("sein", "verb", "to be"),
            line("sein", "det", "his", {
              forms: [{ form: "ihr", source: "declension" }],
            }),
            line("ihr", "pron", "you (plural)"),
          ].join("\n"),
        ),
      );
      const out = join(dir, "de_en.sqlite");
      const stats = yield* importWiktextract({
        lang: "de",
        input,
        out,
        grammar: [
          { lemma: "des", pos: "DET", senses: ["of the"] },
          { lemma: "ihr", pos: "PRON", senses: ["you (plural)", "to her"] },
          { lemma: "ihr", pos: "DET", senses: ["her, their"] },
          { lemma: "sein", pos: "DET", senses: ["his, its"] },
        ],
      });
      assert.strictEqual(stats.grammarEntries, 4);
      const db = yield* openDictionary(out);
      const senses = (word: string) =>
        findEntriesByForm(db, word).map((e) => [
          `${e.lemma}/${e.pos}`,
          ...e.senses.map((s) => s.translations[0]),
        ]);
      // the file's entry instead of a redirect to `der`
      assert.deepStrictEqual(senses("des"), [["des/DET", "of the"]]);
      // no `sein` (det) through its table, no second `ihr` pronoun
      assert.deepStrictEqual(senses("ihr"), [
        ["ihr/PRON", "you (plural)", "to her"],
        ["ihr/DET", "her, their"],
      ]);
      // content words stay
      assert.deepStrictEqual(senses("sein"), [
        ["sein/DET", "his, its"],
        ["sein/VERB", "to be"],
      ]);
    }).pipe(Effect.scoped),
  );

  it.effect("puts a word's own senses before its comparative ones", () =>
    Effect.gen(function* () {
      const dir = yield* tempDir;
      const input = join(dir, "pl.jsonl");
      const line = (word: string, pos: string, senses: ReadonlyArray<object>, extra = {}) =>
        JSON.stringify({ word, pos, lang_code: "pl", senses, ...extra });
      const comparative = (base: string) => ({
        glosses: [`comparative degree of ${base}`],
        tags: ["comparative", "form-of"],
        form_of: [{ word: base }],
      });
      yield* Effect.promise(() =>
        writeFile(
          input,
          [
            line("późno", "adv", [{ glosses: ["late"] }, { glosses: ["at a late hour"] }]),
            // one line, own sense after the comparative one
            line("później", "adv", [comparative("późno"), { glosses: ["later, afterwards"] }]),
            line("dobrze", "adv", [{ glosses: ["well"] }]),
            // two lines: the comparative alone, then the word's own sense
            line("lepiej", "adv", [comparative("dobrze")]),
            line("lepiej", "adv", [{ glosses: ["rather"] }], { etymology_number: 2 }),
            // a comparative that says what it means, before the word's own sense
            line("dalej", "adv", [{ glosses: ["comparative degree of daleko: further"], tags: ["comparative", "form-of"], form_of: [{ word: "daleko" }] }, { glosses: ["and so on"] }]),
          ].join("\n"),
        ),
      );
      const out = join(dir, "pl_en.sqlite");
      const stats = yield* importWiktextract({ lang: "pl", input, out, grammar: [] });
      const db = yield* openDictionary(out);
      const senses = (word: string) =>
        findEntriesByForm(db, word).map((e) => [e.lemma, ...e.senses.map((s) => s.translations[0])]);
      // every meaning of the base, after the word's own
      assert.deepStrictEqual(senses("później"), [
        ["później", "later, afterwards", "comparative degree of późno: late", "comparative degree of późno: at a late hour"],
      ]);
      assert.deepStrictEqual(senses("lepiej"), [["lepiej", "rather", "comparative degree of dobrze: well"]]);
      assert.deepStrictEqual(senses("dalej"), [["dalej", "and so on", "comparative degree of daleko: further"]]);
      assert.strictEqual(stats.degreeMerged, 1);
    }).pipe(Effect.scoped),
  );

  it.effect("leaves a comparative spelled like a plain form of its base to the base", () =>
    Effect.gen(function* () {
      const dir = yield* tempDir;
      const input = join(dir, "de.jsonl");
      const comparative = (word: string, base: string, extra = {}) =>
        JSON.stringify({
          word,
          pos: "adj",
          lang_code: "de",
          senses: [{ glosses: [`comparative degree of ${base}`], tags: ["comparative", "form-of"], form_of: [{ word: base }] }],
          ...extra,
        });
      yield* Effect.promise(() =>
        writeFile(
          input,
          [
            JSON.stringify({
              word: "neu",
              pos: "adj",
              lang_code: "de",
              senses: [{ glosses: ["new"] }],
              forms: [
                { form: "neuer", tags: ["comparative"] },
                { form: "neuer", tags: ["strong", "nominative", "masculine", "singular"], source: "declension" },
                { form: "neue", tags: ["strong", "nominative", "feminine", "singular"], source: "declension" },
              ],
            }),
            comparative("neuer", "neu", { forms: [{ form: "neueren", source: "declension" }] }),
            JSON.stringify({ word: "gut", pos: "adj", lang_code: "de", senses: [{ glosses: ["good"] }] }),
            comparative("besser", "gut"),
          ].join("\n"),
        ),
      );
      const out = join(dir, "de_en.sqlite");
      const stats = yield* importWiktextract({ lang: "de", input, out, grammar: [] });
      const db = yield* openDictionary(out);
      const senses = (word: string) =>
        findEntriesByForm(db, word).map((e) => [e.lemma, ...e.senses.map((s) => s.translations[0])]);
      // `ein neuer Film`: the plain form of `neu`, as before; its table goes along
      assert.deepStrictEqual(senses("neuer"), [["neu", "new"]]);
      assert.deepStrictEqual(senses("neueren"), [["neu", "new"]]);
      // `besser` is no form of `gut`, so it keeps an entry of its own
      assert.deepStrictEqual(senses("besser"), [["besser", "comparative degree of gut: good"]]);
      assert.strictEqual(stats.degreeDropped, 1);
    }).pipe(Effect.scoped),
  );

  it.effect("lets a grammar line replace a content word of the same part of speech", () =>
    Effect.gen(function* () {
      const dir = yield* tempDir;
      const input = join(dir, "ru.jsonl");
      const line = (word: string, pos: string, gloss: string) =>
        JSON.stringify({ word, pos, lang_code: "ru", senses: [{ glosses: [gloss] }] });
      yield* Effect.promise(() =>
        writeFile(
          input,
          [
            line("здесь", "adv", "here"),
            line("всё", "adv", "still"),
            line("-го", "suffix", "on (a date)"),
          ].join("\n"),
        ),
      );
      const out = join(dir, "ru_en.sqlite");
      yield* importWiktextract({
        lang: "ru",
        input,
        out,
        grammar: [
          { lemma: "здесь", pos: "ADV", senses: ["here", "in this case"] },
          { lemma: "всё", pos: "PRON", senses: ["everything"] },
          { lemma: "-го", pos: "X", senses: ["-th (after a number)"] },
        ],
      });
      const db = yield* openDictionary(out);
      const senses = (word: string) =>
        findEntriesByForm(db, word)
          .map((e) => [`${e.lemma}/${e.pos}`, ...e.senses.map((s) => s.translations[0])])
          .sort();
      // the line replaces Wiktionary's adverb instead of repeating "here"
      assert.deepStrictEqual(senses("здесь"), [["здесь/ADV", "here", "in this case"]]);
      // a part of speech the file doesn't give the word stays
      assert.deepStrictEqual(senses("всё"), [
        ["всё/ADV", "still"],
        ["всё/PRON", "everything"],
      ]);
      // an `X` line only adds
      assert.deepStrictEqual(senses("-го"), [
        ["-го/X", "-th (after a number)"],
        ["-го/X", "on (a date)"],
      ]);
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

  it.effect(
    "indexes Russian forms without stress, with е for ё, abbreviations without spaces, and without misparsed tables",
    () =>
      Effect.gen(function* () {
        const dir = yield* tempDir;
        const input = join(dir, "ru.jsonl");
        const out = join(dir, "ru_en.sqlite");
        const line = (entry: object) =>
          JSON.stringify({ lang: "Russian", lang_code: "ru", ...entry });
        yield* Effect.promise(() =>
          writeFile(
            input,
            [
              line({
                word: "собака",
                pos: "noun",
                senses: [{ glosses: ["dog"] }],
                forms: [
                  {
                    form: "соба́ки",
                    tags: ["genitive", "singular"],
                    source: "declension",
                  },
                ],
              }),
              line({
                word: "ёлка",
                pos: "noun",
                senses: [{ glosses: ["fir tree"] }],
                forms: [
                  {
                    form: "ёлки",
                    tags: ["genitive", "singular"],
                    source: "declension",
                  },
                ],
              }),
              line({
                word: "ж. д.",
                pos: "noun",
                senses: [{ glosses: ["railway"] }],
              }),
              line({
                word: "азбука Брайля",
                pos: "name",
                senses: [{ glosses: ["Braille"] }],
                forms: [
                  {
                    form: "В",
                    tags: ["error-unrecognized-form"],
                    source: "declension",
                  },
                ],
              }),
            ].join("\n") + "\n",
          ),
        );
        const stats = yield* importWiktextract({
          grammar: [],
          lang: "ru",
          input,
          out,
        });
        assert.strictEqual(stats.letterVariants, 2); // елка, елки
        assert.strictEqual(stats.unspacedAbbreviations, 1); // ж.д.

        const db = yield* openDictionary(out);
        assert.deepStrictEqual(lemmas(db, "собаки"), ["собака/NOUN"]);
        assert.deepStrictEqual(lemmas(db, "елки"), ["ёлка/NOUN"]);
        assert.deepStrictEqual(lemmas(db, "ёлки"), ["ёлка/NOUN"]);
        assert.deepStrictEqual(lemmas(db, "в"), []);
        // Unspaced, as texts write it, and without its period, as tokenizers send it.
        assert.deepStrictEqual(lemmas(db, "ж.д."), ["ж. д./NOUN"]);
        assert.deepStrictEqual(lemmas(db, "ж.д"), ["ж. д./NOUN"]);
      }),
  );
});
