import { Schema } from "effect"

export class PublicKey extends Schema.Class<PublicKey>("server/domain/PublicKey")({
  key: Schema.String
}) {}

export class Legal extends Schema.Class<Legal>("server/domain/Legal")({
  privacy_hash: Schema.String,
  tos_hash: Schema.String,
  privacy_short: Schema.String,
  tos_short: Schema.String,
  privacy_link: Schema.String,
  tos_link: Schema.String,
  privacy_change: Schema.optionalKey(Schema.String),
  tos_change: Schema.optionalKey(Schema.String)
}) {}

export class Meta extends Schema.Class<Meta>("server/domain/Meta")({
  name: Schema.String,
  nonce: Schema.String,
  languages: Schema.Array(Schema.String),
  legal: Schema.optionalKey(Legal),
  verification_urls: Schema.Array(Schema.String)
}) {}

export class LookupRequest extends Schema.Class<LookupRequest>("server/domain/LookupRequest")({
  word: Schema.String,
  lang: Schema.String,
  context: Schema.optionalKey(Schema.String)
}) {}

export class LookupResponse extends Schema.Class<LookupResponse>("server/domain/LookupResponse")({
  word: Schema.String,
  translation: Schema.String
}) {}
