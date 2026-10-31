import { mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { Effect, Exit, Result, Schema, Stream } from "effect";
import { createDictionaryFile } from "../dictionary/DictionaryDb.ts";
import { FormSource, SCHEMA_VERSION } from "../dictionary/schema.ts";
import { LANGUAGES, languagePair, type LanguageRules } from "./languages.ts";
import { transformEntry } from "./transform.ts";
import { decodeWiktextractEntry, lineMayBeLanguage } from "./wiktextract.ts";
import { makeWriter } from "./writer.ts";

/** Raw English Wiktionary extract, every language (~3 GB gzipped). */
export const RAW_DUMP_URL =
  "https://kaikki.org/dictionary/raw-wiktextract-data.jsonl.gz";

export class ImportError extends Schema.TaggedError<ImportError>()(
  "ImportError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export type ImportOptions = {
  /** wiktextract `lang_code`, must be configured in `languages.ts` */
  readonly lang: string;
  /** local path or http(s) URL; `.gz` is decompressed while streaming */
  readonly input: string;
  /** output file; built as `<out>.tmp` and renamed on success */
  readonly out: string;
  /** add form -> lemma rows from form-of / alt-of entries (default true) */
  readonly formOfFallback?: boolean;
  /** lines of the target language per write transaction */
  readonly batchSize?: number;
  /** stop after this many lines of the target language */
  readonly limit?: number;
  /** log progress every N target-language lines (0 = off) */
  readonly progressEvery?: number;
};

export type ImportStats = {
  readonly pair: string;
  readonly input: string;
  readonly out: string;
  readonly linesScanned: number;
  readonly languageLines: number;
  readonly invalidLines: number;
  readonly entries: number;
  readonly mergedLines: number;
  readonly linesWithoutEntry: number;
  readonly senses: number;
  readonly skippedSenses: {
    archaic: number;
    historical: number;
    noGloss: number;
  };
  readonly pronunciations: number;
  readonly droppedForms: number;
  readonly forms: { lemma: number; inflection: number; formOf: number };
  readonly formOfLinks: number;
  readonly formOfUnresolved: number;
  readonly fileBytes: number;
  readonly seconds: number;
};

const isUrl = (input: string) => /^https?:\/\//.test(input);

const fail = (message: string) => (cause: unknown) =>
  new ImportError({
    message: `${message}: ${cause instanceof Error ? cause.message : String(cause)}`,
    cause,
  });

/** Bytes of a local file or URL, gunzipped when the name ends in `.gz`. */
export const openInput = (
  input: string,
): Stream.Stream<Uint8Array, ImportError> => {
  const gunzip = (body: ReadableStream<Uint8Array>) =>
    /\.gz($|\?)/.test(input)
      ? body.pipeThrough(
          new DecompressionStream("gzip") as ReadableWritablePair<
            Uint8Array,
            Uint8Array
          >,
        )
      : body;
  const onError = fail(`reading ${input}`);
  if (!isUrl(input)) {
    return Stream.unwrap(
      Effect.tryPromise({
        try: () => stat(input),
        catch: fail(`cannot open ${input}`),
      }).pipe(
        Effect.as(
          Stream.fromReadableStream({
            evaluate: () => gunzip(Bun.file(input).stream()),
            onError,
          }),
        ),
      ),
    );
  }
  return Stream.unwrap(
    Effect.tryPromise({ try: () => fetch(input), catch: onError }).pipe(
      Effect.flatMap((response) =>
        response.ok && response.body !== null
          ? Effect.succeed(response.body)
          : Effect.fail(
              new ImportError({
                message: `GET ${input}: HTTP ${response.status}`,
              }),
            ),
      ),
      Effect.map((body) =>
        Stream.fromReadableStream({ evaluate: () => gunzip(body), onError }),
      ),
    ),
  );
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
  const rules = yield* languageRules(options.lang);
  const tmp = `${options.out}.tmp`;
  const progressEvery = options.progressEvery ?? 0;
  const formOfFallback = options.formOfFallback ?? true;

  yield* Effect.tryPromise({
    try: async () => {
      await mkdir(dirname(options.out), { recursive: true });
      await rm(tmp, { force: true });
    },
    catch: fail(`cannot prepare ${tmp}`),
  });

  const db = yield* Effect.acquireRelease(
    Effect.try({
      try: () => createDictionaryFile(tmp),
      catch: fail(`cannot create ${tmp}`),
    }),
    (db) => Effect.sync(() => db.$client.close(false)),
  );
  const writer = makeWriter(db);
  const read = { scanned: 0, language: 0, invalid: 0, withoutEntry: 0 };
  const skipped = { archaic: 0, historical: 0, noGloss: 0 };
  let droppedForms = 0;

  const parse = (line: string) => {
    read.scanned++;
    if (!lineMayBeLanguage(line, rules.code)) return undefined;
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch {
      read.invalid++;
      return undefined;
    }
    if (
      typeof json !== "object" ||
      json === null ||
      (json as { lang_code?: unknown }).lang_code !== rules.code
    ) {
      return undefined; // the code only appeared nested (e.g. in translations)
    }
    const decoded = decodeWiktextractEntry(json);
    if (Exit.isFailure(decoded)) {
      read.invalid++;
      return undefined;
    }
    return decoded.value;
  };

  let entries = openInput(options.input).pipe(
    Stream.decodeText(),
    Stream.splitLines,
    Stream.filterMap((line) => {
      const entry = parse(line);
      return entry === undefined ? Result.failVoid : Result.succeed(entry);
    }),
  );
  if (options.limit !== undefined) {
    entries = entries.pipe(Stream.take(options.limit));
  }

  yield* entries.pipe(
    Stream.grouped(options.batchSize ?? 1000),
    Stream.runForEach((batch) =>
      Effect.sync(() => {
        const results = batch.map((raw) => transformEntry(rules, raw));
        for (const r of results) {
          if (r.entry === undefined) read.withoutEntry++;
          skipped.archaic += r.skippedSenses.archaic;
          skipped.historical += r.skippedSenses.historical;
          skipped.noGloss += r.skippedSenses["no-gloss"];
          droppedForms += r.droppedForms;
        }
        writer.writeBatch(results);
        const before = read.language;
        read.language += batch.length;
        if (
          progressEvery > 0 &&
          Math.floor(before / progressEvery) !==
            Math.floor(read.language / progressEvery)
        ) {
          const secs = ((performance.now() - started) / 1000).toFixed(0);
          console.error(
            `[${secs}s] ${read.scanned} lines scanned, ${read.language} ${rules.code}, ${writer.counts.entries} entries`,
          );
        }
      }),
    ),
  );

  const formOf = writer.resolveFormOf(formOfFallback);
  const sqlite = db.$client;
  const countForms = (source: FormSource) =>
    sqlite
      .query<{ n: number }, [number]>(
        "SELECT count(*) AS n FROM forms WHERE source = ?",
      )
      .get(source)?.n ?? 0;
  const forms = {
    lemma: countForms(FormSource.Lemma),
    inflection: countForms(FormSource.Inflection),
    formOf: countForms(FormSource.FormOf),
  };

  const meta: Record<string, string> = {
    schema_version: String(SCHEMA_VERSION),
    pair: languagePair(rules),
    lang_code: rules.code,
    source: isUrl(options.input) ? options.input : "local wiktextract file",
    imported_at: new Date().toISOString(),
    limit: options.limit === undefined ? "none" : String(options.limit),
    form_of_fallback: formOfFallback ? "on" : "off",
    entries: String(writer.counts.entries),
    forms: String(forms.lemma + forms.inflection + forms.formOf),
  };
  const insertMeta = sqlite.prepare(
    "INSERT INTO meta (key, value) VALUES (?, ?)",
  );
  sqlite.transaction(() => {
    for (const [k, v] of Object.entries(meta)) insertMeta.run(k, v);
  })();
  sqlite.run("ANALYZE");
  sqlite.run("VACUUM");
  sqlite.close(false);

  yield* Effect.tryPromise({
    try: () => rename(tmp, options.out),
    catch: fail(`cannot move ${tmp} to ${options.out}`),
  });
  const fileBytes = (yield* Effect.tryPromise({
    try: () => stat(options.out),
    catch: fail(`cannot stat ${options.out}`),
  })).size;

  const stats: ImportStats = {
    pair: languagePair(rules),
    input: options.input,
    out: options.out,
    linesScanned: read.scanned,
    languageLines: read.language,
    invalidLines: read.invalid,
    entries: writer.counts.entries,
    mergedLines: writer.counts.mergedLines,
    linesWithoutEntry: read.withoutEntry,
    senses: writer.counts.senses,
    skippedSenses: skipped,
    pronunciations: writer.counts.pronunciations,
    droppedForms,
    forms,
    formOfLinks: writer.counts.formOfLinks,
    formOfUnresolved: formOf.unresolved,
    fileBytes,
    seconds: (performance.now() - started) / 1000,
  };
  return stats;
}, Effect.scoped);
