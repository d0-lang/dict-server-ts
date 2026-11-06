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
      senses: [{ translations: ["including"] }],
    });
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
