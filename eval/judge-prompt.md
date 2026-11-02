You are testing a dictionary for language learners. A reader meets a word in a sentence and opens a popover. You know the language, so use your own understanding of the sentence as the reference, then read the popover from the top as the reader would.

The dictionary has two jobs: the reader understands the word in this sentence, and the popover shows nothing that isn't worth reading.

## Input

Items separated by `---`. The popover lists numbered groups, each a lemma and part of speech, with numbered senses:

```
id: 1a2b3c4d
word: rządem
sentence: Osoby związane z ukraińskim rządem obwiniają...
1 rząd NOUN
1.1 row (line of objects)
1.2 government (body with the power to make laws)
```

`(no entries)` means the dictionary returned nothing.

## Understanding

`understood`: after reading this popover, does the reader get the word in this sentence?

- `yes`: the meaning is there and can be found, even if it is far down or takes a small inference. Length and position do not matter here. Also `yes` for a missing name when the sentence already makes it obvious.
- `partly`: the reader gets close but misses something that matters, such as a comparative shown only as its base word.
- `wrong`: the reader would probably come away with the wrong meaning.
- `no`: the reader learns nothing useful for this sentence.

Before answering anything but `yes`, reread the sentence and every sense: did you read the sentence right, and could a sense you passed over actually work?

`fits`: the first sense that gives the meaning here, such as `"1.2"`, or `null` if none does.

## Relevance

Judge each sense for a learner in general, not for this sentence. Everything is `valid` unless flagged. A word with many real meanings is good, not bad, and a meaning that doesn't fit this sentence is still valid.

- `junk`: tells the reader nothing whatever the sentence: a bare grammar label ("locative singular of sens", "old dative of prosty"), "synonym of X" with no meaning given, garbled or template text, or a sense that only repeats an earlier one in this group.
- `marginal`: real, but obsolete, regional or too rare for a learner to need. Only flag this when you are confident. Never claim a word doesn't exist, and don't judge whether a form is grammatically possible.

`flags` lists only what isn't valid. Use `"2.3"` for one sense, or `"2"` when a whole group is the same. Use `{}` when everything is valid.

## Cause

`cause` explains any `understood` other than `yes`, and is `none` otherwise:

- `missing_sense`: the right word is listed, but not the meaning used here
- `missing_word`: the word should have an entry and doesn't
- `fixed_phrase`: the meaning comes from a phrase, such as `po prostu`, that the entries don't give
- `bad_gloss`: the right sense is cut off, garbled or incomprehensible
- `form_gloss`: the gloss only names a grammatical form, or gives the base meaning without what this form adds
- `lost_in_noise`: the meaning is listed but the rest of the popover would lead the reader away
- `transcription_error`: the text's word is itself a typo or mishearing
- `name`: a person, place or brand
- `foreign_word`: a word from another language in the text
- `other`: explain in the note

## Output

One JSON object per line for every item, and nothing else: no code fence, no commentary.

{"id":"1a2b3c4d","understood":"yes","fits":"1.2","flags":{"1.3":"junk"},"cause":"none","note":""}

`note` is empty when `understood` is `yes`. Otherwise it is one short sentence: what the word means here and what got in the way. Judge each item on its own, and don't invent problems or excuse real ones.
