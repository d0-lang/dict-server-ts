import { lookupKey } from "@dict/core/lookupKey";
import { FormSource, PREFERRED_LETTERS_KEY } from "@dict/core/schema";
import { dictionary } from "./dictionary.ts";

/**
 * Chinese: each word under its traditional lemma, with its simplified
 * spelling as a lemma too, as the importer stores it
 * (`import.otherScriptTags`); characters as `character` lines (`X`).
 */
const words: ReadonlyArray<
  readonly [
    traditional: string,
    simplified: string,
    pos: "NOUN" | "VERB" | "ADV" | "X",
    gloss: string,
  ]
> = [
  ["學習", "学习", "VERB", "to study"],
  ["學", "学", "X", "to learn"],
  ["習", "习", "X", "to practise"],
  ["後", "后", "X", "after; behind"],
  ["后", "后", "X", "empress"],
  ["皇后", "皇后", "NOUN", "empress consort"],
  ["皇", "皇", "X", "emperor"],
  ["麵", "面", "X", "noodles"],
  ["面", "面", "X", "face"],
  ["面前", "面前", "NOUN", "in front of"],
  ["前", "前", "X", "front"],
  ["研究", "研究", "VERB", "to research"],
  ["研究生", "研究生", "NOUN", "graduate student"],
  ["生命", "生命", "NOUN", "life"],
  ["研", "研", "X", "to grind"],
  ["究", "究", "X", "to investigate"],
  ["生", "生", "X", "to be born"],
  ["命", "命", "X", "fate"],
  ["都", "都", "X", "all"],
  ["很", "很", "X", "very"],
  ["忙", "忙", "X", "busy"],
  ["還沒", "还没", "ADV", "not yet"],
  ["還", "还", "X", "still"],
  ["沒", "没", "X", "not have"],
  ["來", "来", "X", "to come"],
  ["他", "他", "X", "he"],
  ["手機", "手机", "NOUN", "mobile phone"],
  ["手", "手", "X", "hand"],
  ["機", "机", "X", "machine"],
  ["机", "机", "X", "alder"],
  ["國", "国", "X", "country"],
  ["與", "与", "X", "and"],
  ["王", "王", "X", "king"],
  ["三", "三", "X", "three"],
  ["年", "年", "X", "year"],
];

export const chinese = (() => {
  const db = dictionary(
    words.map(([traditional, , pos, gloss]) => [
      traditional,
      pos,
      [],
      [gloss],
      pos === "X" ? "character" : "",
    ]),
  );
  words.forEach(([traditional, simplified], i) => {
    if (simplified !== traditional) {
      db.$client.run("INSERT INTO forms VALUES (?, ?, ?)", [
        lookupKey(simplified),
        i + 1,
        FormSource.Lemma,
      ]);
    }
  });
  db.$client.run("INSERT INTO meta VALUES (?, ?)", [
    PREFERRED_LETTERS_KEY,
    JSON.stringify({ 后: ["後"], 机: ["機"] }),
  ]);
  return db;
})();
