import type { DictionaryDb } from "@dict/core/DictionaryDb";
import { caseClass, lookupKey } from "@dict/core/lookupKey";
import { FormSource, GRAMMAR_SOURCE_POS } from "@dict/core/schema";
import type { GrammarEntry } from "../grammar.ts";
import type { Degree } from "../transform/rules.ts";
import type {
  DerivedSense,
  FormOfLink,
  ImportEntry,
} from "../transform/transform.ts";
import type { Redirect, WriterContext } from "./passes/context.ts";
import { addRedirects } from "./passes/redirects.ts";
import { addDegreeForms, settleDegreeEntries } from "./passes/degrees.ts";
import { copyDerivedMeanings } from "./passes/derived.ts";
import { dropUnreachedEntries, replaceGrammarWords } from "./passes/grammar.ts";
import {
  countUnresolvedLinks,
  followLinkChains,
  resolveFormOf,
} from "./passes/links.ts";
import { addParticipleForms } from "./passes/participles.ts";
import { resolveSee } from "./passes/see.ts";
import {
  addAbbreviations,
  addLetterVariants,
  addUnspacedAbbreviations,
} from "./passes/spellings.ts";

export type WriterCounts = {
  entries: number;
  /** wiktextract lines merged into an earlier entry with the same word + etymology + pos */
  mergedLines: number;
  senses: number;
  pronunciations: number;
  /** distinct form-of / alt-of links staged for the fallback */
  formOfLinks: number;
  /** entries kept although all their senses belong to a historical stage */
  historicalEntries: number;
  /** derived senses that got the meaning of their base */
  derivedCopied: number;
  /** derived senses left as a bare gloss, because no meaning was found */
  derivedBare: number;
  /** comparative-only entries folded into the same word's other entry */
  degreeMerged: number;
  /** comparative-only entries spelled like a plain form of their base, left to the base */
  degreeDropped: number;
  /** irregular declined comparatives and superlatives that also reach their degree entry */
  degreeForms: number;
  /** declined participles indexed, where no other entry had the form */
  participleForms: number;
  /** `see` targets that have an entry */
  seeLinks: number;
  /** entries from the language's grammar file */
  grammarEntries: number;
  /** Wiktionary grammar-word rows replaced by those entries */
  grammarReplaced: number;
  /** abbreviations also reachable without their period */
  abbreviations: number;
  /** forms also reachable with an optional letter written plainly */
  letterVariants: number;
  /** spaced abbreviations also reachable without the spaces */
  unspacedAbbreviations: number;
  /** Kana spellings added as forms of the lemmas their soft redirect names (`つまり` -> `詰まり`). */
  redirectForms: number;
};

export type FormOfResult = {
  /** fallback rows actually added to `forms` (not already covered by an inflection table) */
  readonly added: number;
  /** words with a link, directly or through a chain, to no entry in this file */
  readonly unresolved: number;
};

type EntryState = {
  readonly id: number;
  readonly glosses: Set<string>;
  readonly prons: Set<string>;
  readonly pages: Set<string>;
};

/**
 * Batched writer over prepared statements on the raw bun:sqlite client (the
 * hot path; Drizzle's query builder is used for reads). The grammar file's
 * entries are written on creation, so they come first in import order. Call
 * `writeBatch` once per batch (each call is one transaction), then `finish`
 * once.
 *
 * Forms are deduplicated by the `forms` primary key with `INSERT OR IGNORE`,
 * not in memory. The only in-memory state is one small record per entry, to
 * merge wiktextract lines that share word + etymology + pos.
 */
export const makeWriter = (
  db: DictionaryDb,
  grammar: ReadonlyArray<GrammarEntry>,
  optionalLetters: ReadonlyArray<readonly [string, string]> = [],
  /** The language has reflexive entries (`bawić się`), which share their verb's forms. */
  reflexive = false,
) => {
  const sqlite = db.$client;
  sqlite.run(`CREATE TEMP TABLE form_of_pending (
    form       TEXT NOT NULL,
    lemma      TEXT NOT NULL,
    source_pos TEXT NOT NULL,
    pointer    INTEGER NOT NULL,
    marked     INTEGER NOT NULL,
    PRIMARY KEY (form, lemma, source_pos)
  ) WITHOUT ROWID`);

  const insertEntry = sqlite.prepare(
    "INSERT INTO entries (id, lemma, pos, source_pos, etymology, case_class, features, pages) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const selectPages = sqlite.query<{ pages: string | null }, [number]>(
    "SELECT pages FROM entries WHERE id = ?",
  );
  const updatePages = sqlite.prepare(
    "UPDATE entries SET pages = ? WHERE id = ?",
  );
  /** Add Wiktionary pages to the ones entry `id` credits, after them, without repeats. */
  const addPages = (id: number, pages: Iterable<string>) => {
    const stored = selectPages.get(id)?.pages;
    const old: ReadonlyArray<string> =
      stored === null || stored === undefined ? [] : JSON.parse(stored);
    const all = [...new Set([...old, ...pages])];
    if (all.length > old.length) updatePages.run(JSON.stringify(all), id);
  };
  const insertSense = sqlite.prepare(
    "INSERT INTO senses (entry_id, idx, glosses, see) VALUES (?, ?, ?, ?)",
  );
  const insertPron = sqlite.prepare(
    "INSERT INTO pronunciations (entry_id, idx, kind, value) VALUES (?, ?, ?, ?)",
  );
  const insertForm = sqlite.prepare(
    "INSERT OR IGNORE INTO forms (form, entry_id, source) VALUES (?, ?, ?)",
  );
  // Two links between the same words: the less weak one wins whole, as in
  // `dedupeLinks`, so a marked link and a pointer link don't merge into a
  // plain one. (A chain instead takes the weaker value of each flag.)
  const insertPending = sqlite.prepare(
    `INSERT INTO form_of_pending (form, lemma, source_pos, pointer, marked) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT DO UPDATE SET pointer = excluded.pointer, marked = excluded.marked
     WHERE excluded.pointer + excluded.marked < pointer + marked`,
  );

  const counts: WriterCounts = {
    entries: 0,
    mergedLines: 0,
    senses: 0,
    pronunciations: 0,
    formOfLinks: 0,
    historicalEntries: 0,
    derivedCopied: 0,
    derivedBare: 0,
    degreeMerged: 0,
    degreeDropped: 0,
    degreeForms: 0,
    participleForms: 0,
    seeLinks: 0,
    grammarEntries: 0,
    grammarReplaced: 0,
    abbreviations: 0,
    letterVariants: 0,
    unspacedAbbreviations: 0,
    redirectForms: 0,
  };
  let lastId = 0;
  const byKey = new Map<string, EntryState>();
  const historicalEntries: Array<ImportEntry> = [];
  const verbalNouns: Array<{ form: string; entryId: number }> = [];
  const participleForms: Array<{ form: string; entryId: number }> = [];
  /** entry id -> gloss -> its derived sense */
  const derivedByEntry = new Map<number, Map<string, DerivedSense>>();
  /** entry id -> forms its table tags comparative or superlative */
  const degreeFormsByEntry = new Map<number, Map<string, Degree | undefined>>();

  /** word + pos + etymology -> the grammar of its last line that had any */
  const lastFeatures = new Map<string, string>();

  /**
   * Lines with the same word, part of speech and etymology are one entry,
   * unless their grammar differs: `See` m "lake" and `See` f "sea" are two
   * words. A line without grammar continues the last one that had it, since
   * wiktextract splits some entries over several lines.
   */
  const grammarOf = (entry: ImportEntry): string | undefined => {
    const word = `${entry.lemma}\u0000${entry.sourcePos}\u0000${entry.etymology}`;
    if (entry.features !== undefined) lastFeatures.set(word, entry.features);
    return entry.features ?? lastFeatures.get(word);
  };

  /** verb + pos + etymology + grammar -> the forms its lines list, and its entries */
  const verbForms = new Map<string, { forms: Set<string>; ids: Set<number> }>();

  /**
   * A verb and its reflexive entries (`zakręcać`, `zakręcać się`) share the
   * forms any of their lines lists: wiktextract may give the table on the
   * reflexive line only. Grammar keeps them apart, as for other entries.
   */
  const shareForms = (
    entry: ImportEntry,
    id: number,
    features: string | undefined,
  ) => {
    const key = `${entry.reflexiveOf ?? entry.lemma}\u0000${entry.sourcePos}\u0000${entry.etymology}\u0000${features ?? ""}`;
    let group = verbForms.get(key);
    if (group === undefined) {
      group = { forms: new Set(), ids: new Set() };
      verbForms.set(key, group);
    }
    if (!group.ids.has(id)) {
      for (const form of group.forms) {
        insertForm.run(form, id, FormSource.Inflection);
      }
      group.ids.add(id);
    }
    for (const form of entry.forms) {
      if (group.forms.has(form)) continue;
      group.forms.add(form);
      for (const other of group.ids) {
        insertForm.run(form, other, FormSource.Inflection);
      }
    }
  };

  const writeEntry = (entry: ImportEntry) => {
    const features = grammarOf(entry);
    const key = `${entry.lemma}\u0000${entry.sourcePos}\u0000${entry.etymology}\u0000${features ?? ""}`;
    let state = byKey.get(key);
    if (state === undefined) {
      state = {
        id: ++lastId,
        glosses: new Set(),
        prons: new Set(),
        pages: new Set([entry.page]),
      };
      counts.entries++;
      byKey.set(key, state);
      insertEntry.run(
        state.id,
        entry.lemma,
        entry.pos,
        entry.sourcePos,
        entry.etymology,
        caseClass(entry.lemma),
        features ?? null,
        JSON.stringify([entry.page]),
      );
      insertForm.run(lookupKey(entry.lemma), state.id, FormSource.Lemma);
    } else {
      counts.mergedLines++;
      if (!state.pages.has(entry.page)) {
        state.pages.add(entry.page);
        addPages(state.id, [entry.page]);
      }
    }
    for (const { glosses, see } of entry.senses) {
      const k = glosses.join("\u0000");
      if (state.glosses.has(k)) continue;
      insertSense.run(
        state.id,
        state.glosses.size,
        JSON.stringify(glosses),
        see.length > 0 ? JSON.stringify(see) : null,
      );
      state.glosses.add(k);
      counts.senses++;
    }
    for (const pron of entry.pronunciations) {
      const k = `${pron.kind}\u0000${pron.value}`;
      if (state.prons.has(k)) continue;
      insertPron.run(state.id, state.prons.size, pron.kind, pron.value);
      state.prons.add(k);
      counts.pronunciations++;
    }
    if (reflexive && entry.pos === "VERB") {
      shareForms(entry, state.id, features);
    } else {
      for (const form of entry.forms) {
        insertForm.run(form, state.id, FormSource.Inflection);
      }
    }
    for (const form of entry.verbalNouns) {
      verbalNouns.push({ form, entryId: state.id });
    }
    for (const form of entry.participleForms ?? []) {
      participleForms.push({ form, entryId: state.id });
    }
    if ((entry.degreeForms?.length ?? 0) > 0) {
      const degrees =
        degreeFormsByEntry.get(state.id) ??
        new Map<string, Degree | undefined>();
      for (const { form, degree } of entry.degreeForms!) {
        // Lines of one word that disagree on the degree name neither.
        degrees.set(
          form,
          degrees.has(form) && degrees.get(form) !== degree
            ? undefined
            : degree,
        );
      }
      degreeFormsByEntry.set(state.id, degrees);
    }
    if (entry.derived.length > 0) {
      const senses = derivedByEntry.get(state.id) ?? new Map();
      for (const sense of entry.derived) senses.set(sense.gloss, sense);
      derivedByEntry.set(state.id, senses);
    }
  };

  /** Grammar-file entries are not merged with Wiktionary lines. */
  sqlite.transaction(() => {
    for (const entry of grammar) {
      const id = ++lastId;
      insertEntry.run(
        id,
        entry.lemma,
        entry.pos,
        GRAMMAR_SOURCE_POS,
        0,
        caseClass(entry.lemma),
        null,
        null,
      );
      insertForm.run(lookupKey(entry.lemma), id, FormSource.Lemma);
      for (const form of entry.forms ?? []) {
        insertForm.run(lookupKey(form), id, FormSource.Inflection);
      }
      entry.senses.forEach((sense, idx) => {
        const see = entry.see?.[idx] ?? [];
        insertSense.run(
          id,
          idx,
          JSON.stringify([sense]),
          see.length > 0 ? JSON.stringify(see) : null,
        );
        counts.senses++;
      });
      counts.entries++;
      counts.grammarEntries++;
    }
  })();

  /** Soft redirects, resolved once every entry is written (`addRedirects`). */
  const redirects: Array<Redirect> = [];

  const writeLinks = (links: ReadonlyArray<FormOfLink>) => {
    for (const link of links) {
      counts.formOfLinks += insertPending.run(
        link.form,
        link.lemma,
        link.sourcePos,
        link.pointer ? 1 : 0,
        link.marked ? 1 : 0,
      ).changes;
    }
  };

  const writeBatch = sqlite.transaction(
    (
      items: ReadonlyArray<{
        readonly entry: ImportEntry | undefined;
        readonly historicalEntry?: ImportEntry;
        readonly reflexiveEntries?: ReadonlyArray<ImportEntry>;
        readonly formOf: ReadonlyArray<FormOfLink>;
        readonly redirect?: Redirect;
      }>,
    ) => {
      for (const item of items) {
        if (item.redirect !== undefined) redirects.push(item.redirect);
        if (item.entry !== undefined) writeEntry(item.entry);
        for (const entry of item.reflexiveEntries ?? []) writeEntry(entry);
        if (item.historicalEntry !== undefined) {
          historicalEntries.push(item.historicalEntry);
        }
        writeLinks(item.formOf);
      }
    },
  );

  const hasEntry = (key: string): boolean =>
    sqlite
      .query<{ n: number }, [string, number]>(
        "SELECT count(*) AS n FROM forms WHERE form = ? AND source = ?",
      )
      .get(key, FormSource.Lemma)!.n > 0;

  /** Write the historical entries of words that ended up with no other entry. */
  const restoreHistoricalEntries = sqlite.transaction(() => {
    const missing = historicalEntries.filter(
      (entry) => !hasEntry(lookupKey(entry.lemma)),
    );
    for (const entry of missing) writeEntry(entry);
    counts.historicalEntries = missing.length;
  });

  /** What the passes in `passes/` work with. */
  const ctx: WriterContext = {
    redirects,
    sqlite,
    counts,
    insertSense,
    insertForm,
    addPages,
    optionalLetters,
    hasEntry,
    verbalNouns,
    participleForms,
    derivedByEntry,
    degreeFormsByEntry,
  };

  /**
   * Everything that needs the whole dump, in order. Call once, after the last
   * `writeBatch`. `formOfFallback: false` skips only the link fallback.
   */
  const finish = (formOfFallback: boolean): FormOfResult => {
    // Words that depend on others, which may come later in the dump.
    restoreHistoricalEntries();
    followLinkChains(ctx);
    copyDerivedMeanings(ctx);
    settleDegreeEntries(ctx);
    resolveSee(ctx);
    const unresolved = countUnresolvedLinks(ctx);
    const added = formOfFallback ? resolveFormOf(ctx) : 0;
    // After the form-of links, which add a table's forms to its base too.
    addDegreeForms(ctx);
    addParticipleForms(ctx);
    // After every form spelled so, which decide what has an entry of its own.
    addRedirects(ctx);
    sqlite.run("DROP TABLE form_of_pending");
    // Then the steps that need every form in place.
    sqlite.transaction(() => {
      replaceGrammarWords(ctx);
      dropUnreachedEntries(ctx);
      addUnspacedAbbreviations(ctx);
      addAbbreviations(ctx);
      addLetterVariants(ctx);
    })();
    return { added, unresolved };
  };

  return { counts, writeBatch, finish };
};

export type Writer = ReturnType<typeof makeWriter>;
