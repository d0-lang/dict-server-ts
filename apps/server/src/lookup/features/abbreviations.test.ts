import { assert, describe, it } from "@effect/vitest";
import { lemmas } from "../testing/dictionary.ts";
import { german } from "../testing/german.ts";
import { russian } from "../testing/russian.ts";

describe("lookup with context", () => {
  it("joins the pieces of an abbreviation a browser splits at its periods", () => {
    for (const context of [
      "Яблоки, груши и т.д. лежали на столе.",
      "Яблоки, груши и т. д. лежали на столе.",
    ]) {
      assert.deepStrictEqual(lemmas(russian, "ru_en", "т", context), [
        "и т. д.",
        "т",
      ]);
      assert.deepStrictEqual(lemmas(russian, "ru_en", "д", context), [
        "и т. д.",
        "д",
      ]);
    }
    assert.deepStrictEqual(lemmas(german, "de_en", "z", "Obst, z.B. Äpfel."), [
      "z. B.",
    ]);
    // an initial before a name isn't an abbreviation the dictionary has
    assert.deepStrictEqual(
      lemmas(russian, "ru_en", "т", "Т.Голикова: добрый день!"),
      ["т"],
    );
  });
});
