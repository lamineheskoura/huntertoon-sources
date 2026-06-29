# HunterToon Sources

External JS sources for HunterToon.

This repository layout is designed so the Flutter app can:
- fetch a manifest from `config/sources_config.json`
- detect new sources and source updates
- download per-source JS files
- keep built-in Dart sources during migration

Current test source:
- `swat`
