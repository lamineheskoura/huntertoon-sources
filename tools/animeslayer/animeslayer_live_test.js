// Live test: real AnimeSlayer source against the public API.
const path = require("path");
const { createSource } = require(path.join(__dirname, "..", "..", "sources", "animeslayer", "source.js"));

const api = {
  http: async (url, opts) => {
    const res = await fetch(url, {
      method: (opts && opts.method) || "GET",
      headers: (opts && opts.headers) || {},
      body: opts && opts.body,
    });
    return {
      ok: res.ok,
      status: res.status,
      headers: Object.fromEntries(res.headers),
      body: await res.text(),
    };
  },
};
const src = createSource(api, { base_url: "https://anslayer.com/anime/public" });

function assert(ok, message) {
  console.log(ok ? "ok  :" : "FAIL:", message);
  if (!ok) process.exitCode = 1;
}

(async () => {
  const details = await src.getMangaDetails({ url: "https://anslayer.com/anime/14174" });
  console.log("detail:", details.title, "chapters:", details.chapters.length);
  assert(details.title === "Black Clover 2nd Season", "details load");
  assert(details.chapters.length > 0, "episodes load");

  const episodeUrl = details.chapters[details.chapters.length - 1].url;
  const servers = await src.getEpisodeServers({ url: episodeUrl });
  console.log("servers:", servers.map((s) => s.name).join(" | "));
  assert(servers.length === 4, "all four currently-live servers are retained");
  assert(servers.some((s) => s.name === "streamtape"),
    "streamtape survives a failed direct-video probe as an embed");

  const streamtape = servers.find((s) => s.name === "streamtape");
  const resolved = await src.resolveServer({ serverUrl: streamtape.embedUrl });
  assert(resolved && resolved.type === "embed", "streamtape resolves through the native embed path");
  assert(resolved && resolved.url === streamtape.embedUrl, "original streamtape URL is preserved");

  console.log(process.exitCode ? "\nRESULT: FAIL" : "\nRESULT: PASS");
})().catch((e) => {
  console.error("THROW:", e.stack || e.message);
  process.exit(1);
});
