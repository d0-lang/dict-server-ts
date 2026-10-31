import { Schema } from "effect";

/**
 * The subset of a raw wiktextract JSONL line the importer reads. Unknown keys
 * are ignored and almost everything is optional, because the raw English
 * Wiktionary dump is very uneven (see https://kaikki.org/dictionary/rawdata.html
 * and the wiktextract README for the full shape).
 */

const Tags = Schema.optionalKey(Schema.Array(Schema.String));

const WordLink = Schema.Struct({
  word: Schema.String,
});

export const WiktextractSense = Schema.Struct({
  glosses: Schema.optionalKey(Schema.Array(Schema.String)),
  tags: Tags,
  /** `form-of` senses point at their lemma here ("domu" -> "dom"). */
  form_of: Schema.optionalKey(Schema.Array(WordLink)),
  /** `alt-of` senses point at the main spelling here. */
  alt_of: Schema.optionalKey(Schema.Array(WordLink)),
});
export type WiktextractSense = typeof WiktextractSense.Type;

export const WiktextractForm = Schema.Struct({
  form: Schema.String,
  tags: Tags,
  source: Schema.optionalKey(Schema.String),
});
export type WiktextractForm = typeof WiktextractForm.Type;

export const WiktextractSound = Schema.Struct({
  ipa: Schema.optionalKey(Schema.String),
  ogg_url: Schema.optionalKey(Schema.String),
  mp3_url: Schema.optionalKey(Schema.String),
  tags: Tags,
  /** Regional variant label, e.g. "Central Greater Poland". */
  note: Schema.optionalKey(Schema.String),
});
export type WiktextractSound = typeof WiktextractSound.Type;

export const WiktextractEntry = Schema.Struct({
  word: Schema.String,
  pos: Schema.String,
  lang_code: Schema.String,
  etymology_number: Schema.optionalKey(
    Schema.Union([Schema.Number, Schema.String]),
  ),
  senses: Schema.optionalKey(Schema.Array(WiktextractSense)),
  forms: Schema.optionalKey(Schema.Array(WiktextractForm)),
  sounds: Schema.optionalKey(Schema.Array(WiktextractSound)),
});
export type WiktextractEntry = typeof WiktextractEntry.Type;

export const decodeWiktextractEntry =
  Schema.decodeUnknownExit(WiktextractEntry);

/**
 * Cheap pre-filter on the raw line before `JSON.parse`. The full dump is
 * ~25 GB of JSON for every language; parsing only lines that mention the
 * language code is what makes streaming it practical. A match is only a
 * candidate: nested translation lists also contain `lang_code`, so the
 * top-level field is checked again after parsing.
 */
export const lineMayBeLanguage = (line: string, langCode: string): boolean =>
  line.includes(`"lang_code": "${langCode}"`) ||
  line.includes(`"lang_code":"${langCode}"`);
