import { assert, describe, it } from "@effect/vitest";
import { lookupWord } from "../../lookup.ts";
import { dictionary, languageOf } from "../../testing/dictionary.ts";
import { inNumerals } from "./numbers.ts";

/**
 * Numbers with counters, on a dictionary with readings: what a browser's
 * segmenter gives is `3|人`, `10|月`, `5|冊`.
 */
describe("numbers and their counters", () => {
  const numbers = dictionary([
    ["十", "NUM", [], ["ten"], "num", undefined, "じゅう"],
    ["一", "NUM", [], ["one"], "num", undefined, "いち"],
    ["一", "PROPN", [], ["a surname"], "name", undefined, "いち"],
    ["五", "NOUN", [], ["five"], "noun", undefined, "いつ"],
    ["五", "NOUN", [], ["five"], "noun", undefined, "ご"],
    ["万", "NOUN", [], ["ten thousand"], "noun", undefined, "まん"],
    ["月", "NOUN", [], ["the Moon"], "noun", undefined, "つき"],
    ["月", "PROPN", [], ["a female given name"], "name", undefined, "つき"],
    ["月", "X", [], ["month of the year"], "suffix", undefined, "がつ"],
    ["十月", "NOUN", ["10月"], ["October"], "noun", undefined, "じゅうがつ"],
    ["人", "NOUN", [], ["a person"], "noun", undefined, "ひと"],
    ["人", "X", [], ["counter for people"], "counter", undefined, "にん"],
    ["二人", "NOUN", ["2人"], ["two people"], "noun", undefined, "ににん"],
    ["二人", "NOUN", ["2人"], ["two people"], "noun", undefined, "ふたり"],
    ["冊", "X", [], ["books"], "counter", undefined, "さつ"],
    ["年", "NOUN", [], ["a year"], "noun", undefined, "とし"],
    ["年", "X", [], ["years"], "counter", undefined, "ねん"],
    ["円", "NOUN", [], ["a circle"], "noun", undefined, "えん"],
    ["つ", "X", [], ["counter for things"], "counter"],
    ["つ", "SYM", [], ["a giving hand"], "symbol"],
    ["目", "NOUN", [], ["eye"], "noun", undefined, "め"],
    ["目", "X", [], ["-th"], "suffix", undefined, "め"],
  ]);
  const language = languageOf("ja_en");
  /** Each entry as `lemma reading`, and `match` when it has one. */
  const shown = (word: string, context?: string) => {
    const { entries, segments } = lookupWord(
      numbers,
      language,
      word,
      context,
      context === undefined ? undefined : 1,
    );
    return {
      entries: entries.map(
        (entry) =>
          `${entry.lemma} ${entry.pron?.reading ?? ""}`.trim() +
          (entry.match === undefined ? "" : ` ${entry.match.join("|")}`),
      ),
      segments: segments?.map(
        (segment) =>
          `${segment.text}: ${(segment.entries ?? []).map((i) => entries[i]!.lemma).join(", ")}`,
      ),
    };
  };

  it("reads a run of digits as one number, under its numerals", () => {
    // the analyzer: 1|0|月
    assert.deepStrictEqual(shown("月", "10月3日に会いましょう。"), {
      entries: ["十月 じゅうがつ 10月", "月 がつ", "月 つき", "十 じゅう"],
      segments: ["10: 十", "月: 月, 月"],
    });
  });

  it("puts the counter's reading and counter entries first, and no names", () => {
    assert.deepStrictEqual(shown("人", "学生が3人います。"), {
      entries: ["人 にん", "人 ひと"],
      segments: undefined,
    });
    assert.deepStrictEqual(shown("年", "1998年には始まった。").entries, [
      "年 ねん",
      "年 とし",
    ]);
    // a counter after a counter: the ordinal suffix, not "eye", and no symbol
    assert.deepStrictEqual(shown("目", "じゃあ3つ目。").entries, [
      "目 め",
      "目 め",
    ]);
    assert.strictEqual(
      lookupWord(numbers, language, "目", "じゃあ3つ目。", 1).entries[0]!
        .senses[0]!.translations[0],
      "-th",
    );
    assert.deepStrictEqual(shown("つ", "じゃあ3つ目。").entries, ["つ"]);
  });

  it("gives a number one entry, read as the analyzer reads it, or none", () => {
    assert.deepStrictEqual(shown("5", "本を5冊買った。").entries, ["五 ご"]);
    assert.deepStrictEqual(shown("1998", "1998年には始まった。").entries, []);
    // a numeral of a big number stands by itself (`2|万`)
    assert.deepStrictEqual(shown("万", "2万円のローファー。").entries, [
      "万 まん",
    ]);
  });

  it("underlines nothing when the dictionary has no entry for the whole", () => {
    assert.deepStrictEqual(shown("冊", "本を5冊買った。"), {
      entries: ["冊 さつ"],
      segments: undefined,
    });
  });

  it("takes the whole's irregular reading from the number written in numerals", () => {
    // the analyzer reads 2|人 as に + にん, and 二人 as ふたり
    assert.deepStrictEqual(shown("人", "2人で行った。").entries.slice(0, 2), [
      "二人 ふたり 2人",
      "二人 ににん 2人",
    ]);
  });

  it("splits a number and its counter without a sentence", () => {
    // the counter first, when the click covers it
    assert.deepStrictEqual(shown("5冊"), {
      entries: ["冊 さつ", "五 ご"],
      segments: ["5: 五", "冊: 冊"],
    });
    assert.deepStrictEqual(shown("1998年").segments, ["1998: ", "年: 年, 年"]);
  });

  it("writes digits as numerals", () => {
    const numerals = language.context.analyzer!.numerals!;
    assert.strictEqual(inNumerals("10", numerals), "十");
    assert.strictEqual(inNumerals("1998", numerals), "千九百九十八");
    assert.strictEqual(inNumerals("20000", numerals), "二万");
    assert.strictEqual(inNumerals("100000000", numerals), "一億");
    assert.strictEqual(inNumerals("0", numerals), "〇");
    assert.strictEqual(inNumerals("10月", numerals), "十月");
    assert.strictEqual(inNumerals("月", numerals), undefined);
    assert.strictEqual(inNumerals("1".repeat(17), numerals), undefined);
  });
});
