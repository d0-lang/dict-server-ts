import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiError,
  HttpApiGroup,
  HttpApiMiddleware,
  HttpApiSchema,
} from "effect/http-api";
import { Schema } from "effect";
import {
  LabelsResponse,
  LookupError,
  LookupResponse,
  Meta,
  PublicKey,
} from "../domain/schemas.ts";

/** Answers a lookup body that is not a JSON object with the protocol's `bad_request`. */
export class LookupBodyErrors extends HttpApiMiddleware.Service<LookupBodyErrors>()(
  "server/api/LookupBodyErrors",
  { error: LookupError },
) {}

export class DictApi extends HttpApiGroup.make("dict")
  .add(
    HttpApiEndpoint.get("getKey", "/get-key", {
      success: PublicKey,
    }),
    HttpApiEndpoint.get("getMeta", "/get-meta", {
      headers: {
        "x-nonce": Schema.String,
      },
      success: HttpApiSchema.WithHeaders(Meta, {
        "x-signature": Schema.String,
      }),
      error: HttpApiError.BadRequest,
    }),
    // A POST: words and sentences travel in the body, which no access log or cache keeps.
    HttpApiEndpoint.post("lookup", "/lookup", {
      payload: Schema.Struct({
        // Loose so a missing or mistyped one gets the protocol's error body from the handler.
        word: Schema.optionalKey(Schema.Unknown),
        lang: Schema.optionalKey(Schema.Unknown),
        // The sentence around `word`. Never logged.
        context: Schema.optionalKey(Schema.Unknown),
        // Which copy of `word` in `context` was clicked, from 1.
        at: Schema.optionalKey(Schema.Unknown),
      }),
      success: LookupResponse,
      error: LookupError,
    }).middleware(LookupBodyErrors),
    HttpApiEndpoint.get("getLabels", "/get-labels", {
      query: {
        // One or more pairs, joined by commas. Optional so a missing one gets the protocol's error body.
        lang: Schema.optionalKey(Schema.String),
      },
      success: LabelsResponse,
      error: LookupError,
    }),
  )
  .prefix("/v1") {}

export class Api extends HttpApi.make("dict-api").add(DictApi) {}
