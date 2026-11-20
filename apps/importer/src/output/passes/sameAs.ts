import { hiragana } from "@dict/core/kana";
import type { WriterContext } from "./context.ts";

/**
 * A sense that only says "Same as ゆうぎ (yūgi) above" points at another
 * entry of its word on the same Wiktionary page, which the reader may not
 * see ("above"). It is replaced by that entry's senses, so the entry
 * explains the word by itself: `遊戯` read ゆうげ gets ゆうぎ's "a game".
 * A する verb's "Same as above" points at the word without する, a headword
 * of its own (`見合いする` under `見合い`): it takes that word's senses. The
 * verb's entry stays, since the analyzer may not keep the word whole without
 * it (`厄介|払い|し|た`).
 */

/** "Same as しん (shin) above", "same as above.", "all senses same as 上(うえ) (ue) above". */
const SAME_AS = /^(?:all senses )?same as\s*(.*?)\s*\b(above|below)\.?$/i;

/** The kana a target names (`しん` of `しん (shin)`, `うえ` of `上(うえ) (ue)`), if any. */
const kanaOf = (target: string): string | undefined =>
  /[\p{Script=Hiragana}\p{Script=Katakana}ー]+/u.exec(target)?.[0];

/** A pointer sense: where it points, and the reading it names. */
export const parseSameAs = (
  gloss: string,
):
  | { readonly direction: "above" | "below"; readonly reading?: string }
  | undefined => {
  const match = SAME_AS.exec(gloss.trim());
  if (match === null) return undefined;
  const direction = match[2]!.toLowerCase() as "above" | "below";
  const reading = kanaOf(match[1]!);
  return reading === undefined
    ? { direction }
    : { direction, reading: hiragana(reading) };
};

type EntryRow = {
  readonly id: number;
  readonly lemma: string;
  readonly pos: string;
  readonly reading: string | null;
};

type SenseRow = {
  readonly entry_id: number;
  readonly idx: number;
  readonly glosses: string;
  readonly see: string | null;
};

const lastGloss = (sense: SenseRow): string =>
  (JSON.parse(sense.glosses) as Array<string>).at(-1) ?? "";

export const copySameAsSenses = ({ sqlite }: WriterContext) =>
  sqlite.transaction(() => {
    const pointers = sqlite
      .query<SenseRow, []>(
        "SELECT entry_id, idx, glosses, see FROM senses WHERE glosses LIKE '%same as%' COLLATE NOCASE",
      )
      .all()
      .filter((sense) => parseSameAs(lastGloss(sense)) !== undefined);
    const entryOf = sqlite.prepare<EntryRow, [number]>(
      `SELECT e.id, e.lemma, e.pos,
         (SELECT value FROM pronunciations p WHERE p.entry_id = e.id AND p.kind = 'reading') AS reading
       FROM entries e WHERE e.id = ?`,
    );
    const sameLemma = sqlite.prepare<EntryRow, [string, number]>(
      `SELECT e.id, e.lemma, e.pos,
         (SELECT value FROM pronunciations p WHERE p.entry_id = e.id AND p.kind = 'reading') AS reading
       FROM entries e WHERE e.lemma = ? AND e.id <> ? ORDER BY e.id`,
    );
    const sensesOf = sqlite.prepare<SenseRow, [number]>(
      "SELECT entry_id, idx, glosses, see FROM senses WHERE entry_id = ? ORDER BY idx",
    );
    const deleteSenses = sqlite.prepare(
      "DELETE FROM senses WHERE entry_id = ?",
    );
    /** The entries of the word a する verb is made of, verbs aside. */
    const nounsOf = sqlite.prepare<{ id: number }, [string]>(
      "SELECT id FROM entries WHERE lemma = ? AND pos <> 'VERB' ORDER BY id",
    );
    const insert = sqlite.prepare(
      "INSERT INTO senses (entry_id, idx, glosses, see) VALUES (?, ?, ?, ?)",
    );
    /** Its own senses, not pointers themselves. */
    const meaningful = (id: number) =>
      sensesOf
        .all(id)
        .filter((sense) => parseSameAs(lastGloss(sense)) === undefined);

    for (const entryId of new Set(pointers.map((p) => p.entry_id))) {
      const self = entryOf.get(entryId);
      if (self === null) continue;
      // The word's own kana after its kanji (`する` of `遊戯する`) is not part
      // of the reading a gloss names (`ゆうぎ`).
      const tail = /\p{Script=Hiragana}+$/u.exec(self.lemma)?.[0] ?? "";
      const stem = (reading: string) =>
        tail !== "" && reading.endsWith(tail)
          ? reading.slice(0, -tail.length)
          : reading;
      const others = sameLemma
        .all(self.lemma, self.id)
        .filter((other) => meaningful(other.id).length > 0);
      const samePosFirst = (rows: ReadonlyArray<EntryRow>) => [
        ...rows.filter((row) => row.pos === self.pos),
        ...rows.filter((row) => row.pos !== self.pos),
      ];
      const targetOf = (gloss: string): EntryRow | undefined => {
        const pointer = parseSameAs(gloss)!;
        const { reading } = pointer;
        if (reading !== undefined) {
          return samePosFirst(
            others.filter(
              (other) =>
                other.reading !== null &&
                // `もうす` names all of `申す`'s reading, `ゆうぎ` only the
                // part before `遊戯する`'s する
                [
                  hiragana(other.reading),
                  stem(hiragana(other.reading)),
                ].includes(reading),
            ),
          )[0];
        }
        // Without a reading, the nearest entry that way on the page, which
        // the dump lists in page order.
        const near =
          pointer.direction === "above"
            ? others.filter((other) => other.id < self.id).reverse()
            : others.filter((other) => other.id > self.id);
        return samePosFirst(near)[0];
      };

      const senses: Array<{ glosses: string; see: string | null }> = [];
      const seen = new Set<string>();
      const add = (sense: { glosses: string; see: string | null }) => {
        if (seen.has(sense.glosses)) return;
        seen.add(sense.glosses);
        senses.push(sense);
      };
      const madeOf =
        self.lemma.endsWith("する") && self.lemma.length > 2
          ? nounsOf.all(self.lemma.slice(0, -2))
          : [];
      let changed = false;
      for (const sense of sensesOf.all(self.id)) {
        if (parseSameAs(lastGloss(sense)) === undefined) {
          add(sense);
          continue;
        }
        const target = targetOf(lastGloss(sense));
        if (target !== undefined) {
          meaningful(target.id).forEach(add);
          changed = true;
        } else if (madeOf.length > 0) {
          madeOf.forEach((noun) => meaningful(noun.id).forEach(add));
          changed = true;
        } else {
          add(sense);
        }
      }
      if (!changed) continue;
      deleteSenses.run(self.id);
      senses.forEach((sense, idx) =>
        insert.run(self.id, idx, sense.glosses, sense.see),
      );
    }
  })();
