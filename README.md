<p align="center"><img src="docs/logo.svg" width="96" height="96" alt="DaDict logo"></p>

<h1 align="center">DaDict server</h1>

<p align="center">
Public server: <code>https://server.dadict.com</code> — add it in DaDict<br>
<a href="https://server.dadict.com/privacy">Privacy policy</a> · <a href="https://server.dadict.com/terms">Terms</a> · <a href="#run-your-own">Run your own</a> · <a href="https://github.com/d0-lang/protocol">Protocol</a>
</p>

Click a word while you read, and the server answers with what it means, in English. With the sentence around the word, it finds what a single word can't show:

- **Phrases and idioms**: `Kraft` in *Das Gesetz tritt morgen in Kraft* → *in Kraft treten*, "to come into force"
- **Separable verbs**: `fand` in *Die Sitzung fand gestern statt* → *stattfinden*
- **Compounds, split into their parts**: `Rettungsfonds` → `Rettung` + `s` + `Fonds`
- **Whole words in text without spaces**: `食` in *寿司を食べました* → *食べる*

It speaks the [d0 lookup protocol](https://github.com/d0-lang/protocol), so any client that speaks it can use any server. **DaDict public**, at the address above, is the one we run. Run your own if you'd rather your lookups stayed with you.

## Languages

**German · Spanish · French · Italian · Japanese · Polish · Russian · Ukrainian**, each explained in English, from the English [Wiktionary](https://en.wiktionary.org/). Answers come with pronunciation (IPA, and recordings from Wikimedia Commons where there are any) and links to the Wiktionary pages the entries come from.

## Run your own

You need Docker and about 1 GB of memory for all eight languages. Japanese's word analyzer takes about 600 MB of that; the other seven need 384 MB.

```bash
mkdir dict-server && cd dict-server
curl -LO https://github.com/d0-lang/dict-server-ts/releases/latest/download/compose.yaml
docker compose up -d
```

The first start downloads the release's dictionaries (about 400 MB) and checks them against its checksums. Then the server answers at `http://127.0.0.1:3000`, on this machine only. Point your client at it; to serve other people, put a reverse proxy such as Caddy or nginx in front, and read [Going public](#going-public).

- **Settings** go in a `.env` file next to `compose.yaml` (see [Settings](#settings)), then `docker compose up -d` again.
- **Updating**: download a newer release's `compose.yaml` and `docker compose up -d`. The new image fetches its own dictionaries.
- **Your server's key** is created on the first start and kept in the `identity` volume. Clients remember it: if it's lost, they warn their users that your server's identity changed. Back it up:

  ```bash
  docker compose cp server:/app/identity/identity.json ./identity-backup.json
  ```

## Settings

| Setting | Default | What it does |
| --- | --- | --- |
| `SERVER_NAME` | `dict poc` | The name clients show for your server. |
| `LANGUAGES` | every dictionary in `data/` | The pairs to serve, joined by commas: `de_en,pl_en`. Leaving out `ja_en` saves about 600 MB. |
| `CONTEXT` | `true` | Accept the sentence around a word. Your privacy policy has to say so. |
| `INCLUDE_LEGAL` | `false` | Send your privacy policy and terms. Off, clients tell users your server is for testing only. |
| `PRIVACY_FILE`, `TOS_FILE` | the templates in `legal/` | Your privacy policy and terms, as Markdown. |
| `PRIVACY_LINK`, `TOS_LINK` | `example.invalid` | Where they're published. The server shows them itself at `/privacy` and `/terms`, so these can be `https://<your server>/privacy` and `/terms`. |
| `PRIVACY_CHANGE`, `TOS_CHANGE` | none | A short summary of the last change, shown with the notice. At most 500 characters. |
| `VERIFICATION_URLS` | `example.invalid` | Where you post news about your server, joined by commas. Clients show it if your key ever changes, so it shouldn't be on the server itself. |
| `REPORT_URL` | none | A page where users report a wrong or missing answer; `https` only. |
| `PORT` | `3000` | The port inside the container, or of `bun run dev`. With Docker, change `DICT_PORT` instead. |
| `IDENTITY_FILE` | `data/identity.json` | Where the key is kept. Docker keeps it in the `identity` volume. |
| `DATA_DIR` | `data` | Where the dictionaries are. |

With Docker, `DICT_PORT` sets the port on your machine (default 3000), and `DICT_VERSION` the release to run.

## Going public

- **Legal texts.** Copy `legal/privacy.example.md` and `legal/terms.example.md`, fill them in, and turn `INCLUDE_LEGAL` on. [`legal/README.md`](legal/README.md) says what to fill in, and what your setup has to do for the texts to be true, such as what your proxy may log. Settle them before you go public: any change makes every client pause until its user has seen it.
- **The key.** Back it up, and keep it for as long as the server runs.

## Development

You need [Bun](https://bun.sh).

```bash
bun install
cp .env.example .env
bun run import --lang pl   # builds data/pl_en.sqlite from the Wiktionary dump, a 3 GB download
bun run dev
bun run test               # needs no dictionaries
```

| Document | About |
| --- | --- |
| [docs/development.md](docs/development.md) | The repo's layout, running from source, the endpoints, logs, tests, Docker builds |
| [docs/importer.md](docs/importer.md) | How a dictionary is built from Wiktionary, and what gets in |
| [docs/lookups.md](docs/lookups.md) | How a lookup finds headwords, ranks them, splits compounds and uses the sentence |
| [CONTRIBUTING.md](CONTRIBUTING.md) | What helps most, and how to send a change |

Releases are built in CI: every language is imported from a stored, dated copy of the Wiktionary dump, checked, and published with the image ([docs/importer.md](docs/importer.md#dump-snapshots)).

## Licence

The code is under the [MIT licence](LICENSE). The dictionaries are built from Wiktionary, written by its contributors, and are under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Pronunciation recordings are files on Wikimedia Commons, each under its own licence.
