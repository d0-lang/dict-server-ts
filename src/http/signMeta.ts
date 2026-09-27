import { Effect, Schema } from "effect"
import { HttpServerResponse } from "effect/unstable/http"
import { Meta } from "../domain/schemas.ts"

const utf8 = new TextEncoder()

export const signedMetaResponse = Effect.fnUntraced(function*(
  sign: (body: Uint8Array) => Effect.Effect<string>,
  meta: Meta
) {
  const encoded = yield* Schema.encodeEffect(Meta)(meta)
  const body = JSON.stringify(encoded)
  const signature = yield* sign(utf8.encode(body))
  return HttpServerResponse.text(body, {
    contentType: "application/json",
    headers: {
      "x-signature": signature
    }
  })
})
