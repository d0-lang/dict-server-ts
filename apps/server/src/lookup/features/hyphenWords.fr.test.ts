import { assert, describe, it } from "@effect/vitest";
import { lookupWord } from "../lookup.ts";
import { languageOf, lemmas } from "../testing/dictionary.ts";
import { french } from "../testing/french.ts";

describe("hyphen affixes", () => {
  it("explain a particle after a hyphen by the grammar file's line", () => {
    assert.deepStrictEqual(
      lemmas(french, "fr_en", "là", "Ces articles-là sont bons."),
      ["-là", "là"],
    );
    // It underlines the word it follows with it, never just itself.
    assert.deepStrictEqual(
      lookupWord(
        french,
        languageOf("fr_en"),
        "là",
        "Ces articles-là sont bons.",
        1,
      ).entries.map((entry) => entry.match),
      [["articles-là"], undefined],
    );
  });
});
