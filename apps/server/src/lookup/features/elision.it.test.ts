import { assert, describe, it } from "@effect/vitest";
import { lemmas } from "../testing/dictionary.ts";
import { italian } from "../testing/italian.ts";

describe("Italian elision", () => {
  it("splits a word a surname is spelled like, the name after the split", () => {
    assert.deepStrictEqual(lemmas(italian, "it_en", "dell'acqua"), [
      "acqua",
      "dell'",
      "Dell'Acqua",
    ]);
    // At the start of a sentence too.
    assert.deepStrictEqual(lemmas(italian, "it_en", "Dell’anno"), [
      "anno",
      "dell'",
      "Dell'Anno",
    ]);
  });

  it("keeps the name whole when the text writes its capitals", () => {
    assert.deepStrictEqual(lemmas(italian, "it_en", "Dell'Acqua"), [
      "Dell'Acqua",
    ]);
    // A word with an entry of its own that is no name stays whole.
    assert.deepStrictEqual(lemmas(italian, "it_en", "quest'anno"), [
      "quest'anno",
    ]);
  });
});
