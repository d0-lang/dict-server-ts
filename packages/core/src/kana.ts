/**
 * What the code knows about Japanese writing, in one place: kana, the two
 * scripts that spell a word by its sound, and kanji. Japanese alone needs
 * this, and no other language's code should: a rule that asks about kana is a
 * rule for Japanese.
 */

const KANA = /^[\p{Script=Hiragana}\p{Script=Katakana}ー]+$/u;
const KANJI = /\p{Script=Han}/u;

/** The word is written in kana alone (`ところ`, `ワクワク`, `コーヒー`). */
export const isKana = (text: string): boolean => KANA.test(text);

/** The word has a kanji in it (`所`, `食べる`). */
export const hasKanji = (text: string): boolean => KANJI.test(text);

/**
 * Katakana as hiragana (`サン` as `さん`, `ワクワク` as `わくわく`), so a
 * word or a reading compares alike in either script.
 */
export const hiragana = (text: string): string =>
  text.replace(/[ァ-ヶ]/gu, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
