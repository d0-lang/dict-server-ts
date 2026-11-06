import { assert, describe, it } from "@effect/vitest";
import { tokenize } from "./tokenize.ts";

describe("tokenize", () => {
  it("splits a word at a period between letters, as browsers do", () => {
    const tokens = tokenize("груши и т.д. лежали", "ru");
    assert.deepStrictEqual(
      tokens.map((token) => [token.key, token.dottedBefore]),
      [
        ["груши", false],
        ["и", false],
        ["т", false],
        ["д", true],
        // a period and a space, as after any abbreviation: the lookup decides
        ["лежали", true],
      ],
    );
  });

  it("normalizes words and splits clauses at punctuation", () => {
    const tokens = tokenize("Er ruft an, weil es eilt.", "de");
    assert.deepStrictEqual(
      tokens.map((token) => [token.key, token.clause]),
      [
        ["er", 0],
        ["ruft", 0],
        ["an", 0],
        ["weil", 1],
        ["es", 1],
        ["eilt", 1],
      ],
    );
  });
});
