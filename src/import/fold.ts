/** Fold a form or lemma for case-insensitive lookup. Surface text stays unchanged. */
export const foldKey = (value: string, locale: string): string =>
  value.normalize("NFC").toLocaleLowerCase(locale);
