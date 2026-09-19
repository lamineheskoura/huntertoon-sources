function createSource(api, config) {
  var baseUrl = ((config && config.base_url) || "https://witanime.site").replace(/\/+$/, "");
  var configHeaders = (config && config.headers) || {};
  var userAgent =
    configHeaders["User-Agent"] ||
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
  var lastPageUrl = baseUrl + "/";

  // Minimal cookie jar: the Laravel backend gates POST /watch/.../sources
  // behind session cookies (XSRF-TOKEN + witanime-session) + X-CSRF-TOKEN.
  // GET without cookies -> POST returns 419; direct GET of sources -> 404.
  var cookieJar = "";

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

  // Anime-Online-Theme filter vocab (verified live on /قائمة-الانمي/).
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

  function mergeHeaders(a, b) {
    var out = {};
    for (var k in a) out[k] = a[k];
    if (b) for (var x in b) out[x] = b[x];
    return out;
  }

  function rememberCookies(res) {
    try {
      var headers = (res && res.headers) || {};
      var raw = headers["set-cookie"] || headers["Set-Cookie"] || headers["SET-COOKIE"] || "";
      if (!raw) {
        for (var k in headers) {
          if (String(k).toLowerCase() === "set-cookie") {
            raw = headers[k];
            break;
          }
        }
      }
      var parts = [];
      if (raw instanceof Array) {
        parts = raw;
      } else if (raw) {
        parts = String(raw).split(/\n/);
      }
      var store = {};
      var i, j;
      var existing = String(cookieJar || "").split(/;\s*/);
      for (i = 0; i < existing.length; i++) {
        var kv = existing[i].split("=");
        if (kv.length >= 2 && kv[0]) store[kv[0]] = existing[i].substring(kv[0].length + 1);
      }
      for (i = 0; i < parts.length; i++) {
        var first = String(parts[i] || "").split(";")[0].trim();
        var eq = first.indexOf("=");
        if (eq > 0) store[first.substring(0, eq).trim()] = first.substring(eq + 1).trim();
      }
      var out = [];
      for (j in store) {
        if (store[j]) out.push(j + "=" + store[j]);
      }
      cookieJar = out.join("; ");
    } catch (e) {}
  }

  function withCookies(headers) {
    var out = mergeHeaders({}, headers);
    if (cookieJar) out["Cookie"] = cookieJar;
    return out;
  }

  async function fetchHtml(url, extraHeaders, method, body) {
    lastPageUrl = url || lastPageUrl;
    var headers = withCookies(mergeHeaders(defaultHeaders, extraHeaders));
    if (api.http) {
      var res = await api.http(url, { method: method || "GET", headers: headers, body: body });
      if (!res || !res.ok) throw new Error("HTTP " + (res ? res.status : 0) + " for " + url);
      rememberCookies(res);
      return res.body || "";
    }
    if (method && method !== "GET") return "";
    var html = await api.fetchText(url, headers);
    if (!html) throw new Error("Empty response: " + url);
    return html;
  }

  async function fetchJson(url, extraHeaders, method, body) {
    var headers = withCookies(mergeHeaders({
      "User-Agent": userAgent,
      "Accept": "application/json",
      "Accept-Language": "ar,en-US;q=0.9,en;q=0.8",
      "Referer": lastPageUrl || (baseUrl + "/")
    }, extraHeaders));
    if (!api.http) throw new Error("No http bridge for " + url);
    var res = await api.http(url, { method: method || "GET", headers: headers, body: body });
    rememberCookies(res);
    if (!res || !res.ok) throw new Error("HTTP " + (res ? res.status : 0) + " for " + url);
    try {
      return JSON.parse(res.body || "{}");
    } catch (e) {
      throw new Error("Bad JSON for " + url);
    }
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

  function parseEpisodeNumber(url) {
    var m = String(url || "").match(/\/watch\/[^/?#]+\/(\d+)/);
    if (m) return m[1];
    var m2 = String(url || "").match(/الحلقة-(\d+)/);
    if (m2) return m2[1];
    return "0";
  }

  function qualityOf(serverName) {
    var n = String(serverName || "").toUpperCase();
    if (n.indexOf("4K") !== -1) return "4K";
    if (n.indexOf("FHD") !== -1 || n.indexOf("1080") !== -1) return "FHD";
    if (n.indexOf("HD") !== -1 || n.indexOf("720") !== -1) return "HD";
    if (n.indexOf("SD") !== -1 || n.indexOf("480") !== -1) return "SD";
    return null;
  }

  function getCsrfToken(html) {
    var m = String(html || "").match(/<meta[^>]+name="csrf-token"[^>]+content="([^"]+)"/);
    if (m) return m[1];
    var m2 = String(html || "").match(/<meta[^>]+content="([^"]+)"[^>]+name="csrf-token"/);
    return (m2 && m2[1]) || "";
  }

  // ---- card parser (browse / movies / search HTML) ----
  // Card: <a class="group block w-full cursor-pointer" href="/anime/{slug}|/movie/{slug}">
  //         <img src="...posters..." alt="..."> ... <h3>Title</h3>

  async function parseCards(html) {
    var anchors = [];
    try {
      anchors = anchors.concat(await api.cssAll(html, "a[href*='/anime/']") || []);
    } catch (e) {}
    try {
      anchors = anchors.concat(await api.cssAll(html, "a[href*='/movie/']") || []);
    } catch (e) {}
    if (!anchors.length) return parseCardsRegex(html);
    var out = [];
    var seen = {};
    for (var i = 0; i < anchors.length; i++) {
      var item = anchors[i] || {};
      var attrs = item.attrs || {};
      var inner = item.html || "";
      var href = attrs.href || "";
      if (!href) continue;
      if (href.indexOf("/anime/") === -1 && href.indexOf("/movie/") === -1) continue;
      if (href.indexOf("/watch/") !== -1) continue;
      var detailUrl = makeAbsolute(href);
      if (seen[detailUrl]) continue;
      seen[detailUrl] = true;
      if (inner.indexOf("<h3") === -1 && inner.indexOf("<img") === -1) continue;
      var title = "";
      try {
        title = unescapeHtml(cleanTitle(await api.cssText(inner, "h3"))) || "";
      } catch (e) {}
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
    }
    if (!out.length) return parseCardsRegex(html);
    return out;
  }

  function parseCardsRegex(html) {
    var out = [];
    var seen = {};
    var re = /<a[^>]+href="([^"]*(?:\/anime\/|\/movie\/)[^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    var m;
    while ((m = re.exec(String(html || ""))) !== null) {
      var href = m[1] || "";
      var inner = m[2] || "";
      if (href.indexOf("/watch/") !== -1) continue;
      var detailUrl = makeAbsolute(href);
      if (seen[detailUrl]) continue;
      if (inner.indexOf("<h3") === -1 && inner.indexOf("<img") === -1) continue;
      seen[detailUrl] = true;
      var title = "";
      var hm = inner.match(/<h3[^>]*>([\s\S]*?)<\/h3>/);
      if (hm) title = unescapeHtml(stripTags(hm[1]));
      if (!title) {
        var am = inner.match(/<img[^>]+alt="([^"]*)"/);
        if (am) title = unescapeHtml(cleanTitle(am[1]));
      }
      if (!title) continue;
      var cover = "";
      var sm = inner.match(/<img[^>]+src="([^"]+)"/);
      if (sm) cover = makeAbsolute(sm[1]);
      if (!cover) {
        var dm = inner.match(/<img[^>]+data-src="([^"]+)"/);
        if (dm) cover = makeAbsolute(dm[1]);
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
  // h1 title, p.mb-6.leading-relaxed story, span.rounded-full.border genres,
  // div.mb-6.grid info rows (label span.text-neutral-400 + value p.text-white),
  // episodes a[href*=/watch/] "الحلقة N".

  async function parseDetails(html, url) {
    html = String(html || "");
    var title = "";
    try {
      title = unescapeHtml(stripTags(await api.cssText(html, "h1"))) || "";
    } catch (e) {}
    if (!title) {
      var hm = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
      if (hm) title = unescapeHtml(stripTags(hm[1]));
    }
    if (!title) {
      try {
        title = unescapeHtml(cleanTitle(await api.cssAttr(html, "meta[property='og:title']", "content"))) || "";
      } catch (e) {}
    }

    var cover = "";
    try {
      cover = makeAbsolute(await api.cssAttr(html, "meta[property='og:image']", "content") || "");
    } catch (e) {}
    if (!cover) {
      var pm = html.match(/<img[^>]+src="(https:\/\/images\.witanime\.site\/posters\/[^"]+)"/);
      if (pm) cover = pm[1];
    }

    var description = "";
    var sm = html.match(/<p[^>]*class="[^"]*leading-relaxed[^"]*"[^>]*>([\s\S]*?)<\/p>/);
    if (sm) description = unescapeHtml(stripTags(sm[1]));
    if (description.length < 60) {
      var dm = html.match(/<meta[^>]+name="description"[^>]+content="([^"]+)"/);
      if (!dm) dm = html.match(/<meta[^>]+content="([^"]+)"[^>]+name="description"/);
      if (dm && dm[1] && dm[1].length > description.length) description = unescapeHtml(cleanTitle(dm[1]));
    }

    var genres = [];
    try {
      var genreSpans = await api.cssList(html, "span.rounded-full") || [];
      for (var gi = 0; gi < genreSpans.length; gi++) {
        var g = unescapeHtml(cleanTitle(genreSpans[gi]));
        if (g && genres.indexOf(g) === -1) genres.push(g);
      }
    } catch (e) {}
    if (!genres.length) {
      var gre = /<span[^>]*class="[^"]*rounded-full[^"]*"[^>]*>([^<]*)<\/span>/g;
      var gm;
      while ((gm = gre.exec(html)) !== null) {
        var gt = unescapeHtml(cleanTitle(gm[1]));
        if (gt && genres.indexOf(gt) === -1) genres.push(gt);
      }
    }

    var status = "", year = "", animeType = "", season = "", sourceMaterial = "";
    var episodeDurationMin = null;
    var ire = /<span[^>]*class="[^"]*text-neutral-400[^"]*"[^>]*>([^<]*)<\/span>\s*<p[^>]*>([\s\S]*?)<\/p>/g;
    var im;
    while ((im = ire.exec(html)) !== null) {
      var label = cleanTitle(im[1]);
      var value = unescapeHtml(stripTags(im[2]));
      if (!value) continue;
      if (label.indexOf("الحالة") !== -1 || label.indexOf("حالة") !== -1) {
        status = value;
      } else if (label.indexOf("النوع") !== -1) {
        animeType = value;
      } else if (label.indexOf("الموسم") !== -1) {
        season = value;
      } else if (label.indexOf("السنة") !== -1 || label.indexOf("سنة") !== -1) {
        var ym = value.match(/(\d{4})/);
        year = ym ? ym[1] : value;
      } else if (label.indexOf("المدة") !== -1 || label.indexOf("مدة") !== -1) {
        var dm = value.match(/(\d+)/);
        episodeDurationMin = dm ? parseInt(dm[1], 10) : null;
      } else if (label.indexOf("المصدر") !== -1) {
        sourceMaterial = value;
      }
    }

    var trailerUrl = "";
    try {
      trailerUrl = makeAbsolute(await api.cssAttr(html, "a[href*='youtube']", "href") || "");
    } catch (e) {}

    // Type badge on the hero (TV / فيلم / OVA / ONA / Special ...).
    if (!animeType) {
      var bm = html.match(/<div[^>]*class="[^"]*rounded-md[^"]*bg-white[^"]*"[^>]*>([^<]*)<\/div>/);
      if (bm) {
        var cand = unescapeHtml(cleanTitle(bm[1]));
        var known = ["TV", "Movie", "OVA", "ONA", "Special", "فيلم"];
        for (var bi = 0; bi < known.length; bi++) {
          if (cand === known[bi] || cand.toLowerCase() === known[bi].toLowerCase()) {
            animeType = known[bi] === "فيلم" ? "Movie" : known[bi];
            break;
          }
        }
      }
    }
    if (!animeType && url.indexOf("/movie/") !== -1) animeType = "Movie";

    var episodes = parseEpisodes(html, title, url.indexOf("/movie/") !== -1);

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
      episodeDurationMin: episodeDurationMin,
      sourceMaterial: sourceMaterial || null,
      trailerUrl: trailerUrl || null,
      malUrl: null
    };
  }

  function parseEpisodes(html, title, isMoviePage) {
    var out = [];
    var seen = {};
    var re = /<a[^>]+href="([^"]*\/watch\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    var m;
    while ((m = re.exec(String(html || ""))) !== null) {
      var href = m[1] || "";
      var epUrl = makeAbsolute(href);
      if (!epUrl || seen[epUrl]) continue;
      seen[epUrl] = true;
      var label = unescapeHtml(stripTags(m[2]));
      var nm = label.match(/الحلقة\s*(\d+)/) || epUrl.match(/\/watch\/[^/?#]+\/(\d+)/);
      var num = nm ? nm[1] : parseEpisodeNumber(epUrl);
      out.push({
        number: String(num),
        title: isMoviePage ? ("فيلم " + (title || "")) : ("الحلقة " + num),
        url: epUrl,
        views: 0,
        isLocked: false,
        date: "",
        isFiller: false,
        thumbnailUrl: null,
        durationSeconds: null,
        servers: []
      });
      if (out.length > 2000) break;
    }
    out.sort(function (a, b) {
      return (parseFloat(b.number) || 0) - (parseFloat(a.number) || 0);
    });
    return out;
  }

  function parentAnimeUrls(episodeUrl) {
    var m = String(episodeUrl || "").match(/\/watch\/([^/?#]+)\/\d+/);
    if (!m) return [];
    return [baseUrl + "/anime/" + m[1], baseUrl + "/movie/" + m[1]];
  }

  function streamToken(serverUrl) {
    var m = String(serverUrl || "").match(/([a-f0-9]{64})/);
    return (m && m[1]) || "";
  }

  // ---- episode servers (Laravel CSRF chain, verified live) ----
  // GET {watchUrl} (cookies + csrf-token meta)
  // -> POST {watchUrl}/sources (X-CSRF-TOKEN + Cookie + Referer)
  // -> {players:{FHD:[{token,label,version,lang}],...}, downloads:{...}}
  // playback url = /watch/stream-gate/{token} (verified in watchPlayer bundle).

  async function decodeEpisodeServers(watchUrl) {
    var out = [];
    try {
      var html = await fetchHtml(watchUrl);
      var csrf = getCsrfToken(html);
      if (!csrf) return [];
      var sourcesUrl = String(watchUrl).replace(/\/+$/, "") + "/sources";
      var data;
      try {
        data = await fetchJson(sourcesUrl, {
          "X-CSRF-TOKEN": csrf,
          "X-Requested-With": "XMLHttpRequest",
          "Referer": watchUrl,
          "Origin": baseUrl
        }, "POST", "");
      } catch (e) {
        return [];
      }
      var players = (data && data.players) || {};
      var bucket;
      for (bucket in players) {
        var list = players[bucket] || [];
        for (var i = 0; i < list.length; i++) {
          var entry = list[i] || {};
          var token = entry.token || "";
          if (!/^[a-f0-9]{64}$/.test(token)) continue;
          var label = cleanTitle(entry.label || "") || ("سيرفر " + (out.length + 1));
          var ver = cleanTitle(entry.version || "");
          var name = ver ? (label + " " + ver) : label;
          var gate = baseUrl + "/watch/stream-gate/" + token;
          out.push({
            id: token,
            name: name,
            embedUrl: gate,
            url: gate,
            type: "embed",
            quality: qualityOf(bucket) || qualityOf(name)
          });
        }
      }
    } catch (e) {}
    return out;
  }

  return {
    requiresCloudflare: false,

    async getHomepageManga(args) {
      try {
        var page = (args && args.page) || 1;
        var url = page > 1 ? baseUrl + "/browse/page/" + page : baseUrl + "/browse";
        return await parseCards(await fetchHtml(url));
      } catch (e) {
        return [];
      }
    },

    async search(args) {
      try {
        var query = (args && args.query) || "";
        if (!query.trim()) return [];
        // Suggest API first (verified live). NOTE: no X-Requested-With here —
        // the endpoint answers 404 when that header is present.
        try {
          var data = await fetchJson(
            baseUrl + "/search/suggest?q=" + encodeURIComponent(query),
            { "Referer": baseUrl + "/" },
            "GET"
          );
          var results = (data && data.results) || [];
          var out = [];
          var seen = {};
          for (var i = 0; i < results.length; i++) {
            var r = results[i] || {};
            var url = makeAbsolute(r.url || "");
            if (!url || seen[url]) continue;
            seen[url] = true;
            var title = unescapeHtml(cleanTitle(r.title || ""));
            if (!title) continue;
            out.push({
              title: title,
              coverUrl: makeAbsolute(r.poster || ""),
              detailUrl: url,
              contentType: "anime"
            });
          }
          if (out.length) return out;
        } catch (e) {}
        // Fallbacks: /search?q= HTML, then /browse?search= HTML.
        try {
          var cards = await parseCards(await fetchHtml(baseUrl + "/search?q=" + encodeURIComponent(query)));
          if (cards.length) return cards;
        } catch (e) {}
        return await parseCards(await fetchHtml(baseUrl + "/browse?search=" + encodeURIComponent(query)));
      } catch (e) {
        return [];
      }
    },

    async getMangaDetails(args) {
      var url = makeAbsolute((args && args.url) || "");
      try {
        if (url.indexOf("/watch/") !== -1) {
          var parents = parentAnimeUrls(url);
          for (var pi = 0; pi < parents.length; pi++) {
            try {
              var details = await parseDetails(await fetchHtml(parents[pi]), parents[pi]);
              if (details.chapters && details.chapters.length) {
                details.originalUrl = parents[pi];
                return details;
              }
            } catch (e) {}
          }
          var epHtml = await fetchHtml(url);
          var epTitle = "";
          try {
            epTitle = unescapeHtml(stripTags(await api.cssText(epHtml, "h1"))) || url;
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
              number: parseEpisodeNumber(url),
              title: "الحلقة " + parseEpisodeNumber(url),
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
        return await parseDetails(await fetchHtml(url), url);
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
        if (url.indexOf("/watch/") !== -1) {
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
        return await decodeEpisodeServers(url);
      } catch (e) {
        return [];
      }
    },

    async resolveServer(args) {
      try {
        var serverUrl = makeAbsolute((args && (args.serverUrl || args.url)) || "");
        if (!serverUrl) return null;
        var token = streamToken(serverUrl);
        if (!token) {
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
        }
        // Verify the token resolves (same chain the player uses).
        try {
          var csrfPage = makeAbsolute((args && args.episodeUrl) || "");
          if (csrfPage.indexOf("/watch/") === -1) csrfPage = baseUrl + "/";
          var watchHtml = await fetchHtml(csrfPage);
          var csrf = getCsrfToken(watchHtml);
          if (csrf) {
            await fetchJson(baseUrl + "/watch/stream-source/" + token, {
              "X-CSRF-TOKEN": csrf,
              "X-Requested-With": "XMLHttpRequest",
              "Referer": csrfPage,
              "Origin": baseUrl
            }, "POST", "");
          }
        } catch (e) {}
        return {
          url: baseUrl + "/watch/stream-gate/" + token,
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
        var type = cleanTitle((args && args.type) || "");
        // Genre/status have no GET routes on the new site (Livewire only) —
        // downgrade to the browse list instead of returning nothing.
        var isMovie = type.indexOf("فيلم") !== -1 || type.toLowerCase().indexOf("movie") !== -1;
        var base = isMovie ? baseUrl + "/movies" : baseUrl + "/browse";
        var url = page > 1 ? base + "/page/" + page : base;
        return await parseCards(await fetchHtml(url));
      } catch (e) {
        return [];
      }
    },

    async getGenresAndTypes() {
      return { genres: defaultGenres, types: defaultTypes };
    },

    async fetchMoreChapters() {
      // Episode lists ship complete inside the anime page.
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

    getVideoHeaders() {
      return {
        "User-Agent": userAgent,
        "Referer": baseUrl + "/",
        "Accept": "*/*",
        "Accept-Language": "ar,en-US;q=0.9,en;q=0.8",
        "Sec-Fetch-Dest": "video",
        "Sec-Fetch-Mode": "no-cors",
        "Sec-Fetch-Site": "cross-site"
      };
    },

    sanitizeCoverUrl(args) {
      return makeAbsolute((args && args.url) || "");
    }
  };
}

if (typeof module !== "undefined") module.exports = { createSource: createSource };
