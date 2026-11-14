import { lookupKey } from "@dict/core/lookupKey";
import type { Morpheme } from "../../common/analyzer.ts";
import { loadEntries } from "../../common/entries.ts";
import { numberSense } from "../../common/glossNumbers.ts";
import { type Answer, type Click, PLAIN } from "./click.ts";
import { morphemeParts, type Part, splitResult } from "./parts.ts";
import { endOf, hasPos, type Settings, startOf, type Word } from "./words.ts";

/**
 * `text` with each run of digits written in `numerals` (`10月` -> `十月`,
 * `1998` -> `千九百九十八`, `20000` -> `二万`), or undefined when it has no
 * digits or a number too big for them.
 */
export const inNumerals = (
  text: string,
  numerals: NonNullable<Settings["numerals"]>,
): string | undefined => {
  const { digits, units, myriads } = numerals;
  const digit = [...digits];
  let found = false;
  let tooBig = false;
  const written = text.replace(/[0-9０-９]+/gu, (run) => {
    found = true;
    const values = [...run]
      .map((c) => c.charCodeAt(0) - (c >= "０" ? 0xff10 : 0x30))
      .reverse();
    // Groups of four digits, each but the lowest followed by its myriad.
    const groups: Array<string> = [];
    for (let k = 0; k * 4 < values.length; k++) {
      let group = "";
      for (let p = 3; p >= 0; p--) {
        const d = values[k * 4 + p] ?? 0;
        if (d === 0) continue;
        group +=
          p === 0 ? digit[d]! : (d === 1 ? "" : digit[d]!) + units[p - 1]!;
      }
      if (group === "") continue;
      if (k > myriads.length) tooBig = true;
      groups.unshift(k === 0 ? group : group + myriads[k - 1]!);
    }
    return groups.length === 0 ? digit[0]! : groups.join("");
  });
  return found && !tooBig ? written : undefined;
};

/**
 * A number and the word after it, read as its counter (`10|月`, `5|冊`,
 * `三百|円`). The number's digits are one piece (`10`, not `1` and `0`)
 * with one entry or none: the number's own (`十`), read as the analyzer
 * reads it (`五` as ご, not いつ), never a name or a character (`一` "a
 * surname"). The counter's entries come read as the analyzer reads them
 * (`人` as にん, `月` as がつ), then counter entries (the language's
 * `counters`), then suffixes and
 * affixes (`目` "-th" in `3つ目`, not "eye"), and no names or symbols
 * (`つ` "a giving hand").
 *
 * The whole has entries when the dictionary lists it (`十月`, `三人`), and
 * those hold the irregular readings (`一匹` いっぴき, `三日` みっか); never
 * by its head alone (`年` for `1998年`). Without them nothing is the whole
 * word, so nothing carries `match`: the clicked piece answers by itself.
 *
 * Written with digits, the word is the number and its counter, so of the
 * whole's entries only those of that word are it (`aboutNumber`): `10分` is
 * "ten minutes", though `十分` is mostly "enough".
 */
export const numberLookup = (c: Click): Answer => {
  const { found: w, piece, settings } = c;
  const isNumber = (m: Morpheme) => hasPos(m.pos, settings.numbers);
  if (c.wider || !w.some(isNumber)) return undefined;
  // Digits make one number (`1|9|9|8`), and so do numerals (`二十|八`);
  // where they meet, each is read by itself (`2|万`, `1|億|2000|万`).
  const digits = (m: Morpheme) => /^[0-9０-９]+$/u.test(m.surface);
  const pieces: Array<Array<Morpheme>> = [];
  for (const m of w) {
    const before = pieces.at(-1)?.at(-1);
    if (
      before !== undefined &&
      isNumber(m) &&
      isNumber(before) &&
      digits(m) === digits(before)
    ) {
      pieces.at(-1)!.push(m);
    } else {
      pieces.push([m]);
    }
  }
  // As written, and with its digits as numerals (`10` as `十`).
  const spellings = (written: string): ReadonlyArray<string> => {
    const numerals =
      settings.numerals === undefined
        ? undefined
        : inNumerals(written, settings.numerals);
    return numerals === undefined ? [written] : [written, numerals];
  };
  const numberIds = (p: Word): ReadonlyArray<number> => {
    const forms = [
      ...spellings(c.textOf(p)),
      ...(p.length === 1 ? p[0]!.bases : []),
    ];
    const keys = new Set(forms.map(lookupKey));
    const ids = forms
      .flatMap((form) => c.rows(form))
      .filter(
        (row) =>
          keys.has(lookupKey(row.lemma)) &&
          (row.pos === "NUM" || row.pos === "NOUN"),
      )
      .map((row) => row.id);
    // A number's reading is its digits' only when it is one morpheme.
    const [best] = c.byReading(
      [...new Set(ids)],
      p.length === 1 ? [p[0]!.reading] : [],
      (id) => (c.infoOf(id).pos === "NUM" ? 1 : 0),
    );
    return best === undefined ? [] : [best];
  };
  const match = c.matchOf(startOf(w), endOf(w));
  if (pieces.length === 1) {
    const ids = numberIds(w);
    return ids.length === 0
      ? PLAIN
      : { entries: loadEntries(c.db, ids).map((e) => ({ ...e, ...match })) };
  }
  // The whole as the analyzer reads it written in numerals, where it knows
  // the irregular readings (`二人` ふたり, where `2|人` is に + にん).
  const spelled = spellings(c.textOf(w));
  const listed = c.byReading(
    [
      ...new Set(
        spelled
          .flatMap((form) => c.rows(form))
          .filter((row) => row.pos !== "PROPN")
          .map((row) => row.id),
      ),
    ],
    [c.readingOf(spelled.at(-1)!)],
  );
  const whole = /[0-9０-９]/u.test(c.textOf(w))
    ? aboutNumber(c, listed)
    : listed;
  const shown = new Set(whole);
  const overlaps = (p: Word) =>
    startOf(p) < piece.end && endOf(p) > piece.start;
  const parts = pieces.map((p, i): Part => {
    // The number is shown first when it alone is clicked; a click over it
    // and its counter shows the counter first (`g` of `28g`).
    if (p.some(isNumber)) {
      const main =
        overlaps(p) && startOf(p) <= piece.start && endOf(p) >= piece.end;
      return {
        text: c.textOf(p),
        ids: numberIds(p).filter((id) => !shown.has(id)),
        main,
      };
    }
    const main = overlaps(p);
    const [part] = morphemeParts(c, p, shown);
    // After the number: its counter, and what follows that (`目` "-th"
    // in `3|つ|目`). A unit in Latin letters is every entry its spelling
    // finds, with no reading to rank them by: the analyzer reads `g` as the
    // letter's name, and the dictionary has it under `グラム`.
    const counter = pieces.slice(0, i).some((q) => q.some(isNumber));
    const latin = /^\p{Script=Latin}+$/u.test(part!.text);
    const found = latin
      ? [
          ...new Set([
            ...part!.ids,
            ...c
              .rows(part!.text)
              .map((row) => row.id)
              .filter((id) => !shown.has(id)),
          ]),
        ]
      : part!.ids;
    return {
      text: part!.text,
      ids: counter
        ? c.byReading(
            found.filter((id) => !["PROPN", "SYM"].includes(c.infoOf(id).pos)),
            latin ? [] : [p[0]!.reading],
            (id) =>
              settings.counters.includes(c.infoOf(id).sourcePos)
                ? 2
                : c.infoOf(id).pos === "X"
                  ? 1
                  : 0,
          )
        : part!.ids,
      main,
    };
  });
  if (whole.length > 0) {
    return splitResult(c.db, loadEntries(c.db, whole), parts, match);
  }
  // The parts the click covers answer: the one clicked (`冊` of `5冊`), or
  // each of those it covers (`万年` of `8|万|年`, `5冊` without a
  // sentence), which spell the clicked word.
  const covered = parts.filter((_, i) => overlaps(pieces[i]!));
  const first = pieces[parts.indexOf(covered[0]!)];
  const last = pieces[parts.indexOf(covered.at(-1)!)];
  if (
    first !== undefined &&
    last !== undefined &&
    startOf(first) === piece.start &&
    endOf(last) === piece.end
  ) {
    if (covered.every((part) => part.ids.length === 0)) return PLAIN;
    return covered.length === 1
      ? { entries: loadEntries(c.db, covered[0]!.ids) }
      : splitResult(c.db, [], covered, {});
  }
  // A click cut across them: all the parts, which spell the whole.
  if (parts.every((part) => part.ids.length === 0)) return PLAIN;
  return splitResult(c.db, [], parts, match);
};

/**
 * Of `ids`, the entries of the word its digits spell, in their order. The
 * entries about a number tell how that word is read: those with a sense
 * that begins with a number (`十分` じっぷん "ten minutes"), or without
 * any, those with a number in a sense (`千年` "a millennium; a thousand
 * years"). They come first, then the other entries read so, which are the
 * same word (`一番` いちばん "first, number one", then "most"). Entries
 * read otherwise are other words spelled alike (`十分` じゅうぶん "enough",
 * `一番` ひとつがい "a pair", `五月` さつき "azalea"), and so is every
 * entry when none is about a number (`七節` "a stick insect"). All of
 * `ids` when the code knows no number words of the senses' language.
 */
const aboutNumber = (
  c: Click,
  ids: ReadonlyArray<number>,
): ReadonlyArray<number> => {
  const ranks = loadEntries(c.db, ids).map((entry) =>
    numberSense(
      c.target,
      entry.senses.flatMap((sense) => sense.translations),
    ),
  );
  if (ranks.some((rank) => rank === undefined)) return ids;
  const best = Math.max(0, ...ranks.map((rank) => rank ?? 0));
  if (best === 0) return [];
  const numbers = ids.filter((_, i) => ranks[i] === best);
  const readings = new Set(numbers.flatMap((id) => c.infoOf(id).readings));
  const readAlike = ids.filter(
    (id) =>
      !numbers.includes(id) &&
      c.infoOf(id).readings.some((reading) => readings.has(reading)),
  );
  return [...numbers, ...readAlike];
};
