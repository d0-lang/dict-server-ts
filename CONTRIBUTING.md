# Contributing

This is a hobby project with one maintainer. I read everything, but a reply can take a while.

## What helps most

- **A wrong or missing word.** Open a "Wrong or missing word" issue with the language, the word and the sentence it was in. No code needed.
- **A fix for one language:** a missing grammar word, a phrase, a rule. Each language's data is in `languages/<lang>/`.
- **A server bug,** if you run a server yourself.

## Ask first for big changes

A small fix can go straight to a PR. For the changes below, open an issue and wait for my reply before you write code. I may say no, or want it done another way, and I don't want your work wasted.

- **The protocol** ([d0-lang/protocol](https://github.com/d0-lang/protocol)). Every server and every client has to follow a change to it.
- **A new language.** It is a lot of work with pass marks to reach, see Languages below.
- **The dictionary file format** (`packages/core`, `spec/`). Every dictionary has to be rebuilt after a change to it.

## Setup

You need [Bun](https://bun.sh).

```sh
bun install
cp .env.example .env
bun run import --lang pl   # builds data/pl_en.sqlite from the kaikki.org dump, a 3 GB download
bun run dev
```

The tests need no dictionary files. [docs/development.md](docs/development.md) describes the layout, [docs/importer.md](docs/importer.md) the importer and [docs/lookups.md](docs/lookups.md) how lookups work.

## Before you open a PR

- `bun run typecheck`, `bun run test` and `bun run format:check` pass. CI runs the same three.
- One change per PR.
- Fill in the PR template and keep the description that short. Say what you checked and what you did not.

## Languages

Adding a language, or reworking one, has pass marks: a judge model reads a sample of lookups and scores them (`.agents/skills/add-language/SKILL.md`). The judge costs API money, so you don't have to run it. Send the change with the language PR template filled in as far as you can, and I run the judge before merging.

## AI-written changes

Fine. You answer for them: run the checks, read the diff yourself, and keep the description short. `CLAUDE.md` has the rules agents follow in this repo.

## Security

Report a vulnerability privately, through "Report a vulnerability" on the repo's Security tab, not in a public issue.

## Licence

The code is MIT. By sending a change you agree it is under MIT too. Dictionary files built from Wiktionary stay under CC BY-SA 4.0.
