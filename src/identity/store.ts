import { Effect, Schema } from "effect";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export class StoredIdentity extends Schema.Class<StoredIdentity>(
  "server/identity/StoredIdentity",
)({
  publicKeyBase64: Schema.String,
  privateKeyPkcs8Base64: Schema.String,
}) {}

export const readStoredIdentity = Effect.fnUntraced(function* (path: string) {
  const json = yield* Effect.tryPromise({
    try: () => Bun.file(path).json(),
    catch: (cause) =>
      new Error(`Failed to read identity file ${path}: ${String(cause)}`),
  }).pipe(Effect.orDie);
  return yield* Schema.decodeUnknownEffect(StoredIdentity)(json).pipe(
    Effect.orDie,
  );
});

export const writeStoredIdentity = Effect.fnUntraced(function* (
  path: string,
  stored: StoredIdentity,
) {
  yield* Effect.tryPromise({
    try: () => mkdir(dirname(path), { recursive: true }),
    catch: (cause) =>
      new Error(`Failed to create identity directory: ${String(cause)}`),
  }).pipe(Effect.orDie);
  yield* Effect.tryPromise({
    try: () => Bun.write(path, `${JSON.stringify(stored, null, 2)}\n`),
    catch: (cause) =>
      new Error(`Failed to write identity file ${path}: ${String(cause)}`),
  }).pipe(Effect.orDie);
});

export const storedIdentityExists = Effect.fnUntraced(function* (path: string) {
  return yield* Effect.tryPromise({
    try: () => Bun.file(path).exists(),
    catch: (cause) =>
      new Error(`Failed to stat identity file ${path}: ${String(cause)}`),
  }).pipe(Effect.orDie);
});
