import { dictionary } from "./dictionary.ts";

export const polish = dictionary([
  ["mieć", "VERB", ["miało", "ma"]],
  ["miejsce", "NOUN"],
  ["mieć miejsce", "VERB"],
  ["nic", "PRON", ["niczego"]],
  ["to", "PRON"],
  ["to nic", "INTJ"],
  ["po prostu", "PART"],
  ["prosty", "ADJ", ["prostu"]],
  ["być", "VERB", ["jest"]],
  ["w", "ADP"],
  ["dupa", "NOUN", ["dupie"]],
  ["być w dupie", "VERB"],
  [
    "w tym",
    "ADP",
    [],
    ["Used other than figuratively or idiomatically: see w, ten.", "including"],
  ],
  ["ten", "DET", ["tym"]],
  ["móc", "VERB", ["może"]],
  ["może być", "INTJ"],
  ["gorzki", "ADJ"],
  ["bawić", "VERB", ["bawię", "bawiliśmy"], ["to amuse"]],
  // a reflexive verb, found by the verb's forms (as the importer makes it)
  ["bawić się", "VERB", ["bawić", "bawię", "bawiliśmy"], ["to play"]],
  ["się", "PRON", [], ["oneself"]],
  ["dobrze", "ADV"],
  ["bardzo", "ADV"],
  ["dziś", "ADV"],
  ["dziecko", "NOUN", ["dzieci"]],
]);
