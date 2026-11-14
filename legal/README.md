# Legal texts

`privacy.md` and `terms.md` are the starting text for a public server. They describe what the server software does and what the protocol requires of every client. They say nothing about one client's settings or defaults: a client can change without you, and its own disclosures cover that. The rest depends on how you run the server, so read this before you publish them.

The server puts a hash of each document in its metadata. Any change to the text makes every client pause lookups until its user has seen the notice, so settle the text before you go public.

## Fill in

Replace every `[[...]]`:

| Placeholder | What goes there |
|---|---|
| `[[DATE]]` | The day the text last changed. |
| `[[SERVER URL]]` | The address users add in their client. |
| `[[OPERATOR]]`, `[[COUNTRY]]` | Who runs the server and where. Some countries also require a postal address; add it if yours does. |
| `[[CONTACT EMAIL]]` | An address you read. |
| `[[PRIVACY URL]]` | Where the privacy policy is published. |
| `[[LOG DAYS]]` | How long logs are kept. |
| `[[HOSTING PROVIDER, COUNTRY]]` | Who hosts the server, and any CDN in front of it. |
| `[[TRANSFERS: ...]]` | Whether data leaves the European Economic Area, and on what basis. |
| `[[SUPERVISORY AUTHORITY]]` | Your country's data protection authority. |

## Make the promises true

The privacy policy makes promises that only your setup can keep.

- **Web server logs.** Words and sentences travel in the request's query string, and nginx, Caddy and Apache log the full address by default. Set the access log to record only the IP address, the time, the path without the query string, and the status. If you log more (the browser's name, for example), add it to "What is kept".
- **Log retention.** Delete web server logs after `[[LOG DAYS]]` days. The server program also writes one line per request (time, path, status; no IP address and no query string). Docker keeps those without limit unless you set log rotation.
- **CDN.** A CDN that ends TLS sees every word and sentence, may log them, and may set cookies. If you use one, name it under "Hosting" and check that "no cookies" is still true.
- **Audio from your own host.** The texts assume recordings come from Wikimedia Commons. If you serve audio yourself, playing a recording is a request to your server. Replace the Wikimedia paragraph in both texts, say what that request tells you, and credit the recordings.
- **Page addresses.** The policy says you do not record the page a user is reading, even if a client sends it. A browser can send it in the `Referer` header, so keep that header out of your logs.
- **Other data sources.** "The dictionary data" in the terms names Wiktionary and Wikimedia Commons. Change it to match the `sources` your server lists.

## What these texts are not

They were written with care and checked against the software, but not by a lawyer. They follow EU law (GDPR). If you run a server elsewhere, or for money, get them reviewed.
