import { closeSync, openSync, writeSync } from "node:fs";
import { Effect, Stream } from "effect";
import { importFailure } from "./errors.ts";
import { languageRules } from "./Importer.ts";
import { prepareOutput, publish } from "./output/finalize.ts";
import { openInput } from "./source/input.ts";
import { parseLine } from "./source/wiktextract.ts";

const BATCH_LINES = 1000;

export type FilterOptions = {
  /** wiktextract `lang_code`, must be configured in `languages.ts` */
  readonly lang: string;
  /** local path or http(s) URL; `.gz` is decompressed while streaming */
  readonly input: string;
  /** plain JSONL output; built as `<out>.tmp` and renamed on success */
  readonly out: string;
  /** replace `out` if it already exists; otherwise fails up front */
  readonly force?: boolean;
};

/**
 * Copy one language's lines out of the raw dump, unchanged, so repeated imports
 * don't have to scan the whole dump. Lines that can't be parsed but mention the
 * language are kept, so an import of the result counts them as invalid too.
 */
export const filterDump = Effect.fn("filterDump")(function* (
  options: FilterOptions,
) {
  const rules = yield* languageRules(options.lang);
  const tmp = `${options.out}.tmp`;
  yield* prepareOutput(options.out, tmp, options.force ?? false);

  const fd = yield* Effect.acquireRelease(
    Effect.try({
      try: () => openSync(tmp, "w"),
      catch: importFailure(`cannot create ${tmp}`),
    }),
    (fd) => Effect.sync(() => closeSync(fd)),
  );

  let linesScanned = 0;
  let languageLines = 0;
  yield* openInput(options.input).pipe(
    Stream.decodeText(),
    Stream.splitLines,
    Stream.filter((line) => {
      linesScanned++;
      return parseLine(line, rules.code) !== "other-language";
    }),
    Stream.grouped(BATCH_LINES),
    Stream.runForEach((batch) =>
      Effect.try({
        try: () => {
          writeSync(fd, batch.join("\n") + "\n");
          languageLines += batch.length;
        },
        catch: importFailure(`cannot write ${tmp}`),
      }),
    ),
  );

  const fileBytes = yield* publish(tmp, options.out);
  return { out: options.out, linesScanned, languageLines, fileBytes };
}, Effect.scoped);
