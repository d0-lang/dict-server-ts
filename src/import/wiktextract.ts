import { Schema } from "effect";

const NullableString = Schema.NullOr(Schema.String);
const NullableStringArray = Schema.NullOr(Schema.Array(Schema.String));

const LinkedWord = Schema.Struct({
  word: Schema.optionalKey(NullableString),
  extra: Schema.optionalKey(NullableString),
});

const Sense = Schema.Struct({
  glosses: Schema.optionalKey(NullableStringArray),
  raw_glosses: Schema.optionalKey(NullableStringArray),
  tags: Schema.optionalKey(NullableStringArray),
  categories: Schema.optionalKey(NullableStringArray),
  form_of: Schema.optionalKey(Schema.NullOr(Schema.Array(LinkedWord))),
  alt_of: Schema.optionalKey(Schema.NullOr(Schema.Array(LinkedWord))),
});

const Form = Schema.Struct({
  form: Schema.optionalKey(NullableString),
  tags: Schema.optionalKey(NullableStringArray),
});

const Sound = Schema.Struct({
  ipa: Schema.optionalKey(NullableString),
  ogg_url: Schema.optionalKey(NullableString),
  mp3_url: Schema.optionalKey(NullableString),
  audio: Schema.optionalKey(NullableString),
  tags: Schema.optionalKey(NullableStringArray),
});

const EtymologyNumber = Schema.NullOr(
  Schema.Union([Schema.String, Schema.Number]),
);

/**
 * Fields the importer reads. Extra wiktextract keys are ignored.
 * Kept narrow on purpose: the raw dump is tens of gigabytes.
 */
export const WiktextractEntry = Schema.Struct({
  word: Schema.optionalKey(NullableString),
  pos: Schema.optionalKey(NullableString),
  lang: Schema.optionalKey(NullableString),
  lang_code: Schema.optionalKey(NullableString),
  etymology_number: Schema.optionalKey(EtymologyNumber),
  categories: Schema.optionalKey(NullableStringArray),
  forms: Schema.optionalKey(Schema.NullOr(Schema.Array(Form))),
  senses: Schema.optionalKey(Schema.NullOr(Schema.Array(Sense))),
  sounds: Schema.optionalKey(Schema.NullOr(Schema.Array(Sound))),
});

export type WiktextractEntry = typeof WiktextractEntry.Type;
export type WiktextractSense = typeof Sense.Type;

export const decodeWiktextractEntry =
  Schema.decodeUnknownSync(WiktextractEntry);
