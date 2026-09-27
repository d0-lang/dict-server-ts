import { assert, it, layer } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { HttpApiTest } from "effect/unstable/httpapi"
import { HttpServer } from "effect/unstable/http"
import { Api } from "./Api.ts"
import { DictHandlers } from "../http/DictHandlers.ts"
import { makeWebHandler } from "../http/app.ts"
import { LookupRequest } from "../domain/schemas.ts"
import { verifyWithPublicKey } from "../identity/Identity.ts"

const HandlersLayer = Layer.mergeAll(DictHandlers, HttpServer.layerServices)
const makeClient = HttpApiTest.groups(Api, ["dict"])

layer(HandlersLayer)("DictApi", (it) => {
  it.effect("returns the Ed25519 public key", () =>
    Effect.gen(function*() {
      const client = yield* makeClient
      const key = yield* client.dict.getKey()
      assert.isString(key.key)
      assert.isAbove(key.key.length, 0)
    }))

  it.effect("echoes X-Nonce in metadata", () =>
    Effect.gen(function*() {
      const client = yield* makeClient
      const meta = yield* client.dict.getMeta({
        headers: { "x-nonce": "startup-1" }
      })
      const body = "body" in meta ? meta.body : meta
      assert.strictEqual(body.nonce, "startup-1")
      assert.strictEqual(body.name, "dict poc")
      assert.deepStrictEqual(body.languages, ["de_en"])
    }))

  it.effect("looks up a word with a stub translation", () =>
    Effect.gen(function*() {
      const client = yield* makeClient
      const result = yield* client.dict.lookup({
        query: {
          payload: new LookupRequest({ word: "Mutter", lang: "de_en" })
        }
      })
      assert.strictEqual(result.word, "Mutter")
      assert.strictEqual(result.translation, "TBD")
    }))
})

it.live("signs the exact get-meta body bytes", () =>
  Effect.tryPromise({
    try: async () => {
      const { handler, dispose } = makeWebHandler()
      try {
        const nonce = "live-nonce"
        const metaResponse = await handler(
          new Request("http://localhost/v1/get-meta", {
            headers: { "X-Nonce": nonce }
          })
        )
        const body = await metaResponse.text()
        const signature = metaResponse.headers.get("x-signature")
        assert.strictEqual(metaResponse.status, 200)
        assert.isString(signature)

        const parsed = JSON.parse(body) as { nonce: string }
        assert.strictEqual(parsed.nonce, nonce)

        const keyResponse = await handler(new Request("http://localhost/v1/get-key"))
        const { key } = await keyResponse.json() as { key: string }

        const ok = await Effect.runPromise(
          verifyWithPublicKey(key, new TextEncoder().encode(body), signature!)
        )
        assert.isTrue(ok)

        const missingNonce = await handler(new Request("http://localhost/v1/get-meta"))
        assert.strictEqual(missingNonce.status, 400)

        const lookupPayload = encodeURIComponent(JSON.stringify({ word: "Mutter", lang: "de_en" }))
        const lookupResponse = await handler(new Request(`http://localhost/v1/lookup?payload=${lookupPayload}`))
        assert.strictEqual(lookupResponse.status, 200)
        assert.deepStrictEqual(await lookupResponse.json(), { word: "Mutter", translation: "TBD" })
      } finally {
        await dispose()
      }
    },
    catch: (cause) => cause instanceof Error ? cause : new Error(String(cause))
  }))
