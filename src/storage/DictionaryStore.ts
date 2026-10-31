import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { Context, Effect, Layer } from "effect";
import { rmSync, statSync } from "node:fs";
import { ImportError } from "../import/errors.ts";
import {
  CREATE_ENTRY_INDEXES_SQL,
  CREATE_FORM_INDEX_SQL,
  CREATE_TABLES_SQL,
  dictionarySchema,
  entries,
  forms,
  meta,
  senses,
} from "./schema.ts";

const INSERT_CHUNK = 400;

export type StoredSense = {
  readonly translations: ReadonlyArray<string>;
};

export type StoredEntry = {
  readonly lemma: string;
  readonly lemmaKey: string;
  readonly pos: string;
  readonly etymologyNumber: string;
  readonly ipa: ReadonlyArray<string>;
  readonly audio: ReadonlyArray<string>;
  readonly reading: string | undefined;
  readonly senses: ReadonlyArray<StoredSense>;
  readonly forms: ReadonlyArray<{
    readonly form: string;
    readonly formKey: string;
  }>;
};

export type StoredFallback = {
  readonly form: string;
  readonly formKey: string;
  readonly lemma: string;
  readonly lemmaKey: string;
  readonly pos: string;
};

export type LookupEntry = {
  readonly lemma: string;
  readonly pos: string;
  readonly pron?: {
    readonly ipa?: ReadonlyArray<string>;
    readonly audio?: ReadonlyArray<string>;
    readonly reading?: string;
  };
  readonly senses: ReadonlyArray<{
    readonly translations: ReadonlyArray<string>;
  }>;
};

export type StorageReport = {
  readonly entries: number;
  readonly senses: number;
  readonly forms: number;
  readonly formsBeforeFallback: number;
  readonly fallbackExactInserted: number;
  readonly fallbackFoldedInserted: number;
  readonly fallbackUnresolved: number;
  readonly bytesBeforeFallback: number;
  readonly bytesAfterFallback: number;
  readonly bytesFinal: number;
  readonly tableBytes: Readonly<Record<string, number>> | undefined;
};

type WriteBatch = {
  readonly entries: ReadonlyArray<StoredEntry>;
  readonly fallbacks: ReadonlyArray<StoredFallback>;
};

type Sql = ReturnType<typeof drizzle<typeof dictionarySchema>>;

const chunks = <A>(items: ReadonlyArray<A>, size: number): A[][] => {
  const out: A[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
};

const jsonOrNull = (values: ReadonlyArray<string>): string | null =>
  values.length === 0 ? null : JSON.stringify(values);

const parseJsonList = (
  value: string | null,
): ReadonlyArray<string> | undefined => {
  if (value === null || value.length === 0) {
    return undefined;
  }
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed)) {
    return undefined;
  }
  const strings = parsed.filter(
    (item): item is string => typeof item === "string",
  );
  return strings.length === 0 ? undefined : strings;
};

export const removeDbFiles = (path: string): void => {
  for (const suffix of ["", "-wal", "-shm"]) {
    rmSync(`${path}${suffix}`, { force: true });
  }
};

const fileSize = (path: string): number => statSync(path).size;

const openDatabase = (path: string): Database => {
  const sqlite = new Database(path, { create: true });
  sqlite.exec("PRAGMA journal_mode = WAL");
  sqlite.exec("PRAGMA synchronous = NORMAL");
  sqlite.exec("PRAGMA temp_store = MEMORY");
  sqlite.exec("PRAGMA foreign_keys = OFF");
  sqlite.exec("PRAGMA cache_size = -262144");
  sqlite.exec(CREATE_TABLES_SQL);
  return sqlite;
};

const checkpoint = (sqlite: Database, path: string): number => {
  sqlite.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  return fileSize(path);
};

const countTable = (sqlite: Database, table: string): number => {
  const row = sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as {
    n: number;
  };
  return row.n;
};

const tableBytes = (
  sqlite: Database,
): Readonly<Record<string, number>> | undefined => {
  try {
    const rows = sqlite
      .prepare("SELECT name, SUM(pgsize) AS bytes FROM dbstat GROUP BY name")
      .all() as Array<{ name: string; bytes: number }>;
    const out: Record<string, number> = {};
    for (const row of rows) {
      out[row.name] = row.bytes;
    }
    return out;
  } catch {
    return undefined;
  }
};

const makeStore = (path: string, sqlite: Database, db: Sql) => {
  const insertFallback = sqlite.prepare(
    `INSERT INTO fallbacks (form, form_key, lemma, lemma_key, pos)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const lookupEntries = sqlite.prepare(
    `SELECT DISTINCT e.id AS id, e.lemma AS lemma, e.pos AS pos,
            e.ipa_json AS ipaJson, e.audio_json AS audioJson, e.reading AS reading
     FROM forms f
     JOIN entries e ON e.id = f.entry_id
     WHERE f.form_key = ?
     ORDER BY e.id`,
  );
  const lookupSenses = sqlite.prepare(
    `SELECT translations_json AS translationsJson
     FROM senses
     WHERE entry_id = ?
     ORDER BY position`,
  );

  const writeBatch = Effect.fn("DictionaryStore.writeBatch")(function* (
    batch: WriteBatch,
  ) {
    if (batch.entries.length === 0 && batch.fallbacks.length === 0) {
      return;
    }
    yield* Effect.try({
      try: () => {
        const tx = sqlite.transaction(() => {
          if (batch.entries.length > 0) {
            const inserted = db
              .insert(entries)
              .values(
                batch.entries.map((entry) => ({
                  lemma: entry.lemma,
                  lemmaKey: entry.lemmaKey,
                  pos: entry.pos,
                  etymologyNumber: entry.etymologyNumber,
                  ipaJson: jsonOrNull(entry.ipa),
                  audioJson: jsonOrNull(entry.audio),
                  reading: entry.reading ?? null,
                })),
              )
              .returning({ id: entries.id })
              .all();

            const senseRows: Array<{
              entryId: number;
              position: number;
              translationsJson: string;
            }> = [];
            const formRows: Array<{
              form: string;
              formKey: string;
              entryId: number;
            }> = [];

            for (let index = 0; index < batch.entries.length; index++) {
              const entry = batch.entries[index];
              const id = inserted[index]?.id;
              if (entry === undefined || id === undefined) {
                throw new Error("entry insert did not return an id");
              }
              entry.senses.forEach((sense, position) => {
                senseRows.push({
                  entryId: id,
                  position,
                  translationsJson: JSON.stringify(sense.translations),
                });
              });
              for (const form of entry.forms) {
                formRows.push({
                  form: form.form,
                  formKey: form.formKey,
                  entryId: id,
                });
              }
            }

            for (const chunk of chunks(senseRows, INSERT_CHUNK)) {
              db.insert(senses).values(chunk).run();
            }
            for (const chunk of chunks(formRows, INSERT_CHUNK)) {
              db.insert(forms).values(chunk).onConflictDoNothing().run();
            }
          }

          for (const link of batch.fallbacks) {
            insertFallback.run(
              link.form,
              link.formKey,
              link.lemma,
              link.lemmaKey,
              link.pos,
            );
          }
        });
        tx();
      },
      catch: (cause) =>
        new ImportError({ message: "Failed to write a batch", cause }),
    });
  });

  const finish = Effect.fn("DictionaryStore.finish")(function* (options: {
    readonly vacuum: boolean;
  }) {
    return yield* Effect.try({
      try: () => {
        sqlite.exec(CREATE_ENTRY_INDEXES_SQL);
        const formsBeforeFallback = countTable(sqlite, "forms");
        const bytesBeforeFallback = checkpoint(sqlite, path);

        const exact = sqlite
          .prepare(
            `INSERT OR IGNORE INTO forms (form, form_key, entry_id)
             SELECT f.form, f.form_key, e.id
             FROM fallbacks f
             JOIN entries e ON e.lemma = f.lemma AND e.pos = f.pos`,
          )
          .run();
        const folded = sqlite
          .prepare(
            `INSERT OR IGNORE INTO forms (form, form_key, entry_id)
             SELECT f.form, f.form_key, e.id
             FROM fallbacks f
             JOIN entries e ON e.lemma_key = f.lemma_key AND e.pos = f.pos
             WHERE NOT EXISTS (
               SELECT 1 FROM entries exact
               WHERE exact.lemma = f.lemma AND exact.pos = f.pos
             )`,
          )
          .run();
        const unresolvedRow = sqlite
          .prepare(
            `SELECT COUNT(*) AS n FROM (
               SELECT DISTINCT f.form, f.lemma, f.pos
               FROM fallbacks f
               WHERE NOT EXISTS (
                 SELECT 1 FROM entries e
                 WHERE e.pos = f.pos
                   AND (e.lemma = f.lemma OR e.lemma_key = f.lemma_key)
               )
             )`,
          )
          .get() as { n: number };

        const bytesAfterFallback = checkpoint(sqlite, path);
        sqlite.exec(CREATE_FORM_INDEX_SQL);
        if (options.vacuum) {
          sqlite.exec("VACUUM");
        }
        sqlite.exec("PRAGMA journal_mode = DELETE");
        const bytesFinal = checkpoint(sqlite, path);
        const report: StorageReport = {
          entries: countTable(sqlite, "entries"),
          senses: countTable(sqlite, "senses"),
          forms: countTable(sqlite, "forms"),
          formsBeforeFallback,
          fallbackExactInserted: exact.changes,
          fallbackFoldedInserted: folded.changes,
          fallbackUnresolved: unresolvedRow.n,
          bytesBeforeFallback,
          bytesAfterFallback,
          bytesFinal,
          tableBytes: tableBytes(sqlite),
        };
        return report;
      },
      catch: (cause) =>
        new ImportError({ message: "Failed to finish the import", cause }),
    });
  });

  const writeMeta = Effect.fn("DictionaryStore.writeMeta")(function* (
    values: Readonly<Record<string, string>>,
  ) {
    yield* Effect.try({
      try: () => {
        const rows = Object.entries(values).map(([key, value]) => ({
          key,
          value,
        }));
        if (rows.length === 0) {
          return;
        }
        db.insert(meta).values(rows).onConflictDoNothing().run();
      },
      catch: (cause) =>
        new ImportError({ message: "Failed to write import metadata", cause }),
    });
  });

  const lookupByFormKey = Effect.fn("DictionaryStore.lookupByFormKey")(
    function* (formKey: string) {
      return yield* Effect.try({
        try: () => {
          const rows = lookupEntries.all(formKey) as Array<{
            id: number;
            lemma: string;
            pos: string;
            ipaJson: string | null;
            audioJson: string | null;
            reading: string | null;
          }>;
          return rows.map((row): LookupEntry => {
            const ipa = parseJsonList(row.ipaJson);
            const audio = parseJsonList(row.audioJson);
            const reading =
              row.reading === null || row.reading.length === 0
                ? undefined
                : row.reading;
            const pron =
              ipa === undefined && audio === undefined && reading === undefined
                ? undefined
                : {
                    ...(ipa === undefined ? {} : { ipa }),
                    ...(audio === undefined ? {} : { audio }),
                    ...(reading === undefined ? {} : { reading }),
                  };
            const senseRows = lookupSenses.all(row.id) as Array<{
              translationsJson: string;
            }>;
            return {
              lemma: row.lemma,
              pos: row.pos,
              ...(pron === undefined ? {} : { pron }),
              senses: senseRows.map((sense) => ({
                translations: parseJsonList(sense.translationsJson) ?? [],
              })),
            };
          });
        },
        catch: (cause) => new ImportError({ message: "Lookup failed", cause }),
      });
    },
  );

  return DictionaryStore.of({
    writeBatch,
    finish,
    writeMeta,
    lookupByFormKey,
  });
};

export class DictionaryStore extends Context.Service<
  DictionaryStore,
  {
    readonly writeBatch: (
      batch: WriteBatch,
    ) => Effect.Effect<void, ImportError>;
    readonly finish: (options: {
      readonly vacuum: boolean;
    }) => Effect.Effect<StorageReport, ImportError>;
    readonly writeMeta: (
      values: Readonly<Record<string, string>>,
    ) => Effect.Effect<void, ImportError>;
    readonly lookupByFormKey: (
      formKey: string,
    ) => Effect.Effect<ReadonlyArray<LookupEntry>, ImportError>;
  }
>()("server/storage/DictionaryStore") {
  static layer = (path: string) =>
    Layer.effect(
      DictionaryStore,
      Effect.gen(function* () {
        const sqlite = yield* Effect.acquireRelease(
          Effect.sync(() => openDatabase(path)),
          (database) =>
            Effect.sync(() => {
              database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
              database.close();
            }),
        );
        const db = drizzle(sqlite, { schema: dictionarySchema });
        return makeStore(path, sqlite, db);
      }),
    );
}
