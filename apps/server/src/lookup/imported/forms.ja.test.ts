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

const ruby = (word: string, pairs: Array<[string, string]>) => ({
  form: word,
  tags: ["canonical"],
  ruby: pairs,
});

describe("importWiktextract, Japanese", () => {
  it.effect(
    "reads a kana spelling's soft redirect as a form of the kanji lemmas read that way, if the word has no entry of its own",
    () =>
      Effect.gen(function* () {
        const dir = yield* tempDir;
        const input = join(dir, "ja.jsonl");
        const out = join(dir, "ja_en.sqlite");
        const line = (entry: object) =>
          JSON.stringify({ lang: "Japanese", lang_code: "ja", ...entry });
        yield* Effect.promise(() =>
          writeFile(
            input,
            [
              line({
                word: "但し",
                pos: "conj",
                senses: [{ glosses: ["however"] }],
                forms: [ruby("但し", [["但", "ただ"]])],
              }),
              // `ただし` is also a name's reading of `正`
              line({
                word: "正",
                pos: "name",
                senses: [{ glosses: ["a male given name"] }],
                forms: [ruby("正", [["正", "ただし"]])],
              }),
              line({
                word: "正",
                pos: "noun",
                senses: [{ glosses: ["righteousness"] }],
                forms: [ruby("正", [["正", "せい"]])],
              }),
              line({
                word: "ただし",
                pos: "soft-redirect",
                redirects: ["但し", "正"],
                senses: [{ tags: ["no-gloss"] }],
              }),
              line({
                word: "わくわく",
                pos: "adv",
                senses: [{ glosses: ["excitedly"] }],
              }),
              // the same word in katakana, though it has an entry of its own
              line({
                word: "ワクワク",
                pos: "noun",
                senses: [{ glosses: ["a rare sense"] }],
              }),
              line({
                word: "ワクワク",
                pos: "soft-redirect",
                redirects: ["わくわく"],
                senses: [{ tags: ["no-gloss"] }],
              }),
              line({
                word: "国国",
                pos: "noun",
                senses: [{ glosses: ["countries"] }],
                forms: [ruby("国国", [["国国", "くにぐに"]])],
              }),
              // a kanji spelling: no reading to match
              line({
                word: "国々",
                pos: "soft-redirect",
                redirects: ["国国"],
                senses: [{ tags: ["no-gloss"] }],
              }),
              line({
                word: "は",
                pos: "particle",
                senses: [{ glosses: ["topic marker"] }],
              }),
              line({
                word: "葉",
                pos: "noun",
                senses: [{ glosses: ["leaf"] }],
                forms: [ruby("葉", [["葉", "は"]])],
              }),
              line({
                word: "は",
                pos: "soft-redirect",
                redirects: ["葉"],
                senses: [{ tags: ["no-gloss"] }],
              }),
            ].join("\n") + "\n",
          ),
        );
        const stats = yield* importWiktextract({
          grammar: [],
          lang: "ja",
          input,
          out,
        });
        assert.strictEqual(stats.redirectForms, 3); // ただし, ワクワク, 国々

        const db = yield* openDictionary(out);
        assert.deepStrictEqual(lemmas(db, "ただし"), ["但し/CCONJ"]);
        assert.deepStrictEqual(lemmas(db, "ワクワク").sort(), [
          "わくわく/ADV",
          "ワクワク/NOUN",
        ]);
        assert.deepStrictEqual(lemmas(db, "国々"), ["国国/NOUN"]);
        // は has an entry of its own, so 葉 "leaf" stays out of it
        assert.deepStrictEqual(lemmas(db, "は"), ["は/PART"]);
      }),
  );
});
