import { Effect, Layer } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api/Api.ts"
import { AppConfig } from "../config.ts"
import { Legal, LookupResponse, Meta, PublicKey } from "../domain/schemas.ts"
import { Identity } from "../identity/Identity.ts"
import { signedMetaResponse } from "./signMeta.ts"

const sha256Hex = Effect.fnUntraced(function*(text: string) {
  const digest = yield* Effect.tryPromise({
    try: () => crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
    catch: (cause) => new Error(`Failed to hash text: ${String(cause)}`)
  })
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
})

export const DictHandlersNoDeps = HttpApiBuilder.group(
  Api,
  "dict",
  Effect.fnUntraced(function*(handlers) {
    const identity = yield* Identity
    const config = yield* AppConfig

    const privacy_hash = yield* sha256Hex(config.privacyShort)
    const tos_hash = yield* sha256Hex(config.tosShort)
    const legal = config.includeLegal
      ? new Legal({
        privacy_hash,
        tos_hash,
        privacy_short: config.privacyShort,
        tos_short: config.tosShort,
        privacy_link: config.privacyLink,
        tos_link: config.tosLink,
        ...(config.privacyChange !== undefined ? { privacy_change: config.privacyChange } : {}),
        ...(config.tosChange !== undefined ? { tos_change: config.tosChange } : {})
      })
      : undefined

    return handlers.handleAll({
      getKey: () => Effect.succeed(new PublicKey({ key: identity.publicKeyBase64 })),
      getMeta: ({ headers }) =>
        signedMetaResponse(
          identity.sign,
          new Meta({
            name: config.name,
            nonce: headers["x-nonce"],
            languages: [...config.languages],
            verification_urls: [...config.verificationUrls],
            ...(legal !== undefined ? { legal } : {})
          })
        ).pipe(Effect.orDie),
      lookup: ({ query }) =>
        Effect.succeed(
          new LookupResponse({
            word: query.payload.word,
            translation: "TBD"
          })
        )
    })
  })
)

export const DictHandlersMemory = DictHandlersNoDeps.pipe(
  Layer.provide([Identity.layerMemory, AppConfig.layer])
)

export const DictHandlers = DictHandlersNoDeps.pipe(
  Layer.provide([Identity.layer, AppConfig.layer])
)
