import { Schema } from "effect";

export class PublicKey extends Schema.Class<PublicKey>(
  "server/domain/PublicKey",
)({
  key: Schema.String,
}) {}

export class Legal extends Schema.Class<Legal>("server/domain/Legal")({
  privacy_hash: Schema.String,
  tos_hash: Schema.String,
  privacy_short: Schema.String,
  tos_short: Schema.String,
  privacy_link: Schema.String,
  tos_link: Schema.String,
  privacy_change: Schema.optionalKey(Schema.String),
  tos_change: Schema.optionalKey(Schema.String),
}) {}

export class Meta extends Schema.Class<Meta>("server/domain/Meta")({
  name: Schema.String,
  nonce: Schema.String,
  languages: Schema.Array(Schema.String),
  legal: Schema.optionalKey(Legal),
  features: Schema.optionalKey(Schema.Array(Schema.String)),
  verification_urls: Schema.Array(Schema.String),
}) {}

export const LookupEntry = Schema.Struct({
  lemma: Schema.String,
  pos: Schema.String,
  labels: Schema.optionalKey(Schema.Array(Schema.String)),
  pron: Schema.optionalKey(
    Schema.Struct({
      ipa: Schema.optionalKey(Schema.Array(Schema.String)),
      audio: Schema.optionalKey(Schema.Array(Schema.String)),
      reading: Schema.optionalKey(Schema.String),
    }),
  ),
  senses: Schema.Array(
    Schema.Struct({
      translations: Schema.Array(Schema.String),
      see: Schema.optionalKey(Schema.Array(Schema.String)),
    }),
  ),
  /** The parts of `context` an entry the context adds covers (`context-match`). */
  match: Schema.optionalKey(Schema.Array(Schema.String)),
});
export type LookupEntry = typeof LookupEntry.Type;

/** A piece of the word as sent; `entries` index the response's `entries`. */
export const LookupSegment = Schema.Struct({
  text: Schema.String,
  entries: Schema.optionalKey(Schema.Array(Schema.Number)),
});

/** What a lookup finds: the fields of `LookupResponse`. */
export type LookupBody = {
  readonly entries: ReadonlyArray<LookupEntry>;
  readonly segments?: ReadonlyArray<typeof LookupSegment.Type>;
};

export class LookupResponse extends Schema.Class<LookupResponse>(
  "server/domain/LookupResponse",
)({
  entries: Schema.Array(LookupEntry),
  segments: Schema.optionalKey(Schema.Array(LookupSegment)),
}) {}

export class LookupError extends Schema.Class<LookupError>(
  "server/domain/LookupError",
)(
  { error: Schema.Literals(["bad_request", "unsupported_lang"]) },
  { httpApiStatus: 400 },
) {}
