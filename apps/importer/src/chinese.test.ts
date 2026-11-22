import { assert, describe, it } from "@effect/vitest";
import { Database } from "bun:sqlite";
import { Effect } from "effect";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PREFERRED_LETTERS_KEY } from "@dict/core/schema";
import { importWiktextract } from "./Importer.ts";

const pinyin = (text: string, ...tags: ReadonlyArray<string>) => ({
  zh_pron: text,
  tags: ["Mandarin", ...tags, "Pinyin"],
});

/** A word on its traditional page, with its simplified spelling. */
const word = (traditional: string, simplified: string, gloss: string) => ({
  word: traditional,
  pos: "noun",
  forms: [{ form: simplified, tags: ["Simplified-Chinese"] }],
  senses: [{ glosses: [gloss] }],
});

/** Trimmed Chinese lines, as the dump writes them. */
const LINES = [
  {
    word: "學習",
    pos: "verb",
    forms: [{ form: "学习", tags: ["Simplified-Chinese"] }],
    sounds: [
      pinyin("xuéxí", "Standard"),
      {
        zh_pron: "xio²¹ xi²¹",
        tags: ["Mandarin", "Chengdu", "Sichuanese", "Pinyin"],
      },
    ],
    senses: [{ glosses: ["to study; to learn"] }],
  },
  {
    word: "說",
    pos: "character",
    sounds: [
      pinyin("shuō (shuo¹)", "Standard"),
      {
        ipa: "/ʂu̯ɔ⁵⁵/",
        tags: ["Mandarin", "Standard-Chinese", "vernacular", "Sinological-IPA"],
      },
      { ipa: "/sɔ²¹/", tags: ["Sinological-IPA"] },
      { ipa: "/syːt̚³/", tags: ["Cantonese", "Guangzhou", "Sinological-IPA"] },
    ],
    senses: [{ glosses: ["to say; to speak"] }],
  },
  // A character's simplified page: no meaning, only where it points.
  {
    word: "说",
    pos: "character",
    redirects: ["說"],
    senses: [{ tags: ["no-gloss"] }],
  },
  word("說話", "说话", "to speak"),
  word("小說", "小说", "novel"),
  word("說明", "说明", "to explain"),
  // A variant, not the simplified spelling.
  {
    word: "旳",
    pos: "character",
    redirects: ["的"],
    senses: [{ tags: ["no-gloss"] }],
  },
  {
    word: "的",
    pos: "character",
    etymology_number: 1,
    sounds: [pinyin("dì")],
    senses: [{ glosses: ["bright; clear"] }],
  },
  {
    word: "的",
    pos: "character",
    etymology_number: 2,
    // The page's earlier sounds come first.
    sounds: [pinyin("dì"), pinyin("de")],
    senses: [{ glosses: ["possessive particle"] }],
  },
  { word: "機", pos: "character", senses: [{ glosses: ["machine"] }] },
  // The simplified letter has a page of its own, and no redirect.
  { word: "机", pos: "character", senses: [{ glosses: ["alder"] }] },
  word("手機", "手机", "mobile phone"),
  word("機器", "机器", "machine"),
  word("飛機", "飞机", "aeroplane"),
  {
    word: "住",
    pos: "character",
    senses: [
      { glosses: ["to live; to reside"] },
      { glosses: ["for now"], tags: ["Cantonese"] },
    ],
  },
  {
    word: "吾",
    pos: "character",
    senses: [
      {
        glosses: ["my"],
        tags: ["Hakka", "literary"],
        raw_glosses: ["(literary or Hakka) my"],
      },
      { glosses: ["for me"], tags: ["Hakka"] },
    ],
  },
  {
    word: "咩",
    pos: "particle",
    senses: [{ glosses: ["question particle"], tags: ["Cantonese"] }],
  },
  {
    word: "悅",
    pos: "character",
    // Classical texts write 悅 as 說: a variant, which is a word of its own.
    forms: [{ form: "說", tags: ["alternative", "Traditional-Chinese"] }],
    senses: [{ glosses: ["joy"] }],
  },
].map((line) => JSON.stringify({ lang_code: "zh", ...line }));

const imported = Effect.acquireRelease(
  Effect.promise(() => mkdtemp(join(tmpdir(), "dict-zh-"))),
  (dir) => Effect.promise(() => rm(dir, { recursive: true, force: true })),
).pipe(
  Effect.flatMap((dir) =>
    Effect.gen(function* () {
      const input = join(dir, "zh.jsonl");
      const out = join(dir, "zh.sqlite");
      yield* Effect.promise(() => writeFile(input, LINES.join("\n") + "\n"));
      yield* importWiktextract({ lang: "zh", input, out, grammar: [] });
      return new Database(out, { readonly: true });
    }),
  ),
);

/** `form`'s lemma rows as `lemma: glosses (reading)`. */
const lemmasOf = (db: Database, form: string) =>
  db
    .query<
      { lemma: string; glosses: string; reading: string | null },
      [string]
    >(
      `SELECT e.lemma, (SELECT group_concat(glosses, ' ') FROM senses s WHERE s.entry_id = e.id) AS glosses,
         p.value AS reading FROM forms f
       JOIN entries e ON e.id = f.entry_id
       LEFT JOIN pronunciations p ON p.entry_id = e.id AND p.kind = 'reading'
       WHERE f.form = ? AND f.source = 0 ORDER BY e.id`,
    )
    .all(form)
    .map(
      (row) =>
        `${row.lemma}: ${row.glosses}${row.reading === null ? "" : ` (${row.reading})`}`,
    );

describe("Chinese import with a grammar file", () => {
  it.effect(
    "prefers the letter a grammar line spells, though words keep it",
    () =>
      Effect.acquireRelease(
        Effect.promise(() => mkdtemp(join(tmpdir(), "dict-zh-"))),
        (dir) =>
          Effect.promise(() => rm(dir, { recursive: true, force: true })),
      ).pipe(
        Effect.flatMap((dir) =>
          Effect.gen(function* () {
            const input = join(dir, "zh.jsonl");
            const out = join(dir, "zh.sqlite");
            const lines = [
              {
                word: "裡",
                pos: "character",
                senses: [{ glosses: ["inside"] }],
              },
              {
                word: "里",
                pos: "character",
                senses: [{ glosses: ["li (a unit)"] }],
              },
              word("公里", "公里", "kilometre"),
            ].map((line) => JSON.stringify({ lang_code: "zh", ...line }));
            yield* Effect.promise(() =>
              writeFile(input, lines.join("\n") + "\n"),
            );
            yield* importWiktextract({
              lang: "zh",
              input,
              out,
              grammar: [
                { lemma: "裡", pos: "ADP", senses: ["in"], forms: ["里"] },
              ],
            });
            const db = new Database(out, { readonly: true });
            const meta = db
              .query<{ value: string }, [string]>(
                "SELECT value FROM meta WHERE key = ?",
              )
              .get(PREFERRED_LETTERS_KEY);
            assert.deepStrictEqual(JSON.parse(meta!.value), { 里: ["裡"] });
          }),
        ),
        Effect.scoped,
      ),
  );
});

describe("Chinese import", () => {
  it.effect(
    "finds a word by its simplified spelling as by its lemma, read in pinyin",
    () =>
      Effect.gen(function* () {
        const db = yield* imported;
        const study = '學習: ["to study; to learn"] (xuéxí)';
        assert.deepStrictEqual(lemmasOf(db, "學習"), [study]);
        assert.deepStrictEqual(lemmasOf(db, "学习"), [study]);
      }).pipe(Effect.scoped),
  );

  it.effect(
    "takes a character's simplified page as its lemma, not a variant's",
    () =>
      Effect.gen(function* () {
        const db = yield* imported;
        assert.deepStrictEqual(lemmasOf(db, "说"), [
          '說: ["to say; to speak"] (shuō)',
        ]);
        assert.deepStrictEqual(lemmasOf(db, "旳"), []);
      }).pipe(Effect.scoped),
  );

  it.effect(
    "gives a simplified letter the entries words spell with it, and ranks them",
    () =>
      Effect.gen(function* () {
        const db = yield* imported;
        assert.deepStrictEqual(lemmasOf(db, "机"), [
          '機: ["machine"]',
          '机: ["alder"]',
        ]);
        const meta = db
          .query<{ value: string }, [string]>(
            "SELECT value FROM meta WHERE key = ?",
          )
          .get(PREFERRED_LETTERS_KEY);
        assert.deepStrictEqual(JSON.parse(meta!.value), {
          说: ["說"],
          机: ["機"],
        });
      }).pipe(Effect.scoped),
  );

  it.effect("gives standard Mandarin's IPA, not other varieties'", () =>
    Effect.gen(function* () {
      const db = yield* imported;
      const ipa = db
        .query<{ value: string }, []>(
          "SELECT p.value FROM pronunciations p JOIN entries e ON e.id = p.entry_id WHERE e.lemma = '說' AND p.kind = 'ipa'",
        )
        .all()
        .map((row) => row.value);
      assert.deepStrictEqual(ipa, ["/ʂu̯ɔ⁵⁵/"]);
    }).pipe(Effect.scoped),
  );

  it.effect("reads each etymology by its own sounds", () =>
    Effect.gen(function* () {
      const db = yield* imported;
      assert.deepStrictEqual(lemmasOf(db, "的"), [
        '的: ["bright; clear"] (dì)',
        '的: ["possessive particle"] (de)',
      ]);
    }).pipe(Effect.scoped),
  );

  it.effect(
    "drops other varieties' senses, but not a literary one, and labels it",
    () =>
      Effect.gen(function* () {
        const db = yield* imported;
        assert.deepStrictEqual(lemmasOf(db, "住"), [
          '住: ["to live; to reside"]',
        ]);
        assert.deepStrictEqual(lemmasOf(db, "吾"), ['吾: ["(literary) my"]']);
        assert.deepStrictEqual(lemmasOf(db, "咩"), []);
      }).pipe(Effect.scoped),
  );

  it.effect(
    "keeps a variant listed on a headword line out of the word it spells",
    () =>
      Effect.gen(function* () {
        const db = yield* imported;
        const rows = db
          .query<{ lemma: string }, [string]>(
            "SELECT e.lemma FROM forms f JOIN entries e ON e.id = f.entry_id WHERE f.form = ?",
          )
          .all("說")
          .map((row) => row.lemma);
        assert.deepStrictEqual(rows, ["說"]);
      }).pipe(Effect.scoped),
  );
});
