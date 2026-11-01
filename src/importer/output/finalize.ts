import type { Database } from "bun:sqlite";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { Effect } from "effect";
import { FormSource } from "../../dictionary/schema.ts";
import { importFailure } from "../errors.ts";

/** Create the output directory and remove any temp file from an earlier run. */
export const prepareOutput = (out: string, tmp: string) =>
  Effect.tryPromise({
    try: async () => {
      await mkdir(dirname(out), { recursive: true });
      await rm(tmp, { force: true });
    },
    catch: importFailure(`cannot prepare ${tmp}`),
  });

export const countForms = (sqlite: Database) => {
  const count = (source: FormSource) =>
    sqlite
      .query<{ n: number }, [number]>(
        "SELECT count(*) AS n FROM forms WHERE source = ?",
      )
      .get(source)?.n ?? 0;
  return {
    lemma: count(FormSource.Lemma),
    inflection: count(FormSource.Inflection),
    formOf: count(FormSource.FormOf),
  };
};

/** Write `meta`, compact the file and close it so it can be renamed. */
export const finalizeDatabase = (
  sqlite: Database,
  meta: Readonly<Record<string, string>>,
) => {
  const insertMeta = sqlite.prepare(
    "INSERT INTO meta (key, value) VALUES (?, ?)",
  );
  sqlite.transaction(() => {
    for (const [key, value] of Object.entries(meta)) {
      insertMeta.run(key, value);
    }
  })();
  sqlite.run("ANALYZE");
  sqlite.run("VACUUM");
  sqlite.close(false);
};

/** Move the finished file into place and return its size. */
export const publish = Effect.fnUntraced(function* (tmp: string, out: string) {
  yield* Effect.tryPromise({
    try: () => rename(tmp, out),
    catch: importFailure(`cannot move ${tmp} to ${out}`),
  });
  const file = yield* Effect.tryPromise({
    try: () => stat(out),
    catch: importFailure(`cannot stat ${out}`),
  });
  return file.size;
});
