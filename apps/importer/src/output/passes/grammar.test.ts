import { assert, describe, it } from "@effect/vitest";
import { createDictionaryFile } from "@dict/core/DictionaryDb";
import { FormSource, GRAMMAR_SOURCE_POS } from "@dict/core/schema";
import type { WriterContext } from "./context.ts";
import { replaceGrammarWords } from "./grammar.ts";

/** A file with `entries` ([id, lemma, pos, sourcePos]) and `forms` ([form, id, source]). */
const file = (
  entries: ReadonlyArray<readonly [number, string, string, string]>,
  forms: ReadonlyArray<readonly [string, number, number]>,
) => {
  const db = createDictionaryFile(":memory:");
  for (const [id, lemma, pos, sourcePos] of entries) {
    db.$client.run(
      "INSERT INTO entries VALUES (?, ?, ?, ?, 0, 0, NULL, NULL)",
      [id, lemma, pos, sourcePos],
    );
  }
  for (const row of forms) {
    db.$client.run("INSERT INTO forms VALUES (?, ?, ?)", [...row]);
  }
  return db.$client;
};

const reached = (sqlite: WriterContext["sqlite"], form: string) =>
  sqlite
    .query<{ lemma: string; pos: string }, [string]>(
      "SELECT e.lemma, e.pos FROM forms f JOIN entries e ON e.id = f.entry_id WHERE f.form = ? ORDER BY e.id",
    )
    .all(form)
    .map((row) => `${row.lemma} ${row.pos}`);

const run = (
  sqlite: WriterContext["sqlite"],
  optionalLetters: WriterContext["optionalLetters"] = [],
) =>
  replaceGrammarWords({
    sqlite,
    counts: {},
    optionalLetters,
  } as unknown as WriterContext);

describe("replaceGrammarWords", () => {
  it("drops a listed word's form-of links to the lines of another listed word", () => {
    const sqlite = file(
      [
        [1, "de", "ADP", GRAMMAR_SOURCE_POS],
        [2, "des", "DET", GRAMMAR_SOURCE_POS],
        [3, "un", "DET", GRAMMAR_SOURCE_POS],
        [4, "une", "NOUN", "noun"],
        [5, "dé", "NOUN", "noun"],
      ],
      [
        ["de", 1, FormSource.Lemma],
        ["des", 2, FormSource.Lemma],
        ["un", 3, FormSource.Lemma],
        // Wiktionary: `des` is a form of `de` and `un`, and the plural of `dé`.
        ["des", 1, FormSource.FormOf],
        ["des", 3, FormSource.FormOf],
        ["des", 5, FormSource.Inflection],
        // `de` is unlisted as a form here, so `du` keeps its link to `de`.
        ["du", 1, FormSource.FormOf],
      ],
    );
    run(sqlite);
    assert.deepStrictEqual(reached(sqlite, "des"), ["des DET", "dé NOUN"]);
    assert.deepStrictEqual(reached(sqlite, "du"), ["de ADP"]);
  });

  it("keeps a link that spells the other word without its optional letters", () => {
    // Russian texts write `всё` as `все`, which the file lists too.
    const sqlite = file(
      [
        [1, "все", "PRON", GRAMMAR_SOURCE_POS],
        [2, "всё", "PRON", GRAMMAR_SOURCE_POS],
        [3, "весь", "DET", GRAMMAR_SOURCE_POS],
      ],
      [
        ["все", 1, FormSource.Lemma],
        ["всё", 2, FormSource.Lemma],
        ["весь", 3, FormSource.Lemma],
        ["все", 2, FormSource.FormOf],
        ["все", 3, FormSource.FormOf],
      ],
    );
    run(sqlite, [["ё", "е"]]);
    assert.deepStrictEqual(reached(sqlite, "все"), ["все PRON", "всё PRON"]);
  });
});
