// LIVE harness: runs the REAL published source.js against the LIVE site.
// api.http is delegated to a local bridge that performs every request in a
// real Chromium, with EXACTLY the headers the source asked for, plus the
// app's CfCookieStore.applyIdentity() behaviour (it replaces the Cookie on
// the canonical host with its own jar).
//
//   node tools/witanime/witanime_live_harness.js [watchUrl]
//
// Prints the servers the source actually returns, or the empty list.
const path = require("path");

const SRC = path.join(__dirname, "..", "..", "sources", "witanime", "source.js");
const WATCH = process.argv[2] || "https://witanime.site/watch/koori-no-jouheki-2nd-season/1";
const BRIDGE = process.env.WIT_BRIDGE || "http://127.0.0.1:8765/req";

const api = {
  http: async (url, opts) => {
    const res = await fetch(BRIDGE, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url,
        method: (opts && opts.method) || "GET",
        headers: (opts && opts.headers) || {},
        body: (opts && opts.body) || null,
      }),
    });
    return await res.json();
  },
  cssText: async () => "",
  cssAttr: async () => "",
  cssList: async () => [],
  browser: async () => "",
  fetchText: async () => "",
  cryptoOp: async () => "",
};

const { createSource } = require(SRC);
const src = createSource(api, {
  base_url: "https://witanime.site",
  // Same UA the app would inject after making it device-coherent. The live
  // bridge's Chromium identifies itself as Chrome/149 on Windows.
  user_agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
  headers: {
    "User-Agent": "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "ar,en-US;q=0.9,en;q=0.8",
    "Referer": "https://witanime.site/",
  },
});

(async () => {
  const servers = await src.getEpisodeServers({ url: WATCH });
  console.log("\n===== RESULT =====");
  console.log("server count:", servers.length);
  for (const s of servers) {
    console.log(`- ${s.name} [${s.quality}] type=${s.type}`);
    console.log(`  ${s.embedUrl}`);
  }
  console.log(servers.length ? "LIVE RESULT: PASS" : "LIVE RESULT: FAIL (empty)");
})().catch((e) => {
  console.error("THROW:", e.stack || e.message);
  process.exit(1);
});
