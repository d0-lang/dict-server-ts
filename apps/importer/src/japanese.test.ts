import { assert, describe, it } from "@effect/vitest";
import { Database } from "bun:sqlite";
import { Effect } from "effect";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importWiktextract } from "./Importer.ts";

/** Trimmed Japanese lines, as the dump writes them. */
const LINES = [
  {
    word: "捏造",
    pos: "noun",
    forms: [
      {
        form: "捏造",
        ruby: [
          ["捏", "ねつ"],
          ["造", "ぞう"],
        ],
        tags: ["canonical"],
      },
    ],
    senses: [{ glosses: ["fabrication"] }],
  },
  {
    word: "捏造",
    pos: "verb",
    head_templates: [{ name: "ja-verb-suru" }],
    forms: [
      {
        form: "捏造する",
        ruby: [
          ["捏", "ねつ"],
          ["造", "ぞう"],
        ],
        tags: ["canonical"],
      },
      { form: "捏造した", tags: ["past"], source: "conjugation" },
      {
        form: "ねつぞうした",
        tags: ["past", "hiragana"],
        source: "conjugation",
      },
    ],
    senses: [{ glosses: ["to fabricate"] }],
  },
  { word: "ねつぞう", pos: "soft-redirect", redirects: ["捏造"] },
  {
    word: "カール",
    pos: "verb",
    head_templates: [{ name: "ja-verb-suru" }],
    // Wiktionary's tables of katakana する-verbs leave out the word.
    forms: [
      { form: "し", tags: ["continuative"], source: "conjugation" },
      { form: "しろ", tags: ["imperative"], source: "conjugation" },
    ],
    senses: [{ glosses: ["to curl"] }],
  },
  { word: "は", pos: "particle", senses: [{ glosses: ["topic marker"] }] },
  {
    word: "は",
    pos: "syllable",
    senses: [{ glosses: ["The hiragana syllable は (ha)."] }],
  },
  {
    word: "ふ",
    pos: "suffix",
    forms: [{ form: "は", tags: ["imperfective"], source: "conjugation" }],
    senses: [
      {
        glosses: ["expresses repetition of an action"],
        tags: ["morpheme"],
      },
    ],
  },
  { word: "き", pos: "particle", senses: [{ glosses: ["marks a reason"] }] },
  {
    word: "き",
    pos: "suffix",
    senses: [
      {
        glosses: ["Indicates past tense: -ed"],
        tags: ["Classical", "Japanese", "morpheme"],
      },
    ],
  },
].map((line) => JSON.stringify({ lang_code: "ja", ...line }));

const imported = Effect.acquireRelease(
  Effect.promise(() => mkdtemp(join(tmpdir(), "dict-ja-"))),
  (dir) => Effect.promise(() => rm(dir, { recursive: true, force: true })),
).pipe(
  Effect.flatMap((dir) =>
    Effect.gen(function* () {
      const input = join(dir, "ja.jsonl");
      const out = join(dir, "ja.sqlite");
      yield* Effect.promise(() => writeFile(input, LINES.join("\n") + "\n"));
      yield* importWiktextract({ lang: "ja", input, out, grammar: [] });
      return new Database(out, { readonly: true });
    }),
  ),
);

const entriesOf = (db: Database, form: string) =>
  db
    .query<{ lemma: string; pos: string; reading: string | null }, [string]>(
      `SELECT e.lemma, e.pos, p.value AS reading FROM forms f
       JOIN entries e ON e.id = f.entry_id
       LEFT JOIN pronunciations p ON p.entry_id = e.id AND p.kind = 'reading'
       WHERE f.form = ? ORDER BY e.id`,
    )
    .all(form);

describe("Japanese import", () => {
  it.effect(
    "shows a する-verb with する, found by the bare word and its kana",
    () =>
      Effect.gen(function* () {
        const db = yield* imported;
        const verb = {
          lemma: "捏造する",
          pos: "VERB",
          reading: "ねつぞうする",
        };
        const noun = { lemma: "捏造", pos: "NOUN", reading: "ねつぞう" };
        assert.deepStrictEqual(entriesOf(db, "捏造"), [noun, verb]);
        assert.deepStrictEqual(entriesOf(db, "ねつぞう"), [noun, verb]);
        assert.deepStrictEqual(entriesOf(db, "ねつぞうした"), [verb]);
      }).pipe(Effect.scoped),
  );

  it.effect("drops table forms that leave out the word (し of カール)", () =>
    Effect.gen(function* () {
      const db = yield* imported;
      assert.deepStrictEqual(entriesOf(db, "し"), []);
      assert.deepStrictEqual(entriesOf(db, "カール"), [
        { lemma: "カールする", pos: "VERB", reading: null },
      ]);
    }).pipe(Effect.scoped),
  );

  it.effect("leaves out kana letters, suffix tables and Classical senses", () =>
    Effect.gen(function* () {
      const db = yield* imported;
      assert.deepStrictEqual(entriesOf(db, "は"), [
        { lemma: "は", pos: "PART", reading: null },
      ]);
      // The Classical past `き` would only stay if `き` had no other entry.
      assert.deepStrictEqual(entriesOf(db, "き"), [
        { lemma: "き", pos: "PART", reading: null },
      ]);
    }).pipe(Effect.scoped),
  );
});
