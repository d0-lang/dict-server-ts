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

  it.effect(
    "lets a grammar line replace a content word of the same part of speech",
    () =>
      Effect.gen(function* () {
        const dir = yield* tempDir;
        const input = join(dir, "ru.jsonl");
        const line = (word: string, pos: string, gloss: string) =>
          JSON.stringify({
            word,
            pos,
            lang_code: "ru",
            senses: [{ glosses: [gloss] }],
          });
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
            .map((e) => [
              `${e.lemma}/${e.pos}`,
              ...e.senses.map((s) => s.translations[0]),
            ])
            .sort();
        // the line replaces Wiktionary's adverb instead of repeating "here"
        assert.deepStrictEqual(senses("здесь"), [
          ["здесь/ADV", "here", "in this case"],
        ]);
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
});
