import { asc, inArray } from "drizzle-orm";
import type { DictionaryDb } from "./DictionaryDb.ts";
import { CONTENT_POS, type PartScore, splitCompound } from "./compounds.ts";
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

/**
 * `pieces` of `lookupKey(word)` as slices of `word` itself, which segments
 * must spell exactly. Undefined when normalizing changed the length of the
 * word (surrounding spaces, decomposed accents), so slices can't be mapped.
 */
export const surfaceSlices = (
  word: string,
  pieces: ReadonlyArray<string>,
): ReadonlyArray<string> | undefined => {
  const original = [...word];
  const key = [...lookupKey(word)];
  if (
    original.length !== key.length ||
    original.some((char, i) => char.toLowerCase() !== key[i])
  ) {
    return undefined;
  }
  let at = 0;
  return pieces.map((piece) => {
    const length = [...piece].length;
    const slice = original.slice(at, at + length).join("");
    at += length;
    return slice;
  });
};

/**
 * `findEntriesByForm`, and for a word with no entry in a compounding language,
 * the content-word entries of its parts in reading order: `Gemüsefonds` gives
 * `Gemüse` then `Fond`, with a segment per part (and per linking element).
 * The parts take the word's capitalisation, so a noun compound ranks the noun
 * readings of its parts first.
 */
export const findEntriesWithCompounds = (
  db: DictionaryDb,
  word: string,
  linkers: ReadonlyArray<string> | undefined,
): LookupResult => {
  const direct = findEntriesByForm(db, word);
  if (direct.length > 0 || linkers === undefined) return { entries: direct };
  // Tables don't list a name's genitive (`Dortmunds`), which would split
  // into nonsense (`Dort` + `Mund`).
  const capital = caseClass(cleanWord(word)) !== CaseClass.Lower;
  const key = lookupKey(word);
  if (capital && key.endsWith("s") && [...key].length > 3) {
    const names = findEntriesByForm(db, cleanWord(word).slice(0, -1), {
      abbreviations: false,
    }).filter((entry) => entry.pos === "PROPN");
    if (names.length > 0) return { entries: names };
  }
  const content = [...CONTENT_POS].map((p) => `'${p}'`).join(", ");
  const formScore = db.$client.query<{ score: number | null }, [string]>(
    `SELECT max(CASE WHEN f.source = ${FormSource.Lemma} AND e.pos <> 'VERB' THEN 2 ELSE 1 END) AS score
     FROM forms f JOIN entries e ON e.id = f.entry_id
     WHERE f.form = ? AND f.source <> ${FormSource.Abbreviation} AND e.pos IN (${content})`,
  );
  // `left` is a form of a noun whose lemma is `stem` (`tages` of `Tag`).
  const nounForm = db.$client.query<{ n: number }, [string, string]>(
    `SELECT count(*) AS n FROM forms f JOIN entries e ON e.id = f.entry_id
     JOIN forms l ON l.entry_id = e.id AND l.source = ${FormSource.Lemma} AND l.form = ?2
     WHERE f.form = ?1 AND f.source <> ${FormSource.Abbreviation} AND e.pos IN ('NOUN', 'PROPN')`,
  );
  // `stem` is itself a noun, adverb or number (`Mais`, `Eisen`, `links`).
  const plainLemma = db.$client.query<{ n: number }, [string]>(
    `SELECT count(*) AS n FROM forms f JOIN entries e ON e.id = f.entry_id
     WHERE f.form = ? AND f.source = ${FormSource.Lemma} AND e.pos IN ('NOUN', 'ADV', 'NUM')`,
  );
  /** See `PartScore`: `s`/`es` link any noun, other linkers mostly a plural. */
  const partScore: PartScore = (stem, linker) => {
    const score = formScore.get(stem)!.score ?? 0;
    if (score === 0) return 0;
    if (linker === "" && plainLemma.get(stem)!.n > 0) return 4;
    if (linker !== "" && nounForm.get(stem + linker, stem)!.n > 0) return 3;
    return score === 2 && ["", "s", "es"].includes(linker) ? 2 : 1;
  };
  const pieces = splitCompound(key, partScore, linkers);
  if (pieces === undefined) return { entries: [] };
  const parts = pieces.filter((piece) => piece.part);
  // A modifier followed by a linker is a noun (`Spitze` + `n`), not `spitze` "great".
  const linked = pieces.flatMap((piece, i) =>
    piece.part ? [pieces[i + 1]?.part === false] : [],
  );
  const perPart = parts.map((piece, i) => {
    const part = piece.text;
    const surface = capital ? part[0]!.toUpperCase() + part.slice(1) : part;
    const found = findEntriesByForm(db, surface, {
      abbreviations: false,
    }).filter((entry) => CONTENT_POS.has(entry.pos));
    // A capitalised compound is a noun, and so is its head (`Tag`, not
    // `tagen`). A modifier is usually a stem as it stands (`Stahl`, not
    // `stehlen`), unless it only exists as a verb stem (`Förder-`).
    const isHead = i === parts.length - 1;
    // Wiktionary's prefix entry (`sonder-` "special") explains a modifier
    // better than the verb it is also a form of (`sondern` "to separate").
    const prefix = isHead
      ? []
      : findEntriesByForm(db, `${part}-`, { abbreviations: false });
    const preferred = isHead
      ? capital
        ? found.filter((entry) => entry.pos === "NOUN")
        : []
      : found.filter(
          (entry) =>
            lookupKey(entry.lemma) === part &&
            (!linked[i] || entry.pos === "NOUN" || entry.pos === "PROPN"),
        );
    if (prefix.length > 0 && preferred.length === 0) return prefix;
    const kept = preferred.length > 0 ? preferred : found;
    const seen = new Set<string>();
    return kept.filter((entry) => {
      const id = JSON.stringify([entry.lemma, entry.pos, entry.senses]);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  });
  const result = perPart.flat();
  const slices = surfaceSlices(
    word,
    pieces.map((piece) => piece.text),
  );
  if (slices === undefined) return { entries: result };
  // A part repeated in the word (`Kindeskind`) gets its own copies, since an
  // entry belongs to at most one segment.
  let next = 0;
  let part = 0;
  const segments = pieces.map((piece, i): Segment => {
    if (!piece.part) return { text: slices[i]! };
    const count = perPart[part++]!.length;
    const indexes = Array.from({ length: count }, (_, k) => next + k);
    next += count;
    return count > 0
      ? { text: slices[i]!, entries: indexes }
      : { text: slices[i]! };
  });
  return { entries: result, segments };
};
