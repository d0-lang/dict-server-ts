import { assert, describe, it } from "@effect/vitest";
import { lookupWord } from "../../lookup.ts";
import { dictionary, languageOf, lemmas } from "../../testing/dictionary.ts";
import { german } from "../../testing/german.ts";

describe("lookup with context", () => {
  it("puts a phrase the word is part of first", () => {
    const context = "Vor allem die Kinder.";
    assert.deepStrictEqual(lemmas(german, "de_en", "Vor", context), [
      "vor allem",
      "vor",
    ]);
    assert.deepStrictEqual(lemmas(german, "de_en", "allem", context), [
      "vor allem",
      "allem",
    ]);
  });

  it("finds a phrase written with sich by any reflexive pronoun", () => {
    assert.deepStrictEqual(
      lemmas(german, "de_en", "mache", "Ich mache mir Sorgen."),
      ["sich Sorgen machen", "machen"],
    );
  });

  it("takes the reflexive phrases are written with from the language record", () => {
    // A language whose phrases are written with `zich`, as Dutch's are.
    const german = languageOf("de_en");
    const language = {
      ...german,
      context: {
        ...german.context,
        reflexive: "zich",
        reflexives: ["zich", "me"],
      },
    };
    const db = dictionary([
      ["maken", "VERB", ["maak"]],
      ["zorg", "NOUN", ["zorgen"]],
      ["zich", "PRON"],
      ["me", "PRON"],
      ["zich zorgen maken", "VERB"],
    ]);
    assert.deepStrictEqual(
      lookupWord(db, language, "maak", "Ik maak me zorgen.", 1).entries.map(
        (entry) => entry.lemma,
      ),
      ["zich zorgen maken", "maken"],
    );
  });

  it("finds a verb phrase whose verb comes first", () => {
    const context = "Das Gesetz tritt morgen in Kraft.";
    assert.deepStrictEqual(lemmas(german, "de_en", "tritt", context), [
      "in Kraft treten",
      "treten",
    ]);
    assert.deepStrictEqual(lemmas(german, "de_en", "Kraft", context), [
      "in Kraft treten",
      "Kraft",
    ]);
  });

  it("keeps a German verb phrase together at the end of its clause", () => {
    assert.deepStrictEqual(
      lemmas(german, "de_en", "ist", "Er ist an der Uni."),
      ["sein"],
    );
    assert.deepStrictEqual(
      lemmas(german, "de_en", "ist", "Das Licht ist an."),
      ["an sein", "sein"],
    );
    assert.deepStrictEqual(
      lemmas(
        german,
        "de_en",
        "haben",
        "Es ist ein Schwein und möchte einen hellen Fonds haben.",
      ),
      ["haben"],
    );
  });

  it("keeps a German untyped phrase out of the verb bracket", () => {
    // Its rest needn't end the clause, as a separable verb's must.
    assert.deepStrictEqual(
      lemmas(german, "de_en", "heißen", "Wie heißen Sie eigentlich?"),
      ["wie heißen Sie", "heißen"],
    );
  });
});
