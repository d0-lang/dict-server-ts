import { assert, describe, it } from "@effect/vitest";
import { lookupWord } from "../../lookup.ts";
import { languageOf, lemmas } from "../../testing/dictionary.ts";
import { french } from "../../testing/french.ts";

describe("phrases ending in a contracted word", () => {
  it("match the preposition merged with the article", () => {
    assert.deepStrictEqual(
      lemmas(french, "fr_en", "partir", "À partir du siècle suivant."),
      ["à partir de", "partir"],
    );
    // Also from the merged word, which is no form of `de`.
    assert.deepStrictEqual(
      lemmas(french, "fr_en", "du", "À partir du siècle suivant."),
      ["à partir de", "du"],
    );
  });

  it("match an elided word written onto the next one", () => {
    assert.deepStrictEqual(
      lemmas(french, "fr_en", "parce", "Il part parce qu'on l'attend."),
      ["parce que", "parce"],
    );
    assert.deepStrictEqual(
      lemmas(french, "fr_en", "afin", "Il part tôt afin d’éviter la foule."),
      ["afin de", "afin"],
    );
  });

  it("match only as the phrase's last word", () => {
    // `du` stands for `de` only at the end: `du nouveau` is not `de nouveau`.
    assert.deepStrictEqual(
      lemmas(french, "fr_en", "nouveau", "Il y a du nouveau."),
      ["nouveau"],
    );
  });

  it("find a verb phrase whose rest is an elided content word, the verb apart", () => {
    assert.deepStrictEqual(
      lemmas(french, "fr_en", "a", "Il a toujours l'air content."),
      ["avoir l'air", "avoir"],
    );
  });

  it("match a first word written onto an elided word", () => {
    assert.deepStrictEqual(lemmas(french, "fr_en", "marre", "J'en ai marre."), [
      "en avoir marre",
      "marre",
    ]);
    assert.deepStrictEqual(lemmas(french, "fr_en", "veut", "Il m'en veut."), [
      "en vouloir",
      "vouloir",
    ]);
    // Clicked on the elided token, the match covers all of it.
    const result = lookupWord(
      french,
      languageOf("fr_en"),
      "J'en",
      "J'en ai marre.",
    );
    assert.deepStrictEqual(
      result.entries.map((entry) => entry.lemma),
      ["en avoir marre", "en", "je"],
    );
    assert.deepStrictEqual(result.entries[0]!.match, ["J'en ai marre"]);
    // Written apart, as before.
    assert.deepStrictEqual(lemmas(french, "fr_en", "marre", "Il en a marre."), [
      "en avoir marre",
      "marre",
    ]);
    // A phrase that joins its second word with a hyphen needs it so.
    assert.deepStrictEqual(
      lemmas(french, "fr_en", "que", "Est-ce que tu pars ?"),
      ["est-ce que", "que"],
    );
    assert.deepStrictEqual(
      lemmas(french, "fr_en", "que", "C'est ce que je dis."),
      ["que"],
    );
    // Without elision, `j'en` is no `en`.
    assert.deepStrictEqual(lemmas(french, "de_en", "marre", "J'en ai marre."), [
      "marre",
    ]);
  });

  it("leave languages without contractions alone", () => {
    assert.deepStrictEqual(
      lemmas(french, "de_en", "partir", "À partir du siècle suivant."),
      ["partir"],
    );
  });
});
