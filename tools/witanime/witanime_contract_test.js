// Contract test for sources/witanime/source.js — runs the REAL source code
// against a captured Laravel/Cloudflare transport contract. No app, no network.
//
//   node tools/witanime/witanime_contract_test.js comma    # what the app's cronet_http does: join(',')
//   node tools/witanime/witanime_contract_test.js newline  # what an in-page browser fetch does: '\n'
//
// comma -> must return 11 servers (v1.4.1 and older returned 0)
// newline -> returns 11 either way (this is why in-page tests hide the bug)
const path = require("path");
const fs = require("fs");

const SRC = path.join(__dirname, "..", "..", "sources", "witanime", "source.js");
const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, "wit_contract_fixture.json"), "utf8"));

const joinMode = (process.argv[2] || "comma").toLowerCase();
const sep = joinMode === "comma" ? "," : "\n";
const setCookieHeader = FIX.set_cookie_values.join(sep);

// The app's CfCookieStore.applyIdentity() REPLACES the source's Cookie header
// with its own jar for witanime.site (host key "witanime.site"). That jar has
// no Laravel session, so the origin answers POST /sources with
// 404 {"message":"Not Found."} — exactly what the device showed.
// A trailing-dot host ("witanime.site.") is a different lookup key, so the
// session the source just minted travels untouched.
const APP_JAR = "XSRF-TOKEN=app-xsrf; witanime-session=app-stale-session";

const calls = [];
const api = {
  http: async (url, opts) => {
    opts = opts || {};
    const headers = opts.headers || {};
    const method = (opts.method || "GET").toUpperCase();
    const cookie = headers.Cookie || headers.cookie || "";
    const canonical = /^https:\/\/witanime\.site\//.test(url);
    const effectiveCookie = canonical ? APP_JAR : cookie;
    calls.push({
      method,
      url,
      host: (url.match(/^https:\/\/([^/]+)\//) || [])[1] || "",
      cookie: !!cookie,
      origin: headers.Origin || headers.origin || "",
      secFetchSite: headers["Sec-Fetch-Site"] || headers["sec-fetch-site"] || "",
    });

    if (method === "GET" && /\/watch\//.test(url)) {
      return {
        ok: true,
        status: 200,
        headers: { "set-cookie": setCookieHeader, "content-type": "text/html" },
        body: '<html><head><meta name="csrf-token" content="' + FIX.csrf + '"></head><body></body></html>',
      };
    }
    if (method === "POST" && /\/sources$/.test(url)) {
      // Laravel: the POST only succeeds for the session that owns the CSRF
      // token. Any other session (the app's stale jar) -> 404 Not Found.
      if (!/witanime-session=REDACTED/.test(effectiveCookie)) {
        return { ok: false, status: 404, headers: {}, body: '{"message":"Not Found."}' };
      }
      if (!(headers.Origin || headers.origin)) {
        return { ok: false, status: 404, headers: {}, body: '{"message":"Not Found."}' };
      }
      return { ok: true, status: 200, headers: { "content-type": "application/json" }, body: JSON.stringify(FIX.players) };
    }
    return { ok: false, status: 404, headers: {}, body: "" };
  },
  browser: async () => "",
  cryptoOp: async () => "",
};

const { createSource } = require(SRC);
const src = createSource(api, {
  base_url: "https://witanime.site",
  headers: { "User-Agent": "dart-http" },
});

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exitCode = 1;
  } else {
    console.log("ok  :", msg);
  }
}

(async () => {
  const servers = await src.getEpisodeServers({ url: FIX.url });
  const gets = calls.filter((c) => c.method === "GET");
  const posts = calls.filter((c) => c.method === "POST");
  console.log(`\nmode=${joinMode} sep=${JSON.stringify(sep)} setCookieValues=${FIX.set_cookie_values.length}`);
  console.log(`GET  seen: ${gets.map((g) => g.host).join(",")}`);
  console.log(`POST seen: ${posts.map((p) => p.host).join(",")} | cookie header sent: ${posts.map((p) => p.cookie).join(",")}`);
  console.log(`servers: ${servers.length} ${servers.map((s) => s.name).join(" | ")}`);

  assert(posts.length === 1, "exactly one POST /sources (no wasted retry)");
  assert(posts[0] && posts[0].cookie === true, "POST carries a Cookie header");
  // The session must be minted AND used on a host the app's cookie store
  // does not own, otherwise applyIdentity() replaces it with the app jar.
  assert(posts[0] && posts[0].host === "witanime.site.",
    "POST /sources uses the isolated trailing-dot host (app jar cannot overwrite it)");
  assert(gets.length === 1 && gets[0].host === "witanime.site.",
    "the watch page GET runs on the same isolated host as the POST");
  assert(posts[0] && posts[0].origin === "https://witanime.site.",
    "POST carries the browser Origin header of that host");
  assert(posts[0] && posts[0].secFetchSite === "same-origin",
    "POST carries Sec-Fetch-Site: same-origin");
  assert(servers.length === FIX.server_count,
    `all ${FIX.server_count} players listed (HD=${FIX.players.players.HD.length} FHD=${FIX.players.players.FHD.length} SD=${FIX.players.players.SD.length})`);
  assert(servers.every((s) => /^[a-f0-9]{64}$/.test(s.id)), "every server id is a real stream token");
  assert(servers.every((s) => s.quality), "every server has a quality bucket");
  console.log(process.exitCode ? "\nRESULT: FAIL" : "\nRESULT: PASS");
})().catch((e) => {
  console.error("THROW:", e.stack || e.message);
  process.exit(1);
});
