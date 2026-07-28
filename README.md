# HunterToon Sources

External JS sources for the HunterToon app.

## Layout

```
huntertoon-sources/
├─ config/
│  ├─ sources_config.json          ← Legacy source manifest (v2 format)
│  ├─ js_sources_config.json       ← JS sources manifest (v5 format)
│  └─ studio_sources_config.json   ← Studio-only source definitions
├─ sources/
│  └─ <source_id>/
│     └─ source.js                 ← Runtime JS source code
├─ JS_SOURCE_NOTES.md
└─ README.md
```

## How the app uses this repo

1. The Flutter app fetches `config/js_sources_config.json` from
   `raw.githubusercontent.com/lamineheskoura/huntertoon-sources/main/...`
   at runtime (no app update needed).
2. The manifest lists every available source, its `scriptUrl` (a JS file in
   `sources/<id>/source.js`), and metadata.
3. When the user visits `/source-download`, the app downloads the JS files
   and stores them in the app-private documents directory.
4. `SourceRegistry` loads them on the next launch.

## Sources (31)

| # | ID | Name |
|---|----|------|
| 1 | `area_manga` | Area Manga |
| 2 | `asurascans` | Asura Scans |
| 3 | `azora` | AzoraMoon |
| 4 | `brownmanga` | Brown Manga |
| 5 | `despair_manga` | Despair Manga |
| 6 | `dilar` | Dilar |
| 7 | `fada_riwayat` | Fada Riwayat |
| 8 | `hijala` | Hijala |
| 9 | `hizo_manga` | Hizo Manga |
| 10 | `kawaii` | Kawaii |
| 11 | `lava_scans` | Lava Scans |
| 12 | `lekmanga` | Lek Manga |
| 13 | `mangalionz` | Manga Lionz |
| 14 | `mangasid` | Manga Sid |
| 15 | `mangastarz` | Manga Starz |
| 16 | `mangatek` | Manga Tek |
| 17 | `mangatime` | Manga Time |
| 18 | `manhasama` | Manhasama |
| 19 | `manhuaus` | Manhua US |
| 20 | `mgeko` | Mgeko |
| 21 | `mnga4all` | Manga 4 All |
| 22 | `nadi_al_riwayt` | Nadi al Riwayat |
| 23 | `realmnovel` | Realm Novel |
| 24 | `rocks_manga` | Rocks Manga |
| 25 | `seanovel` | Sea Novel |
| 26 | `sparkmanga` | Spark Manga |
| 27 | `stellarsaber` | Stellar Saber |
| 28 | `sunovels` | Sun Novels |
| 29 | `swat` | Swat |
| 30 | `team_x` | Team X |
| 31 | `three_asq` | Three ASQ |

## Adding / updating a source

1. Create `sources/<id>/source.js` with the correct source interface.
2. Add the source entry in `config/js_sources_config.json`.
3. Commit, push to `main` — the app picks it up at next runtime
   (or immediately if Firebase Remote Config triggers a refresh).
