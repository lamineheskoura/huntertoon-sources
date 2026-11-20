// Home contract test: getHomepageManga must read the site's latest-episodes
// feed (/new-episodes JSON), not the permanent A-Z catalog (/browse).
//   node tools/witanime/witanime_home_test.js
const path = require("path");
const fs = require("fs");

const SRC = path.join(__dirname, "..", "..", "sources", "witanime", "source.js");
const html = fs.readFileSync(path.join(__dirname, "wit_newep1.html"), "utf8");
const calls = [];
const api = {
  http: async (url, opts) => {
    opts = opts || {};
    calls.push((opts.method || "GET") + " " + url);
    if (/\/new-episodes\?page=1$/.test(url)) {
      return { ok: true, status: 200, headers: { "content-type": "application/json" },
               body: JSON.stringify({ page: 1, hasOlder: true, html }) };
    }
    if (/\/browse$/.test(url)) {
      return { ok: true, status: 200, headers: {}, body: '<a href="/anime/aaa-alphabetical"><h3>Aaa</h3></a>' };
    }
    return { ok: false, status: 404, headers: {}, body: "" };
  },
  browser: async () => "",
  cryptoOp: async () => "",
};

const { createSource } = require(SRC);
const src = createSource(api, { base_url: "https://witanime.site", headers: { "User-Agent": "dart-http" } });

function assert(cond, msg) {
  console.log((cond ? "ok  : " : "FAIL:") + " " + msg);
  if (!cond) process.exitCode = 1;
}

(async () => {
  const items = await src.getHomepageManga({ page: 1 });
  console.log(`items=${items.length} calls=${JSON.stringify(calls)}`);
  console.log("first 5:", items.slice(0, 5).map((x) => x.title).join(" | "));

  assert(calls.length === 1 && /new-episodes/.test(calls[0]), "one request to /new-episodes (no /browse fallback)");
  assert(items.length >= 10, `latest feed yields a full page (${items.length})`);
  assert(!items.some((x) => x.detailUrl.includes("aaa-alphabetical")), "did NOT fall back to the A-Z catalog");
  assert(items.every((x) => /^https:\/\/witanime\.site\/(anime|movie)\/[^/]+$/.test(x.detailUrl)),
    "every detailUrl is a real detail page (/anime|/movie/slug)");
  assert(new Set(items.map((x) => x.detailUrl)).size === items.length, "no duplicate anime across cards");
  assert(/steel-ball-run-jojo-no-kimyou-na-bouken/.test(items[0].detailUrl),
    "first card is the newest episode's anime");
  console.log(process.exitCode ? "\nRESULT: FAIL" : "\nRESULT: PASS");
})().catch((e) => { console.error("THROW:", e.stack || e.message); process.exit(1); });
