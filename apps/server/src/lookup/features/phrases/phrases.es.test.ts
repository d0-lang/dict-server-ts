import { assert, describe, it } from "@effect/vitest";
import { lemmas } from "../../testing/dictionary.ts";
import { spanish } from "../../testing/spanish.ts";

describe("Spanish phrases ending in a contracted word", () => {
  it("match de and a merged with the article (del, al)", () => {
    assert.deepStrictEqual(
      lemmas(spanish, "es_en", "partir", "A partir del siglo XV."),
      ["a partir de", "partir"],
    );
    assert.deepStrictEqual(
      lemmas(spanish, "es_en", "torno", "Se formó en torno al gobierno."),
      ["en torno a", "torno"],
    );
  });

  it("don't match a word that is no contraction of the last word", () => {
    assert.deepStrictEqual(
      lemmas(spanish, "es_en", "torno", "Se formó en torno el gobierno."),
      ["torno"],
    );
  });
});
