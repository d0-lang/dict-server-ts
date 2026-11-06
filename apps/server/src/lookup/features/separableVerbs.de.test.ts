import { assert, describe, it } from "@effect/vitest";
import { lemmas } from "../testing/dictionary.ts";
import { german } from "../testing/german.ts";

describe("lookup with context", () => {
  it("finds a separable verb from either half", () => {
    const context = "Die Sitzung fand gestern in Berlin statt.";
    assert.deepStrictEqual(lemmas(german, "de_en", "fand", context), [
      "stattfinden",
      "finden",
    ]);
    assert.deepStrictEqual(lemmas(german, "de_en", "statt", context), [
      "stattfinden",
      "statt",
    ]);
  });

  it("keeps a separable verb together across a word with periods inside", () => {
    assert.deepStrictEqual(
      lemmas(german, "de_en", "fand", "Er fand in comp.os.minix statt."),
      ["stattfinden", "finden"],
    );
  });

  it("only takes a particle at the end of its clause", () => {
    assert.deepStrictEqual(
      lemmas(german, "de_en", "geht", "Er geht mit ihr ins Kino."),
      ["gehen"],
    );
    assert.deepStrictEqual(
      lemmas(german, "de_en", "fand", "Er fand statt Geld nur Steine."),
      ["finden"],
    );
  });
});
