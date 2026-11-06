import { assert, describe, it } from "@effect/vitest";
import { lemmas } from "../../testing/dictionary.ts";
import { russian } from "../../testing/russian.ts";

describe("lookup with context", () => {
  it("inflects the verb of an untyped phrase, but not of a proverb", () => {
    assert.deepStrictEqual(
      lemmas(russian, "ru_en", "стелили", "Родители всегда стелили соломку."),
      ["стелить соломку", "стелить"],
    );
    assert.deepStrictEqual(
      lemmas(russian, "ru_en", "знала", "Щука знала свою науку."),
      ["знать"],
    );
  });

  it("allows two words between a verb and the rest in Russian", () => {
    assert.deepStrictEqual(
      lemmas(russian, "ru_en", "дашь", "Ты дашь мне честное слово?"),
      ["дать слово", "дать"],
    );
    assert.deepStrictEqual(
      lemmas(russian, "ru_en", "дашь", "Ты дашь мне очень честное слово?"),
      ["дать"],
    );
    // With the verb twice, the nearer one counts.
    assert.deepStrictEqual(
      lemmas(
        russian,
        "ru_en",
        "слово",
        "Он дал ему хлеб и дал мне честное слово.",
      ),
      ["дать слово", "слово"],
    );
  });

  it("lets a comma split a long conjunction before its last word", () => {
    assert.deepStrictEqual(
      lemmas(russian, "ru_en", "того", "Он ушёл после того, как стемнело."),
      ["после того как", "того"],
    );
    // In a two-word one, the comma makes two words: "the way that", not "because".
    assert.deepStrictEqual(
      lemmas(russian, "ru_en", "так", "Сделай так, как я сказал."),
      ["так"],
    );
  });

  it("takes a negated verb phrase with its object in another case", () => {
    assert.deepStrictEqual(
      lemmas(russian, "ru_en", "значения", "Это не имеет значения."),
      ["иметь значение", "значение"],
    );
    // The negation doesn't count as a word between the verb and the rest.
    assert.deepStrictEqual(
      lemmas(russian, "ru_en", "слова", "Я слова никому не давал."),
      ["давать слово", "слово"],
    );
    // A helper verb may stand between the negation and the verb.
    assert.deepStrictEqual(
      lemmas(russian, "ru_en", "значения", "Это не будет иметь значения."),
      ["иметь значение", "значение"],
    );
    // Only the verb the match uses counts as negated.
    assert.deepStrictEqual(
      lemmas(russian, "ru_en", "примеры", "Он не брал денег и брал примеры."),
      ["пример"],
    );
    // Without the negation, the object keeps the phrase's own form.
    assert.deepStrictEqual(
      lemmas(russian, "ru_en", "значения", "Он имел значения слов."),
      ["значение"],
    );
  });

  it("doesn't let a phrase take one part of a hyphenated word", () => {
    assert.deepStrictEqual(
      lemmas(russian, "ru_en", "есть", "Кто-то есть дома?"),
      ["есть"],
    );
    assert.deepStrictEqual(
      lemmas(russian, "ru_en", "есть", "Он устал, то есть хочет спать."),
      ["то есть", "есть"],
    );
  });
});
