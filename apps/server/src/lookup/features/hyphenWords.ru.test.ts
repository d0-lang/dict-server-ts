import { assert, describe, it } from "@effect/vitest";
import { lemmas } from "../testing/dictionary.ts";
import { russian } from "../testing/russian.ts";

describe("lookup with context", () => {
  it("joins the parts of a Russian hyphenated word, inflected or not", () => {
    const context = "Позови кого-нибудь, пусть поможет.";
    assert.deepStrictEqual(lemmas(russian, "ru_en", "кого", context), [
      "кто-нибудь",
      "кто",
    ]);
    assert.deepStrictEqual(lemmas(russian, "ru_en", "нибудь", context), [
      "кто-нибудь",
    ]);
    // No form for the inflected word: its parts as lemmas.
    assert.deepStrictEqual(
      lemmas(
        russian,
        "ru_en",
        "одним",
        "Это сделал одним-единственным ударом.",
      ),
      ["один-единственный", "один"],
    );
  });

  it("falls back to a hyphen affix only beside a word", () => {
    assert.deepStrictEqual(
      lemmas(russian, "ru_en", "ка", "Поехали-ка домой."),
      ["-ка", "ка"],
    );
    assert.deepStrictEqual(
      lemmas(russian, "ru_en", "е", "Это было в 1990-е годы."),
      ["е"],
    );
  });

  it("explains an ending after a number with the grammar file's line", () => {
    assert.deepStrictEqual(
      lemmas(russian, "ru_en", "го", "В матче 3-го тура выиграли гости."),
      ["-го", "го"],
    );
    // not without the number
    assert.deepStrictEqual(lemmas(russian, "ru_en", "го", "Они играли в го."), [
      "го",
    ]);
    // nor as the hyphen affix of a word that isn't a number
    assert.deepStrictEqual(lemmas(russian, "ru_en", "ой", "О-ой, какие!"), [
      "ой",
    ]);
  });

  it("leaves a word as it is when it also stands alone in the context", () => {
    assert.deepStrictEqual(
      lemmas(russian, "ru_en", "восток", "Ветер дул на северо-восток."),
      ["северо-восток", "восток"],
    );
    assert.deepStrictEqual(
      lemmas(russian, "ru_en", "восток", "Шли на восток и северо-восток."),
      ["восток"],
    );
  });
});
