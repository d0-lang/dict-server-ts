import { dictionary } from "./dictionary.ts";

export const spanish = dictionary([
  ["el", "DET", [], ["the"]],
  ["de", "ADP", [], ["of"]],
  ["a", "ADP", [], ["to"]],
  ["del", "ADP", [], ["of the"], "grammar"],
  ["al", "ADP", [], ["to the"], "grammar"],
  ["siglo", "NOUN", [], ["century"]],
  ["gobierno", "NOUN", [], ["government"]],
  // Phrases ending in a preposition that merges with the article.
  ["partir", "VERB", [], ["to leave"]],
  ["a partir de", "ADP", [], ["from, starting from"]],
  ["torno", "NOUN", [], ["lathe"]],
  ["en torno a", "ADP", [], ["around"]],
  ["en", "ADP", [], ["in"]],
  // Nouns whose lemma is a form of a common verb, which the neighbouring
  // word tells apart.
  ["trata", "NOUN", [], ["trafficking"]],
  ["tratar", "VERB", ["trata"], ["to treat"]],
  ["se", "PRON", [], ["oneself"]],
  ["como", "ADV", [], ["like, as"]],
  ["comer", "VERB", ["como"], ["to eat"]],
  ["no", "ADV", [], ["not"]],
  ["yo", "PRON", [], ["I"]],
  ["uno", "NUM", [], ["one"]],
  ["unir", "VERB", ["uno"], ["to unite"]],
  ["ellos", "PRON", [], ["they, them"]],
  ["entre", "ADP", [], ["between, among"]],
  ["poder", "VERB", [], ["can, to be able to"]],
  ["poder", "NOUN", [], ["power"]],
  ["su", "DET", [], ["his, her, its, their"], "grammar"],
  // Past participles after haber, ser and estar.
  ["he", "AUX", [], ["have"], "grammar"],
  ["estado", "NOUN", [], ["state"]],
  ["estar", "VERB", ["estado"], ["to be"]],
]);
