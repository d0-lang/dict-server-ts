import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";
import { Stream } from "effect";
import { ImportError } from "./errors.ts";

const iterateLines = async function* (
  path: string,
): AsyncGenerator<string, void, undefined> {
  const input = createReadStream(path);
  const source = path.endsWith(".gz") ? input.pipe(createGunzip()) : input;
  source.setEncoding("utf8");
  const lines = createInterface({ input: source, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (line.length > 0) {
        yield line;
      }
    }
  } finally {
    lines.close();
  }
};

/** One JSON object per line. `.gz` inputs are inflated while reading. */
export const readJsonlLines = (
  path: string,
): Stream.Stream<string, ImportError> =>
  Stream.fromAsyncIterable(
    iterateLines(path),
    (cause) =>
      new ImportError({
        message: `Failed to read ${path}`,
        cause,
      }),
  );
