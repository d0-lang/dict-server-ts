import { assert, describe, it } from "@effect/vitest";
import { createDictionaryFile } from "@dict/core/DictionaryDb";
import { FormSource } from "@dict/core/schema";
import type { WriterContext } from "./context.ts";
import { addParticipleForms } from "./participles.ts";

const ADOPTER = 1;
const PLAIRE = 3;

/** `adopter` (table: `adopté`), the noun `adopté` with its plural, `plaire` (`plu`), and `plus`. */
const file = () => {
  const db = createDictionaryFile(":memory:");
  const entries: ReadonlyArray<readonly [number, string, string]> = [
    [ADOPTER, "adopter", "VERB"],
    [2, "adopté", "NOUN"],
    [PLAIRE, "plaire", "VERB"],
    [4, "plus", "ADV"],
  ];
  for (const [id, lemma, pos] of entries) {
    db.$client.run(
      "INSERT INTO entries VALUES (?, ?, ?, ?, 0, 0, NULL, NULL)",
      [id, lemma, pos, pos.toLowerCase()],
    );
  }
  const forms: ReadonlyArray<readonly [string, number, number]> = [
    ["adopter", ADOPTER, FormSource.Lemma],
    ["adopté", ADOPTER, FormSource.Inflection],
    ["adopté", 2, FormSource.Lemma],
    ["adoptés", 2, FormSource.Inflection],
    ["plaire", PLAIRE, FormSource.Lemma],
    ["plu", PLAIRE, FormSource.Inflection],
    ["plus", 4, FormSource.Lemma],
  ];
  for (const row of forms) {
    db.$client.run("INSERT INTO forms VALUES (?, ?, ?)", [...row]);
  }
  return db.$client;
};

const run = (shared: boolean) => {
  const sqlite = file();
  addParticipleForms({
    sqlite,
    counts: {},
    participleForms: [
      { form: "adoptés", entryId: ADOPTER },
      { form: "adoptées", entryId: ADOPTER },
      { form: "plus", entryId: PLAIRE },
    ],
    participlesSharedWithOwn: shared,
  } as unknown as WriterContext);
  return (form: string) =>
    sqlite
      .query<{ id: number }, [string]>(
        "SELECT entry_id AS id FROM forms WHERE form = ? ORDER BY entry_id",
      )
      .all(form)
      .map((row) => row.id);
};

describe("addParticipleForms", () => {
  it("adds a declined form only where no other entry has it", () => {
    const reached = run(false);
    assert.deepStrictEqual(reached("adoptées"), [ADOPTER]);
    assert.deepStrictEqual(reached("adoptés"), [2]);
    assert.deepStrictEqual(reached("plus"), [4]);
  });

  it("lets the participle's own noun share it, not another word", () => {
    const reached = run(true);
    assert.deepStrictEqual(reached("adoptés"), [ADOPTER, 2]);
    assert.deepStrictEqual(reached("plus"), [4]);
  });
});
