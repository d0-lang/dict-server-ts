import { assert, describe, it } from "@effect/vitest";
import { lemmas } from "../testing/dictionary.ts";
import { german } from "../testing/german.ts";

describe("lookup with context", () => {
  it("finds a separable verb from either half", () => {
    const context = "Die Sitzung fand gestern in Berlin statt.";
    assert.deepStrictEqual(lemmas(german, "de_en", "fand", context), [
      "stattfinden",
      "finden",
    ]);
    assert.deepStrictEqual(lemmas(german, "de_en", "statt", context), [
      "stattfinden",
      "statt",
    ]);
  });

  it("keeps a separable verb together across a word with periods inside", () => {
    assert.deepStrictEqual(
      lemmas(german, "de_en", "fand", "Er fand in comp.os.minix statt."),
      ["stattfinden", "finden"],
    );
  });

  it("only takes a particle at the end of its clause", () => {
    assert.deepStrictEqual(
      lemmas(german, "de_en", "geht", "Er geht mit ihr ins Kino."),
      ["gehen"],
    );
    assert.deepStrictEqual(
      lemmas(german, "de_en", "fand", "Er fand statt Geld nur Steine."),
      ["finden"],
    );
  });

  it("looks past an und that joins two words inside the clause", () => {
    const context =
      "Die Länder wirken bei der Gesetzgebung und Verwaltung mit.";
    assert.deepStrictEqual(lemmas(german, "de_en", "wirken", context), [
      "mitwirken",
      "wirken",
    ]);
  });

  it("ignores words inside the clause that look like verb forms", () => {
    // `deutsche ein` is also a form of `eindeutschen`
    assert.deepStrictEqual(
      lemmas(
        german,
        "de_en",
        "lenkt",
        "Schließlich lenkt die deutsche Regierung ein.",
      ),
      ["einlenken", "lenken"],
    );
  });

  it("takes no capitalised word inside the sentence for the verb", () => {
    const context = "Er sah die Spiele mit Freunden an.";
    assert.deepStrictEqual(lemmas(german, "de_en", "Spiele", context), [
      "Spiel",
      "spielen",
    ]);
    assert.deepStrictEqual(
      lemmas(german, "de_en", "spielt", "Er spielt die Spiele an."),
      ["anspielen", "spielen"],
    );
    // nor for the particle
    assert.deepStrictEqual(
      lemmas(german, "de_en", "habe", "Ich habe das Handy in der Hand."),
      ["haben"],
    );
  });

  it("leaves a particle past a conjunction to a verb after it", () => {
    assert.deepStrictEqual(
      lemmas(
        german,
        "de_en",
        "geht",
        "Er geht nach Hause und kommt morgen mit.",
      ),
      ["gehen"],
    );
    assert.deepStrictEqual(
      lemmas(
        german,
        "de_en",
        "kommt",
        "Er geht nach Hause und kommt morgen mit.",
      ),
      ["mitkommen", "kommen"],
    );
  });
});
