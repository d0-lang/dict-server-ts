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
