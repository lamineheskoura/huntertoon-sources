function createSource(api, config) {
  var baseUrl = ((config && config.base_url) || "https://anime3rb.com").replace(/\/+$/, "");
  var configHeaders = (config && config.headers) || {};
  var userAgent =
    configHeaders["User-Agent"] ||
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
  var lastPageUrl = baseUrl + "/";

  var defaultHeaders = {
    "User-Agent": userAgent,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "ar,en-US;q=0.9,en;q=0.8",
    "Referer": baseUrl + "/",
    "Origin": baseUrl,
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "same-origin",
    "Upgrade-Insecure-Requests": "1"
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

  // Arabic genre name -> site english slug (verified live slugs).
  var GENRE_SLUG = {
    "أكشن": "action",
    "مغامرات": "adventure",
    "رومانسي": "romance",
    "كوميدي": "comedy",
    "خيال": "fantasy",
    "دراما": "drama",
    "شونين": "shounen",
    "سينين": "seinen",
    "مدرسي": "school",
    "رعب": "horror",
    "غموض": "mystery",
    "نفسي": "psychological",
    "رياضي": "sports",
    "موسيقى": "music",
    "لعبة": "game",
    "مصاصي دماء": "vampire",
    "شياطين": "demons",
    "سحر": "magic",
    "شوجو": "shoujo",
    "خيال علمي": "sci-fi",
    "شريحة من الحياة": "slice-of-life",
    "تاريخي": "historical",
    "عسكري": "military",
    "فضاء": "space",
    "ساموراي": "samurai",
    "تحقيق": "detective",
    "ايسيكاي": "isekai",
    "فنون قتالية": "martial-arts",
    "خارق للطبيعة": "supernatural"
  };

  var TYPE_SLUGS = ["tv", "movie", "ova", "ona", "special", "tv-special",
    "music", "cm", "pv", "unknown"];

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
    if (u.indexOf("vid3rb.com") !== -1) return baseUrl + "/";
    if (u.indexOf("anime3rb.com") !== -1) return baseUrl + "/";
    return "";
  }

  function videoHeadersFor(url) {
    var u = String(url || "");
    var ref = mediaHeaders[u] || mediaHeaders[u.split("#")[0]] || embedRefererFor(u) || baseUrl + "/";
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

  async function fetchHtml(url, extraHeaders, method) {
    lastPageUrl = url || lastPageUrl;
    var headers = mergeHeaders(defaultHeaders, extraHeaders);
    if (api.http) {
      var res = await api.http(url, { method: method || "GET", headers: headers });
      if (!res || !res.ok) throw new Error("HTTP " + (res ? res.status : 0) + " for " + url);
      return res.body || "";
    }
    if (method && method !== "GET") return "";
    var html = await api.fetchText(url, headers);
    if (!html) throw new Error("Empty response: " + url);
    return html;
  }

  function cleanTitle(s) {
    return String(s || "").replace(/\s+/g, " ").trim();
  }

  function stripTags(s) {
    return cleanTitle(String(s || "").replace(/<[^>]*>/g, " "));
  }

  function unescapeHtml(s) {
    return String(s || "")
      .replace(/&quot;/g, "\"")
      .replace(/&#39;/g, "'")
      .replace(/&#x27;/g, "'")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");
  }

  function makeAbsolute(url) {
    if (!url) return "";
    url = String(url).trim();
    if (url.indexOf("http://") === 0) return "https:" + url.substring(5);
    if (url.indexOf("https://") === 0) return url;
    if (url.indexOf("//") === 0) return "https:" + url;
    if (url.indexOf("/") === 0) return baseUrl + url;
    return baseUrl + "/" + url;
  }

  function withMp4Suffix(url) {
    var u = String(url || "");
    if (!u) return "";
    if (u.indexOf(".mp4") !== -1) return u;
    return u + "#.mp4";
  }

  function parseEpisodeNumber(url, label) {
    var m = String(url || "").match(/\/(\d+)\/?(?:[?#]|$)/);
    if (m) return m[1];
    var m2 = String(label || "").match(/الحلقة\s*(\d+)/);
    if (m2) return m2[1];
    var m3 = String(label || "").match(/(\d+)/);
    if (m3) return m3[1];
    return "0";
  }

  function qualityOf(name) {
    var m = String(name || "").match(/(\d{3,4})\s*p/i);
    if (m) return m[1] + "p";
    var n = String(name || "").toUpperCase();
    if (n.indexOf("1080") !== -1) return "1080p";
    if (n.indexOf("720") !== -1) return "720p";
    if (n.indexOf("480") !== -1) return "480p";
    if (n.indexOf("HEVC") !== -1) return "1080p HEVC";
    return null;
  }

  function budDec(bud) {
    if (!bud || bud.n <= 0) return false;
    bud.n--;
    return true;
  }

  // ---- card parser (list / genre / type / search pages share markup) ----

  async function parseAnimeCards(html) {
    var anchors = [];
    try {
      anchors = await api.cssAll(html, "a[href*='/titles/']") || [];
    } catch (e) {}
    var out = [];
    var seen = {};
    for (var i = 0; i < anchors.length; i++) {
      var item = anchors[i] || {};
      var attrs = item.attrs || {};
      var inner = item.html || "";
      var href = attrs.href || "";
      if (!href) continue;
      // Skip nav/filter links, keep title slugs only.
      if (href.indexOf("/titles/list") !== -1) continue;
      if (!/\/titles\/[a-z0-9\-]+\/?$/i.test(href.split("?")[0])) continue;
      var detailUrl = makeAbsolute(href);
      if (seen[detailUrl]) continue;
      seen[detailUrl] = true;
      var title = "";
      try {
        title = unescapeHtml(cleanTitle(await api.cssText(inner, "h2"))) || "";
      } catch (e) {}
      if (!title) {
        try {
          title = unescapeHtml(cleanTitle(await api.cssText(inner, "h3"))) || "";
        } catch (e) {}
      }
      if (!title) {
        try {
          title = unescapeHtml(cleanTitle(await api.cssAttr(inner, "img", "alt"))) || "";
        } catch (e) {}
      }
      if (!title) continue;
      var cover = "";
      try {
        cover = makeAbsolute(await api.cssAttr(inner, "img", "src") || "");
      } catch (e) {}
      if (!cover) {
        try {
          cover = makeAbsolute(await api.cssAttr(inner, "img", "data-src") || "");
        } catch (e) {}
      }
      out.push({
        title: title,
        coverUrl: cover,
        detailUrl: detailUrl,
        contentType: "anime"
      });
      if (out.length > 300) break;
    }
    return out;
  }

  // ---- anime / movie details ----

  async function parseAnimeDetails(html, url) {
    html = String(html || "");
    var title = "";
    try {
      title = unescapeHtml(cleanTitle(await api.cssText(html, "h1"))) || "";
    } catch (e) {}
    if (!title) {
      try {
        title = unescapeHtml(cleanTitle(await api.cssAttr(html, "meta[property='og:title']", "content"))) || "";
      } catch (e) {}
    }
    var cover = "";
    try {
      cover = makeAbsolute(await api.cssAttr(html, "meta[property='og:image']", "content") || "");
    } catch (e) {}
    var description = "";
    try {
      description = unescapeHtml(cleanTitle(await api.cssAttr(html, "meta[name='description']", "content"))) || "";
    } catch (e) {}
    if (!description) {
      var dm = html.match(/<p[^>]*class="[^"]*leading-loose[^"]*"[^>]*>([\s\S]*?)<\/p>/);
      if (dm) description = unescapeHtml(stripTags(dm[1]));
    }
    var genres = [];
    try {
      var gl = await api.cssList(html, "a[href*='/genre/']") || [];
      for (var gi = 0; gi < gl.length; gi++) {
        var g = unescapeHtml(cleanTitle(gl[gi]));
        if (g && genres.indexOf(g) === -1) genres.push(g);
      }
    } catch (e) {}
    if (!genres.length) {
      var gre = /<a[^>]+href="[^"]*\/genre\/[^"]*"[^>]*>([^<]*)<\/a>/g, gm;
      while ((gm = gre.exec(html)) !== null) {
        var gt = unescapeHtml(cleanTitle(gm[1]));
        if (gt && genres.indexOf(gt) === -1) genres.push(gt);
      }
    }

    var status = "", year = "", animeType = "", season = "";
    var infoText = "";
    try {
      infoText = await api.cssText(html, "table") || "";
    } catch (e) {}
    var blob = infoText + "\n" + stripTags(html.match(/<table[\s\S]*?<\/table>/) ? html.match(/<table[\s\S]*?<\/table>/)[0] : "");
    var ym = blob.match(/(19|20)\d{2}/);
    year = ym ? ym[0] : "";
    if (blob.indexOf("مستمر") !== -1 || blob.indexOf("قيد البث") !== -1) status = "مستمر";
    else if (blob.indexOf("منتهي") !== -1 || blob.indexOf("مكتمل") !== -1) status = "مكتمل";
    var sm = blob.match(/(شتاء|ربيع|صيف|خريف)/);
    season = sm ? sm[1] : "";
    if (/\( *مسلسل *\)/.test(html)) animeType = "TV";
    else if (/\( *فيلم *\)/.test(html)) animeType = "Movie";
    else if (/\( *أوفا *\)|\( *ova *\)/i.test(html)) animeType = "OVA";

    var trailerUrl = "";
    try {
      trailerUrl = makeAbsolute(await api.cssAttr(html, "a[href*='youtube']", "href") || "");
    } catch (e) {}

    var episodes = parseEpisodes(html, title);
    // Movie with embedded player but no episode links: single entry so
    // playback still resolves from the details page itself.
    if (!episodes.length) {
      var hasPlayer = /video_url|video\.vid3rb\.com\/player|ld\+json/i.test(html);
      if (hasPlayer) {
        episodes.push({
          number: "1",
          title: "فيلم " + (title || ""),
          url: url,
          views: 0,
          isLocked: false,
          date: "",
          isFiller: false,
          thumbnailUrl: null,
          durationSeconds: null,
          servers: []
        });
      }
    }

    return {
      title: title || "غير معروف",
      coverUrl: cover,
      description: description,
      genres: genres,
      status: status,
      chapters: episodes,
      originalUrl: url,
      hasMoreChapters: false,
      lastFetchedPage: 1,
      contentType: "anime",
      animeType: animeType || null,
      season: season || null,
      year: year || null,
      episodeDurationMin: null,
      sourceMaterial: null,
      trailerUrl: trailerUrl || null,
      malUrl: null
    };
  }

  function parseEpisodes(html, title) {
    var out = [];
    var seen = {};
    var re = /<a[^>]+href="([^"]*\/episode\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    var m;
    while ((m = re.exec(String(html || ""))) !== null) {
      var epUrl = makeAbsolute(m[1]);
      if (!epUrl || seen[epUrl]) continue;
      seen[epUrl] = true;
      var label = unescapeHtml(stripTags(m[2]));
      var num = parseEpisodeNumber(epUrl, label);
      out.push({
        number: String(num),
        title: label.indexOf("الحلقة") !== -1 ? label : ("الحلقة " + num),
        url: epUrl,
        views: 0,
        isLocked: false,
        date: "",
        isFiller: false,
        thumbnailUrl: null,
        durationSeconds: null,
        servers: []
      });
      if (out.length > 3000) break;
    }
    out.sort(function (a, b) {
      return (parseFloat(b.number) || 0) - (parseFloat(a.number) || 0);
    });
    return out;
  }

  function streamToken(url) {
    var m = String(url || "").match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
    return (m && m[1]) || "";
  }

  // ---- episode servers (first-party vid3rb chain, verified live) ----
  // GET {watchUrl} -> snapshot video_url (player uuid + token + expires)
  // -> GET player page -> JSON srcs per quality (mp4)
  // -> targets 302 to files.vid3rb.com mp4 (Range 206 proven).
  // Tokens are short-lived: always resolved fresh, never stored.

  function playerUrlsFromPage(html, watchUrl) {
    // Snapshots are HTML-entity encoded (&quot;, \/, &amp;) — decode first.
    var h = unescapeHtml(String(html || "")).replace(/\\\//g, "/");
    var out = [];
    var m = h.match(/video_url"\s*:\s*"([^"]+)"/) || h.match(/video_url\s*[:=]\s*["']([^"']+)["']/);
    if (m) out.push(m[1]);
    var re = /https?:\/\/video\.vid3rb\.com\/player\/[a-z0-9\-]+\?[^"'\s<>]*/gi, g;
    while ((g = re.exec(h)) !== null) {
      out.push(g[0]);
    }
    var ld = h.match(/"embedUrl"\s*:\s*"([^"]+)"/);
    if (ld) out.push(ld[1].replace(/\\\//g, "/"));
    var seen = {};
    var uniq = [];
    for (var i = 0; i < out.length; i++) {
      var u = String(out[i]).replace(/\\\//g, "/");
      if (u.indexOf("//") === 0) u = "https:" + u;
      if (u && !seen[u]) {
        seen[u] = true;
        uniq.push(u);
      }
    }
    return uniq;
  }

  function playerSrcsFromBody(body) {
    var out = [];
    var h = String(body || "");
    // Best: video_sources JSON array [{src,type,label,res,premium}].
    // NOTE: the page declares `video_sources = [];` first — take the
    // longest populated match, not the first empty one.
    var reA = /var\s+video_sources\s*=\s*(\[[\s\S]*?\])\s*;/g, ma;
    var best = "";
    while ((ma = reA.exec(h)) !== null) {
      if (ma[1].length > best.length) best = ma[1];
    }
    if (best) {
      var arr = null;
      try {
        arr = JSON.parse(best);
      } catch (e) {}
      if (arr instanceof Array) {
        for (var i = 0; i < arr.length; i++) {
          var src = cleanTitle((arr[i] && arr[i].src) || "");
          if (!src) continue;
          if (src.indexOf("//") === 0) src = "https:" + src;
          var lb = cleanTitle((arr[i] && arr[i].label) || "");
          out.push({ label: lb, url: src });
        }
        if (out.length) return out;
      }
    }
    // Player JSON: "1080p": {"src": "https://video.vid3rb.com/video/..."} style
    // and flat "NNNp": "url" pairs.
    var re = /"(1080p|720p|480p|360p|2160p)"\s*:\s*(\{[^{}]*\}|"[^"]+")/g, m;
    while ((m = re.exec(h)) !== null) {
      var chunk = m[2];
      var sm = chunk.match(/"src"\s*:\s*"([^"]+)"/) || chunk.match(/"(https?:[^"]+)"/);
      if (sm) {
        var u = sm[1].replace(/\\\//g, "/");
        if (u.indexOf("//") === 0) u = "https:" + u;
        out.push({ label: m[1], url: u });
      }
    }
    if (!out.length) {
      var g2 = h.match(/https?:\/\/video\.vid3rb\.com\/video\/[a-z0-9\-]+\?[^"'\s<>]*/gi) || [];
      for (var i = 0; i < g2.length; i++) {
        out.push({ label: "", url: g2[i].replace(/\\\//g, "/") });
      }
    }
    return out;
  }

  function heightOf(label) {
    var m = String(label || "").match(/(\d{3,4})/);
    return m ? (parseInt(m[1], 10) || 0) : 0;
  }

  async function decodeEpisodeServers(watchUrl) {
    var out = [];
    try {
      var html = await fetchHtml(watchUrl);
      // Resolution budget: episode + player + margin.
      var bud = { n: 8 };
      var t0 = 0;
      try {
        t0 = new Date().getTime();
      } catch (e0) {}
      var players = playerUrlsFromPage(html, watchUrl);
      var quals = [];
      var seenQ = {};
      for (var p = 0; p < players.length; p++) {
        if (bud.n <= 0) break;
        if (t0) {
          var nowMs = 0;
          try {
            nowMs = new Date().getTime();
          } catch (e1) {}
          if (nowMs && nowMs - t0 > 12000) break;
        }
        var srcs = [];
        try {
          bud.n--;
          var body = await fetchHtml(players[p], { "Referer": watchUrl });
          srcs = playerSrcsFromBody(body);
        } catch (e) {}
        for (var s = 0; s < srcs.length; s++) {
          var su = srcs[s].url || "";
          if (!su || seenQ[su]) continue;
          seenQ[su] = true;
          var h = heightOf(srcs[s].label);
          quals.push({ label: srcs[s].label || (h ? (h + "p") : "HD"), url: su, height: h });
        }
        if (quals.length >= 4) break;
      }
      if (!quals.length) return [];
      quals.sort(function (a, b) { return b.height - a.height; });
      var qh = [];
      for (var q = 0; q < quals.length; q++) {
        var durl = withMp4Suffix(quals[q].url);
        qh.push({
          label: quals[q].label,
          url: durl,
          height: quals[q].height,
          isDefault: q === 0,
          headers: { "Referer": watchUrl, "User-Agent": userAgent }
        });
        rememberMedia(durl, watchUrl);
        rememberMedia(quals[q].url, watchUrl);
      }
      out.push({
        id: streamToken(quals[0].url) || "vid3rb",
        name: "vid3rb",
        embedUrl: players[0] || watchUrl,
        url: players[0] || watchUrl,
        directUrl: qh[0].url,
        type: "mp4",
        quality: qh[0].label,
        qualities: qh,
        selectedQualityIndex: 0,
        headers: { "Referer": watchUrl, "User-Agent": userAgent }
      });
    } catch (e) {}
    return out;
  }

  function watchUrlFromEpisode(episodeUrl) {
    return String(episodeUrl || "");
  }

  return {
    requiresCloudflare: false,

    async getHomepageManga(args) {
      try {
        var page = (args && args.page) || 1;
        return await parseAnimeCards(await fetchHtml(baseUrl + "/titles/list?page=" + page));
      } catch (e) {
        return [];
      }
    },

    async search(args) {
      try {
        var query = (args && args.query) || "";
        if (!query.trim()) return [];
        // Native /search is CF-challenged (403 live); the list filter is
        // proven ignored, so only the native route is attempted (fail-closed
        // on challenge) to avoid fake results.
        var html = await fetchHtml(baseUrl + "/search?q=" + encodeURIComponent(query));
        return await parseAnimeCards(html);
      } catch (e) {
        return [];
      }
    },

    async getMangaDetails(args) {
      var url = makeAbsolute((args && args.url) || "");
      try {
        if (url.indexOf("/episode/") !== -1) {
          var slugm = url.match(/\/episode\/([^\/?#]+)/);
          var parent = slugm ? (baseUrl + "/titles/" + slugm[1]) : "";
          if (parent) return await parseAnimeDetails(await fetchHtml(parent), parent);
          var epHtml = await fetchHtml(url);
          var epTitle = "";
          try {
            epTitle = unescapeHtml(cleanTitle(await api.cssText(epHtml, "h1"))) || url;
          } catch (e) {
            epTitle = url;
          }
          return {
            title: epTitle,
            coverUrl: "",
            description: "",
            genres: [],
            status: "",
            chapters: [{
              number: parseEpisodeNumber(url, epTitle),
              title: epTitle,
              url: url,
              views: 0,
              isLocked: false,
              date: "",
              isFiller: false,
              thumbnailUrl: null,
              durationSeconds: null,
              servers: []
            }],
            originalUrl: url,
            hasMoreChapters: false,
            lastFetchedPage: 1,
            contentType: "anime"
          };
        }
        return await parseAnimeDetails(await fetchHtml(url), url);
      } catch (e) {
        return {
          title: "غير معروف",
          coverUrl: "",
          description: "",
          genres: [],
          status: "",
          chapters: [],
          originalUrl: url,
          hasMoreChapters: false,
          lastFetchedPage: 1,
          contentType: "anime"
        };
      }
    },

    async getChapterPages() {
      // Anime episodes have no image pages — compat stub for the manga path.
      return [];
    },

    async getChapterContent(args) {
      try {
        var url = makeAbsolute((args && args.url) || "");
        if (url.indexOf("/episode/") !== -1 || url.indexOf("/titles/") !== -1) {
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
        if (!url) return [];
        // Movie/title pages carry their own player snapshot.
        if (url.indexOf("/episode/") !== -1 || url.indexOf("/titles/") !== -1) {
          return await decodeEpisodeServers(watchUrlFromEpisode(url));
        }
        return [];
      } catch (e) {
        return [];
      }
    },

    async resolveServer(args) {
      try {
        var serverUrl = makeAbsolute((args && (args.serverUrl || args.url)) || "");
        if (!serverUrl) return null;
        // Closed allow-list: first-party player/CDN + site only.
        var u = serverUrl.toLowerCase();
        var okHost = u.indexOf("vid3rb.com") !== -1 || u.indexOf("anime3rb.com") !== -1;
        if (!okHost) return null;
        return {
          url: serverUrl,
          type: "embed",
          headers: {
            "User-Agent": userAgent,
            "Referer": baseUrl + "/",
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
        var page = (args && args.page) || 1;
        var genre = cleanTitle((args && args.genre) || "");
        var type = cleanTitle((args && args.type) || "");
        var slug = "";
        if (genre && GENRE_SLUG[genre]) {
          return await parseAnimeCards(await fetchHtml(baseUrl + "/genre/" + GENRE_SLUG[genre] + "?page=" + page));
        }
        if (genre && /^[a-z0-9\-]+$/i.test(genre)) {
          slug = genre.toLowerCase();
          return await parseAnimeCards(await fetchHtml(baseUrl + "/genre/" + slug + "?page=" + page));
        }
        if (type) {
          var t = type.toLowerCase();
          var hit = "";
          for (var i = 0; i < TYPE_SLUGS.length; i++) {
            if (t === TYPE_SLUGS[i] || t.indexOf(TYPE_SLUGS[i]) !== -1 ||
              (TYPE_SLUGS[i] === "movie" && type.indexOf("فيلم") !== -1)) {
              hit = TYPE_SLUGS[i];
              break;
            }
          }
          if (hit) {
            return await parseAnimeCards(await fetchHtml(baseUrl + "/titles/list/" + hit + "?page=" + page));
          }
        }
        return await parseAnimeCards(await fetchHtml(baseUrl + "/titles/list?page=" + page));
      } catch (e) {
        return [];
      }
    },

    async getGenresAndTypes() {
      return { genres: defaultGenres, types: defaultTypes };
    },

    async fetchMoreChapters() {
      // Episode lists ship complete inside the title page.
      return null;
    },

    getImageHeaders() {
      return {
        "User-Agent": userAgent,
        "Referer": lastPageUrl || baseUrl + "/",
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
