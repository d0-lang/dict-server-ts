import { assert, describe, it } from "@effect/vitest";
import { pairLabels } from "./labels.ts";
import { dictionary, languageOf } from "./testing/dictionary.ts";

describe("pairLabels", () => {
  it("leaves out the gender German shows as the article", () => {
    const db = dictionary([
      ["Mutter", "NOUN", [], ["mother"], "noun", "Gender=Fem"],
      ["Leute", "NOUN", [], ["people"], "noun", "Number=Ptan"],
      ["Bonbon", "NOUN", [], ["sweet"], "noun", "Gender=Masc,Neut"],
      // a lemma with its article already: the gender is a label there
      ["die Alten", "NOUN", [], ["the elderly"], "noun", "Gender=Fem"],
    ]);
    assert.deepStrictEqual(pairLabels(db, languageOf("de_en")), {
      f: { name: "feminine" },
    });
    assert.deepStrictEqual(
      pairLabels(
        dictionary([["Mutter", "NOUN", [], ["mother"], "noun", "Gender=Fem"]]),
        languageOf("de_en"),
      ),
      {},
    );
  });
});
