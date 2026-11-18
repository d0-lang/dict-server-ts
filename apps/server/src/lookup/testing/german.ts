import { dictionary } from "./dictionary.ts";

export const german = dictionary([
  ["finden", "VERB", ["fand", "findet"]],
  ["stattfinden", "VERB", ["stattfand", "stattfindet", "fand statt"]],
  ["statt", "ADP"],
  ["gehen", "VERB", ["geht"]],
  ["mitgehen", "VERB", ["mitgeht"]],
  ["mit", "ADP"],
  ["vor", "ADP"],
  ["allem", "PRON"],
  ["vor allem", "ADV"],
  ["treten", "VERB", ["tritt", "trat", "getreten"]],
  ["Kraft", "NOUN"],
  ["in", "ADP"],
  ["in Kraft treten", "VERB", ["trat in Kraft"]],
  ["sein", "VERB", ["ist"]],
  ["an", "ADP"],
  ["an sein", "VERB", ["ist an"]],
  ["haben", "VERB", ["hat", "habe"]],
  ["Schwein", "NOUN"],
  ["Schwein haben", "VERB"],
  ["machen", "VERB", ["mache", "macht"]],
  ["Sorge", "NOUN", ["Sorgen"]],
  ["sich", "PRON"],
  ["mir", "PRON"],
  ["sich Sorgen machen", "VERB"],
  ["Gemüse", "NOUN"],
  ["Fonds", "NOUN"],
  ["Dort", "NOUN"],
  ["Mund", "NOUN"],
  ["Dortmund", "PROPN"],
  ["sondern", "VERB", ["sonder"]],
  ["sonder-", "X"],
  ["Ausstellung", "NOUN", ["ausstellungen"]],
  ["heißen", "VERB", ["heißt"]],
  ["wie", "ADV"],
  ["Sie", "PRON"],
  ["eigentlich", "ADV"],
  ["wie heißen Sie", "X", [], ["what is your name?"], "phrase"],
  ["z. B.", "ADV", ["z.B."], ["for example"]],
  ["Obst", "NOUN"],
  ["wirken", "VERB", ["wirkt"]],
  ["mitwirken", "VERB", ["mitwirkt"]],
  ["kommen", "VERB", ["kommt"]],
  ["mitkommen", "VERB", ["mitkommt"]],
  ["und", "CCONJ"],
  ["lenken", "VERB", ["lenkt"]],
  ["einlenken", "VERB", ["einlenkt"]],
  ["eindeutschen", "VERB", ["eindeutsche"]],
  ["spielen", "VERB", ["spiele", "spielt"]],
  ["anspielen", "VERB", ["anspiele", "anspielt"]],
  ["Spiel", "NOUN", ["Spiele"]],
  ["handhaben", "VERB", ["handhabe"]],
  ["Hand", "NOUN"],
  ["tagen", "VERB", ["tagen", "tagt"]],
  ["Tag", "NOUN", ["Tage", "Tagen"]],
  // With their gender, so the headword has its article (`der Hund`).
  ["Hund", "NOUN", ["Hunde", "Hundes"], ["dog"], "noun", "Gender=Masc"],
  ["Mutter", "NOUN", ["Mütter"], ["mother"], "noun", "Gender=Fem"],
  ["Mutter", "NOUN", ["Muttern"], ["nut (for a bolt)"], "noun", "Gender=Fem"],
]);

// `Mutter` "mother" with its page and a recording, as the import stores
// them: the lookup links the page and the recording's file page.
{
  const { id } = german.$client
    .query<{ id: number }, []>(
      "SELECT min(id) AS id FROM entries WHERE lemma = 'Mutter'",
    )
    .get()!;
  german.$client.run("UPDATE entries SET pages = ? WHERE id = ?", [
    JSON.stringify(["Mutter"]),
    id,
  ]);
  german.$client.run(
    "INSERT INTO pronunciations VALUES (?, 0, 'ipa', '/ˈmʊtɐ/'), (?, 1, 'audio', ?)",
    [
      id,
      id,
      "https://upload.wikimedia.org/wikipedia/commons/0/03/De-Mutter.ogg",
    ],
  );
}
