import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDictionary } from "@dict/core/DictionaryDb";
import { findEntriesByForm } from "../common/entries.ts";
import { importWiktextract } from "@dict/importer/Importer";

const tempDir = Effect.acquireRelease(
  Effect.promise(() => mkdtemp(join(tmpdir(), "dict-import-"))),
  (dir) => Effect.promise(() => rm(dir, { recursive: true, force: true })),
);

describe("importWiktextract", () => {
  it.effect(
    "declines a participle only where no other entry has the form",
    () =>
      Effect.gen(function* () {
        const dir = yield* tempDir;
        const input = join(dir, "de.jsonl");
        const verb = (word: string, participle: string) =>
          JSON.stringify({
            word,
            pos: "verb",
            lang_code: "de",
            senses: [{ glosses: [`to ${word}`] }],
            forms: [
              {
                form: participle,
                tags: ["participle", "present"],
                source: "conjugation",
              },
            ],
          });
        yield* Effect.promise(() =>
          writeFile(
            input,
            [
              verb("bestehen", "bestehend"),
              verb("vorspringen", "vorspringend"),
              // Wiktionary has this participle as an adjective of its own
              JSON.stringify({
                word: "bestehend",
                pos: "adj",
                lang_code: "de",
                senses: [{ glosses: ["existing"] }],
                forms: [
                  {
                    form: "bestehende",
                    tags: ["strong", "nominative", "feminine", "singular"],
                    source: "declension",
                  },
                ],
              }),
            ].join("\n"),
          ),
        );
        const out = join(dir, "de_en.sqlite");
        const stats = yield* importWiktextract({
          lang: "de",
          input,
          out,
          grammar: [],
        });
        const db = yield* openDictionary(out);
        const lemmas = (word: string) =>
          findEntriesByForm(db, word).map((e) => e.lemma);
        assert.deepStrictEqual(lemmas("vorspringende"), ["vorspringen"]);
        assert.deepStrictEqual(lemmas("bestehende"), ["bestehend"]);
        // the adjective's table lacks this one, so the verb gets it
        assert.deepStrictEqual(lemmas("bestehenden"), ["bestehen"]);
        assert.isAbove(stats.participleForms, 0);
      }).pipe(Effect.scoped),
  );
});
