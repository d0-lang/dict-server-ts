import { assert, describe, it } from "@effect/vitest";
import { Database } from "bun:sqlite";
import { Effect } from "effect";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importWiktextract } from "./Importer.ts";

const row = (form: string, ...tags: Array<string>) => ({
  form,
  tags,
  source: "conjugation",
});

/** Trimmed Latvian lines, as the dump writes them. */
const LINES = [
  {
    word: "sākt",
    pos: "verb",
    forms: [
      row("es", "first-person", "indicative", "singular"),
      row("sāku", "first-person", "indicative", "present", "singular"),
      row("sāk", "indicative", "present", "singular", "third-person"),
      row("sāka", "indicative", "past", "singular", "third-person"),
      row("sāks", "future", "indicative", "singular", "third-person"),
      row("sākam", "first-person", "indicative", "plural", "present"),
      row("sācis", "active", "conditional", "participle", "past"),
    ],
    senses: [{ glosses: ["to begin, to start"] }],
  },
  {
    word: "beigt",
    pos: "verb",
    forms: [
      row("beidz", "indicative", "present", "singular", "third-person"),
      row("beidza", "indicative", "past", "singular", "third-person"),
    ],
    senses: [{ glosses: ["to finish"] }],
  },
  // `beidzas` is also a word of its own here, so it stays that word's.
  { word: "beidzas", pos: "noun", senses: [{ glosses: ["test noun"] }] },
  {
    word: "smiet",
    pos: "verb",
    forms: [row("smej", "indicative", "present", "singular", "third-person")],
    senses: [{ glosses: ["to mock"] }],
  },
  // The dump has this reflexive, so `smiet` makes none.
  {
    word: "smieties",
    pos: "verb",
    forms: [row("smejas", "indicative", "present", "singular", "third-person")],
    senses: [{ glosses: ["to laugh"] }],
  },
  { word: "es", pos: "pron", senses: [{ glosses: ["I"] }] },
].map((line) => JSON.stringify({ lang_code: "lv", ...line }));

const imported = Effect.acquireRelease(
  Effect.promise(() => mkdtemp(join(tmpdir(), "dict-lv-"))),
  (dir) => Effect.promise(() => rm(dir, { recursive: true, force: true })),
).pipe(
  Effect.flatMap((dir) =>
    Effect.gen(function* () {
      const input = join(dir, "lv.jsonl");
      const out = join(dir, "lv.sqlite");
      yield* Effect.promise(() => writeFile(input, LINES.join("\n") + "\n"));
      yield* importWiktextract({ lang: "lv", input, out, grammar: [] });
      return new Database(out, { readonly: true });
    }),
  ),
);

const entriesOf = (db: Database, form: string) =>
  db
    .query<{ lemma: string; pos: string }, [string]>(
      `SELECT e.lemma, e.pos FROM forms f JOIN entries e ON e.id = f.entry_id
       WHERE f.form = ? ORDER BY e.id`,
    )
    .all(form)
    .map((r) => `${r.lemma} ${r.pos}`);

const glossesOf = (db: Database, lemma: string) =>
  db
    .query<{ glosses: string }, [string]>(
      `SELECT s.glosses FROM senses s JOIN entries e ON e.id = s.entry_id
       WHERE e.lemma = ? ORDER BY s.idx`,
    )
    .all(lemma)
    .flatMap((r) => JSON.parse(r.glosses) as Array<string>);

describe("Latvian import", () => {
  it.effect("spells a verb's reflexive from its table, with its meaning", () =>
    Effect.gen(function* () {
      const db = yield* imported;
      for (const form of [
        "sākties",
        "sākos",
        "sākas",
        "sākās",
        "sāksies",
        "sākamies",
        "sācies",
      ]) {
        assert.deepStrictEqual(entriesOf(db, form), ["sākties VERB"], form);
      }
      assert.deepStrictEqual(glossesOf(db, "sākties"), [
        "reflexive of sākt: to begin, to start",
      ]);
      // the verb keeps its own forms
      assert.deepStrictEqual(entriesOf(db, "sāka"), ["sākt VERB"]);
    }).pipe(Effect.scoped),
  );

  it.effect(
    "leaves a form another word has, and a reflexive the dump has",
    () =>
      Effect.gen(function* () {
        const db = yield* imported;
        assert.deepStrictEqual(entriesOf(db, "beidzās"), ["beigties VERB"]);
        assert.deepStrictEqual(entriesOf(db, "beidzas"), ["beidzas NOUN"]);
        assert.deepStrictEqual(entriesOf(db, "smejas"), ["smieties VERB"]);
        assert.deepStrictEqual(glossesOf(db, "smieties"), ["to laugh"]);
      }).pipe(Effect.scoped),
  );

  it.effect("doesn't make a verb of the pronoun heading its table's row", () =>
    Effect.gen(function* () {
      const db = yield* imported;
      assert.deepStrictEqual(entriesOf(db, "es"), ["es PRON"]);
    }).pipe(Effect.scoped),
  );
});
