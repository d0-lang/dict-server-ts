import { assert, describe, it } from "@effect/vitest";
import { dictionary } from "../testing/dictionary.ts";
import { loadEntries } from "./entries.ts";
import { formRows } from "./forms.ts";

describe("formRows", () => {
  it("keeps each file's rows apart", () => {
    const german = dictionary([["Bank", "NOUN", [], ["bench"]]]);
    const polish = dictionary([["bank", "NOUN", [], ["bank"]]]);
    // Asked of one file first, then of the other: the rows kept for the
    // first must not answer the second.
    assert.deepStrictEqual(
      formRows(german, "bank").map((row) => row.lemma),
      ["Bank"],
    );
    assert.deepStrictEqual(
      formRows(polish, "bank").map((row) => row.lemma),
      ["bank"],
    );
    assert.deepStrictEqual(
      formRows(german, "bank").map((row) => row.lemma),
      ["Bank"],
    );
  });
});

describe("loadEntries", () => {
  it("returns the entries in the order asked, with their senses in order", () => {
    const db = dictionary([
      ["eins", "NUM", [], ["one", "a single"]],
      ["zwei", "NUM", [], ["two"]],
      ["drei", "NUM", [], ["three"]],
    ]);
    const entries = loadEntries(db, [3, 1, 2]);
    assert.deepStrictEqual(
      entries.map((entry) => entry.lemma),
      ["drei", "eins", "zwei"],
    );
    assert.deepStrictEqual(
      entries[1]!.senses.map((sense) => sense.glosses),
      [["one"], ["a single"]],
    );
  });
});
