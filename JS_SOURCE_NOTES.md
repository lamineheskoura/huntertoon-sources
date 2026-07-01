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
