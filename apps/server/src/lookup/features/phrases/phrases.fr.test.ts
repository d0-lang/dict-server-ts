import { assert, describe, it } from "@effect/vitest";
import { lemmas } from "../../testing/dictionary.ts";
import { french } from "../../testing/french.ts";

describe("phrases ending in a contracted word", () => {
  it("match the preposition merged with the article", () => {
    assert.deepStrictEqual(
      lemmas(french, "fr_en", "partir", "À partir du siècle suivant."),
      ["à partir de", "partir"],
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

  it("leave languages without contractions alone", () => {
    assert.deepStrictEqual(
      lemmas(french, "de_en", "partir", "À partir du siècle suivant."),
      ["partir"],
    );
  });
});
