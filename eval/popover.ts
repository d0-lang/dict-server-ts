/** What a reader sees, as text for the judge. Pronunciation is left out. */
import { createHash } from "node:crypto";
import type { Entry, Item } from "./types.ts";

/** Same grouping as `groupEntries` in the extension: lowercase lemma and pos, senses in server order. */
export const groupEntries = (entries: ReadonlyArray<Entry>): ReadonlyArray<Entry> => {
  const groups = new Map<string, { lemma: string; pos: string; senses: Array<string> }>();
  for (const { lemma, pos, senses } of entries) {
    const key = JSON.stringify([lemma.toLowerCase(), pos]);
    const group = groups.get(key) ?? { lemma, pos, senses: [] };
    group.senses.push(...senses);
    groups.set(key, group);
  }
  return [...groups.values()];
};

export const renderPopover = (entries: ReadonlyArray<Entry>): string => {
  if (entries.length === 0) return "(no entries)";
  return groupEntries(entries)
    .flatMap((group, g) => [
      `${g + 1} ${group.lemma} ${group.pos}`,
      ...group.senses.map((sense, s) => `${g + 1}.${s + 1} ${sense}`),
    ])
    .join("\n");
};

/** Changes when the word, its sentence, what the reader sees, or the prompt changes. */
export const verdictKey = (item: Item, prompt: string): string =>
  createHash("sha256")
    .update([item.word, item.sentence, renderPopover(item.entries), prompt].join("\0"))
    .digest("hex");
