import type { DictionaryDb } from "@dict/core/DictionaryDb";
import { caseClass, cleanWord, lookupKey } from "@dict/core/lookupKey";
import {
  CaseClass,
  FormSource,
  GRAMMAR_SOURCE_POS,
  type UdPos,
} from "@dict/core/schema";
import { notAnAcronym } from "./forms.ts";
import { commonsFilePage } from "./sources.ts";

/**
 * Entry in the shape of the protocol's `/v1/lookup` response. Until
 * `presentResult` turns it into a headword, `lemma` is the stored lemma,
 * `features` its grammar (`Gender=Masc`) and `labels` what the lookup adds
 * (`て form`); after, `lemma` is the headword and `labels` its grammar and
 * those, and `features` is gone.
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
    readonly audio?: ReadonlyArray<Audio>;
    readonly reading?: string;
  };
  readonly senses: ReadonlyArray<{
    readonly glosses: ReadonlyArray<string>;
    readonly see?: ReadonlyArray<string>;
  }>;
  /**
   * Until `presentResult`: the titles of the Wiktionary pages the entry is
   * built from (`entries.pages`). After, `sources` links them.
   */
  readonly pages?: ReadonlyArray<string>;
  /** Links to the pages the entry is built from. */
  readonly sources?: ReadonlyArray<string>;
};

/** A recording: the file, and the page that credits it. */
export type Audio = {
  readonly url: string;
  readonly source?: string;
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
 * import stored. A lowercase word is no acronym, so all-caps lemmas are left
 * out when it has another entry (`notAnAcronym`: `ne` without `NE`).
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
 *    the letter И". So does a grammar-file `X` line, which only adds: `な`
 *    gives the particle before "the form of だ before a noun".
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
         AND ${notAnAcronym("?1", "?2", `(?3 = 1 OR o.source <> ${FormSource.Abbreviation})`)}
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
         -- a grammar-file ending that only adds (な after a な-adjective)
         e.source_pos = '${GRAMMAR_SOURCE_POS}' AND e.pos = 'X',
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

/** Row shapes of `loadEntries`' queries; the JSON columns still as text. */
type HeadRow = {
  readonly id: number;
  readonly lemma: string;
  readonly pos: UdPos;
  readonly features: string | null;
  readonly pages: string | null;
};
type SenseRow = {
  readonly entryId: number;
  readonly glosses: string;
  readonly see: string | null;
};
type PronRow = {
  readonly entryId: number;
  readonly kind: string;
  readonly value: string;
};

/** `rows` by their entry, each entry's in the order given. */
const byEntry = <R extends { readonly entryId: number }>(
  rows: ReadonlyArray<R>,
): ReadonlyMap<number, ReadonlyArray<R>> => {
  const grouped = new Map<number, Array<R>>();
  for (const row of rows) {
    const list = grouped.get(row.entryId);
    if (list === undefined) grouped.set(row.entryId, [row]);
    else list.push(row);
  }
  return grouped;
};

/**
 * Entries by id, in the order given, in the shape of the protocol. The ids go
 * in as one JSON list (`json_each`), so each query is prepared once and kept
 * (`query`), whatever the number of ids.
 */
export const loadEntries = (
  db: DictionaryDb,
  ids: ReadonlyArray<number>,
): ReadonlyArray<LookupEntry> => {
  if (ids.length === 0) return [];
  const list = JSON.stringify(ids);
  const heads = db.$client
    .query<HeadRow, [string]>(
      `SELECT id, lemma, pos, features, pages FROM entries
       WHERE id IN (SELECT value FROM json_each(?1))`,
    )
    .all(list);
  const senseRows = byEntry(
    db.$client
      .query<SenseRow, [string]>(
        `SELECT entry_id AS entryId, glosses, see FROM senses
         WHERE entry_id IN (SELECT value FROM json_each(?1)) ORDER BY entry_id, idx`,
      )
      .all(list),
  );
  const pronRows = byEntry(
    db.$client
      .query<PronRow, [string]>(
        `SELECT entry_id AS entryId, kind, value FROM pronunciations
         WHERE entry_id IN (SELECT value FROM json_each(?1)) ORDER BY entry_id, idx`,
      )
      .all(list),
  );

  const byId = new Map(heads.map((head) => [head.id, head]));
  return ids.map((id) => {
    const head = byId.get(id)!;
    const prons = pronRows.get(id) ?? [];
    const ipa = prons.filter((p) => p.kind === "ipa").map((p) => p.value);
    const audio = prons
      .filter((p) => p.kind === "audio")
      .map((p): Audio => {
        const source = commonsFilePage(p.value);
        return source === undefined
          ? { url: p.value }
          : { url: p.value, source };
      });
    const reading = prons.find((p) => p.kind === "reading")?.value;
    const pron = {
      ...(ipa.length > 0 ? { ipa } : {}),
      ...(audio.length > 0 ? { audio } : {}),
      ...(reading !== undefined ? { reading } : {}),
    };
    const pages =
      head.pages === null
        ? []
        : (JSON.parse(head.pages) as ReadonlyArray<string>);
    return {
      lemma: head.lemma,
      pos: head.pos,
      ...(head.features !== null ? { features: head.features } : {}),
      ...(pages.length > 0 ? { pages } : {}),
      ...(Object.keys(pron).length > 0 ? { pron } : {}),
      senses: (senseRows.get(id) ?? []).map((s) => ({
        glosses: JSON.parse(s.glosses) as ReadonlyArray<string>,
        ...(s.see !== null
          ? { see: JSON.parse(s.see) as ReadonlyArray<string> }
          : {}),
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
