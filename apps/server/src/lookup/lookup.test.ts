import { assert, describe, it } from "@effect/vitest";
import { lookupWord } from "./lookup.ts";
import { dictionary, languageOf, lemmas } from "./testing/dictionary.ts";
import { german } from "./testing/german.ts";
import { polish } from "./testing/polish.ts";

describe("lookup with context", () => {
  it("leaves the lookup as it is without context", () => {
    assert.deepStrictEqual(lemmas(german, "de_en", "fand"), ["finden"]);
  });

  it("leaves out a phrase's pointer to its literal reading", () => {
    const [phrase] = lookupWord(
      polish,
      languageOf("pl_en"),
      "tym",
      "Jesteś w tym fachowiec.",
    ).entries;
    assert.deepStrictEqual(phrase, {
      lemma: "w tym",
      pos: "ADP",
      senses: [{ glosses: ["including"] }],
      match: ["w tym"],
    });
  });

  it("puts capitalised lemmas first for a capitalised word inside a sentence", () => {
    assert.deepStrictEqual(
      lemmas(german, "de_en", "Tagen", "In wenigen Tagen kommt er."),
      ["Tag", "tagen"],
    );
    assert.deepStrictEqual(
      lemmas(german, "de_en", "Tagen", "Er sagt: „Tagen wir morgen?“"),
      ["tagen", "Tag"],
    );
    assert.deepStrictEqual(
      lemmas(german, "de_en", "Tagen", "Tagen die Minister heute?"),
      ["tagen", "Tag"],
    );
    assert.deepStrictEqual(lemmas(german, "de_en", "Tagen"), ["tagen", "Tag"]);
  });

  it("keeps a verb on top for an infinitive used as a noun", () => {
    const db = dictionary([
      ["Binde", "NOUN", ["Binden"]],
      ["binden", "VERB", ["bindet"]],
    ]);
    assert.deepStrictEqual(
      lemmas(db, "de_en", "Binden", "Mehr zum Binden unten."),
      ["binden", "Binde"],
    );
    assert.deepStrictEqual(
      lemmas(db, "de_en", "Binden", "Er kauft zwei Binden im Laden."),
      ["Binde", "binden"],
    );
  });

  it("keeps an adjective's place before another capitalised word", () => {
    const db = dictionary([
      ["deutsch", "ADJ", ["deutschen"]],
      ["Deutsch", "PROPN", ["Deutschen"]],
    ]);
    const de = languageOf("de_en");
    const first = (context: string) =>
      lookupWord(db, de, "Deutschen", context).entries[0]!.lemma;
    assert.strictEqual(first("Er fährt mit der Deutschen Bahn."), "deutsch");
    assert.strictEqual(first("Sie lernen im Deutschen viel."), "Deutsch");
  });

  it("ignores a word that isn't in the context", () => {
    assert.deepStrictEqual(lemmas(german, "de_en", "fand", "Es regnet."), [
      "finden",
    ]);
  });
});

describe("segments", () => {
  it("re-indexes segments behind entries the context adds", () => {
    const db = dictionary([
      ["Gemüse", "NOUN"],
      ["Fonds", "NOUN"],
      ["Gemüsefonds kochen", "VERB"],
      ["kochen", "VERB"],
    ]);
    const result = lookupWord(
      db,
      languageOf("de_en"),
      "Gemüsefonds",
      "Wir Gemüsefonds kochen.",
    );
    assert.deepStrictEqual(
      result.entries.map((entry) => entry.lemma),
      ["Gemüsefonds kochen", "Gemüse", "Fonds"],
    );
    assert.deepStrictEqual(result.segments, [
      { text: "Gemüse", entries: [1] },
      { text: "fonds", entries: [2] },
    ]);
  });
});
