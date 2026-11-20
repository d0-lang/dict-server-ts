import { lookupKey } from "@dict/core/lookupKey";
import type { WriterContext } from "./context.ts";

/**
 * Keep only `see` targets that have an entry, now that all entries exist,
 * and not the words of a kept target of several (`iskrzyć` and `się` of
 * `iskrzyć się`).
 */
export const resolveSee = ({ sqlite, counts, hasEntry }: WriterContext) =>
  sqlite.transaction(() => {
    const update = sqlite.prepare(
      "UPDATE senses SET see = ? WHERE entry_id = ? AND idx = ?",
    );
    const rows = sqlite
      .query<{ entry_id: number; idx: number; see: string }, []>(
        "SELECT entry_id, idx, see FROM senses WHERE see IS NOT NULL",
      )
      .all();
    for (const row of rows) {
      const found = (JSON.parse(row.see) as Array<string>).filter((word) =>
        hasEntry(lookupKey(word)),
      );
      const partOfFound = new Set(
        found.flatMap((word) => {
          const parts = word.split(" ");
          return parts.length > 1 ? parts : [];
        }),
      );
      const see = found.filter((word) => !partOfFound.has(word));
      update.run(
        see.length > 0 ? JSON.stringify(see) : null,
        row.entry_id,
        row.idx,
      );
      counts.seeLinks += see.length;
    }
  })();
