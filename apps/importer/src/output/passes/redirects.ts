import { hiragana, isKana } from "@dict/core/kana";
import { lookupKey } from "@dict/core/lookupKey";
import {
  FormSource,
  GRAMMAR_SOURCE_POS,
  PREFERRED_LETTERS_KEY,
} from "@dict/core/schema";
import type { Database } from "bun:sqlite";
import type { WriterContext } from "./context.ts";

/** How many words must spell a letter so, and what share of the letter's other spellings they must be. */
const LETTER_WORDS = 3;
const LETTER_SHARE = 0.1;

/**
 * Letter pairs (`學学`: the letter, then its other-script spelling) from the
 * lemmas spelled in both scripts (`學習`, `学习`), as `import.otherScriptTags`
 * stores them: a lemma row of an entry that isn't its lemma, of as many
 * letters. A pair counts when at least `LETTER_WORDS` words spell it, and
 * they are at least `LETTER_SHARE` of the words with the letter: a form that
 * isn't the word letter for letter gives pairs few words share (`波` as `云`
 * in three of the many words that keep `波`).
 */
const otherScriptLetters = (
  sqlite: Database,
): {
  readonly pairs: ReadonlySet<string>;
  readonly preferred: Readonly<Record<string, ReadonlyArray<string>>>;
} => {
  const words = new Map<string, number>();
  /** Words spelled in both scripts that have the letter, changed or not. */
  const ofLetter = new Map<string, number>();
  /** Words spelled in both scripts that keep the letter as it is. */
  const kept = new Map<string, number>();
  const rows = sqlite
    .query<{ lemma: string; form: string }, [number]>(
      `SELECT e.lemma AS lemma, f.form AS form FROM forms f JOIN entries e ON e.id = f.entry_id
       WHERE f.source = ?1 AND f.form <> e.lemma`,
    )
    .all(FormSource.Lemma);
  for (const { lemma, form } of rows) {
    const a = [...lookupKey(lemma)];
    const b = [...form];
    if (a.length !== b.length) continue;
    const pairs = new Set(
      a.flatMap((letter, i) => (letter !== b[i] ? [`${letter}${b[i]}`] : [])),
    );
    for (const pair of pairs) words.set(pair, (words.get(pair) ?? 0) + 1);
    for (const letter of new Set(a)) {
      ofLetter.set(letter, (ofLetter.get(letter) ?? 0) + 1);
    }
    for (const letter of new Set(a.filter((letter, i) => letter === b[i]))) {
      kept.set(letter, (kept.get(letter) ?? 0) + 1);
    }
  }
  const counted = [...words].filter(
    ([pair, n]) =>
      n >= LETTER_WORDS && n >= LETTER_SHARE * ofLetter.get([...pair][0]!)!,
  );
  const preferred: Record<string, Array<string>> = {};
  for (const [pair, n] of counted) {
    const [letter, other] = [...pair] as [string, string];
    if (n > (kept.get(other) ?? 0)) (preferred[other] ??= []).push(letter);
  }
  // A grammar-file line names a letter's common use: `裡/里` "in" is what
  // `里` mostly stands for, though many words keep `里` "li" as it is.
  const lines = sqlite
    .query<{ lemma: string; form: string }, [number]>(
      `SELECT e.lemma AS lemma, f.form AS form FROM forms f JOIN entries e ON e.id = f.entry_id
       WHERE f.source = ?1 AND e.source_pos = '${GRAMMAR_SOURCE_POS}' AND f.form <> e.lemma`,
    )
    .all(FormSource.Lemma);
  for (const { lemma, form } of lines) {
    const letter = lookupKey(lemma);
    if ([...letter].length !== 1 || [...form].length !== 1) continue;
    if (!(preferred[form] ?? []).includes(letter)) {
      (preferred[form] ??= []).push(letter);
    }
  }
  return { pairs: new Set(counted.map(([pair]) => pair)), preferred };
};

/**
 * Each letter's other-script spelling as a lemma of the letter's entries
 * (`机` of `機`, `干` of `乾` and `幹`), where Wiktionary has no redirect for
 * it: the simplified letter's page holds its own older meanings (`机` "a
 * kind of tree"), and texts write the letter so in every word.
 */
const addLetterLemmas = (
  sqlite: Database,
  pairs: ReadonlySet<string>,
  insertForm: WriterContext["insertForm"],
): number => {
  const entriesOf = sqlite.query<{ id: number }, [string, number]>(
    `SELECT DISTINCT f.entry_id AS id FROM forms f JOIN entries e ON e.id = f.entry_id
     WHERE f.form = ?1 AND f.source = ?2 AND e.lemma = ?1`,
  );
  let added = 0;
  for (const pair of pairs) {
    const [letter, other] = [...pair] as [string, string];
    for (const { id } of entriesOf.all(letter, FormSource.Lemma)) {
      added += insertForm.run(other, id, FormSource.Lemma).changes;
    }
  }
  return added;
};

export const addRedirects = ({
  sqlite,
  counts,
  redirects,
  hasEntry,
  insertForm,
  otherScript,
}: WriterContext) => {
  const readAs = sqlite.query<{ id: number }, [string, number, string]>(
    `SELECT DISTINCT f.entry_id AS id FROM forms f
     JOIN entries e ON e.id = f.entry_id AND e.pos <> 'PROPN'
     -- read as the spelling, plus what the lemma adds to the word (ねつぞう
     -- for 捏造する, read ねつぞうする: lemmaSuffixes)
     JOIN pronunciations p ON p.entry_id = f.entry_id AND p.kind = 'reading'
       AND p.value = ?3 || substr(e.lemma, length(?1) + 1)
     WHERE f.form = ?1 AND f.source = ?2`,
  );
  const lemmaOf = sqlite.query<{ id: number }, [string, number]>(
    `SELECT DISTINCT f.entry_id AS id FROM forms f
     JOIN entries e ON e.id = f.entry_id AND e.pos <> 'PROPN'
     WHERE f.form = ?1 AND f.source = ?2`,
  );
  // Names too: `美国` is `美國`.
  const anyLemmaOf = sqlite.query<{ id: number }, [string, number]>(
    `SELECT DISTINCT entry_id AS id FROM forms WHERE form = ?1 AND source = ?2`,
  );
  const letters = otherScript ? otherScriptLetters(sqlite) : undefined;
  const letterPairs: ReadonlySet<string> = letters?.pairs ?? new Set();
  if (letters !== undefined) {
    sqlite
      .query("INSERT OR REPLACE INTO meta (key, value) VALUES (?1, ?2)")
      .run(PREFERRED_LETTERS_KEY, JSON.stringify(letters.preferred));
  }
  const spellsInOtherScript = (form: string, target: string) => {
    const a = [...form];
    const b = [...target];
    return (
      a.length === b.length &&
      a.some((letter, i) => letter !== b[i]) &&
      a.every(
        (letter, i) => letter === b[i] || letterPairs.has(`${b[i]}${letter}`),
      )
    );
  };
  sqlite.transaction(() => {
    if (otherScript) {
      counts.redirectForms += addLetterLemmas(sqlite, letterPairs, insertForm);
    }
    for (const { form, targets } of redirects) {
      if (
        otherScript &&
        targets.some((t) => spellsInOtherScript(form, lookupKey(t)))
      ) {
        for (const target of targets) {
          if (!spellsInOtherScript(form, lookupKey(target))) continue;
          for (const { id } of anyLemmaOf.all(
            lookupKey(target),
            FormSource.Lemma,
          )) {
            counts.redirectForms += insertForm.run(
              form,
              id,
              FormSource.Lemma,
            ).changes;
          }
        }
        continue;
      }
      const own = hasEntry(form);
      for (const target of targets) {
        const key = lookupKey(target);
        const kanaVariant =
          isKana(form) && isKana(key) && hiragana(form) === hiragana(key);
        if (own && !kanaVariant) continue;
        const ids =
          isKana(form) && !isKana(key)
            ? readAs.all(key, FormSource.Lemma, form)
            : lemmaOf.all(key, FormSource.Lemma);
        for (const { id } of ids) {
          counts.redirectForms += insertForm.run(
            form,
            id,
            FormSource.Redirect,
          ).changes;
        }
      }
    }
  })();
};
