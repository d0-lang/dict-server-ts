import { assert, describe, it } from "@effect/vitest";
import { lookupWord } from "../lookup.ts";
import { languageOf, lemmas } from "../testing/dictionary.ts";
import { french } from "../testing/french.ts";

describe("elision", () => {
  it("splits an elided word from the word it is written onto, host first", () => {
    const result = lookupWord(french, languageOf("fr_en"), "l’homme");
    assert.deepStrictEqual(
      result.entries.map((entry) => entry.lemma),
      ["homme", "le"],
    );
    assert.deepStrictEqual(result.segments, [
      { text: "l’", entries: [1] },
      { text: "homme", entries: [0] },
    ]);
    // In a sentence, at its start, and before a name.
    assert.deepStrictEqual(
      lemmas(french, "fr_en", "D'une", "D'une part, l'eau.", 1),
      ["un", "de"],
    );
    assert.deepStrictEqual(lemmas(french, "fr_en", "L'Europe"), [
      "Europe",
      "le",
    ]);
  });

  it("splits a word Wiktionary lists only as a form of the elided word", () => {
    // `qu'il` is a form of `que`, which leaves out `il`.
    assert.deepStrictEqual(lemmas(french, "fr_en", "qu'il"), ["il", "que"]);
  });

  it("splits a word whose own entry only names its parts", () => {
    assert.deepStrictEqual(lemmas(french, "fr_en", "qu'on"), ["on", "que"]);
    // An entry that says what the word means stays.
    assert.deepStrictEqual(lemmas(french, "fr_en", "c'est"), ["c'est"]);
  });

  it("keeps a word with an entry of its own whole", () => {
    assert.deepStrictEqual(lemmas(french, "fr_en", "aujourd'hui"), [
      "aujourd'hui",
    ]);
    assert.deepStrictEqual(lemmas(french, "fr_en", "d’abord"), ["d'abord"]);
    // A part without an entry: nothing to split into.
    assert.deepStrictEqual(lemmas(french, "fr_en", "l'xyz"), []);
  });

  it("splits a noun made from a clause, its own entry last", () => {
    // `j'aime` is "a like", but "I like" in running text.
    const result = lookupWord(french, languageOf("fr_en"), "j'aime");
    assert.deepStrictEqual(
      result.entries.map((entry) => entry.lemma),
      ["aimer", "je", "j'aime"],
    );
    assert.deepStrictEqual(result.segments, [
      { text: "j'", entries: [1] },
      { text: "aime", entries: [0] },
    ]);
    // A noun whose host isn't a verb stays whole.
    assert.deepStrictEqual(lemmas(french, "fr_en", "presqu'île"), [
      "presqu'île",
    ]);
  });

  it("leaves languages without elision alone", () => {
    assert.deepStrictEqual(lemmas(french, "de_en", "l'homme"), []);
  });
});
