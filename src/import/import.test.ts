import { assert, describe, it } from "@effect/vitest";
import { Database } from "bun:sqlite";
import { Effect } from "effect";
import { gzipSync } from "node:zlib";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyLine } from "./classify.ts";
import { lineMentionsLanguage } from "./filter.ts";
import { foldKey } from "./fold.ts";
import { languageProfile } from "./languages.ts";
import { filterLanguageFile, importLanguage } from "./pipeline.ts";
import { DictionaryStore } from "../storage/DictionaryStore.ts";

const fixturePath = new URL("./fixtures/sample-pl.jsonl", import.meta.url)
  .pathname;

const tempDir = (): string => mkdtempSync(join(tmpdir(), "dict-import-"));

describe("lineMentionsLanguage", () => {
  it.effect(
    "keeps Polish entries and skips Polish translations of other languages",
    () =>
      Effect.sync(() => {
        const lines = readFileSync(fixturePath, "utf8")
          .split("\n")
          .filter((line) => line.length > 0);
        const polish = lines.filter((line) => lineMentionsLanguage(line, "pl"));
        assert.strictEqual(polish.length, 13);
        assert.isFalse(
          lineMentionsLanguage(
            lines.find((line) => line.includes('"word":"house"')) ?? "",
            "pl",
          ),
        );
      }),
  );
});

describe("classifyLine", () => {
  it.effect("keeps a living sense whose categories include Middle Polish", () =>
    Effect.sync(() => {
      const profile = languageProfile("pl");
      const living = classifyLine(
        JSON.stringify({
          word: "mapa",
          lang: "Polish",
          lang_code: "pl",
          pos: "noun",
          senses: [
            {
              glosses: ["map"],
              tags: ["feminine"],
              categories: ["Middle Polish", "Polish lemmas"],
            },
          ],
        }),
        profile,
      );
      assert.strictEqual(living.entry?.lemma, "mapa");
      assert.strictEqual(living.stats.sensesDroppedArchaic, 0);

      const historical = classifyLine(
        JSON.stringify({
          word: "absent",
          lang: "Polish",
          lang_code: "pl",
          pos: "noun",
          senses: [
            {
              glosses: ["absence"],
              tags: ["Middle", "Polish"],
              categories: ["Middle Polish"],
            },
          ],
        }),
        profile,
      );
      assert.strictEqual(historical.entry, undefined);
      assert.strictEqual(historical.stats.sensesDroppedArchaic, 1);
    }),
  );
});

describe("importLanguage", () => {
  it.effect("builds lookup rows from the Polish fixture", () =>
    Effect.gen(function* () {
      const dir = tempDir();
      const output = join(dir, "pl_en.sqlite");
      const report = yield* importLanguage({
        lang: "pl",
        input: fixturePath,
        output,
        batchSize: 3,
        concurrency: 1,
        vacuum: false,
      });

      assert.strictEqual(report.pair, "pl_en");
      assert.strictEqual(report.stats.linesRead, 14);
      assert.strictEqual(report.stats.entries, 4);
      assert.strictEqual(report.stats.senses, 5);
      assert.strictEqual(report.stats.formOfEntries, 6);
      assert.strictEqual(report.stats.altOfEntries, 1);
      assert.strictEqual(report.stats.fallbackLinks, 5);
      assert.strictEqual(report.stats.sensesDroppedAltOf, 1);
      assert.strictEqual(report.stats.sensesDroppedArchaic, 2);
      assert.strictEqual(report.stats.sensesDroppedEmpty, 1);
      assert.strictEqual(report.stats.langMismatches, 1);
      assert.strictEqual(report.stats.badLines, 1);
      assert.strictEqual(report.stats.unknownPos.prefix, 1);
      assert.strictEqual(report.storage.entries, 4);
      assert.strictEqual(report.storage.senses, 5);
      assert.strictEqual(report.storage.formsBeforeFallback, 8);
      assert.strictEqual(report.storage.fallbackExactInserted, 3);
      assert.strictEqual(report.storage.fallbackFoldedInserted, 0);
      assert.strictEqual(report.storage.fallbackUnresolved, 1);
      assert.strictEqual(report.storage.forms, 11);

      const found = yield* Effect.scoped(
        Effect.gen(function* () {
          const store = yield* DictionaryStore;
          const domu = yield* store.lookupByFormKey(foldKey("DOMU", "pl"));
          const domowi = yield* store.lookupByFormKey(foldKey("domowi", "pl"));
          const zamek = yield* store.lookupByFormKey(foldKey("zamek", "pl"));
          const zamku = yield* store.lookupByFormKey(foldKey("zamku", "pl"));
          const zamki = yield* store.lookupByFormKey(foldKey("zamki", "pl"));
          const prefix = yield* store.lookupByFormKey(foldKey("nie-", "pl"));
          const missing = yield* store.lookupByFormKey(foldKey("brak", "pl"));
          return { domu, domowi, zamek, zamku, zamki, prefix, missing };
        }).pipe(Effect.provide(DictionaryStore.layer(output))),
      );

      assert.strictEqual(found.domu.length, 1);
      assert.strictEqual(found.domu[0]?.lemma, "dom");
      assert.strictEqual(found.domu[0]?.pos, "NOUN");
      assert.deepStrictEqual(
        found.domu[0]?.senses.map((sense) => sense.translations),
        [["house"], ["home (dwelling)"]],
      );
      assert.deepStrictEqual(found.domu[0]?.pron?.ipa, ["/dɔm/", "[dɔm]"]);
      assert.deepStrictEqual(found.domu[0]?.pron?.audio, [
        "https://upload.wikimedia.org/wikipedia/commons/a/a0/Pl-dom.ogg",
      ]);
      assert.strictEqual(found.domowi.length, 1);
      assert.strictEqual(found.domowi[0]?.lemma, "dom");
      assert.strictEqual(found.zamek.length, 2);
      assert.deepStrictEqual(
        found.zamek.map((entry) => entry.senses[0]?.translations),
        [["castle"], ["lock (device)"]],
      );
      assert.deepStrictEqual(found.zamku[0]?.senses[0]?.translations, [
        "castle",
      ]);
      assert.deepStrictEqual(found.zamki[0]?.senses[0]?.translations, [
        "lock (device)",
      ]);
      assert.strictEqual(found.prefix[0]?.pos, "X");
      assert.strictEqual(found.missing.length, 0);

      const sqlite = new Database(output, { readonly: true });
      const etymology = sqlite
        .prepare(
          "SELECT lemma, etymology_number FROM entries WHERE lemma = 'zamek' ORDER BY id",
        )
        .all() as Array<{ lemma: string; etymology_number: string }>;
      assert.deepStrictEqual(
        etymology.map((row) => row.etymology_number),
        ["1", "2"],
      );
      const domuForms = sqlite
        .prepare(
          `SELECT form FROM forms
           WHERE entry_id = (SELECT id FROM entries WHERE lemma = 'dom')
           ORDER BY form`,
        )
        .all() as Array<{ form: string }>;
      assert.deepStrictEqual(
        domuForms.map((row) => row.form),
        ["Domu", "dom", "domowi", "domu", "domy", "dóm"],
      );
      const pair = sqlite
        .prepare("SELECT value FROM meta WHERE key = 'pair'")
        .get() as {
        value: string;
      };
      assert.strictEqual(pair.value, "pl_en");
      sqlite.close();
    }),
  );

  it.effect("reads a gzipped JSONL file", () =>
    Effect.gen(function* () {
      const dir = tempDir();
      const input = join(dir, "sample.jsonl.gz");
      const output = join(dir, "pl_en.sqlite");
      writeFileSync(input, gzipSync(readFileSync(fixturePath)));
      const report = yield* importLanguage({
        lang: "pl",
        input,
        output,
        batchSize: 500,
        concurrency: 1,
        vacuum: false,
      });
      assert.strictEqual(report.storage.entries, 4);
      assert.strictEqual(report.storage.forms, 11);
    }),
  );
});

describe("filterLanguageFile", () => {
  it.effect("writes lines whose own language matches", () =>
    Effect.gen(function* () {
      const dir = tempDir();
      const output = join(dir, "pl.jsonl");
      const report = yield* filterLanguageFile({
        lang: "pl",
        input: fixturePath,
        output,
      });
      assert.strictEqual(report.linesRead, 14);
      assert.strictEqual(report.linesKept, 13);
      const kept = readFileSync(output, "utf8")
        .split("\n")
        .filter((line) => line.length > 0);
      assert.strictEqual(kept.length, 13);
      assert.isFalse(kept.some((line) => line.includes('"word":"house"')));
    }),
  );
});
