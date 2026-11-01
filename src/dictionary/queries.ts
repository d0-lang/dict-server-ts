import { asc, eq, inArray } from "drizzle-orm";
import type { DictionaryDb } from "./DictionaryDb.ts";
import { lookupKey } from "./lookupKey.ts";
import {
  entries,
  forms,
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
  }>;
};

/**
 * All entries a surface word resolves to (deinflection included), in import
 * order. Storage-level helper for the future lookup endpoint; ranking (exact
 * lemma first etc.) is left to the endpoint.
 */
export const findEntriesByForm = (
  db: DictionaryDb,
  word: string,
): ReadonlyArray<LookupEntry> => {
  const ids = db
    .select({ id: forms.entryId })
    .from(forms)
    .where(eq(forms.form, lookupKey(word)))
    .all()
    .map((r) => r.id);
  if (ids.length === 0) return [];

  const heads = db
    .select()
    .from(entries)
    .where(inArray(entries.id, ids))
    .orderBy(asc(entries.id))
    .all();
  const senseRows = db
    .select()
    .from(senses)
    .where(inArray(senses.entryId, ids))
    .orderBy(asc(senses.entryId), asc(senses.idx))
    .all();
  const pronRows = db
    .select()
    .from(pronunciations)
    .where(inArray(pronunciations.entryId, ids))
    .orderBy(asc(pronunciations.entryId), asc(pronunciations.idx))
    .all();

  return heads.map((head) => {
    const prons = pronRows.filter((p) => p.entryId === head.id);
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
        .filter((s) => s.entryId === head.id)
        .map((s) => ({ translations: s.translations })),
    };
  });
};
