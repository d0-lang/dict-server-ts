import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import { Identity } from "./Identity.ts"

const utf8 = new TextEncoder()

describe("Identity", () => {
  it.effect("signs body bytes and verifies them", () =>
    Effect.gen(function*() {
      const identity = yield* Identity
      const body = utf8.encode(`{"nonce":"abc"}`)
      const signature = yield* identity.sign(body)

      assert.isTrue(yield* identity.verify(body, signature))
      assert.isFalse(yield* identity.verify(utf8.encode(`{"nonce":"abd"}`), signature))
      assert.isString(identity.publicKeyBase64)
      assert.isAbove(identity.publicKeyBase64.length, 0)
    }).pipe(Effect.provide(Identity.layer)))
})
