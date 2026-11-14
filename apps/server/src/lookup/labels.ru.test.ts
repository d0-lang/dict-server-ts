import { assert, describe, it } from "@effect/vitest";
import { pairLabels } from "./labels.ts";
import { dictionary, languageOf } from "./testing/dictionary.ts";

describe("pairLabels", () => {
  it("explains the labels a Russian lookup can show, and no others", () => {
    const db = dictionary([
      ["соба́ка", "NOUN", [], ["dog"], "noun", "Animacy=Anim|Gender=Fem"],
      ["написать", "VERB", [], ["to write"], "verb", "Aspect=Perf"],
      ["жениться", "VERB", [], ["to marry"], "verb", "Aspect=Imp,Perf"],
      [
        "сирота",
        "NOUN",
        [],
        ["orphan"],
        "noun",
        "Animacy=Anim|Gender=Masc,Fem",
      ],
      ["и", "CCONJ"],
    ]);
    const labels = pairLabels(db, languageOf("ru_en"));
    assert.deepStrictEqual(Object.keys(labels), [
      "anim",
      "f",
      "impf/pf",
      "m/f",
      "pf",
    ]);
    assert.strictEqual(labels["anim"]!.name, "animate");
    assert.include(labels["anim"]!.text!, "вижу брата");
    assert.deepStrictEqual(labels["m/f"], { name: "masculine or feminine" });
  });
});
