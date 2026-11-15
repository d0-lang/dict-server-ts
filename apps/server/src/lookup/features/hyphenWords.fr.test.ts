import { assert, describe, it } from "@effect/vitest";
import { lemmas } from "../testing/dictionary.ts";
import { french } from "../testing/french.ts";

describe("hyphen affixes", () => {
  it("explain a particle after a hyphen by the grammar file's line", () => {
    assert.deepStrictEqual(
      lemmas(french, "fr_en", "là", "Ces articles-là sont bons."),
      ["-là", "là"],
    );
  });
});
