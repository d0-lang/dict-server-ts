import { assert, describe, it } from "@effect/vitest";
import { positionsOf, tokenize } from "./tokenize.ts";

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

  it("records where each word is in the text", () => {
    const text = "Er fand gestern statt.";
    assert.deepStrictEqual(
      tokenize(text, "de").map((t) => text.slice(t.start, t.end)),
      ["Er", "fand", "gestern", "statt"],
    );
  });

  it("finds the clicked copy, counting copies inside other words too", () => {
    const context = "Этот который кот, и кот.";
    const tokens = tokenize(context, "ru");
    // the 1st copy of `кот` is inside `который`, the 2nd and 3rd are words
    assert.deepStrictEqual(
      positionsOf(tokens, "кот", "ru", { context, at: 2 }),
      [2],
    );
    assert.deepStrictEqual(
      positionsOf(tokens, "кот", "ru", { context, at: 3 }),
      [4],
    );
    // a copy inside another word is no click on `кот`: every occurrence counts
    assert.deepStrictEqual(
      positionsOf(tokens, "кот", "ru", { context, at: 1 }),
      [2, 4],
    );
    assert.deepStrictEqual(positionsOf(tokens, "кот", "ru"), [2, 4]);
  });
});
