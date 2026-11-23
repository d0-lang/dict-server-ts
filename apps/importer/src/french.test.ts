import { assert, describe, it } from "@effect/vitest";
import { Database } from "bun:sqlite";
import { Effect } from "effect";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importWiktextract } from "./Importer.ts";

/** Trimmed French lines, as the dump writes them. */
const LINES = [
  {
    word: "prendre",
    pos: "verb",
    forms: [
      { form: "pris", tags: ["participle", "past"], source: "conjugation" },
    ],
    senses: [{ glosses: ["to take"] }],
  },
  {
    word: "pris",
    pos: "adj",
    forms: [{ form: "prise", tags: ["feminine"] }],
    senses: [{ glosses: ["taken"] }],
  },
  {
    word: "pris",
    pos: "verb",
    senses: [
      {
        glosses: ["past participle of prendre"],
        form_of: [{ word: "prendre" }],
        tags: ["form-of", "participle", "past"],
      },
    ],
  },
  {
    word: "prise",
    pos: "verb",
    senses: [
      {
        glosses: ["feminine singular of pris"],
        form_of: [{ word: "pris" }],
        tags: ["feminine", "form-of", "participle", "singular"],
      },
    ],
  },
  {
    word: "aller",
    pos: "verb",
    forms: [
      {
        form: "va",
        tags: ["present", "third-person", "singular"],
        source: "conjugation",
      },
    ],
    senses: [{ glosses: ["to go"] }],
  },
  {
    word: "vader",
    pos: "verb",
    forms: [
      {
        form: "va",
        tags: ["present", "third-person", "singular"],
        source: "conjugation",
      },
    ],
    senses: [{ glosses: ["to go (Louisiana)"] }],
  },
  {
    word: "être",
    pos: "verb",
    senses: [{ glosses: ["to be"] }],
    sounds: [{ ipa: "/ɛtʁ/" }],
  },
  // `est` "is" sounds unlike `est` "east": its form-of line has the sound.
  {
    word: "est",
    pos: "noun",
    senses: [{ glosses: ["east"] }],
    sounds: [{ ipa: "/ɛst/" }],
  },
  {
    word: "est",
    pos: "verb",
    senses: [
      {
        glosses: ["third-person singular present indicative of être"],
        form_of: [{ word: "être" }],
        tags: ["form-of"],
      },
    ],
    sounds: [
      { ipa: "/ɛ/" },
      {
        audio: "Fr-est.ogg",
        ogg_url: "https://upload.wikimedia.org/Fr-est.ogg",
      },
    ],
  },
].map((line) => JSON.stringify({ lang_code: "fr", ...line }));

/** Lines for two irregular forms, each pointing at its verb, and `est`. */
const GRAMMAR = [
  {
    lemma: "pris",
    pos: "VERB",
    senses: ["taken (past participle of prendre)"],
    see: [["prendre"]],
  },
  {
    lemma: "va",
    pos: "VERB",
    senses: ["goes (il va; aller)"],
    see: [["aller"]],
  },
  { lemma: "est", pos: "AUX", senses: ["is (il est; être)"], see: [["être"]] },
] as const;

const imported = Effect.acquireRelease(
  Effect.promise(() => mkdtemp(join(tmpdir(), "dict-fr-"))),
  (dir) => Effect.promise(() => rm(dir, { recursive: true, force: true })),
).pipe(
  Effect.flatMap((dir) =>
    Effect.gen(function* () {
      const input = join(dir, "fr.jsonl");
      const out = join(dir, "fr.sqlite");
      yield* Effect.promise(() => writeFile(input, LINES.join("\n") + "\n"));
      yield* importWiktextract({ lang: "fr", input, out, grammar: GRAMMAR });
      return new Database(out, { readonly: true });
    }),
  ),
);

const entriesOf = (db: Database, form: string) =>
  db
    .query<{ lemma: string; pos: string; grammar: number }, [string]>(
      `SELECT e.lemma, e.pos, e.source_pos = 'grammar' AS grammar FROM forms f
       JOIN entries e ON e.id = f.entry_id WHERE f.form = ? ORDER BY e.id`,
    )
    .all(form)
    .map((row) => `${row.lemma} ${row.pos}${row.grammar ? " (line)" : ""}`);

describe("French import with lines for irregular verb forms", () => {
  it.effect(
    "keeps the verb a line points at and drops the word's other verbs",
    () =>
      Effect.gen(function* () {
        const db = yield* imported;
        assert.deepStrictEqual(entriesOf(db, "va"), [
          "va VERB (line)",
          "aller VERB",
        ]);
        assert.deepStrictEqual(entriesOf(db, "pris"), [
          "pris VERB (line)",
          "prendre VERB",
          "pris ADJ",
        ]);
      }).pipe(Effect.scoped),
  );

  it.effect("lets a declined participle go on to its verb past the line", () =>
    Effect.gen(function* () {
      const db = yield* imported;
      // `prise` is "feminine singular of pris": the line and the adjective
      // `pris`, and through the participle, `prendre`.
      assert.deepStrictEqual(entriesOf(db, "prise"), [
        "pris VERB (line)",
        "prendre VERB",
        "pris ADJ",
      ]);
    }).pipe(Effect.scoped),
  );

  it.effect(
    "gives a line the sounds of its verb form, not of a noun spelled alike",
    () =>
      Effect.gen(function* () {
        const db = yield* imported;
        const sounds = db
          .query<{ kind: string; value: string }, []>(
            `SELECT p.kind, p.value FROM entries e JOIN pronunciations p ON p.entry_id = e.id
             WHERE e.lemma = 'est' AND e.source_pos = 'grammar' ORDER BY p.idx`,
          )
          .all()
          .map((row) => `${row.kind} ${row.value}`);
        assert.deepStrictEqual(sounds, [
          "ipa /ɛ/",
          "audio https://upload.wikimedia.org/Fr-est.ogg",
        ]);
      }).pipe(Effect.scoped),
  );
});
