import { Effect, Result, Stream } from "effect";
import { createDictionaryFile } from "../dictionary/DictionaryDb.ts";
import { SCHEMA_VERSION } from "../dictionary/schema.ts";
import { ImportError, importFailure } from "./errors.ts";
import { loadGrammar, type GrammarEntry } from "./grammar.ts";
import {
  countForms,
  finalizeDatabase,
  prepareOutput,
  publish,
} from "./output/finalize.ts";
import { makeWriter } from "./output/writer.ts";
import { isUrl, openInput } from "./source/input.ts";
import { parseLine, type WiktextractEntry } from "./source/wiktextract.ts";
import {
  makeTally,
  tallyResult,
  topParentGlosses,
  type ImportStats,
  type Tally,
} from "./stats.ts";
import {
  LANGUAGES,
  languagePair,
  type LanguageRules,
} from "./transform/languages.ts";
import { transformEntry } from "./transform/transform.ts";

export { ImportError } from "./errors.ts";
export type { ImportStats } from "./stats.ts";

/** Raw English Wiktionary extract, every language (~3 GB gzipped). */
export const RAW_DUMP_URL =
  "https://kaikki.org/dictionary/raw-wiktextract-data.jsonl.gz";

const DEFAULT_BATCH_SIZE = 1000;

export type ImportOptions = {
  /** wiktextract `lang_code`, must be configured in `languages.ts` */
  readonly lang: string;
  /** local path or http(s) URL; `.gz` is decompressed while streaming */
  readonly input: string;
  /** output file; built as `<out>.tmp` and renamed on success */
  readonly out: string;
  /** replace `out` if it already exists; otherwise the import fails up front */
  readonly force?: boolean;
  /** add form -> lemma rows from form-of / alt-of entries (default true) */
  readonly formOfFallback?: boolean;
  /** lines of the target language per write transaction */
  readonly batchSize?: number;
  /** stop after this many lines of the target language */
  readonly limit?: number;
  /** log progress every N target-language lines (0 = off) */
  readonly progressEvery?: number;
  /** grammar entries to use instead of `grammar/<lang>.tsv` (tests) */
  readonly grammar?: ReadonlyArray<GrammarEntry>;
};

export const languageRules = (
  lang: string,
): Effect.Effect<LanguageRules, ImportError> => {
  const rules = LANGUAGES[lang];
  return rules === undefined
    ? Effect.fail(
        new ImportError({
          message: `no import rules for "${lang}" (known: ${Object.keys(LANGUAGES).join(", ")})`,
        }),
      )
    : Effect.succeed(rules);
};

/** Entries of one language from the input, counting every line read. */
const readEntries = (input: string, langCode: string, tally: Tally) =>
  openInput(input).pipe(
    Stream.decodeText(),
    Stream.splitLines,
    Stream.filterMap((line) => {
      tally.linesScanned++;
      const parsed = parseLine(line, langCode);
      if (parsed === "invalid") tally.invalidLines++;
      return typeof parsed === "string"
        ? Result.failVoid
        : Result.succeed<WiktextractEntry>(parsed);
    }),
  );

/**
 * Stream a wiktextract JSONL (the raw all-language dump or an already filtered
 * file, plain or gzipped, local or remote), keep `lang_code == lang` and
 * build a fresh `<pair>.sqlite`.
 *
 * Parsing and SQLite writes are synchronous CPU work, so the pipeline is
 * sequential; the only async part is reading/decompressing the input.
 */
export const importWiktextract = Effect.fn("importWiktextract")(function* (
  options: ImportOptions,
) {
  const started = performance.now();
  const elapsedSeconds = () => (performance.now() - started) / 1000;
  const rules = yield* languageRules(options.lang);
  const tmp = `${options.out}.tmp`;
  const progressEvery = options.progressEvery ?? 0;
  const formOfFallback = options.formOfFallback ?? true;

  yield* prepareOutput(options.out, tmp, options.force ?? false);
  const db = yield* Effect.acquireRelease(
    Effect.try({
      try: () => createDictionaryFile(tmp),
      catch: importFailure(`cannot create ${tmp}`),
    }),
    (db) => Effect.sync(() => db.$client.close(false)),
  );
  const grammar = yield* Effect.try({
    try: () => options.grammar ?? loadGrammar(rules.code),
    catch: importFailure("cannot read the grammar file"),
  });
  const writer = makeWriter(db, grammar, rules.optionalLetters);
  const tally = makeTally();

  const logProgress = () =>
    console.error(
      `[${elapsedSeconds().toFixed(0)}s] ${tally.linesScanned} lines scanned, ${tally.languageLines} ${rules.code}, ${writer.counts.entries} entries`,
    );

  const writeBatch = (batch: ReadonlyArray<WiktextractEntry>) => {
    const results = batch.map((raw) => transformEntry(rules, raw));
    results.forEach((result) => tallyResult(tally, result));
    writer.writeBatch(results);
    const before = tally.languageLines;
    tally.languageLines += batch.length;
    if (
      progressEvery > 0 &&
      Math.floor(before / progressEvery) !==
        Math.floor(tally.languageLines / progressEvery)
    ) {
      logProgress();
    }
  };

  const entries = readEntries(options.input, rules.code, tally);
  yield* (
    options.limit === undefined
      ? entries
      : entries.pipe(Stream.take(options.limit))
  ).pipe(
    Stream.grouped(options.batchSize ?? DEFAULT_BATCH_SIZE),
    Stream.runForEach((batch) => Effect.sync(() => writeBatch(batch))),
  );

  const formOf = writer.finish(formOfFallback);
  const forms = countForms(db.$client);
  finalizeDatabase(db.$client, {
    schema_version: String(SCHEMA_VERSION),
    pair: languagePair(rules),
    lang_code: rules.code,
    source: isUrl(options.input) ? options.input : "local wiktextract file",
    imported_at: new Date().toISOString(),
    limit: options.limit === undefined ? "none" : String(options.limit),
    form_of_fallback: formOfFallback ? "on" : "off",
    entries: String(writer.counts.entries),
    forms: String(
      forms.lemma +
        forms.inflection +
        forms.formOf +
        forms.abbreviation +
        forms.letterVariant,
    ),
  });
  const fileBytes = yield* publish(tmp, options.out);

  const stats: ImportStats = {
    pair: languagePair(rules),
    input: options.input,
    out: options.out,
    linesScanned: tally.linesScanned,
    languageLines: tally.languageLines,
    invalidLines: tally.invalidLines,
    entries: writer.counts.entries,
    mergedLines: writer.counts.mergedLines,
    linesWithoutEntry: tally.linesWithoutEntry,
    senses: writer.counts.senses,
    skippedSenses: tally.skippedSenses,
    pronunciations: writer.counts.pronunciations,
    droppedForms: tally.droppedForms,
    forms,
    formOfLinks: writer.counts.formOfLinks,
    formOfUnresolved: formOf.unresolved,
    historicalEntries: writer.counts.historicalEntries,
    derivedCopied: writer.counts.derivedCopied,
    derivedBare: writer.counts.derivedBare,
    degreeMerged: writer.counts.degreeMerged,
    degreeDropped: writer.counts.degreeDropped,
    seeLinks: writer.counts.seeLinks,
    grammarEntries: writer.counts.grammarEntries,
    grammarReplaced: writer.counts.grammarReplaced,
    abbreviations: writer.counts.abbreviations,
    letterVariants: writer.counts.letterVariants,
    unspacedAbbreviations: writer.counts.unspacedAbbreviations,
    topParentGlosses: topParentGlosses(tally),
    fileBytes,
    seconds: elapsedSeconds(),
  };
  return stats;
}, Effect.scoped);
