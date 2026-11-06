import type { DictionaryDb } from "@dict/core/DictionaryDb";
import { caseClass, cleanWord, lookupKey } from "@dict/core/lookupKey";
import {
  CaseClass,
  entries,
  FormSource,
  pronunciations,
  senses,
  type UdPos,
} from "@dict/core/schema";
import { asc, inArray } from "drizzle-orm";

/** Entry in the shape of the protocol's `/v1/lookup` response. */
export type LookupEntry = {
  readonly lemma: string;
  readonly pos: UdPos;
  readonly pron?: {
    readonly ipa?: ReadonlyArray<string>;
    readonly audio?: ReadonlyArray<string>;
    readonly reading?: string;
  };
  readonly senses: ReadonlyArray<{
    readonly translations: ReadonlyArray<string>;
    readonly see?: ReadonlyArray<string>;
  }>;
};

type LookupSense = LookupEntry["senses"][number];

/** "synonym of x" with nothing else to read: no meaning in brackets, no parent. */
const isBareSynonym = (sense: LookupSense): boolean =>
  sense.see !== undefined &&
  sense.translations.length === 1 &&
  /^synonym of [^(“]*$/i.test(sense.translations[0]!);

/**
 * Wiktionary's pointer from an idiom to its literal reading ("Used other than
 * figuratively or idiomatically: see w, ten."). The words' own entries say
 * more, and context lookups show them right after the phrase.
 */
const isLiteralPointer = (sense: LookupSense): boolean =>
  sense.translations.length === 1 &&
  sense.translations[0]!.startsWith(
    "Used other than figuratively or idiomatically",
  );

/** `entries` without literal pointers, and without entries left with no senses. */
export const dropLiteralPointers = (
  results: ReadonlyArray<LookupEntry>,
): ReadonlyArray<LookupEntry> =>
  results.flatMap((entry) => {
    const senses = entry.senses.filter((sense) => !isLiteralPointer(sense));
    return senses.length > 0 ? [{ ...entry, senses }] : [];
  });

/**
 * Drop literal pointers, bare synonyms of a word the result already shows, and
 * entries left with no senses (`razu` -> "synonym of raz" next to `raz`). Keeps
 * everything if that would empty the result, as when two words only point at
 * each other.
 */
const dropRedundantSynonyms = (
  results: ReadonlyArray<LookupEntry>,
): ReadonlyArray<LookupEntry> => {
  const shown = new Set(results.map((entry) => lookupKey(entry.lemma)));
  const kept = results.flatMap((entry) => {
    const senses = entry.senses.filter(
      (sense) =>
        !isLiteralPointer(sense) &&
        (!isBareSynonym(sense) ||
          !sense.see!.every((word) => shown.has(lookupKey(word)))),
    );
    return senses.length > 0 ? [{ ...entry, senses }] : [];
  });
  return kept.length > 0 ? kept : results;
};

/**
 * Entry ids for a normalized form, best first. One query, using what the
 * import stored:
 *
 * 1. Case: `rank` is 0 for a lemma whose `case_class` suits the word as written,
 *    1 for one that suits it less, 2 for an acronym the word doesn't spell in
 *    capitals. A lowercase word rarely is a noun in German or a name anywhere,
 *    so `oder` gets "or" before the river `Oder`. A capitalised word may only
 *    start a sentence (`Als`, `Ich`), so it pushes back acronyms alone (`Am`
 *    gets `an` before `AM`). An all-caps word puts acronyms first.
 * 2. Letters: an entry for the letter itself, or a one-letter noun that only
 *    names it, comes after the word's others, so `в` gives "in" before "the
 *    third letter of the alphabet" and `и` gives "and" before "the name of
 *    the letter И".
 * 3. Spelling: the entry whose own lemma is this form (`forms.source` =
 *    lemma) before the entries it is a form of, so the noun `Frage` comes
 *    before the verb `fragen`. A form reached only with an optional letter
 *    written plainly comes last (`все` gives `весь` before `всё`).
 * 4. Import order (`entries.id`): grammar-file entries, then the dump's order.
 */
const rankedIds = (
  db: DictionaryDb,
  key: string,
  wordClass: CaseClass,
  abbreviations: boolean,
): ReadonlyArray<number> =>
  db.$client
    .query<{ id: number }, [string, number, number]>(
      `SELECT f.entry_id AS id FROM forms f JOIN entries e ON e.id = f.entry_id
       WHERE f.form = ?1 AND (?3 = 1 OR f.source <> ${FormSource.Abbreviation})
       ORDER BY
         CASE
           WHEN ?2 = ${CaseClass.AllCaps} THEN e.case_class <> ${CaseClass.AllCaps}
           WHEN e.case_class = ${CaseClass.AllCaps} THEN 2
           WHEN ?2 = ${CaseClass.Lower} THEN e.case_class <> ${CaseClass.Lower}
           ELSE 0
         END,
         e.source_pos IN ('character', 'letter-name'),
         f.source <> ${FormSource.Lemma},
         f.source = ${FormSource.LetterVariant},
         e.id`,
    )
    .all(key, wordClass, abbreviations ? 1 : 0)
    .map((row) => row.id);

/** Entries by id, in the order given, in the shape of the protocol. */
export const loadEntries = (
  db: DictionaryDb,
  ids: ReadonlyArray<number>,
): ReadonlyArray<LookupEntry> => {
  if (ids.length === 0) return [];
  const heads = db
    .select()
    .from(entries)
    .where(inArray(entries.id, [...ids]))
    .all();
  const senseRows = db
    .select()
    .from(senses)
    .where(inArray(senses.entryId, [...ids]))
    .orderBy(asc(senses.entryId), asc(senses.idx))
    .all();
  const pronRows = db
    .select()
    .from(pronunciations)
    .where(inArray(pronunciations.entryId, [...ids]))
    .orderBy(asc(pronunciations.entryId), asc(pronunciations.idx))
    .all();

  const byId = new Map(heads.map((head) => [head.id, head]));
  return ids.map((id) => {
    const head = byId.get(id)!;
    const prons = pronRows.filter((p) => p.entryId === id);
    const ipa = prons.filter((p) => p.kind === "ipa").map((p) => p.value);
    const audio = prons.filter((p) => p.kind === "audio").map((p) => p.value);
    const reading = prons.find((p) => p.kind === "reading")?.value;
    const pron = {
      ...(ipa.length > 0 ? { ipa } : {}),
      ...(audio.length > 0 ? { audio } : {}),
      ...(reading !== undefined ? { reading } : {}),
    };
    return {
      lemma: head.lemma,
      pos: head.pos,
      ...(Object.keys(pron).length > 0 ? { pron } : {}),
      senses: senseRows
        .filter((s) => s.entryId === id)
        .map((s) => ({
          translations: s.translations,
          ...(s.see !== null ? { see: s.see } : {}),
        })),
    };
  });
};

/**
 * All entries a surface word resolves to (deinflection included), ranked by
 * `rankedIds`. `abbreviations: false` leaves out `bzw` -> `bzw.` rows, for
 * compound parts.
 */
export const findEntriesByForm = (
  db: DictionaryDb,
  word: string,
  { abbreviations = true }: { readonly abbreviations?: boolean } = {},
): ReadonlyArray<LookupEntry> =>
  dropRedundantSynonyms(
    loadEntries(
      db,
      rankedIds(db, lookupKey(word), caseClass(cleanWord(word)), abbreviations),
    ),
  );

/** How the word as sent splits into parts; see `segments` in the protocol. */
export type Segment = {
  readonly text: string;
  /** Indexes into the result's `entries`. */
  readonly entries?: ReadonlyArray<number>;
};

export type LookupResult = {
  readonly entries: ReadonlyArray<LookupEntry>;
  readonly segments?: ReadonlyArray<Segment>;
};
