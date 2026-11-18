import { assert, describe, it } from "@effect/vitest";
import { lookupWord } from "../lookup.ts";
import { languageOf, lemmas } from "../testing/dictionary.ts";
import { russian } from "../testing/russian.ts";

/** The `match` of each entry of `word` clicked in `context`. */
const matches = (word: string, context: string) =>
  lookupWord(russian, languageOf("ru_en"), word, context, 1).entries.map(
    (entry) => entry.match,
  );

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
    // The affix explains the hyphen-joined word, which it underlines.
    assert.deepStrictEqual(matches("ка", "Поехали-ка домой."), [
      ["Поехали-ка"],
      undefined,
    ]);
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
    // It underlines the number with its ending, never just the ending.
    assert.deepStrictEqual(matches("го", "В матче 3-го тура выиграли гости."), [
      ["3-го"],
      undefined,
    ]);
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

  it("joins the clicked part only, when the client says which one (`at`)", () => {
    const context = "Шли на восток и северо-восток.";
    assert.deepStrictEqual(lemmas(russian, "ru_en", "восток", context, 1), [
      "восток",
    ]);
    assert.deepStrictEqual(lemmas(russian, "ru_en", "восток", context, 2), [
      "северо-восток",
      "восток",
    ]);
    // an `at` past the last copy is ignored
    assert.deepStrictEqual(lemmas(russian, "ru_en", "восток", context, 3), [
      "восток",
    ]);
  });
});
