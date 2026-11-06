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
    for (const lang of ["de", "pl"]) {
      assert.isAbove(loadGrammar(lang).length, 50, lang);
    }
    assert.deepStrictEqual(loadGrammar("xx"), []);
  });
});
