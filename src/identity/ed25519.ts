import { Effect, Encoding } from "effect";

const subtle = globalThis.crypto.subtle;

const copyForSubtle = (bytes: Uint8Array): Uint8Array<ArrayBuffer> =>
  new Uint8Array(bytes);

export const generateKeyPair = Effect.fnUntraced(function* () {
  const generated = yield* Effect.tryPromise({
    try: () => subtle.generateKey("Ed25519", true, ["sign", "verify"]),
    catch: (cause) =>
      new Error(`Failed to generate Ed25519 key: ${String(cause)}`),
  }).pipe(Effect.orDie);

  if (!("privateKey" in generated) || !("publicKey" in generated)) {
    return yield* Effect.die(new Error("Expected an Ed25519 CryptoKeyPair"));
  }
  return generated;
});

export const exportPublicKeyBase64 = Effect.fnUntraced(function* (
  publicKey: CryptoKey,
) {
  const raw = yield* Effect.tryPromise({
    try: () => subtle.exportKey("raw", publicKey),
    catch: (cause) =>
      new Error(`Failed to export Ed25519 public key: ${String(cause)}`),
  }).pipe(Effect.orDie);
  return Encoding.encodeBase64(new Uint8Array(raw));
});

export const exportPrivateKeyPkcs8Base64 = Effect.fnUntraced(function* (
  privateKey: CryptoKey,
) {
  const pkcs8 = yield* Effect.tryPromise({
    try: () => subtle.exportKey("pkcs8", privateKey),
    catch: (cause) =>
      new Error(`Failed to export Ed25519 private key: ${String(cause)}`),
  }).pipe(Effect.orDie);
  return Encoding.encodeBase64(new Uint8Array(pkcs8));
});

export const importPrivateKey = Effect.fnUntraced(function* (
  pkcs8Base64: string,
) {
  const bytes = Encoding.decodeBase64(pkcs8Base64);
  if (bytes._tag === "Failure") {
    return yield* Effect.die(new Error("Invalid private key base64"));
  }
  return yield* Effect.tryPromise({
    try: () =>
      subtle.importKey("pkcs8", copyForSubtle(bytes.success), "Ed25519", true, [
        "sign",
      ]),
    catch: (cause) =>
      new Error(`Failed to import Ed25519 private key: ${String(cause)}`),
  }).pipe(Effect.orDie);
});

export const signWithPrivateKey = Effect.fnUntraced(function* (
  privateKey: CryptoKey,
  body: Uint8Array,
) {
  const signature = yield* Effect.tryPromise({
    try: () => subtle.sign("Ed25519", privateKey, copyForSubtle(body)),
    catch: (cause) => new Error(`Failed to sign body: ${String(cause)}`),
  }).pipe(Effect.orDie);
  return Encoding.encodeBase64(new Uint8Array(signature));
});
