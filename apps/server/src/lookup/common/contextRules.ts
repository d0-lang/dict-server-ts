import type { Language } from "@dict/core/language";

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
  };
  rulesByLanguage.set(language, rules);
  return rules;
};

/** No conjunction ends a clause. */
export const NO_CONJUNCTIONS: ReadonlySet<string> = new Set();
