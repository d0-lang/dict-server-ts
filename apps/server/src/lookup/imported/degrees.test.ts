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

describe("importWiktextract", () => {
  it.effect("puts a word's own senses before its comparative ones", () =>
    Effect.gen(function* () {
      const dir = yield* tempDir;
      const input = join(dir, "pl.jsonl");
      const line = (
        word: string,
        pos: string,
        senses: ReadonlyArray<object>,
        extra = {},
      ) => JSON.stringify({ word, pos, lang_code: "pl", senses, ...extra });
      const comparative = (base: string) => ({
        glosses: [`comparative degree of ${base}`],
        tags: ["comparative", "form-of"],
        form_of: [{ word: base }],
      });
      yield* Effect.promise(() =>
        writeFile(
          input,
          [
            line("późno", "adv", [
              { glosses: ["late"] },
              { glosses: ["at a late hour"] },
            ]),
            // one line, own sense after the comparative one
            line("później", "adv", [
              comparative("późno"),
              { glosses: ["later, afterwards"] },
            ]),
            line("dobrze", "adv", [{ glosses: ["well"] }]),
            // two lines: the comparative alone, then the word's own sense
            line("lepiej", "adv", [comparative("dobrze")]),
            line("lepiej", "adv", [{ glosses: ["rather"] }], {
              etymology_number: 2,
            }),
            // a comparative that says what it means, before the word's own sense
            line("dalej", "adv", [
              {
                glosses: ["comparative degree of daleko: further"],
                tags: ["comparative", "form-of"],
                form_of: [{ word: "daleko" }],
              },
              { glosses: ["and so on"] },
            ]),
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
      // every meaning of the base, after the word's own
      assert.deepStrictEqual(senses("później"), [
        [
          "później",
          "later, afterwards",
          "comparative degree of późno: late",
          "comparative degree of późno: at a late hour",
        ],
      ]);
      assert.deepStrictEqual(senses("lepiej"), [
        ["lepiej", "rather", "comparative degree of dobrze: well"],
      ]);
      assert.deepStrictEqual(senses("dalej"), [
        ["dalej", "and so on", "comparative degree of daleko: further"],
      ]);
      assert.strictEqual(stats.degreeMerged, 1);
    }).pipe(Effect.scoped),
  );

  it.effect(
    "leaves a comparative spelled like a plain form of its base to the base",
    () =>
      Effect.gen(function* () {
        const dir = yield* tempDir;
        const input = join(dir, "de.jsonl");
        const comparative = (word: string, base: string, extra = {}) =>
          JSON.stringify({
            word,
            pos: "adj",
            lang_code: "de",
            senses: [
              {
                glosses: [`comparative degree of ${base}`],
                tags: ["comparative", "form-of"],
                form_of: [{ word: base }],
              },
            ],
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
                  {
                    form: "neuer",
                    tags: ["strong", "nominative", "masculine", "singular"],
                    source: "declension",
                  },
                  {
                    form: "neue",
                    tags: ["strong", "nominative", "feminine", "singular"],
                    source: "declension",
                  },
                ],
              }),
              comparative("neuer", "neu", {
                forms: [{ form: "neueren", source: "declension" }],
              }),
              JSON.stringify({
                word: "gut",
                pos: "adj",
                lang_code: "de",
                senses: [{ glosses: ["good"] }],
              }),
              comparative("besser", "gut"),
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
        const db = yield* openDictionary(out);
        const senses = (word: string) =>
          findEntriesByForm(db, word).map((e) => [
            e.lemma,
            ...e.senses.map((s) => s.translations[0]),
          ]);
        // `ein neuer Film`: the plain form of `neu`, as before; its table goes along
        assert.deepStrictEqual(senses("neuer"), [["neu", "new"]]);
        assert.deepStrictEqual(senses("neueren"), [["neu", "new"]]);
        // `besser` is no form of `gut`, so it keeps an entry of its own
        assert.deepStrictEqual(senses("besser"), [
          ["besser", "comparative degree of gut: good"],
        ]);
        assert.strictEqual(stats.degreeDropped, 1);
      }).pipe(Effect.scoped),
  );

  it.effect(
    "gives declined comparatives and superlatives to their degree's entry",
    () =>
      Effect.gen(function* () {
        const dir = yield* tempDir;
        const input = join(dir, "de.jsonl");
        const degreeOf = (word: string, degree: string, base: string) =>
          JSON.stringify({
            word,
            pos: "adj",
            lang_code: "de",
            senses: [
              {
                glosses: [`${degree} degree of ${base}`],
                tags: [degree, "form-of"],
                form_of: [{ word: base }],
              },
            ],
          });
        yield* Effect.promise(() =>
          writeFile(
            input,
            [
              JSON.stringify({
                word: "groß",
                pos: "adj",
                lang_code: "de",
                senses: [{ glosses: ["big"] }],
                forms: [
                  {
                    form: "große",
                    tags: ["strong", "nominative", "feminine", "singular"],
                    source: "declension",
                  },
                  { form: "größer", tags: ["comparative"] },
                  {
                    form: "größere",
                    tags: [
                      "comparative",
                      "strong",
                      "nominative",
                      "feminine",
                      "singular",
                    ],
                    source: "declension",
                  },
                  {
                    form: "größte",
                    tags: ["superlative", "weak", "nominative", "singular"],
                    source: "declension",
                  },
                  // tagged with both degrees: neither entry gets it
                  {
                    form: "größtere",
                    tags: ["comparative"],
                    source: "declension",
                  },
                  {
                    form: "größtere",
                    tags: ["superlative"],
                    source: "declension",
                  },
                ],
              }),
              degreeOf("größer", "comparative", "groß"),
              degreeOf("größten", "superlative", "groß"),
              JSON.stringify({
                word: "schnell",
                pos: "adj",
                lang_code: "de",
                senses: [{ glosses: ["fast"] }],
                forms: [
                  {
                    form: "schnellste",
                    tags: ["superlative", "weak", "nominative", "singular"],
                    source: "declension",
                  },
                ],
              }),
              degreeOf("schnellsten", "superlative", "schnell"),
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
        const db = yield* openDictionary(out);
        const lemmas = (word: string) =>
          findEntriesByForm(db, word).map((e) => e.lemma);
        // irregular: the base, then the degree's entry
        assert.deepStrictEqual(lemmas("größere"), ["groß", "größer"]);
        assert.deepStrictEqual(lemmas("größte"), ["groß", "größten"]);
        // regular (the base plus an ending): the base alone
        assert.deepStrictEqual(lemmas("schnellste"), ["schnell"]);
        // plain forms, and forms with both degrees, stay with the base
        assert.deepStrictEqual(lemmas("große"), ["groß"]);
        assert.deepStrictEqual(lemmas("größtere"), ["groß"]);
        assert.strictEqual(stats.degreeForms, 2);
      }).pipe(Effect.scoped),
  );
});
