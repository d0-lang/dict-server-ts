import { assert, describe, it } from "@effect/vitest";
import { createDictionaryFile } from "@dict/core/DictionaryDb";
import { caseClass } from "@dict/core/lookupKey";
import { findEntriesByForm } from "./entries.ts";
import { CaseClass, FormSource } from "@dict/core/schema";

describe("caseClass", () => {
  it("classifies lowercase, capitalised and all-caps words", () => {
    assert.strictEqual(caseClass("oder"), CaseClass.Lower);
    assert.strictEqual(caseClass("Oder"), CaseClass.Capitalised);
    assert.strictEqual(caseClass("AM"), CaseClass.AllCaps);
    assert.strictEqual(caseClass("Am"), CaseClass.Capitalised);
    assert.strictEqual(caseClass("Ü"), CaseClass.Capitalised); // one letter
    assert.strictEqual(caseClass("ÜBER"), CaseClass.AllCaps);
    assert.strictEqual(caseClass("2024"), CaseClass.Capitalised);
    assert.strictEqual(caseClass("bzw."), CaseClass.Lower);
  });
});

const ranked = (
  rows: ReadonlyArray<
    readonly [
      lemma: string,
      pos: string,
      sourcePos: string,
      form: string,
      source: number,
      gloss?: string,
    ]
  >,
  word: string,
) => {
  const db = createDictionaryFile(":memory:");
  rows.forEach(([lemma, pos, sourcePos, form, source, gloss], i) => {
    db.$client.run(
      "INSERT OR IGNORE INTO entries VALUES (?, ?, ?, ?, 0, ?, NULL)",
      [i + 1, lemma, pos, sourcePos, caseClass(lemma)],
    );
    db.$client.run("INSERT INTO senses VALUES (?, 0, ?, NULL)", [
      i + 1,
      JSON.stringify([
        `${lemma} ${pos}`,
        ...(gloss === undefined ? [] : [gloss]),
      ]),
    ]);
    db.$client.run("INSERT INTO forms VALUES (?, ?, ?)", [form, i + 1, source]);
  });
  return findEntriesByForm(db, word).map(
    (entry) => entry.senses[0]!.translations[0],
  );
};

describe("findEntriesByForm ranking", () => {
  it("puts a participle after the adjective of the same lemma (`поширені`)", () => {
    assert.deepStrictEqual(
      ranked(
        [
          [
            "поши́рений",
            "VERB",
            "verb",
            "поширені",
            FormSource.Inflection,
            "participle of поши́рити: to widen",
          ],
          ["поши́рений", "ADJ", "adj", "поширені", FormSource.Inflection],
        ],
        "поширені",
      ),
      ["поши́рений ADJ", "поши́рений VERB"],
    );
    // The verb's own lemma keeps its place: German `erhalten` "to receive"
    // before the adjective `erhalten` "intact".
    assert.deepStrictEqual(
      ranked(
        [
          [
            "erhalten",
            "VERB",
            "verb",
            "erhalten",
            FormSource.Lemma,
            "to receive",
          ],
          ["erhalten", "ADJ", "adj", "erhalten", FormSource.Lemma],
        ],
        "erhalten",
      ),
      ["erhalten VERB", "erhalten ADJ"],
    );
  });

  it("puts letters and one-letter letter names after the word", () => {
    assert.deepStrictEqual(
      ranked(
        [
          ["и", "X", "character", "и", FormSource.Lemma],
          ["и", "NOUN", "letter-name", "и", FormSource.Lemma],
          ["и", "CCONJ", "conj", "и", FormSource.Lemma],
        ],
        "и",
      ),
      ["и CCONJ", "и X", "и NOUN"],
    );
  });

  it("puts a form reached only through an optional letter after real forms", () => {
    assert.deepStrictEqual(
      ranked(
        [
          ["всё", "PRON", "pron", "все", FormSource.LetterVariant],
          ["весь", "DET", "det", "все", FormSource.Inflection],
        ],
        "все",
      ),
      ["весь DET", "всё PRON"],
    );
  });
});
