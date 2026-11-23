// Live test for Anime Criative: runs the real source against the public API.
const path = require("path");
const { createSource } = require(path.join(__dirname, "..", "..", "sources", "anime_criative", "source.js"));

const api = {
  http: async (url, opts) => {
    const res = await fetch(url, { method: (opts && opts.method) || "GET", headers: (opts && opts.headers) || {} });
    const body = await res.text();
    return { ok: res.ok, status: res.status, headers: Object.fromEntries(res.headers), body };
  },
};
const src = createSource(api, { base_url: "https://anime-site-api.animecriative.workers.dev" });

function assert(ok, message) {
  console.log(ok ? "ok  :" : "FAIL:", message);
  if (!ok) process.exitCode = 1;
}

(async () => {
  const home = await src.getHomepageManga({ page: 1 });
  console.log("home:", home.length, home.slice(0, 3).map((x) => x.title).join(" | "));
  assert(home.length > 0, "homepage has anime cards");
  assert(home.every((x) => x.detailUrl && x.title), "every card has a title and detail URL");

  const search = await src.search({ query: "one piece" });
  console.log("search:", search.length);
  assert(search.length > 0, "search returns results");

  const detail = await src.getMangaDetails({ url: "https://anime-site-api.animecriative.workers.dev/m-detail.html?id=14174" });
  console.log("detail:", detail.title, "| chapters:", detail.chapters.length);
  assert(detail.title === "Black Clover 2nd Season", "custom document supplies the missing title");
  assert(detail.chapters.length === 4, "custom document supplies four episodes");

  const servers = await src.getEpisodeServers({ url: detail.chapters[detail.chapters.length - 1].url });
  console.log("servers:", servers.length);
  for (const s of servers) console.log(`- ${s.name} [${s.quality || "?"}] ${s.type}: ${s.embedUrl.slice(0, 100)}`);
  assert(servers.length === 5, "episode 1 returns the five live servers");
  assert(servers.some((s) => s.type === "mp4" && s.directUrl), "direct MP4 is preserved");
  assert(servers.some((s) => s.type === "embed"), "iframe servers are preserved");

  console.log(process.exitCode ? "\nRESULT: FAIL" : "\nRESULT: PASS");
})().catch((e) => {
  console.error("THROW:", e.stack || e.message);
  process.exit(1);
});
