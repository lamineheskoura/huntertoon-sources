# Release checklist — READ BEFORE EVERY PUSH (lesson learned 2026-09-12)

## The eternal-update-button incident
Three sources (lekmanga/mangalionz/mangatime) showed "update available"
forever despite successful updates. Root cause: sha256 in
`config/js_sources_config.json` was computed on CRLF working-tree bytes,
but GitHub serves LF bytes. The app saves `actualHash` of DOWNLOADED bytes
and compares with the manifest sha on every check → permanent mismatch.

## Mandatory rules
1. Source files MUST be LF-only in the repo. Never commit CRLF bytes.
2. sha256 in the manifest MUST equal the hash of the EXACT bytes served
   by BOTH raw.githubusercontent.com AND cdn.jsdelivr.net.
3. After every push that touches sources/*.js or config:
   a. Fetch the live manifest from raw + jsdelivr, confirm versions.
   b. Download every changed script from BOTH CDNs, hash, compare with manifest.
   c. If jsdelivr is stale, purge: https://purge.jsdelivr.net/gh/<owner>/<repo>@main/<path>
   d. Re-verify until manifest == raw == jsdelivr for all touched files.
4. `git show HEAD:<path>` bytes are ground truth for what was committed;
   compare its hash with the live hash to detect normalization surprises.
5. Version bumps alone never fix a hash mismatch — always re-verify hashes live.

## The stale-device incident (2026-11-16, manhasama)
A published fix did not reach the user's phone. Root cause: the APP caches the
manifest forever (`remote_js_sources_config_cache`, no TTL) and replaces an
installed source script ONLY when the user taps "تحديث" on its card. A device
kept on the old script kept failing every ad-gated chapter (Cloudflare 403 on
cdn.atsu.moe because the old script omitted `Sec-Fetch-Site` and the app then
injected the blocked `cross-site` triple).

⇒ After publishing a source fix, the release is NOT complete until the user
taps تحديث (or تحديث الكل) and the card shows the new version. Say so
explicitly in the hand-off.

## jsdelivr caches per FILE and per EDGE (2026-11-16)
`cdn.jsdelivr.net` served the NEW script but the OLD manifest while
`gcore.jsdelivr.net` served the opposite — `cache-control: s-maxage=43200`
(12h) per file per host, and a `?v=<ts>` cache-buster still returned the old
body (the stale copy is inside jsdelivr's own storage, not only the edge).

⇒ Verify the manifest AND every changed script on raw AND on all three
jsdelivr hosts (cdn / fastly / gcore). Purge every path form
(`@main/<path>`, `@<short-sha>/<path>`, `@<full-sha>/<path>`, repo root) and
re-check until all hosts agree. The pinned `@<commit>/<path>` form always
serves the exact committed bytes — use it to prove the bytes are correct while
the `@main` copies converge. raw.githubusercontent.com (max-age 300) is the
app's primary and converges in minutes; jsdelivr is the fallback and can lag.
