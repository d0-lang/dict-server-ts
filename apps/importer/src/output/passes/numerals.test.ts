import { assert, describe, it } from "@effect/vitest";
import { createDictionaryFile } from "@dict/core/DictionaryDb";
import { FormSource, NUMERAL_SOURCE_POS } from "@dict/core/schema";
import { parseNumeralsFile } from "../../numerals.ts";
import type { WriterContext } from "./context.ts";
import { replaceNumerals } from "./numerals.ts";

describe("replaceNumerals", () => {
  it("leaves a listed numeral only its own lines, its names and affixes", () => {
    const db = createDictionaryFile(":memory:");
    const entries: ReadonlyArray<readonly [number, string, string, string]> = [
      [1, "九", "NUM", NUMERAL_SOURCE_POS],
      [2, "九", "NUM", "num"],
      [3, "九", "NOUN", "noun"],
      [4, "九", "X", "character"],
      [5, "この", "NUM", "num"],
      [6, "九", "PROPN", "name"],
      [7, "九", "X", "prefix"],
      [8, "九つ", "NUM", "num"],
    ];
    for (const [id, lemma, pos, sourcePos] of entries) {
      db.$client.run(
        "INSERT INTO entries VALUES (?, ?, ?, ?, 0, 0, NULL, NULL)",
        [id, lemma, pos, sourcePos],
      );
    }
    for (const id of [1, 2, 3, 4, 6, 7]) {
      db.$client.run("INSERT INTO forms VALUES ('九', ?, ?)", [
        id,
        FormSource.Lemma,
      ]);
    }
    // the kana この, whose page lists 九; 九つ is a word of its own
    db.$client.run("INSERT INTO forms VALUES ('九', 5, ?)", [
      FormSource.Inflection,
    ]);
    db.$client.run("INSERT INTO forms VALUES ('九つ', 8, ?)", [
      FormSource.Lemma,
    ]);
    replaceNumerals({ sqlite: db.$client } as unknown as WriterContext);
    const reached = (form: string) =>
      db.$client
        .query<{ id: number }, [string]>(
          "SELECT entry_id AS id FROM forms WHERE form = ? ORDER BY entry_id",
        )
        .all(form)
        .map((row) => row.id);
    assert.deepStrictEqual(reached("九"), [1, 6, 7]);
    assert.deepStrictEqual(reached("九つ"), [8]);
  });
});

describe("parseNumeralsFile", () => {
  it("reads one line per word and reading, and refuses a repeated one", () => {
    assert.deepStrictEqual(
      parseNumeralsFile("# comment\n九\tく\tnine | ninth\n", "test"),
      [{ lemma: "九", reading: "く", senses: ["nine", "ninth"] }],
    );
    assert.throws(() =>
      parseNumeralsFile("九\tく\tnine\n九\tく\tnine\n", "test"),
    );
  });
});
