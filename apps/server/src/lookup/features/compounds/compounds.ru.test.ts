import { assert, describe, it } from "@effect/vitest";
import { lookupWord } from "../../lookup.ts";
import { languageOf, lemmas } from "../../testing/dictionary.ts";
import { russian } from "../../testing/russian.ts";

describe("segments", () => {
  it("splits a Russian compound into stems and a linker", () => {
    const parts = (word: string) =>
      lookupWord(russian, languageOf("ru_en"), word).segments?.map(
        (s) => s.text,
      );
    assert.deepStrictEqual(parts("лесонасаждения"), ["лес", "о", "насаждения"]);
    assert.deepStrictEqual(parts("нефтегазовая"), ["нефт", "е", "газовая"]);
    assert.deepStrictEqual(parts("киберкабаны"), ["кибер", "кабаны"]);
    assert.deepStrictEqual(lemmas(russian, "ru_en", "нефтегазовая"), [
      "нефть",
      "газовый",
    ]);
  });

  it("doesn't split a Russian name or a word with a three-letter head", () => {
    assert.deepStrictEqual(lemmas(russian, "ru_en", "Лесонасаждения"), []);
    // `-овой` is an adjective ending, not `о` + `вой` "howl".
    assert.deepStrictEqual(lemmas(russian, "ru_en", "ранговой"), []);
  });

  it("splits off a combining form but not a word-forming prefix", () => {
    // `кибер-` begins no verbs; `при-` begins mostly verbs, so `пристрелка`
    // isn't `при-` + `стрелка`.
    assert.deepStrictEqual(lemmas(russian, "ru_en", "киберкабаны"), [
      "кибер-",
      "кабан",
    ]);
    assert.deepStrictEqual(lemmas(russian, "ru_en", "пристрелка"), []);
  });
});
