import { assert, describe, it } from "@effect/vitest";
import { lookupWord } from "./lookup.ts";
import { dictionary, languageOf } from "./testing/dictionary.ts";

const german = dictionary([
  ["See", "NOUN", ["Sees", "Seen"], ["lake"], "noun", "Gender=Masc"],
  ["See", "NOUN", ["Seen"], ["sea"], "noun", "Gender=Fem"],
  // two Wiktionary etymologies, one headword
  ["Mutter", "NOUN", ["Mütter"], ["mother"], "noun", "Gender=Fem"],
  ["Mutter", "NOUN", ["Muttern"], ["nut (for a bolt)"], "noun", "Gender=Fem"],
  ["Bonbon", "NOUN", [], ["sweet"], "noun", "Gender=Masc,Neut"],
  ["Leute", "NOUN", [], ["people"], "noun", "Gender=Masc|Number=Ptan"],
  ["Hund", "NOUN", ["Hunde"], ["dog"], "noun", "Gender=Masc"],
  ["Köter", "NOUN", [], ["synonym of Hund"], "noun", "Gender=Masc"],
  ["gehen", "VERB", ["geht"], ["to go"], "verb"],
  ["die Alten", "NOUN", [], ["the elderly"], "noun", "Number=Ptan"],
]);
german.$client.run("UPDATE senses SET see = '[\"Hund\"]' WHERE entry_id = 8");

const lookup = (word: string) => lookupWord(german, languageOf("de_en"), word);

describe("German headwords", () => {
  it("puts the article into the lemma, one entry per gender", () => {
    assert.deepStrictEqual(
      lookup("Seen").entries.map((e) => [e.lemma, e.labels, e.senses.length]),
      [
        ["der See", undefined, 1],
        ["die See", undefined, 1],
      ],
    );
    assert.strictEqual(lookup("Bonbon").entries[0]!.lemma, "der/das Bonbon");
    assert.strictEqual(lookup("Leute").entries[0]!.lemma, "die Leute");
    assert.strictEqual(lookup("geht").entries[0]!.lemma, "gehen");
    // a lemma that already has its article keeps just that one
    assert.strictEqual(lookup("die Alten").entries[0]!.lemma, "die Alten");
  });

  it("merges entries with the same headword", () => {
    assert.deepStrictEqual(lookup("Mutter").entries, [
      {
        lemma: "die Mutter",
        pos: "NOUN",
        senses: [{ glosses: ["mother"] }, { glosses: ["nut (for a bolt)"] }],
      },
    ]);
  });

  it("names a see target by its headword, and finds it by that", () => {
    const [koter] = lookup("Köter").entries;
    assert.deepStrictEqual(koter!.senses[0]!.see, ["der Hund"]);
    assert.deepStrictEqual(
      lookup("der Hund").entries.map((e) => e.lemma),
      ["der Hund"],
    );
    assert.deepStrictEqual(
      lookup("die See").entries.map((e) => e.senses[0]!.glosses),
      [["sea"]],
    );
  });
});
