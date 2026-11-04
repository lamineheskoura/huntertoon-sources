## JS Source Notes

This file documents how HunterToon installable JS sources are expected to work.

### Goals

- JS sources must behave as close as possible to the built-in Dart sources.
- JS source behavior must be self-contained.
- Cloudflare decisions for JS sources must come from `source.js`, not from the built-in remote source config.
- JS sources must provide their own scraping logic, headers, image referer behavior, and Cloudflare metadata.

### Current runtime model

1. The app downloads a source entry from `config/js_sources_config.json`.
2. The JS file is installed locally.
3. The raw JS manifest entry is persisted with the installed record.
4. `DynamicJsSource` passes that raw config to `JsSourceRuntime`.
5. The runtime executes `createSource(api, config)` from the JS file.

### Wire contract (engine <-> script)

This is the load-bearing section. A breaking change here silently kills every
installed source, so it is written down rather than inferred from the runtime.

**Entry.** The runtime evaluates the script then calls
`<entryFunction>(api, config)` and stores the result as the source object.
`entryFunction` defaults to `createSource`; the manifest overrides it via
`script.entry`. `config` is the raw manifest entry (JSON), with
`requires_cf`/`requiresCloudflare`/`capabilities.requires_cloudflare` stripped
and `user_agent` replaced by a platform-coherent value.

**Calling convention.** Every method receives ONE object argument and must
return a JSON-serializable value (or a Promise of one). A method that is
absent returns `null` and is treated as "empty", never as a crash — so old
scripts keep working when a new optional method lands.

**Methods the app invokes** (arg keys are exact):

| Method | Arg | Return |
| --- | --- | --- |
| `getHomepageManga` | `{page}` | manga list |
| `search` | `{query, page}` | manga list |
| `getFilteredManga` | `{genre, type, page}` | manga list |
| `getGenresAndTypes` | — | `{genres, types}` |
| `getMangaDetails` | `{url}` | details |
| `fetchMoreChapters` | `{url, nextPage}` | details or `null` |
| `getChapterPages` | `{url}` | `[string]` |
| `getChapterContent` | `{url}` | content object |
| `getEpisodeServers` | `{url}` | server list |
| `resolveServer` | `{episodeUrl, serverId, serverUrl}` | video source or `null` |
| `getImageHeaders` | `{url}` | header map (sync) |
| `getVideoHeaders` | `{url}` | header map (sync) |
| `sanitizeCoverUrl` | `{url}` | string (sync) |

**Shapes.**

- manga item: `{title, coverUrl, detailUrl, contentType}` — `contentType` is
  one of `manga | novel | anime | overlay | unknown` (anything else reads as
  `manga`).
- details: `{title, coverUrl, description, genres[], chapters[], originalUrl,
  hasMoreChapters, lastFetchedPage, contentType, animeType|type, season, year,
  status, episodeDurationMin, sourceMaterial|source, trailerUrl, malUrl,
  contentRating}`.
- chapter: `{number, title, views, url, isLocked, date, isFiller,
  thumbnailUrl|thumbnail, durationSeconds|duration, servers[]}`.
- content: `{kind: 'image'|'text'|'video'|'overlay', imageUrls[],
  imageAspects[], textContent, chapterTitle, servers[], pageOverlays[][],
  naturalImageWidth, naturalImageHeight}`. `imageAspects` is per-page
  width/height; omit it (or send a non-positive/non-finite entry) and the
  reader measures instead. A missing `getChapterContent` falls back to
  `getChapterPages` and is wrapped as `image`.

**Error strings are part of the wire.** The app parses them, not a human:

- `rate_limited: <url> (HTTP 429, <N>s)` — matched by `http 429,\s*(\d+)\s*s`.
  Nothing may sit between `429` and the comma, or the countdown silently dies
  and the caller hammers a held host. The undated form `(HTTP 429)` means
  "the server did not say", not "wait zero".
- `HTTP 403`, `waf_block`, `cloudflare_blocked`, `rate_limited` are
  **propagated** (they clear cookies / drive the reader's wait) instead of
  being swallowed into an empty list. Any other throw degrades to empty on
  browse surfaces, and rethrows when the caller passes `strict`.

**Budgets.** One invoke has a 35s ceiling; at most 12 queued per runtime;
the inner send bound is 8s; `setTimeout` delays are clamped to 0..60000ms and
suppressed while the reader is open. Timer chains are killed when an invoke
ends, so a script must not rely on a background timer outliving a call.

**`api` bridge** (all Promise-returning unless noted):

- `api.version` — `'1.0'`.
- `api.http(url, {method, headers, body, transport, fingerprint})` →
  `{ok, status, statusText, url, headers, body}`. Routes through the full
  CF-aware stack or the light path per the transport matrix.
- `api.fetchText(url, headers, {transport, fingerprint})` → body string;
  rejects when the bridge reports `ok: false`.
- `api.parseHtml(html)` → opaque doc id; then `api.cssText/cssAttr/cssHtml/
  cssList/cssListAttr/cssListHtml/cssAll/cssMap(html|docId, selector, ...)`.
  Queries on one payload are memoized — one parse, not one isolate per query.
- `api.browser(url, {waitForSelector, timeoutSeconds})` — headless WebView.
- `api.cryptoOp(op, dataHex, extra)` / `api.crypto(...)` — `sha256|sha384|
  sha512|hmacSha256|hmacSha384|hmacSha512|hkdf`.
- `api.aesGcmDecrypt(blob, keyHex, aadHex)` / `api.decryptAesGcm(blob, keyHex)`.
- `api.xorUtf8(dataB64, keyB64)`, `api.dilarChapter(relId)`.
- `api.now()` (sync).

**Globals polyfilled** by the bootstrap: `fetch`, `setTimeout`, `clearTimeout`,
`atob`, `btoa`, `TextDecoder`, `TextEncoder`, `URLSearchParams`. Anything else
is absent — QuickJS has no DOM, no `XMLHttpRequest`, no `localStorage`.

### Source of truth for Cloudflare

For JS sources, Cloudflare authority must come from the JS file itself:

```js
return {
  requiresCloudflare: true,
  ...
};
```

Rules:

- `team_x`, `azora`, `swat`, `dilar` and other non-CF JS sources must return `requiresCloudflare: false`.
- CF-protected JS sources such as `mangastarz`, `lekmanga`, and any source that really needs challenge cookies should return `requiresCloudflare: true`.
- The app must not trust built-in `sources_config.json` for JS Cloudflare behavior.
- The app must not trust stale manifest CF flags over the JS script metadata.

### Why JS sources broke before

The main contradictions were:

1. Installed JS records only passed a tiny config subset to the runtime.
   - That dropped `headers`, `image_referer`, and any future JS-specific config.
2. `getImageHeaders()` for JS sources could run before the JS runtime was initialized.
   - Result: empty headers, missing `Referer`, broken covers, broken reader images.
3. The image downloader treated any `403`/`503` as Cloudflare.
   - Result: non-CF sources like Team-X could be treated as CF sources.
4. The JS browse screen used built-in source update logic.
   - Result: JS source update flow was mixed with built-in remote config flow.

### Required JS source behavior

Each `source.js` should include:

- A correct `baseUrl`
- Stable request headers
- Reader extraction logic inside the script
- `getImageHeaders()`
- `sanitizeCoverUrl()` if the source uses proxied image URLs
- Accurate `requiresCloudflare`

### Reader and image extraction guidance

To match built-in sources:

- Prefer direct HTML parsing strategies inside `source.js`.
- Do not rely on a single selector strategy if the built-in source uses multiple fallbacks.
- Use these common fallbacks where applicable:
  - selector
  - noscript
  - regex
  - source-specific JSON payloads
- Normalize URLs aggressively:
  - decode proxied `?url=` params
  - force absolute URLs
  - ignore `data:image/...`
  - ignore logos, icons, and non-page assets

### Content classification (Block Filter)

The app classifies every external work with one shared taxonomy before it
shows or downloads anything. A JS source feeds that classifier through two
fields on the `getMangaDetails` result:

- `genres` — the site's own genre/category labels, exactly as published
  (the classifier normalizes case, Arabic orthography, full-width
  characters and punctuation itself).
- `contentRating` — OPTIONAL. The site's OWN content rating when it
  publishes one, e.g. `safe`, `suggestive`, `erotica`, `pornographic`
  (the MangaDex-style vocabulary). Omit the field when the site has no
  rating — do not invent one, and never map an unknown value to `safe`.

Rules for a source:

- Return the raw site labels. Never pre-filter, translate or "clean" a
  genre: the app owns the vocabulary, a source owns the truth.
- Never put the rating in `genres` — it is its own channel.
- A work with no genres and no rating is UNKNOWN, not safe: the app asks
  the user to verify it instead of hiding it.

The app never blocks a work because of its title or description alone —
only genres and the site's own rating are evidence.

### Image headers

JS sources must behave like built-ins:

- Always provide a usable `Referer`
- Always provide a `User-Agent`
- Return image-oriented `Accept` headers
- Let the app append Cloudflare cookies only when the JS source truly requires CF

The app also provides a fallback image-header layer if the runtime is not ready yet.

### Download and Cloudflare handling

Downloader rules:

- A plain `403` is not automatically a Cloudflare challenge.
- Cloudflare must be detected from CF headers or challenge HTML markers.
- Only real CF challenges should trigger the Cloudflare solve flow.
- Normal image hotlink failures must remain normal HTTP failures.

### Checklist when adding or fixing a JS source

1. Compare against the built-in Dart source first.
2. Copy the same URL normalization behavior.
3. Copy the same image extraction fallback order.
4. Set `requiresCloudflare` correctly inside `source.js`.
5. Keep `baseUrl` and image referer canonical and consistent.
6. Verify homepage covers, detail cover, chapter page images, and downloads.
7. Update the SHA256 in `config/js_sources_config.json` after editing the script.

### Notes for specific sources

- `azora`
  - API pages can work while reader HTML still fails.
  - Reader extraction should prefer raw reader HTML parsing and proxied URL normalization.
- `team_x`
  - Not a Cloudflare source.
  - Canonical host must stay consistent to avoid fake image 403s.
- `lavascans`
  - JS must match the built-in image extraction behavior closely.
  - Covers and reader images both need valid headers and correct URL normalization.
