# server

Bun + Effect 4 dictionary protocol PoC.

```bash
bun install
cp .env.example .env   # already gitignored; Bun loads it automatically
bun run dev
```

Settings live in `.env` (`PORT`, `SERVER_NAME`, `LANGUAGES`, `INCLUDE_LEGAL`, legal copy/links, `VERIFICATION_URLS`). See `.env.example`.

- `GET /v1/get-key` — unsigned Ed25519 public key (base64)
- `GET /v1/get-meta` — signed metadata (`X-Nonce` required, `X-Signature` over exact body bytes)
- `GET /v1/lookup?payload=<url-encoded JSON>` — stub translation

```bash
bun run test
```
