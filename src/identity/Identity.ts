import { Context, Effect, Encoding, Layer } from "effect"

const subtle = globalThis.crypto.subtle

const bytesForCrypto = (body: Uint8Array): Uint8Array<ArrayBuffer> => new Uint8Array(body)

export class Identity extends Context.Service<Identity, {
  readonly publicKeyBase64: string
  readonly sign: (body: Uint8Array) => Effect.Effect<string>
  readonly verify: (body: Uint8Array, signatureBase64: string) => Effect.Effect<boolean>
}>()("server/identity/Identity") {
  static readonly layer = Layer.effect(
    Identity,
    Effect.gen(function*() {
      const pair = yield* Effect.tryPromise({
        try: async () => {
          const generated = await subtle.generateKey("Ed25519", true, ["sign", "verify"])
          if (!("privateKey" in generated) || !("publicKey" in generated)) {
            throw new Error("Expected an Ed25519 CryptoKeyPair")
          }
          return generated
        },
        catch: (cause) => new Error(`Failed to generate Ed25519 key: ${String(cause)}`)
      }).pipe(Effect.orDie)

      const rawPublicKey = yield* Effect.tryPromise({
        try: () => subtle.exportKey("raw", pair.publicKey),
        catch: (cause) => new Error(`Failed to export Ed25519 public key: ${String(cause)}`)
      }).pipe(Effect.orDie)

      const publicKeyBase64 = Encoding.encodeBase64(new Uint8Array(rawPublicKey))

      return Identity.of({
        publicKeyBase64,
        sign: Effect.fnUntraced(function*(body: Uint8Array) {
          const signature = yield* Effect.tryPromise({
            try: () => subtle.sign("Ed25519", pair.privateKey, bytesForCrypto(body)),
            catch: (cause) => new Error(`Failed to sign body: ${String(cause)}`)
          }).pipe(Effect.orDie)
          return Encoding.encodeBase64(new Uint8Array(signature))
        }),
        verify: Effect.fnUntraced(function*(body: Uint8Array, signatureBase64: string) {
          const signature = Encoding.decodeBase64(signatureBase64)
          if (signature._tag === "Failure") {
            return false
          }
          return yield* Effect.tryPromise({
            try: () => subtle.verify("Ed25519", pair.publicKey, bytesForCrypto(signature.success), bytesForCrypto(body)),
            catch: (cause) => new Error(`Failed to verify signature: ${String(cause)}`)
          }).pipe(Effect.orDie)
        })
      })
    })
  )
}

export const importPublicKey = Effect.fnUntraced(function*(publicKeyBase64: string) {
  const bytes = Encoding.decodeBase64(publicKeyBase64)
  if (bytes._tag === "Failure") {
    return yield* Effect.die(new Error("Invalid public key base64"))
  }
  return yield* Effect.tryPromise({
    try: () => subtle.importKey("raw", bytesForCrypto(bytes.success), "Ed25519", false, ["verify"]),
    catch: (cause) => new Error(`Failed to import Ed25519 public key: ${String(cause)}`)
  }).pipe(Effect.orDie)
})

export const verifyWithPublicKey = Effect.fnUntraced(function*(
  publicKeyBase64: string,
  body: Uint8Array,
  signatureBase64: string
) {
  const publicKey = yield* importPublicKey(publicKeyBase64)
  const signature = Encoding.decodeBase64(signatureBase64)
  if (signature._tag === "Failure") {
    return false
  }
  return yield* Effect.tryPromise({
    try: () => subtle.verify("Ed25519", publicKey, bytesForCrypto(signature.success), bytesForCrypto(body)),
    catch: (cause) => new Error(`Failed to verify signature: ${String(cause)}`)
  }).pipe(Effect.orDie)
})
