import { assert, describe, it } from "@effect/vitest";
import { lemmas } from "../../testing/dictionary.ts";
import { italian } from "../../testing/italian.ts";

describe("Italian phrases ending in a contracted word", () => {
  it("match a preposition merged with the article, elided or not", () => {
    assert.deepStrictEqual(
      lemmas(italian, "it_en", "causa", "Siamo rimasti a causa della pioggia."),
      ["a causa di", "causa"],
    );
    assert.deepStrictEqual(
      lemmas(italian, "it_en", "grazie", "Ce l'ha fatta grazie all'aiuto."),
      ["grazie a", "grazie"],
    );
  });

  it("don't match a word that is no contraction of the last word", () => {
    assert.deepStrictEqual(
      lemmas(italian, "it_en", "causa", "Siamo rimasti a causa la pioggia."),
      ["causa"],
    );
  });
});
