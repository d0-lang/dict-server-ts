import { assert, describe, it } from "@effect/vitest";
import { createDictionaryFile } from "@dict/core/DictionaryDb";
import type { WriterContext } from "./context.ts";
import { copySameAsSenses, parseSameAs } from "./sameAs.ts";

/** A file with `entries`: [id, lemma, pos, reading, glosses of each sense]. */
const file = (
  entries: ReadonlyArray<
    readonly [number, string, string, string | null, ReadonlyArray<string>]
  >,
) => {
  const db = createDictionaryFile(":memory:");
  for (const [id, lemma, pos, reading, senses] of entries) {
    db.$client.run(
      "INSERT INTO entries VALUES (?, ?, ?, ?, 0, 0, NULL, NULL)",
      [id, lemma, pos, pos.toLowerCase()],
    );
    if (reading !== null) {
      db.$client.run("INSERT INTO pronunciations VALUES (?, 0, 'reading', ?)", [
        id,
        reading,
      ]);
    }
    senses.forEach((gloss, idx) =>
      db.$client.run("INSERT INTO senses VALUES (?, ?, ?, NULL)", [
        id,
        idx,
        JSON.stringify([gloss]),
      ]),
    );
  }
  return db.$client;
};

const glossesOf = (sqlite: WriterContext["sqlite"], id: number) =>
  sqlite
    .query<{ glosses: string }, [number]>(
      "SELECT glosses FROM senses WHERE entry_id = ? ORDER BY idx",
    )
    .all(id)
    .map((row) => (JSON.parse(row.glosses) as Array<string>)[0]);

const run = (sqlite: WriterContext["sqlite"]) =>
  copySameAsSenses({ sqlite } as unknown as WriterContext);

describe("parseSameAs", () => {
  it("reads where a pointer gloss points, and the reading it names", () => {
    assert.deepStrictEqual(parseSameAs("Same as ゆうぎ (yūgi) above"), {
      direction: "above",
      reading: "ゆうぎ",
    });
    assert.deepStrictEqual(
      parseSameAs("all senses same as 上(うえ) (ue) above"),
      { direction: "above", reading: "うえ" },
    );
    assert.deepStrictEqual(parseSameAs("same as above."), {
      direction: "above",
    });
    assert.deepStrictEqual(parseSameAs("Same as below"), {
      direction: "below",
    });
    assert.isUndefined(parseSameAs("same as 懦"));
    assert.isUndefined(parseSameAs("to lie (same as 寝る)"));
  });
});

describe("copySameAsSenses", () => {
  it("gives a reading that points at another the other's senses", () => {
    const sqlite = file([
      [1, "遊戯", "NOUN", "ゆうぎ", ["a game", "a play"]],
      [2, "遊戯する", "VERB", "ゆうぎする", ["to play (a game)"]],
      [3, "遊戯", "NOUN", "ゆうげ", ["Same as ゆうぎ (yūgi) above"]],
      [4, "遊戯する", "VERB", "ゆうげする", ["Same as ゆうぎ (yūgi) above"]],
    ]);
    run(sqlite);
    assert.deepStrictEqual(glossesOf(sqlite, 3), ["a game", "a play"]);
    // the verb's own する is not part of the reading the gloss names
    assert.deepStrictEqual(glossesOf(sqlite, 4), ["to play (a game)"]);
  });

  it("finds a verb by the whole reading the gloss names", () => {
    const sqlite = file([
      [1, "申す", "VERB", "もうす", ["to say (humble)"]],
      [2, "申す", "VERB", "ます", ["Same as もうす (mōsu) above"]],
    ]);
    run(sqlite);
    assert.deepStrictEqual(glossesOf(sqlite, 2), ["to say (humble)"]);
  });

  it("gives a する verb that points at the word without する its senses", () => {
    const sqlite = file([
      [1, "見合い", "NOUN", "みあい", ["formal marriage interview"]],
      [2, "見合いする", "VERB", "みあいする", ["Same as above."]],
      [3, "手当", "NOUN", "てあて", ["allowance"]],
      [4, "手当する", "VERB", "てあてする", ["to treat", "same as above."]],
      // no word without する: left as it is
      [5, "ぺらぺらする", "VERB", null, ["Same as above."]],
    ]);
    run(sqlite);
    assert.deepStrictEqual(glossesOf(sqlite, 2), ["formal marriage interview"]);
    assert.deepStrictEqual(glossesOf(sqlite, 4), ["to treat", "allowance"]);
    assert.deepStrictEqual(glossesOf(sqlite, 5), ["Same as above."]);
  });

  it("takes the nearest entry that way when the gloss names no reading", () => {
    const sqlite = file([
      [1, "灸", "NOUN", "きゅう", ["moxibustion"]],
      [2, "灸", "NOUN", "やいと", ["Same as above.", "a scolding"]],
      [3, "灸", "NOUN", "やいと", ["same as below"]],
    ]);
    run(sqlite);
    assert.deepStrictEqual(glossesOf(sqlite, 2), ["moxibustion", "a scolding"]);
    // below it is nothing but another pointer: left as it is
    assert.deepStrictEqual(glossesOf(sqlite, 3), ["same as below"]);
  });
});
