import { assert, describe, it } from "@effect/vitest";
import type { Morpheme } from "../../common/analyzer.ts";
import { languageOf } from "../../testing/dictionary.ts";
import { wordsOf } from "./words.ts";

const settings = languageOf("ko_en").context.analyzer!;

const morpheme = (surface: string, start: number, pos: string): Morpheme => ({
  surface,
  start,
  end: start + surface.length,
  pos,
  bases: [surface],
  spellings: [surface],
});

const texts = (morphemes: ReadonlyArray<Morpheme>) =>
  wordsOf(morphemes, settings).map((word) =>
    word.map((m) => m.surface).join("|"),
  );

describe("prefixes", () => {
  it("joins a prefix to the noun written right after it", () => {
    // 신제품: 신 + 제품.
    assert.deepStrictEqual(
      texts([morpheme("신", 0, "XPN"), morpheme("제품", 1, "NNG")]),
      ["신|제품"],
    );
  });

  it("joins no prefix across a space", () => {
    // 신 제품: the prefix stays a word of its own.
    assert.deepStrictEqual(
      texts([morpheme("신", 0, "XPN"), morpheme("제품", 2, "NNG")]),
      ["신", "제품"],
    );
  });

  it("joins no prefix across a space to a prefix written onto a noun", () => {
    // 신 비제품: only 비 joins 제품.
    assert.deepStrictEqual(
      texts([
        morpheme("신", 0, "XPN"),
        morpheme("비", 2, "XPN"),
        morpheme("제품", 3, "NNG"),
      ]),
      ["신", "비|제품"],
    );
  });
});
