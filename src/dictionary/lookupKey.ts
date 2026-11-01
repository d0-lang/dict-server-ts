/** Canonical text of a word: NFC, trimmed, original case kept. */
export const cleanWord = (word: string): string => word.normalize("NFC").trim();

/**
 * The spelling a word is indexed and searched by: `cleanWord`, lowercased.
 * Diacritics are kept on purpose (Polish "łza" and "lza" are different words).
 *
 * Stored `forms` rows are built with this function, so changing it requires
 * bumping `SCHEMA_VERSION` and rebuilding every dictionary file; otherwise
 * lookups silently stop matching old rows.
 */
export const lookupKey = (word: string): string =>
  cleanWord(word).toLowerCase();
