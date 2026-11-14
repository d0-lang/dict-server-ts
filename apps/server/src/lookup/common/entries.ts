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

/**
 * Entry in the shape of the protocol's `/v1/lookup` response. Until
 * `presentResult` turns it into a headword, `lemma` is the stored lemma and
 * `features` its grammar (`Gender=Masc`); after, `lemma` is the headword and
 * `labels` its grammar, and `features` is gone.
 */
export type LookupEntry = {
  readonly lemma: string;
  readonly pos: UdPos;
  readonly features?: string;
  readonly labels?: ReadonlyArray<string>;
  /** For an entry the context adds: the parts of `context` it covers. */
  readonly match?: ReadonlyArray<string>;
  readonly pron?: {
    readonly ipa?: ReadonlyArray<string>;
    readonly audio?: ReadonlyArray<string>;
    readonly reading?: string;
  };
  readonly senses: ReadonlyArray<{
    readonly glosses: ReadonlyArray<string>;
    readonly see?: ReadonlyArray<string>;
  }>;
};

type LookupSense = LookupEntry["senses"][number];

/** "synonym of x" with nothing else to read: no meaning in brackets, no parent. */
const isBareSynonym = (sense: LookupSense): boolean =>
  sense.see !== undefined &&
  sense.glosses.length === 1 &&
  /^synonym of [^(“]*$/i.test(sense.glosses[0]!);

/**
 * Wiktionary's pointer from an idiom to its literal reading ("Used other than
 * figuratively or idiomatically: see w, ten."). The words' own entries say
 * more, and context lookups show them right after the phrase.
 */
const isLiteralPointer = (sense: LookupSense): boolean =>
  sense.glosses.length === 1 &&
  sense.glosses[0]!.startsWith("Used other than figuratively or idiomatically");

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
 *    gets `an` before `AM`). An all-caps word puts acronyms first. In a
 *    language that capitalises nouns, a capitalised word the context shows
 *    inside a sentence (`capitalInside`) is capitalised for its own sake, so
 *    `Tagen` gets `der Tag` before the verb `tagen`. Before another
 *    capitalised word (`capitalNext`) it may be an adjective of a name
 *    (`der Deutschen Bahn`), so adjectives keep their place. After one of the
 *    language's `nominalizers` (`nominalized`), an infinitive may be the verb
 *    used as a noun (`zum Binden`), so the verb whose lemma it is keeps its
 *    place too.
 * 2. Letters: an entry for the letter itself, or a one-letter noun that only
 *    names it, comes after the word's others, so `в` gives "in" before "the
 *    third letter of the alphabet" and `и` gives "and" before "the name of
 *    the letter И".
 * 3. Spelling: the entry whose own lemma is this form (`forms.source` =
 *    lemma) before the entries it is a form of, so the noun `Frage` comes
 *    before the verb `fragen`. For one word, an entry of several words it is a
 *    form of comes after one of a single word (`bawię` gives `bawić` before
 *    `bawić się`); context puts the second first when the sentence has `się`.
 *    A degree entry an irregular comparative or superlative also reaches
 *    comes after its base (`größte` gives `groß`, then `größten`). A form
 *    reached only with an optional letter written plainly comes last (`все`
 *    gives `весь` before `всё`).
 * 4. Participles: a participle entry (a verb whose senses name it a
 *    "participle of" its verb) comes after an adjective entry of this form
 *    with the same lemma, so `поширені` gives `поширений` "widespread" before
 *    "participle of поширити: to widen". A verb that is no participle keeps
 *    its place: German `erhalten` "to receive" before the adjective, and
 *    Russian `звучать`, which the dump also lists as an adjective.
 * 5. Import order (`entries.id`): grammar-file entries, then the dump's order.
 */
const rankedIds = (
  db: DictionaryDb,
  key: string,
  wordClass: CaseClass,
  abbreviations: boolean,
  capitalInside: boolean,
  capitalNext: boolean,
  nominalized: boolean,
): ReadonlyArray<number> =>
  db.$client
    .query<{ id: number }, [string, number, number, number, number, number]>(
      `SELECT f.entry_id AS id FROM forms f JOIN entries e ON e.id = f.entry_id
       WHERE f.form = ?1 AND (?3 = 1 OR f.source <> ${FormSource.Abbreviation})
       ORDER BY
         CASE
           WHEN ?2 = ${CaseClass.AllCaps} THEN e.case_class <> ${CaseClass.AllCaps}
           WHEN e.case_class = ${CaseClass.AllCaps} THEN 2
           WHEN ?2 = ${CaseClass.Lower} THEN e.case_class <> ${CaseClass.Lower}
           WHEN ?4 = 1 THEN e.case_class <> ${CaseClass.Capitalised}
             AND NOT (?5 = 1 AND e.pos = 'ADJ')
             AND NOT (?6 = 1 AND e.pos = 'VERB' AND f.source = ${FormSource.Lemma})
           ELSE 0
         END,
         e.source_pos IN ('character', 'letter-name', 'syllable'),
         -- a redirect spells the word itself, in kana, so it ranks with the lemma
         f.source NOT IN (${FormSource.Lemma}, ${FormSource.Redirect}),
         instr(?1, ' ') = 0 AND instr(e.lemma, ' ') > 0,
         f.source = ${FormSource.Degree},
         f.source = ${FormSource.LetterVariant},
         e.pos = 'VERB'
           AND EXISTS (
             SELECT 1 FROM senses ps
             WHERE ps.entry_id = e.id AND ps.glosses LIKE '%participle of %'
           )
           AND EXISTS (
             SELECT 1 FROM forms af JOIN entries ae ON ae.id = af.entry_id
             WHERE af.form = ?1 AND ae.pos = 'ADJ' AND ae.lemma = e.lemma
           ),
         e.id`,
    )
    .all(
      key,
      wordClass,
      abbreviations ? 1 : 0,
      capitalInside ? 1 : 0,
      capitalNext ? 1 : 0,
      nominalized ? 1 : 0,
    )
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
      ...(head.features !== null ? { features: head.features } : {}),
      ...(Object.keys(pron).length > 0 ? { pron } : {}),
      senses: senseRows
        .filter((s) => s.entryId === id)
        .map((s) => ({
          glosses: s.glosses,
          ...(s.see !== null ? { see: s.see } : {}),
        })),
    };
  });
};

/**
 * All entries a surface word resolves to (deinflection included), ranked by
 * `rankedIds`. `abbreviations: false` leaves out `bzw` -> `bzw.` rows, for
 * compound parts. `capitalInside`: the context shows the capitalised word
 * inside a sentence, not at its start; `capitalNext`: and the next word is
 * capitalised too; `nominalized`: and the word before is a nominalizer.
 */
export const findEntriesByForm = (
  db: DictionaryDb,
  word: string,
  {
    abbreviations = true,
    capitalInside = false,
    capitalNext = false,
    nominalized = false,
  }: {
    readonly abbreviations?: boolean;
    readonly capitalInside?: boolean;
    readonly capitalNext?: boolean;
    readonly nominalized?: boolean;
  } = {},
): ReadonlyArray<LookupEntry> =>
  dropRedundantSynonyms(
    loadEntries(
      db,
      rankedIds(
        db,
        lookupKey(word),
        caseClass(cleanWord(word)),
        abbreviations,
        capitalInside,
        capitalNext,
        nominalized,
      ),
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
