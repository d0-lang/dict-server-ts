import { assert, describe, it } from "@effect/vitest";
import { lookupWord } from "../../lookup.ts";
import { dictionary, languageOf } from "../../testing/dictionary.ts";

/** Grammar-file constructions over several words, and endings shown together. */
describe("grammar phrases and endings", () => {
  const words = dictionary([
    ["ことになる", "AUX", [], ["it is decided that"], "grammar"],
    ["ようとする", "AUX", ["うとする"], ["try to"], "grammar"],
    ["なかった", "AUX", [], ["past of ない"], "grammar"],
    ["ない", "AUX", [], ["not"], "grammar"],
    ["た", "AUX", ["たら"], ["past", "たら: if"], "grammar"],
    ["て", "PART", [], ["and"], "grammar"],
    // Wiktionary makes て a form of ている, by the stem of てる
    ["ている", "AUX", ["て"], ["be ...ing"], "grammar"],
    ["てみる", "AUX", [], ["try doing"], "grammar"],
    ["ちゃいけない", "AUX", [], ["must not"], "grammar"],
    ["なくちゃいけない", "AUX", [], ["must"], "grammar"],
    ["なきゃいけない", "AUX", [], ["must"], "grammar"],
    ["こと", "NOUN", [], ["thing"]],
    ["成る", "VERB", ["なる", "なっ"], ["to become"]],
    ["出る", "VERB", ["出よう"], ["to leave"]],
    ["行く", "VERB", ["行こう"], ["to go"]],
    ["する", "VERB", ["し"], ["to do"]],
    ["と", "PART", [], ["quotative"]],
    ["言える", "VERB", ["言え"], ["can say"]],
    ["言えない", "VERB", ["言えなかった"], ["can't say"]],
    // a Wiktionary phrase never starts inside a word
    ["うとした", "X", [], ["junk"]],
  ]);
  const language = languageOf("ja_en");
  const shown = (word: string, context: string) => {
    const { entries, segments } = lookupWord(words, language, word, context, 1);
    return {
      first:
        `${entries[0]?.lemma} ${entries[0]?.match?.join("|") ?? ""}`.trim(),
      segments: segments?.map((segment) => segment.text),
    };
  };

  it("finds a construction from a word's start", () => {
    assert.strictEqual(
      shown("った", "ことになった").first,
      "ことになる ことになった",
    );
  });

  it("finds a grammar construction that starts inside a conjugated verb", () => {
    // the analyzer: 出よう|と|し|た, one morpheme 出よう
    assert.strictEqual(
      shown("と", "出ようとした").first,
      "ようとする ようとした",
    );
    // 行こう has no よう: the line's other spelling, うとする
    assert.strictEqual(
      shown("た", "行こうとした").first,
      "ようとする うとした",
    );
    // a click on the verb before it shows the verb
    assert.strictEqual(shown("出", "出ようとした").first, "出る 出よう");
  });

  it("takes the longer construction, which may mean the opposite", () => {
    // なくちゃいけない "must" holds ちゃいけない "must not"
    assert.strictEqual(
      shown("ちゃ", "行かなくちゃいけない。").first,
      "なくちゃいけない なくちゃいけない",
    );
    assert.strictEqual(
      shown("いけ", "行かなくちゃいけない。").first,
      "なくちゃいけない なくちゃいけない",
    );
    // なきゃ is one morpheme, with the base ない
    assert.strictEqual(
      shown("なきゃ", "出なきゃいけない。").first,
      "なきゃいけない なきゃいけない",
    );
    // without なく before it, "must not"
    assert.strictEqual(
      shown("ちゃ", "行っちゃいけない。").first,
      "ちゃいけない ちゃいけない",
    );
  });

  it("shows an ending by its own line, not by a line it is a form of", () => {
    const { entries, segments } = lookupWord(
      words,
      language,
      "て",
      "言えて、出る。",
      1,
    );
    const part = segments!.find((segment) => segment.text === "て")!;
    assert.deepStrictEqual(
      part.entries!.map((i) => entries[i]!.lemma),
      ["て"],
    );
  });

  it("shows endings the grammar file lists together as one segment", () => {
    assert.deepStrictEqual(shown("言", "言えなかった。").segments, [
      "言え",
      "なかった",
    ]);
    // by the base form of the last ending: みよう is みる
    assert.deepStrictEqual(shown("出", "出てみよう。").segments, [
      "出",
      "てみよう",
    ]);
    // たら is its base た and "if": it stays out of the group
    assert.deepStrictEqual(shown("言", "言えなかったら困る。").segments, [
      "言え",
      "なかっ",
      "たら",
    ]);
  });
});
