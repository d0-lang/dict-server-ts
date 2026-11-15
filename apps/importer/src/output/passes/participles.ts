import { FormSource } from "@dict/core/schema";
import type { WriterContext } from "./context.ts";

/**
 * Declined participles (`participleDeclension`: `ausgelegte`, `wymaganego`)
 * become forms of their verbs only where no other entry has the form, so a
 * participle Wiktionary lists as an adjective keeps it (`bestehende` is
 * `bestehend`'s, not `bestehen`'s). A verb and its reflexive entry share
 * theirs. With `participlesSharedWithOwn`, only another word blocks a form:
 * an entry whose lemma is itself a form of the verb is the participle's own
 * (`adopté` "male adoptee", so `adoptés` is `adopter`'s too), and `plus` stays
 * `plus`, not `plu` + `s`. Runs after every other pass that adds forms.
 */
export const addParticipleForms = ({
  sqlite,
  counts,
  participleForms,
  participlesSharedWithOwn,
}: WriterContext) => {
  sqlite.run(
    "CREATE TEMP TABLE participle_pending (form TEXT NOT NULL, entry_id INTEGER NOT NULL)",
  );
  const pending = sqlite.prepare(
    "INSERT INTO participle_pending VALUES (?, ?)",
  );
  sqlite.transaction(() => {
    for (const { form, entryId } of participleForms) pending.run(form, entryId);
  })();
  counts.participleForms = sqlite.run(
    `INSERT OR IGNORE INTO forms (form, entry_id, source)
     SELECT DISTINCT p.form, p.entry_id, ${FormSource.Inflection} FROM participle_pending p
     WHERE NOT EXISTS (
       SELECT 1 FROM forms f WHERE f.form = p.form
         AND f.entry_id NOT IN (SELECT q.entry_id FROM participle_pending q WHERE q.form = p.form)
         ${
           participlesSharedWithOwn
             ? `AND NOT EXISTS (
                  SELECT 1 FROM entries own JOIN forms verb ON verb.form = lower(own.lemma)
                  WHERE own.id = f.entry_id AND verb.entry_id = p.entry_id
                )`
             : ""
         }
     )`,
  ).changes;
  sqlite.run("DROP TABLE participle_pending");
};
