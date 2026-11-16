import { closeSync, openSync, writeSync } from "node:fs";
import { join } from "node:path";
import { Effect, Stream } from "effect";
import { ImportError, importFailure } from "./errors.ts";
import { languageRules } from "./Importer.ts";
import { prepareOutput, publish } from "./output/finalize.ts";
import { openInput } from "./source/input.ts";
import { parseLine } from "./source/wiktextract.ts";

const BATCH_LINES = 1000;

export type FilterOptions = {
  /** wiktextract `lang_code`s; each needs `languages/<lang>/language.toml` */
  readonly langs: ReadonlyArray<string>;
  /** local path or http(s) URL; `.gz` is decompressed while streaming */
  readonly input: string;
  /** directory for `<lang>.jsonl`, one plain JSONL file per language */
  readonly outDir: string;
  /** replace a file that already exists; otherwise fails up front */
  readonly force?: boolean;
};

export type FilterStats = {
  readonly linesScanned: number;
  readonly languages: ReadonlyArray<{
    readonly lang: string;
    readonly out: string;
    readonly languageLines: number;
    readonly fileBytes: number;
  }>;
};

/**
 * Copy each language's lines out of the raw dump, unchanged, in one pass over
 * it, so repeated imports don't have to scan the whole dump. Lines that can't
 * be parsed but mention a language are kept in its file, so an import of the
 * result counts them as invalid too. Each file is built as `<file>.tmp` and
 * renamed when the whole pass succeeds.
 */
export const filterDump = Effect.fn("filterDump")(function* (
  options: FilterOptions,
) {
  const langs = [...new Set(options.langs)];
  if (langs.length === 0) {
    return yield* Effect.fail(
      new ImportError({ message: "no language to filter" }),
    );
  }
  const outputs: Array<{
    readonly lang: string;
    readonly code: string;
    readonly out: string;
    readonly tmp: string;
    readonly fd: number;
    lines: number;
  }> = [];
  for (const lang of langs) {
    const rules = yield* languageRules(lang);
    const out = join(options.outDir, `${lang}.jsonl`);
    const tmp = `${out}.tmp`;
    yield* prepareOutput(out, tmp, options.force ?? false);
    const fd = yield* Effect.acquireRelease(
      Effect.try({
        try: () => openSync(tmp, "w"),
        catch: importFailure(`cannot create ${tmp}`),
      }),
      (fd) => Effect.sync(() => closeSync(fd)),
    );
    outputs.push({ lang, code: rules.code, out, tmp, fd, lines: 0 });
  }

  let linesScanned = 0;
  yield* openInput(options.input).pipe(
    Stream.decodeText(),
    Stream.splitLines,
    Stream.grouped(BATCH_LINES),
    Stream.runForEach((batch) =>
      Effect.try({
        try: () => {
          linesScanned += batch.length;
          for (const output of outputs) {
            const kept = batch.filter(
              (line) => parseLine(line, output.code) !== "other-language",
            );
            if (kept.length === 0) continue;
            writeSync(output.fd, kept.join("\n") + "\n");
            output.lines += kept.length;
          }
        },
        catch: importFailure("cannot write the filtered files"),
      }),
    ),
  );

  const languages: Array<FilterStats["languages"][number]> = [];
  for (const output of outputs) {
    const fileBytes = yield* publish(output.tmp, output.out);
    languages.push({
      lang: output.lang,
      out: output.out,
      languageLines: output.lines,
      fileBytes,
    });
  }
  return { linesScanned, languages } satisfies FilterStats;
}, Effect.scoped);
