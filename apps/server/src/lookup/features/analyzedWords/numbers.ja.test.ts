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
    // another word that 人 also spells: no counter of 3人
    ["んちゅ", "X", ["人"], ["person (Okinawan)"], "suffix"],
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
    ["分", "X", [], ["minutes"], "counter", undefined, "ふん"],
    ["十分", "ADJ", [], ["enough"], "adj", undefined, "じゅうぶん"],
    [
      "十分",
      "NOUN",
      [],
      ["division into ten equal parts"],
      "noun",
      undefined,
      "じゅうぶん",
    ],
    ["十分", "NOUN", [], ["ten minutes"], "noun", undefined, "じっぷん"],
    ["番", "X", [], ["-th"], "counter", undefined, "ばん"],
    ["一番", "ADV", [], ["most"], "adv", undefined, "いちばん"],
    ["一番", "NOUN", [], ["number one"], "noun", undefined, "いちばん"],
    ["一番", "NOUN", [], ["a pair"], "noun", undefined, "ひとつがい"],
    ["節", "X", [], ["verses"], "counter", undefined, "せつ"],
    ["七", "NUM", [], ["seven"], "num", undefined, "なな"],
    ["七節", "NOUN", [], ["a stick insect"], "noun", undefined, "ななふし"],
    ["四月一日", "PROPN", [], ["a surname"], "name", undefined, "わたぬき"],
    ["四月", "NOUN", [], ["April"], "noun", undefined, "しがつ"],
    ["日", "X", [], ["day of the month"], "counter", undefined, "にち"],
    ["G", "NOUN", [], ["gravity"], "noun", undefined, "ジー"],
    ["グラム", "NOUN", ["g"], ["gram"], "noun"],
    ["グラム", "X", ["g"], ["gram"], "counter"],
    [
      "第二次世界大戦",
      "PROPN",
      [],
      ["World War II"],
      "name",
      undefined,
      "だいにじせかいたいせん",
    ],
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
        .senses[0]!.glosses[0],
      "-th",
    );
    assert.deepStrictEqual(shown("つ", "じゃあ3つ目。").entries, ["つ"]);
  });

  it("finds a unit in Latin letters by its spelling, not as the letter is read", () => {
    // the analyzer reads `g` as ジー, which is the entry for gravity alone
    assert.deepStrictEqual(shown("28g", "重さは28gです。"), {
      entries: ["グラム", "G ジー", "グラム"],
      segments: ["28: ", "g: グラム, G, グラム"],
    });
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

  it("shows a word written with digits by the entries of its number", () => {
    // 十分 is mostly "enough"; 10分 is always ten minutes, read じっぷん
    assert.deepStrictEqual(shown("分", "10分待った。").entries, [
      "十分 じっぷん 10分",
      "分 ふん",
      "十 じゅう",
    ]);
    // written in kanji, every entry of the word answers
    assert.include(
      lookupWord(numbers, language, "十分", "十分です。", 1).entries.flatMap(
        (entry) => entry.senses.flatMap((sense) => sense.glosses),
      ),
      "enough",
    );
    // the other entries read like the number's are the same word: 一番
    // "number one" and "most", not ひとつがい "a pair"
    assert.deepStrictEqual(
      lookupWord(numbers, language, "番", "1番好きだ。", 1)
        .entries.filter((entry) => entry.lemma === "一番")
        .map((entry) => `${entry.pos} ${entry.pron?.reading}`),
      ["NOUN いちばん", "ADV いちばん"],
    );
    // no entry about a number: the number and its counter
    assert.deepStrictEqual(shown("節", "第7節を読む。").entries, ["節 せつ"]);
    // a month is one
    assert.strictEqual(
      shown("月", "4月に行く。").entries[0],
      "四月 しがつ 4月",
    );
  });

  it("takes no name for a date, and a name read with its number", () => {
    // 四月一日 the surname is read わたぬき, with no four and no one in it
    assert.strictEqual(shown("日", "4月1日に会う。").entries[0], "日 にち");
    assert.strictEqual(
      shown("月", "4月1日に会う。").entries[0],
      "四月 しがつ 4月",
    );
    assert.strictEqual(
      shown("世界", "第2次世界大戦が終わった。").entries[0],
      "第二次世界大戦 だいにじせかいたいせん 第2次世界大戦",
    );
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
