import { asc, inArray } from "drizzle-orm";
import type { DictionaryDb } from "./DictionaryDb.ts";
import { CONTENT_POS, splitCompound } from "./compounds.ts";
import { caseClass, cleanWord, lookupKey } from "./lookupKey.ts";
import {
  CaseClass,
  entries,
  FormSource,
  pronunciations,
  senses,
  type UdPos,
} from "./schema.ts";

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
 * Drop bare synonyms of a word the result already shows, and entries left with
 * no senses (`razu` -> "synonym of raz" next to `raz`). Keeps everything if that
 * would empty the result, as when two words only point at each other.
 */
const dropRedundantSynonyms = (
  results: ReadonlyArray<LookupEntry>,
): ReadonlyArray<LookupEntry> => {
  const shown = new Set(results.map((entry) => lookupKey(entry.lemma)));
  const kept = results.flatMap((entry) => {
    const senses = entry.senses.filter(
      (sense) =>
        !isBareSynonym(sense) ||
        !sense.see!.every((word) => shown.has(lookupKey(word))),
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
 * 2. Spelling: the entry whose own lemma is this form (`forms.source` =
 *    lemma) before the entries it is a form of, so the noun `Frage` comes
 *    before the verb `fragen`.
 * 3. Import order (`entries.id`): grammar-file entries, then the dump's order.
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
         f.source <> ${FormSource.Lemma},
         e.id`,
    )
    .all(key, wordClass, abbreviations ? 1 : 0)
    .map((row) => row.id);

/**
 * All entries a surface word resolves to (deinflection included), ranked by
 * `rankedIds`. `abbreviations: false` leaves out `bzw` -> `bzw.` rows, for
 * compound parts.
 */
export const findEntriesByForm = (
  db: DictionaryDb,
  word: string,
  { abbreviations = true }: { readonly abbreviations?: boolean } = {},
): ReadonlyArray<LookupEntry> => {
  const ids = rankedIds(
    db,
    lookupKey(word),
    caseClass(cleanWord(word)),
    abbreviations,
  );
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
  const results = ids.map((id) => {
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
  return dropRedundantSynonyms(results);
};

/**
 * `findEntriesByForm`, and for a word with no entry in a compounding language,
 * the content-word entries of its parts in reading order: `Gemüsefonds` gives
 * `Gemüse` then `Fond`. The parts take the word's capitalisation, so a noun
 * compound ranks the noun readings of its parts first.
 */
export const findEntriesWithCompounds = (
  db: DictionaryDb,
  word: string,
  linkers: ReadonlyArray<string> | undefined,
): ReadonlyArray<LookupEntry> => {
  const direct = findEntriesByForm(db, word);
  if (direct.length > 0 || linkers === undefined) return direct;
  const hasContentEntry = db.$client.query<{ n: number }, [string]>(
    `SELECT count(*) AS n FROM forms f JOIN entries e ON e.id = f.entry_id
     WHERE f.form = ? AND f.source <> ${FormSource.Abbreviation} AND e.pos IN (${[...CONTENT_POS].map((p) => `'${p}'`).join(", ")})`,
  );
  const parts = splitCompound(
    lookupKey(word),
    (part) => hasContentEntry.get(part)!.n > 0,
    linkers,
  );
  if (parts === undefined) return [];
  const capital = caseClass(cleanWord(word)) !== CaseClass.Lower;
  const seen = new Set<string>();
  return parts.flatMap((part, i) => {
    const surface = capital ? part[0]!.toUpperCase() + part.slice(1) : part;
    const found = findEntriesByForm(db, surface, {
      abbreviations: false,
    }).filter((entry) => CONTENT_POS.has(entry.pos));
    // A capitalised compound is a noun, and so is its head (`Tag`, not
    // `tagen`). A modifier is usually a stem as it stands (`Stahl`, not
    // `stehlen`), unless it only exists as a verb stem (`Förder-`).
    const isHead = i === parts.length - 1;
    const preferred = isHead
      ? capital
        ? found.filter((entry) => entry.pos === "NOUN")
        : []
      : found.filter((entry) => lookupKey(entry.lemma) === part);
    return (preferred.length > 0 ? preferred : found).filter((entry) => {
      const id = JSON.stringify([entry.lemma, entry.pos, entry.senses]);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  });
};
