import { FormSource } from "@dict/core/schema";
import { isDegreeGloss, isPointerGloss } from "../../transform/rules.ts";
import type { WriterContext } from "./context.ts";
import { MAX_CHAIN_STEPS } from "./context.ts";

/**
 * Add the base's meaning to each derived sense: same part of speech first,
 * then any, following chains (`koteczek` -> `kotek` -> `kot`). Every result
 * is worked out from the glosses as they were written, before any is
 * replaced, so processing order can't change it.
 */
export const copyDerivedMeanings = ({
  sqlite,
  counts,
  insertSense,
  derivedByEntry,
}: WriterContext) => {
  const entriesOf = sqlite.query<
    { id: number; source_pos: string },
    [string, number]
  >(
    `SELECT e.id, e.source_pos FROM forms f JOIN entries e ON e.id = f.entry_id
     WHERE f.form = ? AND f.source = ? ORDER BY e.id`,
  );
  const sensesOf = (id: number) =>
    sqlite
      .query<{ translations: string; see: string | null }, [number]>(
        "SELECT translations, see FROM senses WHERE entry_id = ? ORDER BY idx",
      )
      .all(id)
      .map((row) => ({
        translations: JSON.parse(row.translations) as Array<string>,
        see: row.see,
      }));
  const linkTargets = sqlite.query<{ lemma: string }, [string]>(
    "SELECT lemma FROM form_of_pending WHERE form = ?",
  );

  const meaningsOf = (
    word: string,
    sourcePos: string,
    seen: ReadonlySet<string>,
  ): ReadonlyArray<string> => {
    if (seen.has(word) || seen.size >= MAX_CHAIN_STEPS) return [];
    const visited = new Set(seen).add(word);
    const follow = (bases: ReadonlyArray<string>) => {
      for (const base of bases) {
        const found = meaningsOf(base, sourcePos, visited);
        if (found.length > 0) return found;
      }
      return [];
    };

    const all = entriesOf.all(word, FormSource.Lemma);
    if (all.length === 0) {
      return follow(linkTargets.all(word).map((row) => row.lemma));
    }
    const samePos = all.filter((e) => e.source_pos === sourcePos);
    const otherPos = all.filter((e) => e.source_pos !== sourcePos);
    for (const group of [samePos, otherPos]) {
      const meanings = group.flatMap((entry) =>
        sensesOf(entry.id).flatMap(({ translations }) => {
          if (derivedByEntry.get(entry.id)?.has(translations[0]!)) return [];
          const meaning = translations
            .filter((gloss) => !isPointerGloss(gloss))
            .join("; ");
          return meaning === "" ? [] : [meaning];
        }),
      );
      if (meanings.length > 0) return [...new Set(meanings)];
      const viaChain = follow(
        group.flatMap((entry) =>
          [...(derivedByEntry.get(entry.id)?.values() ?? [])].flatMap(
            (sense) => sense.bases,
          ),
        ),
      );
      if (viaChain.length > 0) return viaChain;
    }
    return [];
  };

  const sourcePosOf = sqlite.query<{ source_pos: string }, [number]>(
    "SELECT source_pos FROM entries WHERE id = ?",
  );
  const rewrites = [...derivedByEntry].map(([entryId, derived]) => {
    const sourcePos = sourcePosOf.get(entryId)!.source_pos;
    const rows = sensesOf(entryId).flatMap((row) => {
      const gloss = row.translations[0]!;
      const sense = derived.get(gloss);
      if (sense === undefined) return [row];
      const meanings = sense.bases.flatMap((base) =>
        meaningsOf(base, sourcePos, new Set()),
      );
      if (meanings.length === 0) {
        counts.derivedBare++;
        return [row];
      }
      counts.derivedCopied++;
      const prefix = gloss.replace(/[\s.,;:]+$/, "");
      // Every meaning of the base, comparatives too: its first is often not
      // the one meant (`крупнейших` "largest", not "coarsest").
      return meanings.map((meaning) => ({
        translations: [`${prefix}: ${meaning}`],
        see: null,
      }));
    });
    // The word's own senses before its comparative ones (`później` "later"
    // before "comparative of późno").
    const ownFirst = [
      ...rows.filter((row) => !isDegreeGloss(row.translations[0]!)),
      ...rows.filter((row) => isDegreeGloss(row.translations[0]!)),
    ];
    rows.splice(0, rows.length, ...ownFirst);
    const seen = new Set<string>();
    return {
      entryId,
      rows: rows.filter(({ translations }) => {
        const key = translations.join("\u0000");
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }),
    };
  });

  const deleteSenses = sqlite.prepare("DELETE FROM senses WHERE entry_id = ?");
  sqlite.transaction(() => {
    for (const { entryId, rows } of rewrites) {
      counts.senses -= deleteSenses.run(entryId).changes;
      rows.forEach(({ translations, see }, idx) => {
        insertSense.run(entryId, idx, JSON.stringify(translations), see);
        counts.senses++;
      });
    }
  })();
};
