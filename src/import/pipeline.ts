import { Clock, Effect, Ref, Stream } from "effect";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import {
  classifyLine,
  type ClassifyStats,
  addClassifyStats,
  emptyClassifyStats,
} from "./classify.ts";
import { ImportError } from "./errors.ts";
import { foldKey } from "./fold.ts";
import { lineMentionsLanguage } from "./filter.ts";
import { readJsonlLines } from "./jsonl.ts";
import { languageProfile } from "./languages.ts";
import {
  DictionaryStore,
  removeDbFiles,
  type StorageReport,
} from "../storage/DictionaryStore.ts";
import type {
  StoredEntry,
  StoredFallback,
} from "../storage/DictionaryStore.ts";
import type { PreparedEntry, FormLink } from "./classify.ts";

export type ImportOptions = {
  readonly lang: string;
  readonly input: string;
  readonly output: string;
  readonly batchSize: number;
  readonly concurrency: number;
  readonly vacuum: boolean;
};

export type ImportReport = {
  readonly pair: string;
  readonly stats: ClassifyStats & { readonly linesRead: number };
  readonly storage: StorageReport;
  readonly elapsedMs: number;
};

const toStoredEntry = (entry: PreparedEntry, locale: string): StoredEntry => ({
  lemma: entry.lemma,
  lemmaKey: foldKey(entry.lemma, locale),
  pos: entry.pos,
  etymologyNumber: entry.etymologyNumber,
  ipa: entry.ipa,
  audio: entry.audio,
  reading: undefined,
  senses: entry.senses.map((sense) => ({ translations: sense.translations })),
  forms: entry.forms.map((form) => ({
    form,
    formKey: foldKey(form, locale),
  })),
});

const toStoredFallback = (link: FormLink, locale: string): StoredFallback => ({
  form: link.form,
  formKey: foldKey(link.form, locale),
  lemma: link.lemma,
  lemmaKey: foldKey(link.lemma, locale),
  pos: link.pos,
});

export const importLanguage = Effect.fn("importLanguage")(function* (
  options: ImportOptions,
) {
  const profile = languageProfile(options.lang);
  yield* Effect.try({
    try: () => {
      removeDbFiles(options.output);
    },
    catch: (cause) =>
      new ImportError({
        message: `Failed to replace ${options.output}`,
        cause,
      }),
  });
  yield* Effect.tryPromise({
    try: () => mkdir(dirname(options.output), { recursive: true }),
    catch: (cause) =>
      new ImportError({
        message: `Failed to create ${dirname(options.output)}`,
        cause,
      }),
  });

  const started = yield* Clock.currentTimeMillis;
  const report = yield* Effect.scoped(
    Effect.gen(function* () {
      const store = yield* DictionaryStore;
      const stats = yield* Ref.make(emptyClassifyStats());
      const linesRead = yield* Ref.make(0);

      yield* readJsonlLines(options.input).pipe(
        Stream.grouped(options.batchSize),
        Stream.mapEffect(
          (group, index) =>
            Effect.gen(function* () {
              const lines = Array.from(group);
              yield* Ref.update(linesRead, (count) => count + lines.length);
              let combined = emptyClassifyStats();
              const storedEntries: StoredEntry[] = [];
              const storedFallbacks: StoredFallback[] = [];
              for (const line of lines) {
                const classified = classifyLine(line, profile);
                combined = addClassifyStats(combined, classified.stats);
                if (classified.entry !== undefined) {
                  storedEntries.push(
                    toStoredEntry(classified.entry, profile.locale),
                  );
                }
                for (const link of classified.fallbacks) {
                  storedFallbacks.push(toStoredFallback(link, profile.locale));
                }
              }
              yield* store.writeBatch({
                entries: storedEntries,
                fallbacks: storedFallbacks,
              });
              yield* Ref.update(stats, (current) =>
                addClassifyStats(current, combined),
              );
              if (index > 0 && index % 200 === 0) {
                const read = yield* Ref.get(linesRead);
                const soFar = yield* Ref.get(stats);
                yield* Effect.logInfo(
                  `import ${profile.pair}: ${read} lines, ${soFar.entries} entries`,
                );
              }
            }),
          { concurrency: options.concurrency },
        ),
        Stream.runDrain,
      );

      const storage = yield* store.finish({ vacuum: options.vacuum });
      const classifyStats = yield* Ref.get(stats);
      const read = yield* Ref.get(linesRead);
      yield* store.writeMeta({
        pair: profile.pair,
        lang: profile.code,
        gloss_lang: profile.glossLanguage,
        source: options.input,
      });
      return {
        pair: profile.pair,
        stats: { ...classifyStats, linesRead: read },
        storage,
      };
    }).pipe(Effect.provide(DictionaryStore.layer(options.output))),
  );
  const elapsedMs = (yield* Clock.currentTimeMillis) - started;
  return { ...report, elapsedMs };
});

export const filterLanguageFile = Effect.fn("filterLanguageFile")(
  function* (options: {
    readonly lang: string;
    readonly input: string;
    readonly output: string;
  }) {
    const profile = languageProfile(options.lang);
    yield* Effect.tryPromise({
      try: () => mkdir(dirname(options.output), { recursive: true }),
      catch: (cause) =>
        new ImportError({
          message: `Failed to create ${dirname(options.output)}`,
          cause,
        }),
    });

    return yield* Effect.scoped(
      Effect.gen(function* () {
        const output = yield* Effect.acquireRelease(
          Effect.sync(() =>
            createWriteStream(options.output, { encoding: "utf8" }),
          ),
          (stream) =>
            Effect.callback<void>((resume) => {
              stream.end(() => {
                resume(Effect.void);
              });
            }),
        );
        const linesRead = yield* Ref.make(0);
        const linesKept = yield* Ref.make(0);
        yield* readJsonlLines(options.input).pipe(
          Stream.mapEffect(
            (line) =>
              Effect.gen(function* () {
                yield* Ref.update(linesRead, (count) => count + 1);
                if (!lineMentionsLanguage(line, profile.code)) {
                  return;
                }
                yield* Ref.update(linesKept, (count) => count + 1);
                yield* Effect.callback<void, ImportError>((resume) => {
                  output.write(`${line}\n`, (error) => {
                    if (error === null || error === undefined) {
                      resume(Effect.void);
                      return;
                    }
                    resume(
                      Effect.fail(
                        new ImportError({
                          message: `Failed to write ${options.output}`,
                          cause: error,
                        }),
                      ),
                    );
                  });
                });
              }),
            { concurrency: 1 },
          ),
          Stream.runDrain,
        );
        return {
          linesRead: yield* Ref.get(linesRead),
          linesKept: yield* Ref.get(linesKept),
        };
      }),
    );
  },
);
