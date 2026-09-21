function createSource(api, config) {
  var baseUrl = ((config && config.base_url) || "https://anslayer.com/anime/public").replace(/\/+$/, "");
  var siteUrl = "https://anslayer.com";
  var configHeaders = (config && config.headers) || {};
  var userAgent =
    configHeaders["User-Agent"] ||
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
  var lastPageUrl = baseUrl + "/";
  var CLIENT_ID = "android-app2";
  var CLIENT_SECRET = "7befba6263cc14c90d2f1d6da2c5cf9b251bfbbd";
  var LIST_LIMIT = 20;
  var ALT_API = "https://a-reslayer.com/la/public/api/f";

  var defaultHeaders = {
    "User-Agent": userAgent,
    "Accept": "application/json",
    "Accept-Language": "ar,en-US;q=0.9,en;q=0.8",
    "Referer": siteUrl + "/",
    "Origin": siteUrl,
    "Client-Id": CLIENT_ID,
    "Client-Secret": CLIENT_SECRET
  };

  var defaultGenres = [
    "أكشن", "مغامرات", "كوميدي", "دراما", "خيال", "خيال علمي",
    "رومانسي", "رعب", "غموض", "نفسي", "رياضي", "مدرسي",
    "شونين", "شوجو", "سينين", "ايسيكاي", "قوة خارقة", "شريحة من الحياة",
    "تاريخي", "عسكري", "فضاء", "ميكان", "موسيقى",
    "لعبة", "ساخر", "مصاصي دماء", "شياطين", "سحر", "ساموراي",
    "تحقيق", "بوليسي", "ايتشي", "حريم", "جوسي", "شوجو آي",
    "إثارة", "تشويق", "خارق للطبيعة", "فنون قتالية", "أطفال"
  ];
  var defaultTypes = ["TV", "Movie", "ONA", "OVA", "Special"];

  // Per-file headers: the app NEVER reads server.headers (zero consumers)
  // and getVideoHeaders(url) is the only channel reaching the player.
  var mediaHeaders = {};

  function rememberMedia(fileUrl, referer) {
    if (!fileUrl || !referer) return;
    mediaHeaders[String(fileUrl)] = String(referer);
    var bare = String(fileUrl).split("#")[0];
    if (bare && bare !== fileUrl) mediaHeaders[bare] = String(referer);
  }

  function embedRefererFor(url) {
    var u = String(url || "").toLowerCase();
    if (u.indexOf("mediafire.com") !== -1) return "https://www.mediafire.com/";
    if (u.indexOf("mixdrop") !== -1) return "https://mixdrop.co/";
    if (u.indexOf("streamtape") !== -1) return "https://streamtape.com/";
    if (u.indexOf("ok.ru") !== -1) return "https://ok.ru/";
    if (u.indexOf("drive.google") !== -1) return "https://drive.google.com/";
    return "";
  }

  function videoHeadersFor(url) {
    var u = String(url || "");
    var ref = mediaHeaders[u] || mediaHeaders[u.split("#")[0]] || embedRefererFor(u) || siteUrl + "/";
    return {
      "User-Agent": userAgent,
      "Referer": ref,
      "Accept": "*/*",
      "Accept-Language": "ar,en-US;q=0.9,en;q=0.8",
      "Sec-Fetch-Dest": "video",
      "Sec-Fetch-Mode": "no-cors",
      "Sec-Fetch-Site": "cross-site"
    };
  }

  function mergeHeaders(a, b) {
    var out = {};
    for (var k in a) out[k] = a[k];
    if (b) for (var x in b) out[x] = b[x];
    return out;
  }

  async function apiGet(path) {
    var url = baseUrl + path;
    lastPageUrl = url;
    var res = await api.http(url, { method: "GET", headers: mergeHeaders(defaultHeaders, {}) });
    if (!res || !res.ok) throw new Error("HTTP " + (res ? res.status : 0) + " for " + url);
    try {
      return JSON.parse(res.body || "{}");
    } catch (e) {
      throw new Error("Bad JSON for " + url);
    }
  }

  async function apiPost(path, inner) {
    var url = baseUrl + path;
    lastPageUrl = url;
    var headers = mergeHeaders(defaultHeaders, { "Content-Type": "application/json" });
    var res = await api.http(url, {
      method: "POST",
      headers: headers,
      body: JSON.stringify({ json: JSON.stringify(inner) })
    });
    if (!res || !res.ok) throw new Error("HTTP " + (res ? res.status : 0) + " for " + url);
    try {
      return JSON.parse(res.body || "{}");
    } catch (e) {
      throw new Error("Bad JSON for " + url);
    }
  }

  async function fetchText(url, referer) {
    lastPageUrl = url || lastPageUrl;
    var headers = {
      "User-Agent": userAgent,
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "ar,en-US;q=0.9,en;q=0.8",
      "Referer": referer || siteUrl + "/"
    };
    var res = await api.http(url, { method: "GET", headers: headers });
    if (!res || !res.ok) throw new Error("HTTP " + (res ? res.status : 0) + " for " + url);
    return res.body || "";
  }

  function cleanTitle(s) {
    return String(s || "").replace(/\s+/g, " ").trim();
  }

  function makeAbsolute(url) {
    if (!url) return "";
    url = String(url).trim();
    if (url.indexOf("http://") === 0) return "https:" + url.substring(5);
    if (url.indexOf("https://") === 0) return url;
    if (url.indexOf("//") === 0) return "https:" + url;
    if (url.indexOf("/") === 0) return siteUrl + url;
    return siteUrl + "/" + url;
  }

  function withMp4Suffix(url) {
    var u = String(url || "");
    if (!u) return "";
    if (u.indexOf(".mp4") !== -1) return u;
    return u + "#.mp4";
  }

  function budDec(bud) {
    if (!bud || bud.n <= 0) return false;
    bud.n--;
    return true;
  }

  function qualityOf(name) {
    var n = String(name || "").toUpperCase();
    if (n.indexOf("1080") !== -1) return "FHD";
    if (n.indexOf("720") !== -1) return "HD";
    if (n.indexOf("480") !== -1) return "SD";
    return null;
  }

  function listUrl(listType, page, extra) {
    var q = {
      list_type: listType,
      limit: LIST_LIMIT,
      offset: ((page || 1) - 1) * LIST_LIMIT
    };
    if (extra) {
      for (var k in extra) q[k] = extra[k];
    }
    return baseUrl + "/animes/get-published-animes?json=" + encodeURIComponent(JSON.stringify(q));
  }

  function toCard(item) {
    if (!item || !item.anime_id) return null;
    var title = cleanTitle(item.anime_name || "");
    if (!title) return null;
    return {
      title: title,
      coverUrl: makeAbsolute(item.anime_cover_image_url || ""),
      detailUrl: siteUrl + "/anime/" + item.anime_id,
      contentType: "anime"
    };
  }

  async function parseList(url) {
    var data = await apiGet(url.substring(baseUrl.length));
    var items = (data && data.response && data.response.data) || [];
    var out = [];
    var seen = {};
    for (var i = 0; i < items.length; i++) {
      var c = toCard(items[i]);
      if (c && !seen[c.detailUrl]) {
        seen[c.detailUrl] = true;
        out.push(c);
      }
    }
    return out;
  }

  function animeIdFromUrl(url) {
    var m = String(url || "").match(/\/anime\/(\d+)/);
    return m ? m[1] : "";
  }

  function parseEpisodeRef(url) {
    var m = String(url || "").match(/\/anime\/(\d+)\/episode\/(\d+)/);
    if (!m) return null;
    return { aid: m[1], num: m[2] };
  }

  function genresOf(d) {
    var g = d ? d.anime_genres : "";
    var out = [];
    if (!g) return out;
    var arr = (g instanceof Array) ? g : String(g).split(",");
    for (var i = 0; i < arr.length; i++) {
      var t = cleanTitle(arr[i]);
      if (t && out.indexOf(t) === -1) out.push(t);
    }
    return out;
  }

  async function fetchEpisodes(aid) {
    // limit:1 + episode_ids:[0] still returns the FULL list live (verified).
    var data = await apiPost("/episodes/get-episodes-new", {
      anime_id: parseInt(aid, 10) || aid,
      episode_ids: [0],
      limit: 1
    });
    var items = (data && data.response && data.response.data) || [];
    return items;
  }

  function episodeToChapter(aid, ep) {
    var num = String(ep.episode_number != null ? ep.episode_number : "0");
    return {
      number: num,
      title: "الحلقة " + num,
      url: siteUrl + "/anime/" + aid + "/episode/" + num,
      views: 0,
      isLocked: false,
      date: "",
      isFiller: false,
      thumbnailUrl: null,
      durationSeconds: null,
      servers: []
    };
  }

  // ---- direct resolvers (native playback only, fail-closed) ----

  // mediafire: file page -> kDownloadUrl / download host mp4.
  async function resolveMediafire(pageUrl, bud) {
    try {
      if (!budDec(bud)) return "";
      var html = await fetchText(pageUrl, "https://www.mediafire.com/");
      var m = html.match(/kDownloadUrl\s*=\s*"([^"]+)"/);
      var direct = m ? m[1] : "";
      if (!direct) {
        var g = html.match(/https?:\/\/download\d*\.mediafire\.com[^"'\s<>]+/);
        if (g) direct = g[0];
      }
      if (!direct || direct.indexOf("http") !== 0) return "";
      return withMp4Suffix(direct);
    } catch (e) {
      return "";
    }
  }

  // Dean Edwards packer unpack (mixdrop Wise). Pure regex + base36.
  function unpackPacker(src) {
    try {
      var m = String(src || "").match(/eval\(function\(p,a,c,k,e,d\)[\s\S]*?\}\('([\s\S]*?)',(\d+),(\d+),'([\s\S]*?)'\.split\('\|'\)/);
      if (!m) return "";
      var p = m[1], a = parseInt(m[2], 10) || 36, c = parseInt(m[3], 10) || 0;
      var k = m[4].split("|");
      function enc(n) {
        var s = "";
        do {
          var d = n % a;
          s = (d > 35 ? String.fromCharCode(d + 29) : d.toString(36)) + s;
          n = Math.floor(n / a);
        } while (n > 0);
        return s || "0";
      }
      while (c--) {
        if (k[c]) {
          var re = new RegExp("\\b" + enc(c) + "\\b", "g");
          p = p.replace(re, k[c]);
        }
      }
      return p;
    } catch (e) {
      return "";
    }
  }

  // mixdrop: /e/ page -> Wise unpack -> mp4.
  async function resolveMixdrop(embedUrl, bud) {
    try {
      if (!budDec(bud)) return "";
      var html = await fetchText(embedUrl, embedUrl);
      var up = unpackPacker(html);
      if (!up) return "";
      var m = up.match(/(https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*)/);
      if (m) return m[1];
      var g = html.match(/(https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*)/);
      return g ? g[1] : "";
    } catch (e) {
      return "";
    }
  }

  // streamtape: page -> videolink robot -> mp4.
  async function resolveStreamtape(embedUrl, bud) {
    try {
      if (!budDec(bud)) return "";
      var html = await fetchText(embedUrl, embedUrl);
      var m = html.match(/getElementById\(['"]videoolink['"]\)[^>]*>([^<]+)</) ||
        html.match(/id=['"]videoolink['"][^>]*value=['"]([^'"]+)/) ||
        html.match(/robotlink['"]?\s*[:=]\s*['"]([^'"]+)/);
      var link = m ? cleanTitle(m[1]) : "";
      if (!link) {
        var g = html.match(/(https?:\/\/[^\s"'<>]*streamtape[^\s"'<>]*\.mp4[^\s"'<>]*)/);
        return g ? g[1] : "";
      }
      if (link.indexOf("http") !== 0) {
        if (link.indexOf("//") === 0) link = "https:" + link;
        else return "";
      }
      if (!budDec(bud)) return "";
      var html2 = await fetchText(link, embedUrl);
      var g2 = html2.match(/(https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*)/);
      return g2 ? g2[1] : "";
    } catch (e) {
      return "";
    }
  }

  // ok.ru: STATIC EXTRACTION DEAD (verified 2026-09-21: video/videoembed
  // pages carry zero media even with session cookies; metadata needs
  // authenticated XHR). Dropped like mega/hgcloud — app WebView only.

  // drive: passthrough only when the share link is alive (many are
  // deleted: "Page Not Found"). 1 cheap GET, fail-closed.
  async function driveAlive(url, bud) {
    try {
      if (!budDec(bud)) return false;
      var html = await fetchText(url, "https://drive.google.com/");
      if (!html || html.length < 2000) return false;
      if (html.indexOf("Page Not Found") !== -1) return false;
      if (html.indexOf("no longer available") !== -1) return false;
      if (html.indexOf("cannot be found") !== -1) return false;
      // Positive marker required: live file pages embed viewer/download refs.
      if (html.indexOf("/file/d/") === -1 && html.indexOf("downloadUrl") === -1 &&
        html.indexOf("viewerng") === -1) return false;
      return true;
    } catch (e) {
      return false;
    }
  }

  var DROP_HOSTS = ["vidlox", "fembed", "uptostream", "jawcloud", "streamvid",
    "streamhub", "highstream", "tune.pk", "krakenfiles", "pixeldrain"];

  function dropHost(url) {
    var u = String(url || "").toLowerCase();
    for (var i = 0; i < DROP_HOSTS.length; i++) {
      if (u.indexOf(DROP_HOSTS[i]) !== -1) return true;
    }
    return false;
  }

  function isDrive(url) {
    return String(url || "").toLowerCase().indexOf("drive.google") !== -1;
  }

  // muilt: merge official + mirror link lists, dedup.
  async function fetchMuiltLinks(n, bud) {
    var seen = {};
    var out = [];
    // NOTE: official mirror lives on siteUrl (/la/...), NOT under baseUrl
    // (/anime/public/la/... 404s). ALT_API is the a-reslayer mirror.
    var urls = [
      siteUrl + "/la/public/api/f2?n=" + encodeURIComponent(n),
      ALT_API + "?n=" + encodeURIComponent(n)
    ];
    for (var i = 0; i < urls.length; i++) {
      try {
        if (bud && !budDec(bud)) break;
        var res = await api.http(urls[i], {
          method: "GET",
          headers: {
            "User-Agent": userAgent,
            "Accept": "application/json",
            "Referer": siteUrl + "/"
          }
        });
        if (!res || !res.ok) continue;
        var arr = null;
        try {
          arr = JSON.parse(res.body || "[]");
        } catch (e) {}
        if (!(arr instanceof Array)) continue;
        for (var j = 0; j < arr.length; j++) {
          var u = makeAbsolute(arr[j]);
          if (u && !seen[u]) {
            seen[u] = true;
            out.push(u);
          }
        }
      } catch (e) {}
    }
    return out;
  }

  function serverNameFor(url) {
    var u = String(url || "").toLowerCase();
    if (u.indexOf("mediafire") !== -1) return "mediafire";
    if (u.indexOf("mixdrop") !== -1) return "mixdrop";
    if (u.indexOf("streamtape") !== -1) return "streamtape";
    if (u.indexOf("ok.ru") !== -1) return "ok";
    if (u.indexOf("drive.google") !== -1) return "drive";
    if (u.indexOf("voe") !== -1) return "voe";
    if (u.indexOf("videa") !== -1) return "videa";
    if (u.indexOf("dood") !== -1) return "dood";
    if (u.indexOf("mp4upload") !== -1) return "mp4upload";
    if (u.indexOf("uqload") !== -1) return "uqload";
    if (u.indexOf("vkvideo") !== -1 || u.indexOf("vk.com") !== -1) return "vk";
    return "سيرفر";
  }

  async function decodeEpisodeServers(aid, num) {
    var out = [];
    try {
      var eps = await fetchEpisodes(aid);
      var ep = null;
      for (var i = 0; i < eps.length; i++) {
        if (String(eps[i].episode_number) === String(num)) {
          ep = eps[i];
          break;
        }
      }
      if (!ep) return [];
      var muiltN = "";
      var urls = ep.episode_urls || [];
      for (var u = 0; u < urls.length; u++) {
        var nm = (urls[u] && urls[u].episode_server_name) || "";
        if (nm === "muilt" && urls[u].episode_url) {
          var mm = String(urls[u].episode_url).match(/[?&]n=([^&]+)/);
          if (mm) muiltN = decodeURIComponent(mm[1]);
        }
      }
      if (!muiltN) return [];
      // Resolution budget max 14 fetches + soft 12s deadline.
      var bud = { n: 14 };
      var t0 = 0;
      try {
        t0 = new Date().getTime();
      } catch (e0) {}
      function deadlineHit() {
        try {
          if (!t0) return false;
          return (new Date().getTime() - t0) > 12000;
        } catch (e) {
          return false;
        }
      }
      var links = await fetchMuiltLinks(muiltN, bud);
      // Cost order: drive liveness-check is free-ish (no media fetch).
      var first = [];
      var mid = [];
      for (var o = 0; o < links.length; o++) {
        if (isDrive(links[o])) first.push(links[o]);
        else mid.push(links[o]);
      }
      links = first.concat(mid);
      var idx = 0;
      for (var l = 0; l < links.length; l++) {
        if (deadlineHit()) break;
        var link = links[l];
        if (dropHost(link)) continue;
        var durl = "";
        var stype = "mp4";
        var label = serverNameFor(link);
        try {
          if (isDrive(link)) {
            // Drive is resolved natively by the app extractor: passthrough
            // only when alive (many shares are deleted).
            if (await driveAlive(link, bud)) {
              out.push({
                id: "drive-" + idx,
                name: "drive",
                embedUrl: link,
                url: link,
                type: "embed",
                quality: null,
                headers: { "Referer": "https://drive.google.com/", "User-Agent": userAgent }
              });
              idx++;
            }
            continue;
          } else if (label === "mediafire") {
            durl = await resolveMediafire(link, bud);
          } else if (label === "mixdrop") {
            durl = await resolveMixdrop(link, bud);
          } else if (label === "streamtape") {
            durl = await resolveStreamtape(link, bud);
          } else if (label === "ok") {
            // Static ok.ru extraction verified dead (needs session XHR).
            continue;
          } else {
            continue;
          }
        } catch (e) {}
        if (!durl) continue;
        rememberMedia(durl, link);
        out.push({
          id: "sl-" + idx,
          name: label,
          embedUrl: link,
          url: link,
          directUrl: durl,
          type: "mp4",
          quality: qualityOf(label),
          headers: { "Referer": link, "User-Agent": userAgent }
        });
        idx++;
      }
    } catch (e) {}
    return out;
  }

  return {
    requiresCloudflare: false,

    async getHomepageManga(args) {
      try {
        var page = (args && args.page) || 1;
        return await parseList(listUrl("anime_list", page));
      } catch (e) {
        return [];
      }
    },

    async search(args) {
      try {
        var query = (args && args.query) || "";
        if (!query.trim()) return [];
        var page = (args && args.page) || 1;
        return await parseList(listUrl("anime_list", page, { anime_name: query }));
      } catch (e) {
        return [];
      }
    },

    async getMangaDetails(args) {
      var url = makeAbsolute((args && args.url) || "");
      var aid = animeIdFromUrl(url);
      if (!aid) throw new Error("Bad anime URL: " + url);
      var data = await apiGet("/anime/get-anime-details?anime_id=" + encodeURIComponent(aid) +
        "&fetch_episodes=Yes&more_info=Yes");
      var d = (data && data.response) || {};
      if (!d.anime_id) throw new Error("Anime not found: " + aid);
      var eps = await fetchEpisodes(aid);
      var chapters = [];
      var seen = {};
      for (var i = 0; i < eps.length; i++) {
        var ch = episodeToChapter(aid, eps[i]);
        if (!seen[ch.url]) {
          seen[ch.url] = true;
          chapters.push(ch);
        }
      }
      chapters.sort(function (a, b) {
        return (parseFloat(b.number) || 0) - (parseFloat(a.number) || 0);
      });
      var cover = d.anime_cover_image_full_url || d.anime_cover_image_url || "";
      return {
        title: cleanTitle(d.anime_name || "") || "غير معروف",
        coverUrl: makeAbsolute(cover),
        description: cleanTitle(d.anime_description || ""),
        genres: genresOf(d),
        status: cleanTitle(d.anime_status || ""),
        chapters: chapters,
        originalUrl: url,
        hasMoreChapters: false,
        lastFetchedPage: 1,
        contentType: "anime",
        animeType: cleanTitle(d.anime_type || "") || null,
        season: cleanTitle(d.anime_season || "") || null,
        year: cleanTitle(d.anime_release_year ? String(d.anime_release_year) : "") || null,
        episodeDurationMin: null,
        sourceMaterial: null,
        trailerUrl: makeAbsolute(d.anime_trailer_url || "") || null,
        malUrl: null
      };
    },

    async getChapterPages() {
      return [];
    },

    async getChapterContent(args) {
      try {
        var url = makeAbsolute((args && args.url) || "");
        var ref = parseEpisodeRef(url);
        if (ref) {
          var servers = await this.getEpisodeServers({ url: url });
          return { kind: "video", servers: servers };
        }
        return { kind: "image", imageUrls: [] };
      } catch (e) {
        return { kind: "image", imageUrls: [] };
      }
    },

    async getEpisodeServers(args) {
      try {
        var url = makeAbsolute((args && args.url) || "");
        var ref = parseEpisodeRef(url);
        if (!ref) return [];
        return await decodeEpisodeServers(ref.aid, ref.num);
      } catch (e) {
        return [];
      }
    },

    async resolveServer(args) {
      try {
        var serverUrl = makeAbsolute((args && (args.serverUrl || args.url)) || "");
        if (!serverUrl) return null;
        return {
          url: serverUrl,
          type: "embed",
          headers: {
            "User-Agent": userAgent,
            "Referer": siteUrl + "/",
            "Accept": "*/*",
            "Accept-Language": "ar,en-US;q=0.9,en;q=0.8"
          }
        };
      } catch (e) {
        return null;
      }
    },

    async getFilteredManga(args) {
      try {
        // No GET filter routes on this API (dropdowns are Livewire-side):
        // downgrade to the browse list instead of returning nothing.
        var page = (args && args.page) || 1;
        return await parseList(listUrl("anime_list", page));
      } catch (e) {
        return [];
      }
    },

    async getGenresAndTypes() {
      return { genres: defaultGenres, types: defaultTypes };
    },

    async fetchMoreChapters() {
      // Episode lists ship complete inside get-episodes-new.
      return null;
    },

    getImageHeaders() {
      return {
        "User-Agent": userAgent,
        "Referer": lastPageUrl || siteUrl + "/",
        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "Accept-Language": "ar,en-US;q=0.9,en;q=0.8",
        "Sec-Fetch-Dest": "image",
        "Sec-Fetch-Mode": "no-cors",
        "Sec-Fetch-Site": "cross-site"
      };
    },

    getVideoHeaders(args) {
      return videoHeadersFor(args && args.url);
    },

    sanitizeCoverUrl(args) {
      return makeAbsolute((args && args.url) || "");
    }
  };
}

if (typeof module !== "undefined") module.exports = { createSource: createSource };
