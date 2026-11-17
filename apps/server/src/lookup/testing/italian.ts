import { dictionary } from "./dictionary.ts";

export const italian = dictionary([
  // Elided words and the words they are written onto.
  ["dell'", "X", [], ["of the"], "contraction"],
  ["acqua", "NOUN", [], ["water"]],
  ["anno", "NOUN", [], ["year"]],
  // Surnames spelled like an elided word and its host.
  ["Dell'Acqua", "PROPN", [], ["a surname"]],
  ["Dell'Anno", "PROPN", [], ["a surname"]],
  ["quest'", "DET", [], ["this"]],
  ["quest'anno", "ADV", [], ["this year"]],
  // Phrases ending in a preposition that merges with the article.
  ["di", "ADP", [], ["of"]],
  ["a", "ADP", [], ["to"]],
  ["della", "X", [], ["of the"], "contraction"],
  ["al", "X", [], ["to the"], "contraction"],
  ["causa", "NOUN", [], ["cause"]],
  ["a causa di", "ADP", [], ["because of"]],
  ["grazie", "INTJ", [], ["thanks"]],
  ["grazie a", "ADP", [], ["thanks to"]],
  ["all'", "X", [], ["to the"], "contraction"],
  ["aiuto", "NOUN", [], ["help"]],
  ["pioggia", "NOUN", [], ["rain"]],
]);
