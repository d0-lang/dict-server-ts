import { Effect } from "effect";

/**
 * The metadata's `report_url` (the protocol, Reports): the page where users
 * report a wrong or missing answer, from `REPORT_URL`. A client adds `word`,
 * `lang` and `client` to it as query parameters, so the page should read them.
 * Undefined when unset; fails unless it is an absolute `https` URL.
 */
export const reportUrl = (value: string | undefined) => {
  if (value === undefined) return Effect.succeed(undefined);
  return URL.parse(value)?.protocol === "https:"
    ? Effect.succeed(value)
    : Effect.fail(
        new Error(
          `REPORT_URL=${value}: not an absolute https URL, which clients require`,
        ),
      );
};
