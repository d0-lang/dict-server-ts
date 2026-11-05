import { asc, inArray } from "drizzle-orm";
import type { DictionaryDb } from "./DictionaryDb.ts";
import {
  type CompoundPiece,
  type CompoundRules,
  CONTENT_POS,
  MIN_PART,
  type PartScore,
  splitCompound,
} from "./compounds.ts";
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
  rules: CompoundRules | undefined,
): LookupResult => {
  const direct = findEntriesByForm(db, word);
  if (direct.length > 0 || rules === undefined) return { entries: direct };
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
  return compoundEntries(db, word, rules);
};

/**
 * The parts of `word` as a compound, with their entries and segments, whether
 * or not the word has an entry of its own. Empty when it doesn't split.
 * `findEntriesWithCompounds` uses it for words without an entry; the segments
 * benchmark calls it directly.
 */
export const compoundEntries = (
  db: DictionaryDb,
  word: string,
  rules: CompoundRules,
): LookupResult => {
  const split =
    rules.stemEndings === undefined
      ? wordCompound(db, word, rules.linkers)
      : stemCompound(db, word, rules);
  return split === undefined
    ? { entries: [] }
    : compoundResult(word, split.pieces, split.perPart);
};

type CompoundSplit = {
  readonly pieces: ReadonlyArray<CompoundPiece>;
  /** The entries of each part, in order. */
  readonly perPart: ReadonlyArray<ReadonlyArray<LookupEntry>>;
};

const distinctEntries = (
  entries: ReadonlyArray<LookupEntry>,
): ReadonlyArray<LookupEntry> => {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const id = JSON.stringify([entry.lemma, entry.pos, entry.senses]);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
};

/** German-style compounds: every part is a word form (`Gemüse|fonds`). */
const wordCompound = (
  db: DictionaryDb,
  word: string,
  linkers: ReadonlyArray<string>,
): CompoundSplit | undefined => {
  const capital = caseClass(cleanWord(word)) !== CaseClass.Lower;
  const key = lookupKey(word);
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
  if (pieces === undefined) return undefined;
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
    return distinctEntries(preferred.length > 0 ? preferred : found);
  });
  return { pieces, perPart };
};

const stemIndexes = new WeakMap<
  DictionaryDb,
  Map<CompoundRules, ReadonlyMap<string, ReadonlyArray<number>>>
>();

/**
 * Content-word lemmas, not names, by the stems they give a compound (`stemEndings`):
 * the lemma itself and the lemma without its ending (`нефть` → `нефт`,
 * `новый` → `нов`), also without its optional letters (`лед` for `лёд`).
 * Built once per file, on first use.
 */
const stemIndex = (
  db: DictionaryDb,
  rules: CompoundRules,
): ReadonlyMap<string, ReadonlyArray<number>> => {
  const byRules = stemIndexes.get(db) ?? new Map();
  stemIndexes.set(db, byRules);
  const cached = byRules.get(rules);
  if (cached !== undefined) return cached;
  const endings = [...(rules.stemEndings ?? [])].sort(
    (a, b) => b.length - a.length,
  );
  const rows = db.$client
    .query<{ id: number; lemma: string }, []>(
      `SELECT id, lemma FROM entries
       WHERE pos IN ('NOUN', 'ADJ', 'NUM') AND instr(lemma, ' ') = 0 AND instr(lemma, '-') = 0
       ORDER BY id`,
    )
    .all();
  const index = new Map<string, Array<number>>();
  const add = (stem: string, id: number) => {
    if ([...stem].length < MIN_PART) return;
    const ids = index.get(stem);
    if (ids === undefined) index.set(stem, [id]);
    else if (!ids.includes(id)) ids.push(id);
  };
  for (const { id, lemma } of rows) {
    const key = lookupKey(lemma);
    const ending = endings.find((e) => key.endsWith(e));
    const stems = [key, ...(ending ? [key.slice(0, -ending.length)] : [])];
    for (const stem of stems) {
      add(stem, id);
      for (const [letter, plain] of rules.optionalLetters ?? []) {
        if (stem.includes(letter)) add(stem.replaceAll(letter, plain), id);
      }
    }
  }
  byRules.set(rules, index);
  return index;
};

/** Letters at the end of a word that tell whether it is a verb form. */
const ENDING_LENGTH = 3;
/** Share of a word ending's forms that must be verb forms to call it verbal. */
const VERBAL_SHARE = 0.9;
/** Forms an ending needs before its share counts. */
const MIN_ENDING_FORMS = 100;

const verbEndingIndexes = new WeakMap<DictionaryDb, ReadonlySet<string>>();

/**
 * Word endings that almost only verb forms have (`-аем`, `-ать`, `-или`),
 * read from the dictionary's one-word forms. Built once per file, on first
 * use.
 */
const verbEndings = (db: DictionaryDb): ReadonlySet<string> => {
  const cached = verbEndingIndexes.get(db);
  if (cached !== undefined) return cached;
  const rows = db.$client
    .query<{ form: string; verb: number }, []>(
      `SELECT f.form AS form, min(e.pos = 'VERB') AS verb
       FROM forms f JOIN entries e ON e.id = f.entry_id
       WHERE instr(f.form, ' ') = 0 GROUP BY f.form`,
    )
    .all();
  const counts = new Map<string, { forms: number; verbs: number }>();
  for (const { form, verb } of rows) {
    const ending = [...form].slice(-ENDING_LENGTH).join("");
    const count = counts.get(ending) ?? { forms: 0, verbs: 0 };
    count.forms++;
    count.verbs += verb;
    counts.set(ending, count);
  }
  const endings = new Set(
    [...counts].flatMap(([ending, { forms, verbs }]) =>
      forms >= MIN_ENDING_FORMS && verbs / forms >= VERBAL_SHARE
        ? [ending]
        : [],
    ),
  );
  verbEndingIndexes.set(db, endings);
  return endings;
};

/** Builds the indexes compound lookups use, so the first lookup doesn't wait. */
export const warmCompounds = (db: DictionaryDb, rules: CompoundRules): void => {
  if (rules.stemEndings === undefined) return;
  stemIndex(db, rules);
  verbEndings(db);
  combiningForms(db);
};

/** Share of the lemmas a prefix begins that may be verbs, for it to count as a combining form. */
const MAX_PREFIX_VERB_SHARE = 0.2;
/** Lemmas a prefix must begin before its verb share counts. */
const MIN_PREFIX_LEMMAS = 5;

const combiningFormIndexes = new WeakMap<DictionaryDb, ReadonlySet<string>>();

/**
 * Prefix entries that work as a compound's first part (`фото-`, `кибер-`,
 * `анти-`), without their hyphen. Not word-forming prefixes, which mostly
 * make verbs (`при-`, `под-`, `пере-`): splitting them off doesn't explain a
 * word (`при|браться` for `прибраться` "to tidy up", `про|при|етарных`). Read
 * from the lemmas each prefix begins: a combining form begins few verbs.
 * Built once per file, on first use.
 */
const combiningForms = (db: DictionaryDb): ReadonlySet<string> => {
  const cached = combiningFormIndexes.get(db);
  if (cached !== undefined) return cached;
  const prefixes = new Set(
    db.$client
      .query<{ lemma: string }, []>(
        `SELECT lemma FROM entries WHERE lemma LIKE '%-' AND lemma NOT LIKE '-%'`,
      )
      .all()
      .map(({ lemma }) => lookupKey(lemma).slice(0, -1))
      .filter((prefix) => prefix !== ""),
  );
  const lemmas = db.$client
    .query<{ lemma: string; pos: string }, []>(
      `SELECT lemma, pos FROM entries WHERE instr(lemma, ' ') = 0 AND instr(lemma, '-') = 0`,
    )
    .all()
    .map(({ lemma, pos }) => ({ key: lookupKey(lemma), verb: pos === "VERB" }));
  const counts = new Map<string, { lemmas: number; verbs: number }>();
  for (const { key, verb } of lemmas) {
    const chars = [...key];
    // Every prefix of the lemma that leaves a stem of three letters or more.
    for (let cut = 1; cut <= chars.length - MIN_PART; cut++) {
      const prefix = chars.slice(0, cut).join("");
      if (!prefixes.has(prefix)) continue;
      const count = counts.get(prefix) ?? { lemmas: 0, verbs: 0 };
      count.lemmas++;
      if (verb) count.verbs++;
      counts.set(prefix, count);
    }
  }
  const forms = new Set(
    [...prefixes].filter((prefix) => {
      const count = counts.get(prefix);
      return (
        count === undefined ||
        count.lemmas < MIN_PREFIX_LEMMAS ||
        count.verbs / count.lemmas < MAX_PREFIX_VERB_SHARE
      );
    }),
  );
  combiningFormIndexes.set(db, forms);
  return forms;
};

/** Parts of a stem compound. */
const MAX_STEM_PARTS = 2;

/** The endings, and each followed by a reflexive `ся` (`-щийся`, `-щегося`). */
const withReflexive = (
  endings: ReadonlyArray<string>,
): ReadonlyArray<string> => [...endings, ...endings.map((e) => `${e}ся`)];

/** Shortest head of a stem compound (`пар|о|ход` is lost, `ранг|о|вой` too). */
const MIN_STEM_HEAD = 4;

/** Entries a modifier explains with, at most this many per part. */
const MAX_STEM_ENTRIES = 3;

/**
 * Russian-style compounds, whose modifiers are stems (`stemEndings`): a
 * combining-form entry joined plainly (`электро|станция`), a stem with a
 * linker (`лес|о|насаждение`, `нефт|е|газовый`), or a number form joined
 * plainly (`двух|этажный`). The head is a content-word form as written.
 */
const stemCompound = (
  db: DictionaryDb,
  word: string,
  rules: CompoundRules,
): CompoundSplit | undefined => {
  // Capitalised words without an entry are mostly names (`Руденко` isn't
  // `руда` + `НКО`); a compound at a sentence start is the rarer loss.
  if (caseClass(cleanWord(word)) !== CaseClass.Lower) return undefined;
  const key = lookupKey(word);
  const adjectiveEndings = withReflexive(rules.adjectiveEndings ?? []);
  const adjectiveLike = (form: string) =>
    adjectiveEndings.some((ending) => form.endsWith(ending));
  // A word without an entry that ends like a verb is mostly a prefixed or
  // slang verb (`покопаем`, `шпиговали`), not a compound, unless it ends like
  // an adjective, as participles do (`лес|о|обрабатывающий`), or its head is
  // a noun as the dictionary writes it (`аудио|запись`, not `пок|о|паем`).
  const verbal =
    verbEndings(db).has([...key].slice(-ENDING_LENGTH).join("")) &&
    !adjectiveLike(key);
  const index = stemIndex(db, rules);
  // Not a name either: `шпиг|о|вали` isn't `Валя`.
  const heads = [...CONTENT_POS, "DET"]
    .filter((p) => p !== "VERB" && p !== "PROPN")
    .map((p) => `'${p}'`)
    .join(", ");
  // Wiktionary tags some adjectives as determiners (`подобный`), and
  // `-подобный` is among the commonest heads.
  const headForm = db.$client.query<{ n: number }, [string]>(
    `SELECT count(*) AS n FROM forms f JOIN entries e ON e.id = f.entry_id
     WHERE f.form = ? AND f.source <> ${FormSource.Abbreviation} AND e.pos IN (${heads})`,
  );
  const headLemma = db.$client.query<{ n: number }, [string]>(
    `SELECT count(*) AS n FROM forms f JOIN entries e ON e.id = f.entry_id
     WHERE f.form = ? AND f.source = ${FormSource.Lemma} AND e.pos IN (${heads})`,
  );
  const verbForm = db.$client.query<{ n: number }, [string]>(
    `SELECT count(*) AS n FROM forms f JOIN entries e ON e.id = f.entry_id
     WHERE f.form = ? AND f.source <> ${FormSource.Abbreviation} AND e.pos = 'VERB'`,
  );
  const participle = (head: string) =>
    adjectiveLike(head) && verbForm.get(head)!.n > 0;
  // A plain join puts a whole number form first (`двух|этажный`); a whole
  // noun there mostly misreads a linked one (`дом|острой` for `дом|о|строй`).
  const numberForm = db.$client.query<{ n: number }, [string]>(
    `SELECT count(*) AS n FROM forms f JOIN entries e ON e.id = f.entry_id
     WHERE f.form = ? AND f.source <> ${FormSource.Abbreviation} AND e.pos = 'NUM'`,
  );
  const forms = combiningForms(db);
  const prefixEntry = db.$client.query<{ n: number }, [string]>(
    `SELECT count(*) AS n FROM forms WHERE form = ? AND source = ${FormSource.Lemma}`,
  );
  const isPrefix = (stem: string) => forms.has(stem);
  const partScore: PartScore = (stem, linker) => {
    if (linker === "") {
      if (isPrefix(stem)) return 4;
      // A number form spelled out beats a stem with a linker (`восьми|метровый`,
      // not `восьм|и|метровый` from `восьмой`).
      return numberForm.get(stem)!.n > 0 ? 4 : 0;
    }
    if (isPrefix(stem + linker)) return 3;
    // A word-forming prefix spelled as a stem and a linker (`пер|е|запуск`
    // is `перезапуск`, not `перо`).
    if (prefixEntry.get(`${stem}${linker}-`)!.n > 0) return 0;
    // A word ending like a verb takes only a combining form (`аудио|запись`):
    // `приб|е|русь` is `приберусь` "I'll tidy up".
    if (verbal) return 0;
    return index.has(stem) ? 3 : 0;
  };
  // A head of three letters is mostly a suffix read as a word (`ранг|о|вой`).
  const headScore: PartScore = (head) => {
    if ([...head].length < MIN_STEM_HEAD) return 0;
    if (verbal) return headLemma.get(head)!.n > 0 ? 1 : 0;
    return headForm.get(head)!.n > 0 || participle(head) ? 1 : 0;
  };
  // Two parts: a modifier split again would need its own head checks
  // (`про|при|е|тарных`, `лес|о|три|станция`).
  const pieces = splitCompound(
    key,
    partScore,
    rules.linkers,
    MAX_STEM_PARTS,
    headScore,
  );
  if (pieces === undefined) return undefined;
  const perPart = pieces.flatMap((piece, i) => {
    if (!piece.part) return [];
    const isHead = i === pieces.length - 1;
    const formEntries = (form: string) =>
      findEntriesByForm(db, form, { abbreviations: false }).filter((entry) =>
        CONTENT_POS.has(entry.pos),
      );
    if (isHead) {
      const head = findEntriesByForm(db, piece.text, {
        abbreviations: false,
      }).filter(
        (entry) =>
          (CONTENT_POS.has(entry.pos) || entry.pos === "DET") &&
          entry.pos !== "PROPN",
      );
      return [distinctEntries(head)];
    }
    const linker = pieces[i + 1]?.part === false ? pieces[i + 1]!.text : "";
    const combining = forms.has(`${piece.text}${linker}`)
      ? findEntriesByForm(db, `${piece.text}${linker}-`, {
          abbreviations: false,
        })
      : [];
    if (combining.length > 0) return [combining];
    // A plain join is a number (`восьми|метровый` is `восемь`, not `восьмой`).
    const entries =
      linker === ""
        ? formEntries(piece.text).filter((entry) => entry.pos === "NUM")
        : loadEntries(
            db,
            (index.get(piece.text) ?? []).slice(0, MAX_STEM_ENTRIES),
          );
    return [distinctEntries(entries).slice(0, MAX_STEM_ENTRIES)];
  });
  return { pieces, perPart };
};

/** The entries of a split word in reading order, with its segments. */
const compoundResult = (
  word: string,
  pieces: ReadonlyArray<CompoundPiece>,
  perPart: ReadonlyArray<ReadonlyArray<LookupEntry>>,
): LookupResult => {
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
