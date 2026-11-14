import { FormSource } from "@dict/core/schema";
import { isDegreeGloss, isPointerGloss } from "../../transform/rules.ts";
import type { WriterContext } from "./context.ts";
import { MAX_CHAIN_STEPS } from "./context.ts";

/** Meanings copied from a base word, and the entries they were read from. */
type Meanings = {
  readonly meanings: ReadonlyArray<string>;
  readonly from: ReadonlyArray<number>;
};
const NONE: Meanings = { meanings: [], from: [] };

/**
 * Add the base's meaning to each derived sense: same part of speech first,
 * then any, following chains (`koteczek` -> `kotek` -> `kot`). Every result
 * is worked out from the glosses as they were written, before any is
 * replaced, so processing order can't change it. The entry then credits the
 * pages of the entries the meanings were read from too.
 */
export const copyDerivedMeanings = ({
  sqlite,
  counts,
  insertSense,
  addPages,
  derivedByEntry,
}: WriterContext) => {
  const entriesOf = sqlite.query<
    { id: number; source_pos: string },
    [string, number]
  >(
    `SELECT e.id, e.source_pos FROM forms f JOIN entries e ON e.id = f.entry_id
     WHERE f.form = ? AND f.source = ? ORDER BY e.id`,
  );
  // A verb that only exists as reflexive (`wydarzyć się`) still explains its
  // verbal noun (`wydarzenie`): its entry has the bare verb as a form.
  const reflexiveOf = sqlite.query<
    { id: number; source_pos: string },
    [string, number]
  >(
    `SELECT e.id, e.source_pos FROM forms f JOIN entries e ON e.id = f.entry_id
     WHERE f.form = ?1 AND f.source = ?2
       AND (e.lemma LIKE ?1 || ' %' OR e.lemma LIKE '% ' || ?1)
     ORDER BY e.id`,
  );
  const sensesOf = (id: number) =>
    sqlite
      .query<{ glosses: string; see: string | null }, [number]>(
        "SELECT glosses, see FROM senses WHERE entry_id = ? ORDER BY idx",
      )
      .all(id)
      .map((row) => ({
        glosses: JSON.parse(row.glosses) as Array<string>,
        see: row.see,
      }));
  const linkTargets = sqlite.query<{ lemma: string }, [string]>(
    "SELECT lemma FROM form_of_pending WHERE form = ?",
  );

  const meaningsOf = (
    word: string,
    sourcePos: string,
    seen: ReadonlySet<string>,
  ): Meanings => {
    if (seen.has(word) || seen.size >= MAX_CHAIN_STEPS) return NONE;
    const visited = new Set(seen).add(word);
    const follow = (bases: ReadonlyArray<string>): Meanings => {
      for (const base of bases) {
        const found = meaningsOf(base, sourcePos, visited);
        if (found.meanings.length > 0) return found;
      }
      return NONE;
    };

    const own = entriesOf.all(word, FormSource.Lemma);
    const all =
      own.length > 0 ? own : reflexiveOf.all(word, FormSource.Inflection);
    if (all.length === 0) {
      return follow(linkTargets.all(word).map((row) => row.lemma));
    }
    const samePos = all.filter((e) => e.source_pos === sourcePos);
    const otherPos = all.filter((e) => e.source_pos !== sourcePos);
    for (const group of [samePos, otherPos]) {
      const from: Array<number> = [];
      const meanings = group.flatMap((entry) => {
        const own = sensesOf(entry.id).flatMap(({ glosses }) => {
          if (derivedByEntry.get(entry.id)?.has(glosses[0]!)) return [];
          const meaning = glosses
            .filter((gloss) => !isPointerGloss(gloss))
            .join("; ");
          return meaning === "" ? [] : [meaning];
        });
        if (own.length > 0) from.push(entry.id);
        return own;
      });
      if (meanings.length > 0)
        return { meanings: [...new Set(meanings)], from };
      const viaChain = follow(
        group.flatMap((entry) =>
          [...(derivedByEntry.get(entry.id)?.values() ?? [])].flatMap(
            (sense) => sense.bases,
          ),
        ),
      );
      if (viaChain.meanings.length > 0) return viaChain;
    }
    return NONE;
  };

  const sourcePosOf = sqlite.query<{ source_pos: string }, [number]>(
    "SELECT source_pos FROM entries WHERE id = ?",
  );
  const rewrites = [...derivedByEntry].map(([entryId, derived]) => {
    const sourcePos = sourcePosOf.get(entryId)!.source_pos;
    const from = new Set<number>();
    const rows = sensesOf(entryId).flatMap((row) => {
      const gloss = row.glosses[0]!;
      const sense = derived.get(gloss);
      if (sense === undefined) return [row];
      const meanings = sense.bases.flatMap((base) => {
        const found = meaningsOf(base, sourcePos, new Set());
        found.from.forEach((id) => from.add(id));
        return found.meanings;
      });
      if (meanings.length === 0) {
        counts.derivedBare++;
        return [row];
      }
      counts.derivedCopied++;
      const prefix = gloss.replace(/[\s.,;:]+$/, "");
      // Every meaning of the base, comparatives too: its first is often not
      // the one meant (`крупнейших` "largest", not "coarsest").
      return meanings.map((meaning) => ({
        glosses: [`${prefix}: ${meaning}`],
        see: null,
      }));
    });
    // The word's own senses before its comparative ones (`później` "later"
    // before "comparative of późno").
    const ownFirst = [
      ...rows.filter((row) => !isDegreeGloss(row.glosses[0]!)),
      ...rows.filter((row) => isDegreeGloss(row.glosses[0]!)),
    ];
    rows.splice(0, rows.length, ...ownFirst);
    const seen = new Set<string>();
    return {
      entryId,
      from,
      rows: rows.filter(({ glosses }) => {
        const key = glosses.join("\u0000");
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }),
    };
  });

  const pagesQuery = sqlite.query<{ pages: string | null }, [number]>(
    "SELECT pages FROM entries WHERE id = ?",
  );
  // Read before any entry's pages change, like the glosses.
  const pagesOf = (id: number): ReadonlyArray<string> => {
    const stored = pagesQuery.get(id)?.pages;
    return stored === null || stored === undefined ? [] : JSON.parse(stored);
  };
  const basePages = new Map(
    rewrites.flatMap(({ from }) => [...from]).map((id) => [id, pagesOf(id)]),
  );
  const deleteSenses = sqlite.prepare("DELETE FROM senses WHERE entry_id = ?");
  sqlite.transaction(() => {
    for (const { entryId, from, rows } of rewrites) {
      addPages(
        entryId,
        [...from].flatMap((id) => basePages.get(id) ?? []),
      );
      counts.senses -= deleteSenses.run(entryId).changes;
      rows.forEach(({ glosses, see }, idx) => {
        insertSense.run(entryId, idx, JSON.stringify(glosses), see);
        counts.senses++;
      });
    }
  })();
};
