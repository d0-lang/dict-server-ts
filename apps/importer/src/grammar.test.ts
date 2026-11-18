import { assert, describe, it } from "@effect/vitest";
import { loadGrammar, parseGrammarFile } from "./grammar.ts";

describe("parseGrammarFile", () => {
  it("reads one entry per line, senses split by a bar", () => {
    assert.deepStrictEqual(
      parseGrammarFile(
        "# comment\n\nim\tADP\tin the | inside the\nSie\tPRON\tyou (formal)\n",
        "t.tsv",
      ),
      [
        { lemma: "im", pos: "ADP", senses: ["in the", "inside the"] },
        { lemma: "Sie", pos: "PRON", senses: ["you (formal)"] },
      ],
    );
  });

  it("reads the words a sense points at after an arrow", () => {
    assert.deepStrictEqual(
      parseGrammarFile(
        "ない\tAUX\tnot\nなかった\tAUX\tpast of ない: didn't → ない | was not\n",
        "t.tsv",
      )[1],
      {
        lemma: "なかった",
        pos: "AUX",
        senses: ["past of ない: didn't", "was not"],
        see: [["ない"], []],
      },
    );
    // A word the file does not list is the dictionary's (`言う`); the
    // import keeps it only if it has an entry (`resolveSee`).
    assert.deepStrictEqual(
      parseGrammarFile("という\tDET\tcalled → 言う", "t.tsv")[0]?.see,
      [["言う"]],
    );
  });

  it("reads other spellings after a slash", () => {
    assert.deepStrictEqual(
      parseGrammarFile("ようとする/うとする\tAUX\ttry to\n", "t.tsv"),
      [
        {
          lemma: "ようとする",
          pos: "AUX",
          senses: ["try to"],
          forms: ["うとする"],
        },
      ],
    );
  });

  it("rejects bad lines with their position", () => {
    assert.throws(() => parseGrammarFile("im ADP in the", "t.tsv"), /t\.tsv:1/);
    assert.throws(() => parseGrammarFile("im\tPREP\tin", "t.tsv"), /PREP/);
    assert.throws(
      () => parseGrammarFile("im\tADP\tin\nim\tADP\tinto", "t.tsv"),
      /listed twice/,
    );
  });
});

describe("loadGrammar", () => {
  it("parses the files in the repo", () => {
    for (const lang of ["de", "pl", "ja"]) {
      assert.isAbove(loadGrammar(lang).length, 50, lang);
    }
    assert.deepStrictEqual(loadGrammar("xx"), []);
  });
});
