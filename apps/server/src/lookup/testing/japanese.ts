import { dictionary } from "./dictionary.ts";

/**
 * Japanese: forms as Wiktionary's conjugation tables list them, and the
 * grammar file's endings. Lookups with context go through the real analyzer
 * (UniDic), so its words decide what is looked up.
 */
export const japanese = dictionary([
  ["食べる", "VERB", ["食べ", "食べた", "食べました", "食べます"], ["to eat"]],
  ["食べ", "VERB", [], ["stem form of 食べる"]],
  ["食", "NOUN", [], ["food"]],
  ["勉強", "NOUN", [], ["study"]],
  ["勉強", "VERB", ["勉強する", "勉強し", "勉強して"], ["to study"]],
  ["する", "VERB", ["し", "して", "す", "さ", "され"], ["to do"]],
  ["いる", "VERB", ["い", "います"], ["to be (animate)"]],
  ["要る", "VERB", ["いる", "いら"], ["to need"]],
  ["ある", "VERB", ["あり", "あります"], ["to exist"]],
  ["ある", "X", ["あります"], ["certain"]],
  ["か", "PART", [], ["question"]],
  ["日本語", "NOUN", [], ["Japanese"]],
  ["は", "PART", [], ["topic"]],
  ["に", "PART", [], ["to, at"]],
  ["手", "NOUN", [], ["hand"]],
  ["入る", "VERB", [], ["to enter"]],
  ["手に入る", "VERB", [], ["to obtain"]],
  ["かも知れない", "PART", [], ["might"]],
  ["知れる", "VERB", ["しれ"], ["to become known"]],
  ["似合う", "VERB", ["にあわせて"], ["to suit"]],
  ["合わせる", "VERB", ["あわせて", "あわせ"], ["to match"]],
  ["約", "ADV", [], ["about"]],
  ["三", "NUM", ["3"], ["three"]],
  ["た", "X", [], ["The hiragana syllable た"], "syllable"],
  // the grammar file's endings
  ["ます", "AUX", [], ["polite"], "grammar"],
  ["た", "AUX", [], ["past"], "grammar"],
  ["て", "PART", [], ["and (te form)"], "grammar"],
  ["いる", "AUX", [], ["-ing"], "grammar"],
  ["ない", "AUX", [], ["not"], "grammar"],
]);
