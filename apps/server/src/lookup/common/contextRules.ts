import type { Language } from "@dict/core/language";
import { lookupKey } from "@dict/core/lookupKey";

/** A language's `[context]` settings, as the matcher reads them. */
type ContextRules = {
  readonly reflexives: ReadonlySet<string> | undefined;
  readonly maxGap: number;
  readonly negation: string | undefined;
  readonly bracket: boolean;
  readonly hyphenWords: boolean;
  readonly conjunctions: ReadonlySet<string>;
  readonly abbreviationLeads: ReadonlySet<string>;
  readonly reflexiveParticles: ReadonlySet<string>;
  /**
   * The word a context word stands for as a phrase's last word, merged with
   * the word after it (`context.contractions`): `de` for `du`, `que` for
   * `qu'il`. Undefined for other words.
   */
  readonly contracted: (key: string) => string | undefined;
  /** Elided words are written onto the next word (`elision`: `l'encontre`). */
  readonly elision: boolean;
};

/** `context.contractions` by lookup key: whole forms (`du`), and elided ones (`qu'`) longest first. */
const contractedForms = (
  contractions: Readonly<Record<string, string>>,
): ((key: string) => string | undefined) => {
  const whole = new Map<string, string>();
  const elided: Array<readonly [string, string]> = [];
  for (const [form, word] of Object.entries(contractions)) {
    const key = lookupKey(form);
    if (key.endsWith("'")) elided.push([key, lookupKey(word)]);
    else whole.set(key, lookupKey(word));
  }
  elided.sort(([a], [b]) => b.length - a.length);
  return (key) =>
    whole.get(key) ??
    elided.find(
      ([form]) => key.startsWith(form) && key.length > form.length,
    )?.[1];
};

const rulesByLanguage = new WeakMap<Language, ContextRules>();

export const contextRules = (language: Language): ContextRules => {
  const cached = rulesByLanguage.get(language);
  if (cached !== undefined) return cached;
  const { context } = language;
  const rules: ContextRules = {
    reflexives:
      context.reflexives.length > 0 ? new Set(context.reflexives) : undefined,
    maxGap: context.maxGap,
    negation: context.negation,
    bracket: context.verbBracket,
    hyphenWords: context.hyphenWords,
    conjunctions: new Set(context.clauseConjunctions),
    abbreviationLeads: new Set(context.abbreviationLeads),
    reflexiveParticles: new Set(context.reflexiveParticles),
    contracted: contractedForms(context.contractions),
    elision: language.elision,
  };
  rulesByLanguage.set(language, rules);
  return rules;
};

/** No conjunction ends a clause. */
export const NO_CONJUNCTIONS: ReadonlySet<string> = new Set();
