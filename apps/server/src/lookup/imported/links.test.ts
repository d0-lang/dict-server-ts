import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDictionary } from "@dict/core/DictionaryDb";
import { findEntriesByForm } from "../common/entries.ts";
import { importWiktextract } from "@dict/importer/Importer";

const tempDir = Effect.acquireRelease(
  Effect.promise(() => mkdtemp(join(tmpdir(), "dict-import-"))),
  (dir) => Effect.promise(() => rm(dir, { recursive: true, force: true })),
);

const lemmas = (db: Parameters<typeof findEntriesByForm>[0], word: string) =>
  findEntriesByForm(db, word).map((e) => `${e.lemma}/${e.pos}`);

describe("importWiktextract", () => {
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
          ...e.senses.map((s) => s.glosses[0]),
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
      assert.deepStrictEqual(senses("tańszy"), [
        ["tańszy", "comparative degree of tani: cheap"],
      ]);
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
                glosses: ["king", "synonym of państwo", "royal couple"],
                see: ["państwo"],
              },
            ],
          ],
        ]);
        // the pointer is left out of the copy, and the group stays one sense
        assert.deepStrictEqual(senses("królik"), [
          ["królik", [{ glosses: ["diminutive of król: king; royal couple"] }]],
        ]);
        // a target with no entry gets no link
        assert.deepStrictEqual(senses("grządka"), [
          [
            "grządka",
            [
              { glosses: ["synonym of zagon"], see: ["zagon"] },
              { glosses: ["synonym of brak"] },
            ],
          ],
        ]);
        // the target is already in the result
        assert.deepStrictEqual(senses("razu"), [
          ["raz", [{ glosses: ["once"] }]],
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

  it.effect("follows a verb's chain through a word with no verb entry", () =>
    Effect.gen(function* () {
      const dir = yield* tempDir;
      const input = join(dir, "fr.jsonl");
      const line = (word: string, pos: string, senses: ReadonlyArray<object>) =>
        JSON.stringify({ word, pos, lang_code: "fr", senses });
      const link = (gloss: string, target: string) => ({
        glosses: [gloss],
        tags: ["form-of"],
        form_of: [{ word: target }],
      });
      yield* Effect.promise(() =>
        writeFile(
          input,
          [
            line("partie", "noun", [{ glosses: ["part"] }]),
            line("partie", "verb", [
              link("feminine singular of parti", "parti"),
            ]),
            line("parties", "noun", [link("plural of partie", "partie")]),
            line("parti", "adj", [{ glosses: ["drunk"] }]),
            line("parti", "noun", [{ glosses: ["party"] }]),
            line("parti", "verb", [
              link("past participle of partir", "partir"),
            ]),
            line("partir", "verb", [{ glosses: ["to leave"] }]),
            line("sortie", "verb", [
              link("feminine singular of sorti", "sorti"),
            ]),
            line("sorti", "verb", [
              link("past participle of sortir", "sortir"),
            ]),
            line("sortir", "verb", [{ glosses: ["to go out"] }]),
            // A noun's link to a word that only has a verb's entry.
            line("Spielens", "noun", [
              link("genitive singular of Spielen", "Spielen"),
            ]),
            line("spielen", "verb", [{ glosses: ["to play"] }]),
            line("Spielen", "noun", [link("dative plural of Spiel", "Spiel")]),
            line("Spiel", "noun", [{ glosses: ["game"] }]),
            // A link to a word the grammar file lists.
            line("nee", "pron", [link("alternative form of née", "née")]),
            line("née", "pron", [link("genitive of elle", "elle")]),
            line("elle", "pron", [{ glosses: ["she"] }]),
          ].join("\n"),
        ),
      );
      const out = join(dir, "fr_en.sqlite");
      yield* importWiktextract({
        lang: "fr",
        input,
        out,
        grammar: [{ lemma: "née", pos: "PRON", senses: ["her"] }],
      });
      const db = yield* openDictionary(out);

      // `parti` has no verb entry: the chain goes on to `partir`, and
      // `parti`'s own entries stay, after the word's own.
      assert.deepStrictEqual(lemmas(db, "partie"), [
        "partie/NOUN",
        "parti/ADJ",
        "parti/NOUN",
        "partir/VERB",
      ]);
      // `partie` has a noun entry, so its plural stops there.
      assert.deepStrictEqual(lemmas(db, "parties"), ["partie/NOUN"]);
      // through a word with no entry at all, as before
      assert.deepStrictEqual(lemmas(db, "sortie"), ["sortir/VERB"]);
      // Only a verb's chain goes on through another word's entry.
      assert.deepStrictEqual(lemmas(db, "spielens"), ["spielen/VERB"]);
      // A word of the grammar file ends a chain like any entry.
      assert.deepStrictEqual(lemmas(db, "nee"), ["née/PRON"]);
    }).pipe(Effect.scoped),
  );

  it.effect(
    "stops a verb's chain at another word's entry without verbChainsThroughEntries",
    () =>
      Effect.gen(function* () {
        const dir = yield* tempDir;
        const input = join(dir, "pl.jsonl");
        const line = (
          word: string,
          pos: string,
          senses: ReadonlyArray<object>,
        ) => JSON.stringify({ word, pos, lang_code: "pl", senses });
        const link = (gloss: string, target: string) => ({
          glosses: [gloss],
          tags: ["form-of"],
          form_of: [{ word: target }],
        });
        yield* Effect.promise(() =>
          writeFile(
            input,
            [
              line("partie", "verb", [
                link("feminine singular of parti", "parti"),
              ]),
              line("parti", "adj", [{ glosses: ["drunk"] }]),
              line("parti", "verb", [
                link("past participle of partir", "partir"),
              ]),
              line("partir", "verb", [{ glosses: ["to leave"] }]),
            ].join("\n"),
          ),
        );
        const out = join(dir, "pl_en.sqlite");
        yield* importWiktextract({ lang: "pl", input, out, grammar: [] });
        const db = yield* openDictionary(out);

        assert.deepStrictEqual(lemmas(db, "partie"), ["parti/ADJ"]);
      }).pipe(Effect.scoped),
  );

  it.effect(
    "writes no entry for a verb form whose gloss only names its grammar",
    () =>
      Effect.gen(function* () {
        const dir = yield* tempDir;
        const input = join(dir, "fr.jsonl");
        const line = (
          word: string,
          pos: string,
          senses: ReadonlyArray<object>,
        ) => JSON.stringify({ word, pos, lang_code: "fr", senses });
        yield* Effect.promise(() =>
          writeFile(
            input,
            [
              line("aimée", "verb", [
                {
                  glosses: ["feminine singular of aimé"],
                  tags: ["form-of", "participle"],
                  form_of: [{ word: "aimé" }],
                },
              ]),
              line("aimé", "adj", [{ glosses: ["beloved"] }]),
              line("aimé", "verb", [
                {
                  glosses: [
                    "presubject first-person singular present indicative of aimer",
                  ],
                  links: [["aimer", "aimer#French"]],
                },
              ]),
              line("aimer", "verb", [{ glosses: ["to love"] }]),
            ].join("\n"),
          ),
        );
        const out = join(dir, "fr_en.sqlite");
        yield* importWiktextract({ lang: "fr", input, out, grammar: [] });
        const db = yield* openDictionary(out);

        assert.deepStrictEqual(lemmas(db, "aimé"), ["aimé/ADJ", "aimer/VERB"]);
        // So `aimé` has no verb entry, and `aimée` reaches `aimer` through it.
        assert.deepStrictEqual(lemmas(db, "aimée"), ["aimé/ADJ", "aimer/VERB"]);
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
          findEntriesByForm(db, "sich").map((e) => e.senses[0]?.glosses),
          [["Reflexive pronoun of the third person: oneself"]],
        );
      }).pipe(Effect.scoped),
  );

  it.effect(
    "gives reflexive verbs their own entry, which explains their verbal noun",
    () =>
      Effect.gen(function* () {
        const dir = yield* tempDir;
        const input = join(dir, "pl.jsonl");
        const out = join(dir, "pl_en.sqlite");
        const reflexive = (gloss: string) => ({
          glosses: [gloss],
          raw_glosses: [`(reflexive with się) ${gloss}`],
          tags: ["reflexive"],
        });
        const line = (
          word: string,
          pos: string,
          senses: ReadonlyArray<object>,
          extra: object = {},
        ) => JSON.stringify({ word, pos, lang_code: "pl", senses, ...extra });
        yield* Effect.promise(() =>
          writeFile(
            input,
            [
              line("wydarzenie", "noun", [
                {
                  glosses: ["verbal noun of wydarzyć"],
                  tags: ["form-of"],
                  form_of: [{ word: "wydarzyć" }],
                },
              ]),
              // only reflexive: wydarzyć się
              line("wydarzyć", "verb", [reflexive("to happen")]),
              // the conjugation is on the reflexive line only
              line("zakręcać", "verb", [{ glosses: ["to turn off"] }]),
              line("zakręcać", "verb", [reflexive("to spin")], {
                forms: [
                  {
                    form: "zakręcamy",
                    tags: ["first-person", "plural", "present"],
                    source: "conjugation",
                  },
                ],
              }),
              line("bawić", "verb", [
                {
                  glosses: ["to amuse"],
                  raw_glosses: ["(transitive) to amuse"],
                },
                reflexive("to play"),
                // the plain verb means this too
                {
                  glosses: ["to guard"],
                  raw_glosses: ["(transitive, reflexive with się) to guard"],
                  tags: ["reflexive", "transitive"],
                },
              ]),
            ].join("\n"),
          ),
        );
        yield* importWiktextract({ lang: "pl", input, out, grammar: [] });
        const db = yield* openDictionary(out);
        assert.deepStrictEqual(lemmas(db, "bawić"), [
          "bawić/VERB",
          "bawić się/VERB",
        ]);
        assert.deepStrictEqual(
          findEntriesByForm(db, "bawić").map((e) =>
            e.senses.map((s) => s.glosses[0]),
          ),
          [["to amuse", "to guard"], ["to play"]],
        );
        assert.deepStrictEqual(lemmas(db, "wydarzyć"), ["wydarzyć się/VERB"]);
        // a verb and its reflexive entry share their forms
        assert.deepStrictEqual(lemmas(db, "zakręcamy"), [
          "zakręcać/VERB",
          "zakręcać się/VERB",
        ]);
        assert.deepStrictEqual(
          findEntriesByForm(db, "wydarzenie")[0]?.senses.map(
            (s) => s.glosses[0],
          ),
          ["verbal noun of wydarzyć: to happen"],
        );
      }),
  );
});
