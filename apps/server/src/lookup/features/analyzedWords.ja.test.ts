import { assert, describe, it } from "@effect/vitest";
import { languageOf, lemmas } from "../testing/dictionary.ts";
import { dictionary } from "../testing/dictionary.ts";
import { japanese } from "../testing/japanese.ts";
import { FormSource } from "@dict/core/schema";
import { lookupWord } from "../lookup.ts";
import { inNumerals } from "./analyzedWords.ts";

const lookup = (word: string, context?: string) =>
  lookupWord(
    japanese,
    languageOf("ja_en"),
    word,
    context,
    context === undefined ? undefined : 1,
  );

/** The parts as `text: lemma, lemma`, for reading at a glance. */
const parts = (word: string, context: string) => {
  const { entries, segments } = lookup(word, context);
  return segments?.map(
    (segment) =>
      `${segment.text}: ${(segment.entries ?? []).map((i) => entries[i]!.lemma).join(", ")}`,
  );
};

describe("words found by the analyzer, in a script without spaces", () => {
  it("reads a piece the segmenter cut off as the whole inflected word", () => {
    // Intl.Segmenter: 食|べ|ま|した
    const context = "昨日、寿司を食べました。";
    for (const piece of ["食", "べ", "した"]) {
      const { entries } = lookup(piece, context);
      assert.strictEqual(entries[0]!.lemma, "食べる");
      assert.deepStrictEqual(entries[0]!.match, ["食べました"]);
    }
    assert.deepStrictEqual(parts("食", context), [
      "食べ: 食べ",
      "まし: ます",
      "た: た",
    ]);
  });

  it("joins a する-noun, the て form and the verb after it into one word", () => {
    // Intl.Segmenter: 勉強|し|てい|ます
    const context = "毎日、日本語を勉強しています。";
    const { entries } = lookup("し", context);
    assert.strictEqual(entries[0]!.lemma, "勉強");
    assert.strictEqual(entries[0]!.pos, "VERB");
    assert.deepStrictEqual(entries[0]!.match, ["勉強しています"]);
    assert.deepStrictEqual(parts("し", context), [
      "勉強: 勉強",
      "し: する",
      "て: て",
      "い: いる",
      "ます: ます",
    ]);
  });

  it("gives a piece cut across two words both, the one that holds most of it first", () => {
    // Intl.Segmenter: ありま|すか; the analyzer: あり|ます, か
    const context = "東京に行ったことがありますか。";
    const { entries } = lookup("すか", context);
    assert.strictEqual(entries[0]!.lemma, "ある");
    // the run of both words, which holds the clicked piece
    assert.deepStrictEqual(entries[0]!.match, ["ありますか"]);
    assert.deepStrictEqual(parts("すか", context), [
      "あります: ある",
      "か: か",
    ]);
  });

  it("ranks the analyzer's lemma first among words written alike", () => {
    // いら is いる "to need" (要る), not いる "to be" (居る)
    assert.strictEqual(
      lookup("い", "何もいらないね。").entries[0]!.lemma,
      "要る",
    );
  });

  it("puts a phrase of several words first, written either way", () => {
    const found = lookup("入る", "安定して手に入るようになった。").entries;
    assert.deepStrictEqual(
      found.map((entry) => entry.lemma),
      ["手に入る", "入る"],
    );
    assert.deepStrictEqual(found[0]!.match, ["手に入る"]);
    // the clicked word's own entry underlines nothing
    assert.isUndefined(found[1]!.match);
    // かもしれない, spelled かも知れない in the dictionary
    const { entries } = lookup("れ", "影響はないのかもしれないですけど。");
    assert.strictEqual(entries[0]!.lemma, "かも知れない");
    assert.deepStrictEqual(entries[0]!.match, ["かもしれない"]);
  });

  it("takes no one-word entry for a phrase", () => {
    // にあわせて is a form of 似合う, but here it is に + あわせて
    assert.strictEqual(
      lookup("あわせて", "ダイヤ改正にあわせて予定した。").entries[0]!.lemma,
      "合わせる",
    );
  });

  it("leaves a word the segmenter keeps whole, and a lookup without context, as they are", () => {
    const { entries } = lookup("日本語", "毎日、日本語を勉強しています。");
    assert.deepStrictEqual(
      entries.map((entry) => entry.lemma),
      ["日本語"],
    );
    assert.isUndefined(entries[0]!.match);
    assert.deepStrictEqual(lemmas(japanese, "ja_en", "食"), ["食"]);
  });

  it("joins no prefix onto a number", () => {
    assert.isUndefined(
      lookup("約", "奠都から約30年になる。").entries[0]!.match,
    );
  });

  it("ranks a kana syllable entry after the word's other entries", () => {
    assert.strictEqual(
      lookup("た").entries.at(-1)!.senses[0]!.translations[0],
      "The hiragana syllable た",
    );
  });

  it("leaves a piece over several words to the analyzer when the dictionary only redirects it", () => {
    // よね (the segmenter's piece, よ + ね) is redirected to 米 "rice"
    const db = dictionary([
      ["よ", "PART", [], ["emphasis"]],
      ["ね", "PART", [], ["right?"]],
      ["米", "NOUN", [], ["rice"]],
      ["そうですね", "INTJ", [], ["that's right"]],
    ]);
    db.$client.run("INSERT INTO forms VALUES ('よね', 3, ?)", [
      FormSource.Redirect,
    ]);
    const language = languageOf("ja_en");
    // both words as parts of the clicked piece, with nothing underlined
    const { entries, segments } = lookupWord(
      db,
      language,
      "よね",
      "できないですよね。",
      1,
    );
    assert.deepStrictEqual(
      entries.map((entry) => [entry.lemma, entry.match]),
      [
        ["よ", undefined],
        ["ね", undefined],
      ],
    );
    assert.deepStrictEqual(segments, [
      { text: "よ", entries: [0] },
      { text: "ね", entries: [1] },
    ]);
    // a piece the dictionary spells as a word is left to the plain lookup
    assert.strictEqual(
      lookupWord(db, language, "そうですね", "そうですね、確かに。", 1)
        .entries[0]!.lemma,
      "そうですね",
    );
  });

  it("ranks a clicked word's entries by the analyzer's lemma, with nothing underlined", () => {
    // みる is redirected to 海松 "seaweed", which ranks with lemmas; here it is 見る
    const db = dictionary([
      ["海松", "NOUN", [], ["a seaweed"]],
      ["見る", "VERB", ["みる"], ["to see"]],
      ["海", "NOUN", [], ["sea"]],
    ]);
    db.$client.run("INSERT INTO forms VALUES ('みる', 1, ?)", [
      FormSource.Redirect,
    ]);
    const { entries } = lookupWord(
      db,
      languageOf("ja_en"),
      "みる",
      "海をみる。",
      1,
    );
    assert.deepStrictEqual(
      entries.map((entry) => entry.lemma),
      ["見る", "海松"],
    );
    assert.isUndefined(entries[0]!.match);
  });

  it("finds a phrase longer than the segmenter's piece before the piece", () => {
    const db = dictionary([
      ["による", "ADP", [], ["by"], "grammar"],
      ["によると", "ADP", [], ["according to"], "grammar"],
      ["記録", "NOUN", [], ["record"]],
    ]);
    // Intl.Segmenter: 記録|による|と; the analyzer: 記録|に|よる|と
    const { entries } = lookupWord(
      db,
      languageOf("ja_en"),
      "による",
      "記録によると、晴れた。",
      1,
    );
    assert.strictEqual(entries[0]!.lemma, "によると");
    assert.deepStrictEqual(entries[0]!.match, ["によると"]);
  });

  it("puts a kana word's kanji lemma first, when its own entries miss the analyzer's part of speech", () => {
    const db = dictionary([
      ["もの", "PART", [], ["because"]],
      ["物", "NOUN", [], ["thing"]],
      ["ちょっと", "ADV", [], ["a little"]],
      ["一寸", "NOUN", ["ちょっと"], ["a unit of length"]],
      ["一寸", "ADV", [], ["a little"]],
    ]);
    const language = languageOf("ja_en");
    // the analyzer reads もの as the noun 物, and もの has only a particle entry
    assert.deepStrictEqual(
      lookupWord(db, language, "もの", "よくあるもの。", 1).entries.map(
        (entry) => entry.lemma,
      ),
      ["物", "もの"],
    );
    // ちょっと has an adverb entry of its own: 一寸 stays behind it
    assert.strictEqual(
      lookupWord(db, language, "ちょっと", "ちょっと待って。", 1).entries[0]!
        .lemma,
      "ちょっと",
    );
  });

  it("takes the word that holds most of the clicked piece", () => {
    const db = dictionary([
      ["思う", "VERB", ["思っ", "思った"], ["to think"]],
      ["より", "PART", [], ["than"]],
    ]);
    // Intl.Segmenter: 思っ|たより; the analyzer: 思っ|た|より
    const { entries, segments } = lookupWord(
      db,
      languageOf("ja_en"),
      "たより",
      "思ったより安い。",
      1,
    );
    assert.deepStrictEqual(
      entries.map((entry) => [entry.lemma, entry.match]),
      [
        ["より", ["思ったより"]],
        ["思う", undefined],
      ],
    );
    // in written order, though より is ranked first
    assert.deepStrictEqual(segments, [
      { text: "思った", entries: [1] },
      { text: "より", entries: [0] },
    ]);
  });

  it("leaves a piece to the plain lookup when the dictionary lacks the word that holds most of it", () => {
    const db = dictionary([
      ["でも", "PART", [], ["even"]],
      ["も", "PART", [], ["also"]],
    ]);
    // the analyzer: 横ばえで|も, and 横ばえ is no word the dictionary has
    const { entries, segments } = lookupWord(
      db,
      languageOf("ja_en"),
      "でも",
      "あの横ばえでも朝から大幅安に。",
      1,
    );
    assert.deepStrictEqual(
      entries.map((entry) => entry.lemma),
      ["でも"],
    );
    assert.isUndefined(segments);
  });

  it("splits a compound the segmenter keeps whole into its words", () => {
    const db = dictionary([
      ["年", "NOUN", [], ["year"]],
      ["前", "NOUN", [], ["before, ago"]],
    ]);
    // Intl.Segmenter: 年前, one piece; the analyzer: 2900年|前
    const { entries, segments } = lookupWord(
      db,
      languageOf("ja_en"),
      "年前",
      "約2900年前に噴火した。",
      1,
    );
    assert.deepStrictEqual(
      segments?.map(
        (segment) =>
          `${segment.text}: ${(segment.entries ?? []).map((i) => entries[i]!.lemma).join(", ")}`,
      ),
      ["2900年: 年", "前: 前"],
    );
    // the piece starts inside 2900年, so the parts spell more than the piece
    assert.deepStrictEqual(entries[0]!.match, ["2900年前"]);
  });

  it("lets the dictionary's word answer for a piece of content words the analyzer cut", () => {
    const db = dictionary([
      ["年代", "NOUN", [], ["era; decade"]],
      ["年", "NOUN", [], ["year"]],
      ["代", "NOUN", [], ["generation"]],
      ["とも", "PART", [], ["even if"]],
      ["と", "PART", [], ["as"]],
      ["も", "PART", [], ["also"]],
    ]);
    const language = languageOf("ja_en");
    // the analyzer: 2000年|代, because of the number
    const compound = lookupWord(
      db,
      language,
      "年代",
      "2000年代に入り、公的資金を注入した。",
      1,
    );
    assert.deepStrictEqual(
      compound.entries.map((entry) => [entry.lemma, entry.match]),
      [["年代", undefined]],
    );
    assert.isUndefined(compound.segments);
    // と|も are particles, which stand next to any word: the analyzer's cut stays
    const particles = lookupWord(
      db,
      language,
      "とも",
      "資源の博物館とも呼ばれている。",
      1,
    );
    assert.deepStrictEqual(
      particles.segments?.map(
        (segment) =>
          `${segment.text}: ${(segment.entries ?? []).map((i) => particles.entries[i]!.lemma).join(", ")}`,
      ),
      ["と: と", "も: も"],
    );
  });

  it("underlines nothing when the words are the clicked piece, and for the piece's own entries", () => {
    const db = dictionary([
      ["そう", "ADV", [], ["so"]],
      ["する", "VERB", ["し", "して"], ["to do"]],
      ["甲子", "NOUN", [], ["Wood Rat"]],
      ["園", "NOUN", [], ["garden"]],
    ]);
    const language = languageOf("ja_en");
    const read = (word: string, context: string) => {
      const { entries, segments } = lookupWord(db, language, word, context, 1);
      return {
        matches: entries.map((entry) => entry.match),
        parts: segments?.map(
          (segment) =>
            `${segment.text}: ${(segment.entries ?? []).map((i) => entries[i]!.lemma).join(", ")}`,
        ),
      };
    };
    // Intl.Segmenter: そうして, one piece; the analyzer: そう|して
    assert.deepStrictEqual(read("そうして", "そうしてそれだけの事をした。"), {
      matches: [undefined, undefined],
      parts: ["そう: そう", "して: する"],
    });
    // one word to both, made with a suffix: 甲子|園
    assert.deepStrictEqual(read("甲子園", "甲子園に行った。"), {
      matches: [undefined, undefined],
      parts: ["甲子: 甲子", "園: 園"],
    });
  });

  it("explains a part whose lemma the dictionary writes in kana", () => {
    const db = dictionary([
      ["教える", "VERB", ["教え"], ["to teach"]],
      ["ほしい", "ADJ", ["欲しい"], ["wanted"]],
      ["て", "PART", [], ["and (te form)"], "grammar"],
    ]);
    const { entries, segments } = lookupWord(
      db,
      languageOf("ja_en"),
      "欲しい",
      "教えて欲しい。",
      1,
    );
    const part = segments!.find((segment) => segment.text === "欲しい")!;
    assert.strictEqual(entries[part.entries![0]!]!.lemma, "ほしい");
  });

  it("finds a word's base form when the dictionary lacks the form, and the lemma before a redirect", () => {
    const db = dictionary([
      ["暗い", "ADJ", [], ["dark"]],
      ["常", "NOUN", [], ["eternal"]],
      ["所", "NOUN", [], ["place"]],
    ]);
    db.$client.run("INSERT INTO forms VALUES ('とこ', 2, ?)", [
      FormSource.Redirect,
    ]);
    const language = languageOf("ja_en");
    assert.strictEqual(
      lookupWord(db, language, "暗く", "暗くなる前に行こう。", 1).entries[0]!
        .lemma,
      "暗い",
    );
    // とこ, casual ところ: UniDic's lemma 所, before 常, which is only redirected there
    assert.strictEqual(
      lookupWord(db, language, "とこ", "降りるとこ迎えに行く。", 1).entries[0]!
        .lemma,
      "所",
    );
  });

  it("reads a word with no entry by the analyzer when there is no context", () => {
    // お送りします, as a client that sends no sentence picks it: お + 送る
    const db = dictionary([
      ["送る", "VERB", ["送ります"], ["to send"]],
      ["御", "X", [], ["honorific prefix"]],
    ]);
    const language = languageOf("ja_en");
    const { entries, segments } = lookupWord(db, language, "お送り");
    assert.deepStrictEqual(
      entries.map((entry) => entry.lemma),
      ["送る", "御"],
    );
    // `match` names a part of the sentence, and none was sent
    assert.deepStrictEqual(
      entries.map((entry) => entry.match),
      [undefined, undefined],
    );
    assert.deepStrictEqual(
      segments?.map((segment) => segment.text),
      ["お", "送り"],
    );
    // A word with an entry of its own keeps it.
    assert.deepStrictEqual(
      lookupWord(db, language, "送る").entries.map((entry) => entry.lemma),
      ["送る"],
    );
  });

  it("shows a word made with a suffix by its parts, not as the word before the suffix", () => {
    // Intl.Segmenter: 機械|屋; the analyzer: 機械 + the suffix 屋
    const db = dictionary([
      ["機械", "NOUN", [], ["machine"]],
      ["屋", "NOUN", [], ["shop; dealer"]],
    ]);
    const { entries, segments } = lookupWord(
      db,
      languageOf("ja_en"),
      "機械",
      "僕は機械屋です。",
      1,
    );
    assert.deepStrictEqual(
      entries.map((entry) => entry.lemma),
      ["機械", "屋"],
    );
    assert.deepStrictEqual(entries[0]!.match, ["機械屋"]);
    assert.deepStrictEqual(segments, [
      { text: "機械", entries: [0] },
      { text: "屋", entries: [1] },
    ]);
  });
});

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

/**
 * A piece the analyzer cuts at a particle (`なる|ほど`, `と|も`) that the
 * dictionary has as a word of its own.
 */
describe("a piece cut at a particle that is a word of its own", () => {
  const words = dictionary([
    ["成程", "INTJ", ["なるほど"], ["I see!"]],
    ["成る", "VERB", ["なる", "なれ"], ["to become"]],
    ["ほど", "PART", [], ["as much as"]],
    ["なんて", "PART", [], ["things like"]],
    ["何", "PRON", ["なん"], ["what"]],
    ["とも", "PART", [], ["of course"]],
    ["とも", "NOUN", [], ["friend"]],
    ["と", "PART", [], ["and, with"]],
    ["も", "PART", [], ["also"]],
  ]);
  const language = languageOf("ja_en");
  const shown = (word: string, context: string) => {
    const { entries, segments } = lookupWord(words, language, word, context, 1);
    return {
      entries: entries.map((entry) => `${entry.lemma} ${entry.pos}`),
      segments: segments?.map((segment) => segment.text),
    };
  };

  it("puts its own entries first where it starts a clause or ends a sentence", () => {
    assert.deepStrictEqual(shown("なるほど", "結構ありますなるほど。"), {
      entries: ["成程 INTJ", "成る VERB", "ほど PART"],
      segments: ["なる", "ほど"],
    });
    assert.deepStrictEqual(
      shown("なんて", "うん、なんて言うんですか").entries.slice(0, 2),
      ["なんて PART", "何 PRON"],
    );
  });

  it("shows only its parts inside a clause", () => {
    assert.deepStrictEqual(
      shown("なるほど", "大きくなればなるほど高い。").entries,
      ["成る VERB", "ほど PART"],
    );
    assert.deepStrictEqual(shown("とも", "博物館とも呼ばれている。").entries, [
      "と PART",
      "も PART",
    ]);
  });

  it("never takes a noun as such a word", () => {
    // ends a sentence: とも "of course", not とも "friend"
    assert.deepStrictEqual(shown("とも", "行くとも。").entries, [
      "とも PART",
      "と PART",
      "も PART",
    ]);
  });
});
