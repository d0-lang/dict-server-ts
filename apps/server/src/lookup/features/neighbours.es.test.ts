import { assert, describe, it } from "@effect/vitest";
import { lookupWord } from "../lookup.ts";
import { languageOf, lemmas } from "../testing/dictionary.ts";
import { spanish } from "../testing/spanish.ts";

const posOf = (word: string, context?: string) =>
  lookupWord(spanish, languageOf("es_en"), word, context).entries.map(
    (entry) => `${entry.lemma} ${entry.pos}`,
  );

describe("the neighbouring word orders a Spanish word's entries", () => {
  it("puts the verb first after an object pronoun or yo", () => {
    assert.deepStrictEqual(
      lemmas(spanish, "es_en", "trata", "Se trata de un error."),
      ["tratar", "trata"],
    );
    assert.deepStrictEqual(lemmas(spanish, "es_en", "como", "Yo como pan."), [
      "comer",
      "como",
    ]);
    assert.deepStrictEqual(lemmas(spanish, "es_en", "trata"), [
      "trata",
      "tratar",
    ]);
  });

  it("leaves the word after no, or after a pronoun that follows a preposition", () => {
    // `no` also negates words that aren't verbs.
    assert.deepStrictEqual(
      lemmas(spanish, "es_en", "como", "Triunfó no como obra seria."),
      ["como", "comer"],
    );
    assert.deepStrictEqual(
      lemmas(spanish, "es_en", "uno", "Entre ellos uno que derogaba la ley."),
      ["uno", "unir"],
    );
  });

  it("puts the verb last after a determiner", () => {
    assert.deepStrictEqual(posOf("poder", "Asume el poder."), [
      "poder NOUN",
      "poder VERB",
    ]);
    assert.deepStrictEqual(posOf("poder", "Conserva la fianza en su poder."), [
      "poder NOUN",
      "poder VERB",
    ]);
  });

  it("puts the verb before the noun for a participle after haber", () => {
    assert.deepStrictEqual(
      lemmas(spanish, "es_en", "estado", "He estado en casa."),
      ["estar", "estado"],
    );
    assert.deepStrictEqual(
      lemmas(spanish, "es_en", "estado", "El estado de la nación."),
      ["estado", "estar"],
    );
  });
});
