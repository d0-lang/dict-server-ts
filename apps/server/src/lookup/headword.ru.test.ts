import { assert, describe, it } from "@effect/vitest";
import { lookupWord } from "./lookup.ts";
import { dictionary, languageOf } from "./testing/dictionary.ts";

const russian = dictionary([
  ["ки́ви", "NOUN", [], ["kiwi (fruit)"], "noun", "Animacy=Inan|Gender=Neut"],
  ["ки́ви", "NOUN", [], ["kiwi (bird)"], "noun", "Animacy=Anim|Gender=Fem"],
  ["соба́ка", "NOUN", ["соба́ки"], ["dog"], "noun", "Animacy=Anim|Gender=Fem"],
  [
    "псина",
    "NOUN",
    [],
    ["synonym of собака"],
    "noun",
    "Animacy=Anim|Gender=Fem",
  ],
  ["сде́лать", "VERB", [], ["to do"], "verb", "Aspect=Perf"],
  ["испо́льзовать", "VERB", [], ["to use"], "verb", "Aspect=Imp,Perf"],
]);
russian.$client.run(
  "UPDATE senses SET see = '[\"собака\"]' WHERE entry_id = 4",
);

const lookup = (word: string) => lookupWord(russian, languageOf("ru_en"), word);

describe("Russian headwords", () => {
  it("shows grammar as labels, one entry per grammar", () => {
    assert.deepStrictEqual(
      lookup("киви").entries.map((e) => [e.lemma, e.labels]),
      [
        ["ки́ви", ["n", "inan"]],
        ["ки́ви", ["f", "anim"]],
      ],
    );
    assert.deepStrictEqual(lookup("сделать").entries[0]!.labels, ["pf"]);
    assert.deepStrictEqual(lookup("использовать").entries[0]!.labels, [
      "impf/pf",
    ]);
  });

  it("writes a see target as its headword, stress included", () => {
    assert.deepStrictEqual(lookup("псина").entries[0]!.senses[0]!.see, [
      "соба́ка",
    ]);
    assert.deepStrictEqual(
      lookup("соба́ка").entries.map((e) => e.lemma),
      ["соба́ка"],
    );
  });
});
