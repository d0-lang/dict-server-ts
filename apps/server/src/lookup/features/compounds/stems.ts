import type { DictionaryDb } from "@dict/core/DictionaryDb";
import { caseClass, cleanWord, lookupKey } from "@dict/core/lookupKey";
import { CaseClass, FormSource } from "@dict/core/schema";
import { findEntriesByForm, loadEntries } from "../../common/entries.ts";
import { type CompoundSplit, distinctEntries } from "./parts.ts";
import {
  type CompoundRules,
  CONTENT_POS,
  MIN_PART,
  type PartScore,
  splitCompound,
} from "./split.ts";

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
    .iterate();
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
  // Counted in SQL: Russian has about a million forms, and reading them
  // one by one left some 800 MB of garbage at startup. `substr` counts
  // characters, as `[...form]` does.
  const endings = new Set(
    db.$client
      .query<{ ending: string }, []>(
        `SELECT ending FROM (
           SELECT substr(form, -${ENDING_LENGTH}) AS ending, count(*) AS forms, sum(verb) AS verbs
           FROM (
             SELECT f.form AS form, min(e.pos = 'VERB') AS verb
             FROM forms f JOIN entries e ON e.id = f.entry_id
             WHERE instr(f.form, ' ') = 0 GROUP BY f.form
           )
           GROUP BY ending
         )
         WHERE forms >= ${MIN_ENDING_FORMS} AND CAST(verbs AS REAL) / forms >= ${VERBAL_SHARE}`,
      )
      .all()
      .map((row) => row.ending),
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
    .iterate();
  const counts = new Map<string, { lemmas: number; verbs: number }>();
  for (const { lemma, pos } of lemmas) {
    const key = lookupKey(lemma);
    const verb = pos === "VERB";
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
export const stemCompound = (
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
