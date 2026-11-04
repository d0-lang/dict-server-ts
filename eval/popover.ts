/** What a reader sees, as text for the judge. Pronunciation is left out. */
import { createHash } from "node:crypto";
import type { Entry, Item, Segment } from "./types.ts";

/** A numbered group of the popover; `part` is the segment it explains, if any. */
export type Group = Entry & { readonly part?: string };

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

/**
 * The groups in reading order. With segments, as the protocol says: entries in
 * no segment belong to the whole word and come first, then each part's own
 * groups.
 */
export const popoverGroups = (
  entries: ReadonlyArray<Entry>,
  segments?: ReadonlyArray<Segment>,
): ReadonlyArray<Group> => {
  if (segments === undefined) return groupEntries(entries);
  const inSegment = new Set(segments.flatMap((segment) => segment.entries ?? []));
  return [
    ...groupEntries(entries.filter((_, i) => !inSegment.has(i))),
    ...segments.flatMap((segment) =>
      groupEntries((segment.entries ?? []).map((i) => entries[i]!)).map((group) => ({
        ...group,
        part: segment.text,
      })),
    ),
  ];
};

export const renderPopover = (
  entries: ReadonlyArray<Entry>,
  segments?: ReadonlyArray<Segment>,
): string => {
  if (entries.length === 0) return "(no entries)";
  const split =
    segments === undefined
      ? []
      : [
          `word parts: ${segments
            .map((segment) => (segment.entries === undefined ? `${segment.text} (linking element)` : segment.text))
            .join(" | ")}`,
        ];
  return [
    ...split,
    ...popoverGroups(entries, segments).flatMap((group, g) => [
      `${g + 1} ${group.lemma} ${group.pos}${group.part === undefined ? "" : ` (part "${group.part}")`}`,
      ...group.senses.map((sense, s) => `${g + 1}.${s + 1} ${sense}`),
    ]),
  ].join("\n");
};

/** Changes when the word, its sentence, what the reader sees, or the prompt changes. */
export const verdictKey = (item: Item, prompt: string): string =>
  createHash("sha256")
    .update([item.word, item.sentence, renderPopover(item.entries, item.segments), prompt].join("\0"))
    .digest("hex");
