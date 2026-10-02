import { Effect, FileSystem, Path, Schema } from "effect";

export class StoredIdentity extends Schema.Class<StoredIdentity>(
  "server/identity/StoredIdentity",
)({
  publicKeyBase64: Schema.String,
  privateKeyPkcs8Base64: Schema.String,
}) {}

const StoredIdentityJson = Schema.fromJsonString(StoredIdentity, { space: 2 });

export const readStoredIdentity = Effect.fnUntraced(function* (path: string) {
  const fs = yield* FileSystem.FileSystem;
  const text = yield* fs.readFileString(path).pipe(Effect.orDie);
  return yield* Schema.decodeUnknownEffect(StoredIdentityJson)(text).pipe(
    Effect.orDie,
  );
});

export const writeStoredIdentity = Effect.fnUntraced(function* (
  path: string,
  stored: StoredIdentity,
) {
  const fs = yield* FileSystem.FileSystem;
  const paths = yield* Path.Path;
  yield* fs
    .makeDirectory(paths.dirname(path), { recursive: true })
    .pipe(Effect.orDie);
  const text = yield* Schema.encodeEffect(StoredIdentityJson)(stored).pipe(
    Effect.orDie,
  );
  yield* fs.writeFileString(path, `${text}\n`).pipe(Effect.orDie);
});

export const storedIdentityExists = Effect.fnUntraced(function* (path: string) {
  const fs = yield* FileSystem.FileSystem;
  return yield* fs.exists(path).pipe(Effect.orDie);
});
