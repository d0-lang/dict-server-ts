import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiError,
  HttpApiGroup,
  HttpApiSchema,
} from "effect/http-api";
import { Schema } from "effect";
import {
  LookupError,
  LookupResponse,
  Meta,
  PublicKey,
} from "../domain/schemas.ts";

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
    HttpApiEndpoint.get("lookup", "/lookup", {
      query: {
        // Optional so a missing one gets the protocol's error body from the handler.
        word: Schema.optionalKey(Schema.String),
        lang: Schema.optionalKey(Schema.String),
      },
      success: LookupResponse,
      error: LookupError,
    }),
  )
  .prefix("/v1") {}

export class Api extends HttpApi.make("dict-api").add(DictApi) {}
