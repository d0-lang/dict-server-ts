import { assert, describe, it } from "@effect/vitest";
import { createDictionaryFile } from "@dict/core/DictionaryDb";
import { FormSource, GRAMMAR_SOURCE_POS } from "@dict/core/schema";
import type { WriterContext } from "./context.ts";
import { replaceGrammarWords } from "./grammar.ts";

/**
 * A file with `entries` ([id, lemma, pos, sourcePos]), `forms` ([form, id,
 * source]) and the links they came from (`links`: [form, lemma, sourcePos]).
 */
const file = (
  entries: ReadonlyArray<readonly [number, string, string, string]>,
  forms: ReadonlyArray<readonly [string, number, number]>,
  links: ReadonlyArray<readonly [string, string, string]> = [],
) => {
  const db = createDictionaryFile(":memory:");
  db.$client.run(
    "CREATE TEMP TABLE form_of_pending (form TEXT, lemma TEXT, source_pos TEXT)",
  );
  for (const row of links) {
    db.$client.run("INSERT INTO form_of_pending VALUES (?, ?, ?)", [...row]);
  }
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

  it("drops the other listed word's own entries that only the link's fallback reached", () => {
    const sqlite = file(
      [
        [1, "la", "DET", GRAMMAR_SOURCE_POS],
        [2, "l'", "DET", GRAMMAR_SOURCE_POS],
        [3, "un", "DET", GRAMMAR_SOURCE_POS],
        [4, "une", "DET", GRAMMAR_SOURCE_POS],
        [5, "la", "NOUN", "noun"],
        [6, "un", "NUM", "num"],
      ],
      [
        ["la", 1, FormSource.Lemma],
        ["l'", 2, FormSource.Lemma],
        ["un", 3, FormSource.Lemma],
        ["une", 4, FormSource.Lemma],
        ["la", 5, FormSource.Lemma],
        ["un", 6, FormSource.Lemma],
        // The article `l'` links to `la`, which has no article entry.
        ["l'", 5, FormSource.FormOf],
        // The numeral `une` links to the numeral `un`.
        ["une", 6, FormSource.FormOf],
      ],
      [
        ["l'", "la", "article"],
        ["une", "un", "num"],
      ],
    );
    run(sqlite);
    assert.deepStrictEqual(reached(sqlite, "l'"), ["l' DET"]);
    assert.deepStrictEqual(reached(sqlite, "une"), ["une DET", "un NUM"]);
  });

  it("replaces Wiktionary's contraction entry of a listed word", () => {
    const sqlite = file(
      [
        [1, "n'", "PART", GRAMMAR_SOURCE_POS],
        [2, "a", "AUX", GRAMMAR_SOURCE_POS],
        [3, "n'", "X", "contraction"],
        [4, "a", "X", "character"],
      ],
      [
        ["n'", 1, FormSource.Lemma],
        ["a", 2, FormSource.Lemma],
        ["n'", 3, FormSource.Lemma],
        ["a", 4, FormSource.Lemma],
      ],
    );
    run(sqlite);
    assert.deepStrictEqual(reached(sqlite, "n'"), ["n' PART"]);
    // Other `X` entries stay: `a` is also the letter.
    assert.deepStrictEqual(reached(sqlite, "a"), ["a AUX", "a X"]);
  });

  it("keeps the verbs a content line points at, and drops its other ones", () => {
    const sqlite = file(
      [
        [1, "va", "VERB", GRAMMAR_SOURCE_POS],
        [2, "aller", "VERB", "verb"],
        [3, "vader", "VERB", "verb"],
        [4, "va", "INTJ", "intj"],
      ],
      [
        ["va", 1, FormSource.Lemma],
        ["va", 2, FormSource.Inflection],
        ["va", 3, FormSource.Inflection],
        ["va", 4, FormSource.Lemma],
      ],
    );
    sqlite.run(`INSERT INTO senses VALUES (1, 0, '["goes"]', '["aller"]')`);
    run(sqlite);
    assert.deepStrictEqual(reached(sqlite, "va"), [
      "va VERB",
      "aller VERB",
      "va INTJ",
    ]);
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
