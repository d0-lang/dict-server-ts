import { Schema } from "effect";

export class PublicKey extends Schema.Class<PublicKey>(
  "server/domain/PublicKey",
)({
  key: Schema.String,
}) {}

/** Links to the hosted documents, and the sha256 of each one's source text. */
export class Legal extends Schema.Class<Legal>("server/domain/Legal")({
  privacy_link: Schema.String,
  privacy_hash: Schema.String,
  privacy_change: Schema.optionalKey(Schema.String),
  tos_link: Schema.String,
  tos_hash: Schema.String,
  tos_change: Schema.optionalKey(Schema.String),
}) {}

/** Whose material the answers are built from, so the client can credit it. */
export const Source = Schema.Struct({
  name: Schema.String,
  url: Schema.String,
  license: Schema.optionalKey(Schema.String),
  license_url: Schema.optionalKey(Schema.String),
  languages: Schema.optionalKey(Schema.Array(Schema.String)),
});

export class Meta extends Schema.Class<Meta>("server/domain/Meta")({
  name: Schema.String,
  nonce: Schema.String,
  languages: Schema.Array(Schema.String),
  features: Schema.optionalKey(Schema.Array(Schema.String)),
  verification_urls: Schema.Array(Schema.String),
  sources: Schema.optionalKey(Schema.Array(Source)),
  /** Where users report a wrong or missing answer (the protocol, Reports). */
  report_url: Schema.optionalKey(Schema.String),
  legal: Schema.optionalKey(Legal),
}) {}

export const LookupEntry = Schema.Struct({
  lemma: Schema.String,
  pos: Schema.String,
  labels: Schema.optionalKey(Schema.Array(Schema.String)),
  pron: Schema.optionalKey(
    Schema.Struct({
      ipa: Schema.optionalKey(Schema.Array(Schema.String)),
      audio: Schema.optionalKey(
        Schema.Array(
          Schema.Struct({
            url: Schema.String,
            /** The page that credits the recording (its Commons file page). */
            source: Schema.optionalKey(Schema.String),
          }),
        ),
      ),
      reading: Schema.optionalKey(Schema.String),
    }),
  ),
  senses: Schema.Array(
    Schema.Struct({
      glosses: Schema.Array(Schema.String),
      see: Schema.optionalKey(Schema.Array(Schema.String)),
    }),
  ),
  /** Links to the pages the entry is built from (its Wiktionary page or pages). */
  sources: Schema.optionalKey(Schema.Array(Schema.String)),
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

/** What a label means: `name` at most 60 characters, `text` at most 1000. */
export const LabelExplanation = Schema.Struct({
  name: Schema.String,
  text: Schema.optionalKey(Schema.String),
});

/** `/v1/get-labels`: per pair served, label string -> its explanation. */
export class LabelsResponse extends Schema.Class<LabelsResponse>(
  "server/domain/LabelsResponse",
)({
  labels: Schema.Record(
    Schema.String,
    Schema.Record(Schema.String, LabelExplanation),
  ),
}) {}

export class LookupError extends Schema.Class<LookupError>(
  "server/domain/LookupError",
)(
  { error: Schema.Literals(["bad_request", "unsupported_lang"]) },
  { httpApiStatus: 400 },
) {}
