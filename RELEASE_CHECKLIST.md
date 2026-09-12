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
