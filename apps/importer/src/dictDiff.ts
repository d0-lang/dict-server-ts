import { Database } from "bun:sqlite";

/**
 * What changed between two builds of one language's dictionary. Ids differ
 * between builds, so an entry is known by its lemma, part of speech, source
 * part of speech and etymology number, and a form by its text and that key.
 * An entry is changed when its senses, pronunciations, grammar features or
 * pages differ.
 */
export type DictDiff = {
  readonly entries: Changes & { readonly changed: number };
  readonly forms: Changes;
  /** A few of each kind, sorted, for a reviewer to look at. */
  readonly examples: {
    readonly addedEntries: ReadonlyArray<string>;
    readonly removedEntries: ReadonlyArray<string>;
    readonly changedEntries: ReadonlyArray<string>;
    readonly addedForms: ReadonlyArray<string>;
    readonly removedForms: ReadonlyArray<string>;
  };
};

type Changes = { readonly added: number; readonly removed: number };

const EXAMPLES = 10;

/** `Hund (NOUN)`, with the etymology number when it is not the first. */
const label = (lemma: string, pos: string, etymology: number) =>
  etymology > 1
    ? `${lemma} (${pos}, etymology ${etymology})`
    : `${lemma} (${pos})`;

type Contents = {
  /** entry key -> everything else about the entry, as one string */
  readonly entries: Map<string, string>;
  /** entry key -> its label */
  readonly labels: Map<string, string>;
  /** `form -> entry label` */
  readonly forms: Set<string>;
};

const readContents = (file: string): Contents => {
  const db = new Database(file, { readonly: true });
  try {
    const keyOf = new Map<number, string>();
    const labels = new Map<string, string>();
    const parts = new Map<string, Array<string>>();
    for (const row of db
      .query<
        {
          id: number;
          lemma: string;
          pos: string;
          source_pos: string;
          etymology: number;
          features: string | null;
          pages: string | null;
        },
        []
      >(
        "SELECT id, lemma, pos, source_pos, etymology, features, pages FROM entries ORDER BY id",
      )
      .all()) {
      const key = JSON.stringify([
        row.lemma,
        row.pos,
        row.source_pos,
        row.etymology,
      ]);
      keyOf.set(row.id, key);
      labels.set(key, label(row.lemma, row.pos, row.etymology));
      // Two entries with one key (rare) are compared as one, in file order.
      if (!parts.has(key)) parts.set(key, []);
      parts.get(key)!.push(`f:${row.features ?? ""}`, `p:${row.pages ?? ""}`);
    }
    const add = (entryId: number, part: string) => {
      const key = keyOf.get(entryId);
      if (key !== undefined) parts.get(key)!.push(part);
    };
    for (const row of db
      .query<{ entry_id: number; glosses: string; see: string | null }, []>(
        "SELECT entry_id, glosses, see FROM senses ORDER BY entry_id, idx",
      )
      .all()) {
      add(row.entry_id, `s:${row.glosses}|${row.see ?? ""}`);
    }
    for (const row of db
      .query<{ entry_id: number; kind: string; value: string }, []>(
        "SELECT entry_id, kind, value FROM pronunciations ORDER BY entry_id, idx",
      )
      .all()) {
      add(row.entry_id, `r:${row.kind}|${row.value}`);
    }
    const forms = new Set<string>();
    for (const row of db
      .query<{ form: string; entry_id: number }, []>(
        "SELECT form, entry_id FROM forms",
      )
      .all()) {
      const key = keyOf.get(row.entry_id);
      if (key !== undefined) forms.add(`${row.form} -> ${labels.get(key)}`);
    }
    const entries = new Map(
      [...parts].map(([key, list]) => [key, list.join("\n")]),
    );
    return { entries, labels, forms };
  } finally {
    db.close();
  }
};

const firstSorted = (items: Iterable<string>) =>
  [...items].sort().slice(0, EXAMPLES);

/** What changed from the dictionary file `before` to `after`. */
export const diffDictionaries = (before: string, after: string): DictDiff => {
  const old = readContents(before);
  const next = readContents(after);
  const added = [...next.entries.keys()].filter((k) => !old.entries.has(k));
  const removed = [...old.entries.keys()].filter((k) => !next.entries.has(k));
  const changed = [...next.entries].filter(
    ([k, contents]) => old.entries.has(k) && old.entries.get(k) !== contents,
  );
  const addedForms = [...next.forms].filter((f) => !old.forms.has(f));
  const removedForms = [...old.forms].filter((f) => !next.forms.has(f));
  return {
    entries: {
      added: added.length,
      removed: removed.length,
      changed: changed.length,
    },
    forms: { added: addedForms.length, removed: removedForms.length },
    examples: {
      addedEntries: firstSorted(added.map((k) => next.labels.get(k)!)),
      removedEntries: firstSorted(removed.map((k) => old.labels.get(k)!)),
      changedEntries: firstSorted(changed.map(([k]) => next.labels.get(k)!)),
      addedForms: firstSorted(addedForms),
      removedForms: firstSorted(removedForms),
    },
  };
};
