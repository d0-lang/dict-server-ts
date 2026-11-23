import { assert, describe, it } from "@effect/vitest";
import { lookupWord } from "../lookup.ts";
import { dictionary, languageOf, lemmas } from "../testing/dictionary.ts";
import { french } from "../testing/french.ts";

describe("the neighbouring word orders the word's entries", () => {
  it("puts the verb first after a subject or the negation", () => {
    assert.deepStrictEqual(
      lemmas(french, "fr_en", "passe", "Il faut que je passe."),
      ["passer", "passe"],
    );
    // After an elided token, the word before is its host: `il` of `qu'il`.
    assert.deepStrictEqual(
      lemmas(french, "fr_en", "passe", "Je crois qu'il passe."),
      ["passer", "passe"],
    );
    // Without context, after another word, or across a clause break, the
    // noun stays first.
    assert.deepStrictEqual(lemmas(french, "fr_en", "passe"), [
      "passe",
      "passer",
    ]);
    assert.deepStrictEqual(lemmas(french, "fr_en", "passe", "Une passe."), [
      "passe",
      "passer",
    ]);
    assert.deepStrictEqual(
      lemmas(french, "fr_en", "passe", "Moi, je. Passe la balle."),
      ["passe", "passer"],
    );
  });

  it("leaves a pronoun that stands before the verb", () => {
    assert.deepStrictEqual(lemmas(french, "fr_en", "lui", "Il lui dit non."), [
      "lui",
      "luire",
    ]);
  });

  it("reads the elided word of the clicked token as the word before its host", () => {
    const result = lookupWord(
      french,
      languageOf("fr_en"),
      "N'oublie",
      "N'oublie pas.",
    );
    assert.deepStrictEqual(
      result.entries.map((entry) => entry.lemma),
      ["oublier", "oublie", "ne"],
    );
    assert.deepStrictEqual(result.segments, [
      { text: "N'", entries: [2] },
      { text: "oublie", entries: [0, 1] },
    ]);
  });

  it("puts the verb first before a hyphen-joined pronoun", () => {
    assert.deepStrictEqual(
      lemmas(french, "fr_en", "Donne", "Donne-moi le livre."),
      ["donner", "donne"],
    );
    // The verb `dit` "called" is the word itself: the verb it is a form of
    // comes first.
    assert.deepStrictEqual(lemmas(french, "fr_en", "dit", "« Non », dit-il."), [
      "dire",
      "dit",
      "dit",
    ]);
  });

  it("keeps a grammar line that points at its verb before that verb", () => {
    const db = dictionary([
      ["va", "VERB", [], ["goes"], "grammar"],
      ["aller", "VERB", ["va"], ["to go"]],
    ]);
    db.$client.run(`UPDATE senses SET see = '["aller"]' WHERE entry_id = 1`);
    assert.deepStrictEqual(lemmas(db, "fr_en", "va", "On va partir."), [
      "va",
      "aller",
    ]);
  });

  it("puts the verb last after a determiner", () => {
    assert.deepStrictEqual(
      lemmas(french, "fr_en", "mesures", "Il prend des mesures."),
      ["mesure", "mesurer"],
    );
    // Only verbs move: the adjective stays before the noun.
    assert.deepStrictEqual(
      lookupWord(
        french,
        languageOf("fr_en"),
        "petit",
        "Des petit chiens.",
      ).entries.map((entry) => entry.pos),
      ["ADJ", "NOUN"],
    );
  });

  it("puts a past participle's verb before its nouns after an auxiliary", () => {
    assert.deepStrictEqual(
      lemmas(french, "fr_en", "partie", "Elle est déjà partie."),
      ["partir", "partie"],
    );
    // After `j'ai`, the word before is `ai`. The verb passes nouns only, not
    // the adjective.
    assert.deepStrictEqual(
      lookupWord(
        french,
        languageOf("fr_en"),
        "fait",
        "J'ai fait ça.",
      ).entries.map((entry) => `${entry.lemma} ${entry.pos}`),
      ["fait ADJ", "faire VERB", "fait NOUN"],
    );
    // Nor the verb `dit` "called", whose lemma the word is.
    assert.deepStrictEqual(lemmas(french, "fr_en", "dit", "J'ai dit non."), [
      "dire",
      "dit",
      "dit",
    ]);
    // `envi` is no form of `envier`, so `envie` is no participle; `désolé`
    // has no noun for the verb to pass.
    assert.deepStrictEqual(
      lemmas(french, "fr_en", "envie", "J'ai envie de partir."),
      ["envie", "envier"],
    );
    assert.deepStrictEqual(
      lemmas(french, "fr_en", "désolé", "Je suis désolé."),
      ["désolé", "désoler"],
    );
  });

  it("leaves languages without the hints alone", () => {
    assert.deepStrictEqual(
      lemmas(french, "de_en", "passe", "Il faut que je passe."),
      ["passe", "passer"],
    );
  });
});
