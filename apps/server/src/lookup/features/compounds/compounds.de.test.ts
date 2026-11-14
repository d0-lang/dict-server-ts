import { assert, describe, it } from "@effect/vitest";
import { lookupWord } from "../../lookup.ts";
import { dictionary, languageOf, lemmas } from "../../testing/dictionary.ts";
import { german } from "../../testing/german.ts";

describe("segments", () => {
  it("splits a compound into parts as written", () => {
    assert.deepStrictEqual(
      lookupWord(german, languageOf("de_en"), "Gemüsefonds"),
      {
        entries: [
          {
            lemma: "Gemüse",
            pos: "NOUN",
            senses: [{ glosses: ["[Gemüse]"] }],
          },
          {
            lemma: "Fonds",
            pos: "NOUN",
            senses: [{ glosses: ["[Fonds]"] }],
          },
        ],
        segments: [
          { text: "Gemüse", entries: [0] },
          { text: "fonds", entries: [1] },
        ],
      },
    );
  });

  it("reads a modifier as a noun with a linker before a verb", () => {
    const db = dictionary([
      ["spitzen", "VERB"],
      ["Spitze", "NOUN", ["spitzen"]],
      ["Gastronomie", "NOUN"],
    ]);
    assert.deepStrictEqual(
      lookupWord(db, languageOf("de_en"), "Spitzengastronomie").segments,
      [
        { text: "Spitze", entries: [0] },
        { text: "n" },
        { text: "gastronomie", entries: [1] },
      ],
    );
    assert.deepStrictEqual(lemmas(db, "de_en", "Spitzengastronomie"), [
      "Spitze",
      "Gastronomie",
    ]);
  });

  it("explains a modifier by its prefix entry when it has one", () => {
    assert.deepStrictEqual(lemmas(german, "de_en", "Sonderausstellungen"), [
      "sonder-",
      "Ausstellung",
    ]);
  });

  it("reads a name's genitive as the name, not a compound", () => {
    assert.deepStrictEqual(lemmas(german, "de_en", "Dortmunds"), ["Dortmund"]);
    assert.strictEqual(
      lookupWord(german, languageOf("de_en"), "Dortmunds").segments,
      undefined,
    );
  });
});
