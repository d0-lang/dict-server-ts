import { stat } from "node:fs/promises";
import { Effect, Stream } from "effect";
import { ImportError, importFailure } from "../errors.ts";

export const isUrl = (input: string) => /^https?:\/\//.test(input);

const isGzipped = (input: string) => /\.gz($|\?)/.test(input);

const gunzip = (body: ReadableStream<Uint8Array>) =>
  body.pipeThrough(
    new DecompressionStream("gzip") as ReadableWritablePair<
      Uint8Array,
      Uint8Array
    >,
  );

const openLocalFile = (path: string) =>
  Effect.tryPromise({
    try: () => stat(path),
    catch: importFailure(`cannot open ${path}`),
  }).pipe(Effect.map(() => Bun.file(path).stream()));

const openUrl = (url: string) =>
  Effect.tryPromise({
    try: () => fetch(url),
    catch: importFailure(`reading ${url}`),
  }).pipe(
    Effect.flatMap((response) =>
      response.ok && response.body !== null
        ? Effect.succeed(response.body)
        : Effect.fail(
            new ImportError({ message: `GET ${url}: HTTP ${response.status}` }),
          ),
    ),
  );

/** Bytes of a local file or URL, gunzipped when the name ends in `.gz`. */
export const openInput = (
  input: string,
): Stream.Stream<Uint8Array, ImportError> =>
  Stream.unwrap(
    (isUrl(input) ? openUrl(input) : openLocalFile(input)).pipe(
      Effect.map((body) =>
        Stream.fromReadableStream({
          evaluate: () => (isGzipped(input) ? gunzip(body) : body),
          onError: importFailure(`reading ${input}`),
        }),
      ),
    ),
  );
