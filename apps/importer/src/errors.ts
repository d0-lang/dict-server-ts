import { Schema } from "effect";

export class ImportError extends Schema.TaggedError<ImportError>()(
  "ImportError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

/** Build a `catch` handler that prefixes the cause with what was being done. */
export const importFailure = (message: string) => (cause: unknown) =>
  new ImportError({
    message: `${message}: ${cause instanceof Error ? cause.message : String(cause)}`,
    cause,
  });
