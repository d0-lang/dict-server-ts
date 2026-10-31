import { Database } from "bun:sqlite";
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { Effect, Schema } from "effect";
import { DDL, SCHEMA_VERSION, schema } from "./schema.ts";

/** Drizzle handle for one `<pair>.sqlite` file. Each language file gets its own. */
export type DictionaryDb = BunSQLiteDatabase<typeof schema> & {
  readonly $client: Database;
};

export class DictionaryOpenError extends Schema.TaggedError<DictionaryOpenError>()(
  "DictionaryOpenError",
  {
    path: Schema.String,
    message: Schema.String,
  },
) {}

const wrap = (client: Database): DictionaryDb =>
  drizzle({ client, schema }) as DictionaryDb;

/**
 * Create an empty dictionary file for the importer (the file must not exist).
 * Durability is switched off: the importer writes to a temp file and renames
 * it only after a successful run, so a crash just leaves garbage to delete.
 */
export const createDictionaryFile = (path: string): DictionaryDb => {
  const client = new Database(path, { create: true, strict: true });
  client.run("PRAGMA journal_mode = OFF");
  client.run("PRAGMA synchronous = OFF");
  client.run("PRAGMA temp_store = FILE");
  client.run("PRAGMA cache_size = -200000"); // ~200 MB page cache
  client.run(DDL);
  client.run(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  return wrap(client);
};

/**
 * Open a finished dictionary read-only, scoped: the connection closes with the
 * scope. Fails when the file is missing or was built for another schema.
 */
export const openDictionary = Effect.fnUntraced(function* (path: string) {
  return yield* Effect.acquireRelease(
    Effect.try({
      try: () => {
        const client = new Database(path, { readonly: true, strict: true });
        const version =
          client
            .query<{ user_version: number }, []>("PRAGMA user_version")
            .get()?.user_version ?? 0;
        if (version !== SCHEMA_VERSION) {
          client.close();
          throw new Error(
            `schema version ${version}, expected ${SCHEMA_VERSION}; re-run the importer`,
          );
        }
        return wrap(client);
      },
      catch: (cause) =>
        new DictionaryOpenError({
          path,
          message: cause instanceof Error ? cause.message : String(cause),
        }),
    }),
    (db) => Effect.sync(() => db.$client.close()),
  );
});
