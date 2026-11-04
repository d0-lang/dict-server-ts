import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppConfig, loadConfig } from "../config.ts";
import { importWiktextract } from "../importer/Importer.ts";
import { Dictionaries } from "./Dictionaries.ts";

const FIXTURE = join(
  import.meta.dirname,
  "..",
  "importer",
  "fixtures",
  "pl-sample.jsonl",
);

describe("Dictionaries", () => {
  it.effect("looks words up in the file of a listed pair", () =>
    Effect.gen(function* () {
      const dir = yield* Effect.acquireRelease(
        Effect.promise(() => mkdtemp(join(tmpdir(), "dict-files-"))),
        (dir) => Effect.promise(() => rm(dir, { recursive: true })),
      );
      yield* importWiktextract({
        lang: "pl",
        input: FIXTURE,
        out: join(dir, "pl_en.sqlite"),
      });
      yield* Effect.gen(function* () {
        const dictionaries = yield* Dictionaries;
        assert.deepStrictEqual(
          dictionaries.lookup("pl_en", "PSA").entries.map((e) => e.lemma),
          ["pies"],
        );
        assert.deepStrictEqual(dictionaries.lookup("pl_en", "nope"), {
          entries: [],
        });
      }).pipe(
        Effect.provide(
          Dictionaries.layer(dir).pipe(
            Layer.provide(
              Layer.succeed(AppConfig, {
                ...loadConfig(),
                languages: ["pl_en"],
              }),
            ),
          ),
        ),
      );
    }).pipe(Effect.scoped),
  );
});
