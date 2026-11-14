import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDictionary } from "@dict/core/DictionaryDb";
import { importWiktextract } from "@dict/importer/Importer";
import { SOURCES } from "../common/sources.ts";
import { lookupWord } from "../lookup.ts";
import { languageOf } from "../testing/dictionary.ts";

const tempDir = Effect.acquireRelease(
  Effect.promise(() => mkdtemp(join(tmpdir(), "dict-import-"))),
  (dir) => Effect.promise(() => rm(dir, { recursive: true, force: true })),
);

const page = (title: string) =>
  `https://en.wiktionary.org/wiki/${encodeURIComponent(title)}#Polish`;

describe("importWiktextract", () => {
  it.effect(
    "credits each entry's Wiktionary pages and each recording's file page",
    () =>
      Effect.gen(function* () {
        const dir = yield* tempDir;
        const input = join(dir, "pl.jsonl");
        const line = (
          word: string,
          pos: string,
          senses: ReadonlyArray<object>,
          extra: object = {},
        ) => JSON.stringify({ word, pos, lang_code: "pl", senses, ...extra });
        const link = (gloss: string, target: string) => ({
          glosses: [gloss],
          tags: ["form-of"],
          form_of: [{ word: target }],
        });
        yield* Effect.promise(() =>
          writeFile(
            input,
            [
              line("koteczek", "noun", [link("diminutive of kotek", "kotek")]),
              line("kotek", "noun", [link("diminutive of kot", "kot")]),
              line("kot", "noun", [{ glosses: ["cat"] }], {
                sounds: [
                  {
                    ogg_url:
                      "https://upload.wikimedia.org/wikipedia/commons/2/2b/Pl-kot.ogg",
                    mp3_url:
                      "https://upload.wikimedia.org/wikipedia/commons/transcoded/2/2b/Pl-kot.ogg/Pl-kot.ogg.mp3",
                  },
                ],
              }),
              // Two etymologies, one headword: one entry, one page.
              line("pies", "noun", [{ glosses: ["dog"] }], {
                etymology_number: 1,
              }),
              line("pies", "noun", [{ glosses: ["cop"] }], {
                etymology_number: 2,
              }),
              line("Rzeczpospolita Polska", "name", [{ glosses: ["Poland"] }]),
            ].join("\n"),
          ),
        );
        const out = join(dir, "pl_en.sqlite");
        yield* importWiktextract({
          lang: "pl",
          input,
          out,
          grammar: [{ lemma: "i", pos: "CCONJ", senses: ["and"] }],
        });
        const db = yield* openDictionary(out);
        const lookup = (word: string) =>
          lookupWord(db, languageOf("pl_en"), word).entries;

        assert.deepStrictEqual(lookup("kot")[0]!.sources, [page("kot")]);
        // Two formats of one recording share their file page.
        assert.deepStrictEqual(lookup("kot")[0]!.pron?.audio, [
          {
            url: "https://upload.wikimedia.org/wikipedia/commons/2/2b/Pl-kot.ogg",
            source: "https://commons.wikimedia.org/wiki/File:Pl-kot.ogg",
          },
          {
            url: "https://upload.wikimedia.org/wikipedia/commons/transcoded/2/2b/Pl-kot.ogg/Pl-kot.ogg.mp3",
            source: "https://commons.wikimedia.org/wiki/File:Pl-kot.ogg",
          },
        ]);
        // The meaning was copied from `kot`, through `kotek`: both pages it was read from.
        const koteczek = lookup("koteczek")[0]!;
        assert.deepStrictEqual(
          koteczek.senses.map((s) => s.glosses),
          [["diminutive of kotek: cat"]],
        );
        assert.deepStrictEqual(koteczek.sources, [
          page("koteczek"),
          page("kot"),
        ]);
        assert.deepStrictEqual(
          lookup("pies").map((e) => e.sources),
          [[page("pies")]],
        );
        assert.deepStrictEqual(lookup("Rzeczpospolita Polska")[0]!.sources, [
          "https://en.wiktionary.org/wiki/Rzeczpospolita_Polska#Polish",
        ]);
        // The grammar file's entries are written by the server's maintainers.
        assert.strictEqual(lookup("i")[0]!.sources, undefined);

        // The client shows only links on the origin of a metadata source.
        const origins = new Set(SOURCES.map((s) => new URL(s.url).origin));
        const links = ["kot", "koteczek", "pies"].flatMap((word) =>
          lookup(word).flatMap((entry) => [
            ...(entry.sources ?? []),
            ...(entry.pron?.audio ?? []).flatMap((a) =>
              a.source === undefined ? [] : [a.source],
            ),
          ]),
        );
        assert.isAbove(links.length, 0);
        for (const url of links) {
          assert.isTrue(origins.has(new URL(url).origin), url);
        }
      }).pipe(Effect.scoped),
  );
});
