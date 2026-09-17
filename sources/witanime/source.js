function createSource(api, config) {
  var baseUrl = ((config && config.base_url) || "https://witanime.you").replace(/\/+$/, "");
  var configHeaders = (config && config.headers) || {};
  var userAgent =
    configHeaders["User-Agent"] ||
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
  var lastPageUrl = baseUrl + "/";
  var yonaplayKeyCache = null;
  var yonaplayKeyTried = false;

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

  // Site taxonomy slugs use dashes, never spaces: "يعرض الان" -> "يعرض-الان".
  function taxonomySlug(name) {
    return encodeURIComponent(cleanTitle(name).replace(/\s+/g, "-"));
  }
  var defaultTypes = ["TV", "Movie", "ONA", "OVA", "Special"];

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

  function makeAbsolute(url) {
    if (!url) return "";
    url = String(url).trim();
    if (url.indexOf("http://") === 0) return "https:" + url.substring(5);
    if (url.indexOf("https://") === 0) return url;
    if (url.indexOf("//") === 0) return "https:" + url;
    if (url.indexOf("/") === 0) return baseUrl + url;
    return baseUrl + "/" + url;
  }

  function isDefaultThumb(url) {
    return !url || url.indexOf("thumbnail-default-category.png") !== -1;
  }

  function parseEpisodeNumber(url) {
    var m = String(url || "").match(/الحلقة-(\d+)/);
    if (m) return m[1];
    var m2 = String(url || "").match(/episode\/[^-]*?-(\d+)\/?$/);
    if (m2) return m2[1];
    return "0";
  }

  function qualityOf(serverName) {
    var n = String(serverName || "").toUpperCase();
    if (n.indexOf("FHD") !== -1) return "FHD";
    if (n.indexOf("HD") !== -1) return "HD";
    if (n.indexOf("SD") !== -1) return "SD";
    return null;
  }

  // ---- obfuscated payload decoders (theme: Anime-Online-Theme) ----

  function b64Bytes(b64) {
    var bin = "";
    try {
      bin = atob(String(b64 || ""));
    } catch (e) {
      return [];
    }
    var out = [];
    for (var i = 0; i < bin.length; i++) out.push(bin.charCodeAt(i) & 0xff);
    return out;
  }

  function bytesToString(bytes) {
    var s = "";
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    try {
      return decodeURIComponent(escape(s));
    } catch (e) {
      return s;
    }
  }

  // Anime page: var processedEpisodeData = 'B64DATA.B64KEY'
  // json = bytes(atob(data)[i] XOR atob(key)[i % keyLen])
  // Preferred path is the native `api.xorUtf8` bridge (fast, no QuickJS
  // big-string traps on 400KB+ blobs). Legacy sync path stays for old apps.
  async function decodeEpisodesBlob(blob) {
    var parts = String(blob || "").split(".");
    if (parts.length < 2) return [];
    if (api.xorUtf8) {
      try {
        var text = await api.xorUtf8(parts[0], parts[1]);
        if (text) return JSON.parse(text) || [];
      } catch (e) {}
    }
    return decodeEpisodesBlobLegacy(parts[0], parts[1]);
  }

  function decodeEpisodesBlobLegacy(dataB64, keyB64) {
    try {
      var data = b64Bytes(dataB64);
      var key = b64Bytes(keyB64);
      if (!data.length || !key.length) return [];
      var plain = [];
      for (var i = 0; i < data.length; i++) {
        plain.push(data[i] ^ key[i % key.length]);
      }
      return JSON.parse(bytesToString(plain)) || [];
    } catch (e) {
      return [];
    }
  }

  // Episode page: window.resourceRegistry/configRegistry from _zT/_zV.
  // url = atob(reverse(entry).stripNonB64).slice(0, -d[atob(k)])
  function decodeServerUrl(entry, cfg) {
    try {
      var rev = String(entry || "").split("").reverse().join("")
        .replace(/[^A-Za-z0-9+/=]/g, "");
      var idx = 0;
      try {
        idx = parseInt(atob(String((cfg && cfg.k) || "")), 10);
      } catch (e) {
        idx = 0;
      }
      var d = (cfg && cfg.d) || [];
      var offset = d[idx] || 0;
      var bin = "";
      try {
        bin = atob(rev);
      } catch (e) {
        return "";
      }
      var url = offset > 0 ? bin.slice(0, -offset) : bin;
      return cleanTitle(url);
    } catch (e) {
      return "";
    }
  }

  async function extractInlineVar(html, name) {
    var m = String(html || "").match(
      new RegExp("var " + name + '="([^"]+)"'));
    return (m && m[1]) || "";
  }

  // FRAMEWORK_HASH lives split (_m1.._m4) in the theme player JS (yh00.js).
  // Fetched once per session; null when unreachable (URL stays usable anyway
  // except yonaplay embeds, which require the key per the theme logic).
  async function getYonaplayKey() {
    if (yonaplayKeyTried) return yonaplayKeyCache;
    yonaplayKeyTried = true;
    try {
      var html = await fetchHtml(baseUrl + "/");
      var srcs = [];
      var re = /<script[^>]*src=["']([^"']+)["'][^>]*>/g;
      var m;
      while ((m = re.exec(html)) !== null) {
        var src = makeAbsolute(m[1]);
        if (src.indexOf("/assets/js/") !== -1 && src.slice(-3) === ".js") {
          srcs.push(src);
        }
        if (srcs.length > 8) break;
      }
      for (var i = 0; i < srcs.length; i++) {
        var js = "";
        try {
          js = await fetchHtml(srcs[i]);
        } catch (e) {
          continue;
        }
        var parts = [];
        for (var n = 1; n <= 4; n++) {
          // Single statement form: var _m1 = "x", _m2 = "y", ...
          var mm = js.match(new RegExp("_m" + n + '\\s*=\\s*"([^"]+)"'));
          if (!mm) break;
          parts.push(mm[1]);
        }
        if (parts.length === 4) {
          yonaplayKeyCache = parts.join("");
          return yonaplayKeyCache;
        }
      }
    } catch (e) {}
    return null;
  }

  async function decodeEpisodeServers(html) {
    var out = [];
    try {
      var links = await api.cssAll(html, "#episode-servers a.server-link");
      var zT = await extractInlineVar(html, "_zT");
      var zV = await extractInlineVar(html, "_zV");
      var entries = [];
      var configs = [];
      try {
        entries = JSON.parse(atob(zT)) || [];
      } catch (e) {
        entries = [];
      }
      try {
        configs = JSON.parse(atob(zV)) || [];
      } catch (e) {
        configs = [];
      }
      var apiKey = null;
      for (var i = 0; i < links.length; i++) {
        var item = links[i] || {};
        var attrs = item.attrs || {};
        var sid = attrs["data-server-id"];
        if (sid === undefined || sid === null || sid === "") continue;
        var idx = parseInt(sid, 10);
        if (isNaN(idx)) continue;
        var name = cleanTitle(item.text || "");
        if (!name) {
          var inner = item.html || "";
          try {
            name = cleanTitle(await api.cssText(inner, ".ser")) || cleanTitle(await api.cssText(inner, "span")) || ("سيرفر " + (idx + 1));
          } catch (e) {
            name = "سيرفر " + (idx + 1);
          }
        }
        var entry = entries[idx];
        var cfg = configs[idx] || {};
        var url = entry !== undefined ? decodeServerUrl(entry, cfg) : "";
        if (!url) continue;
        if (/^https:\/\/yonaplay\.net\/embed\.php\?id=\d+$/.test(url)) {
          if (apiKey === null) apiKey = await getYonaplayKey();
          if (apiKey) url = url + "&apiKey=" + apiKey;
        }
        out.push({
          id: String(idx),
          name: name,
          url: makeAbsolute(url),
          type: "embed",
          quality: qualityOf(name)
        });
      }
    } catch (e) {}
    return out;
  }

  // ---- card parsers ----

  async function parseAnimeCards(html) {
    var items = await api.cssAll(html, ".anime-card-container");
    var out = [];
    var seen = {};
    for (var i = 0; i < items.length; i++) {
      var item = items[i] || {};
      var attrs = item.attrs || {};
      var inner = item.html || "";
      var href = attrs.href || "";
      if (!href) {
        try {
          href = await api.cssAttr(inner, "a.overlay[href*='/anime/']", "href") || "";
        } catch (e) {
          href = "";
        }
      }
      if (!href || href.indexOf("/anime/") === -1) continue;
      var detailUrl = makeAbsolute(href);
      if (seen[detailUrl]) continue;
      seen[detailUrl] = true;
      var title = "";
      try {
        title = cleanTitle(await api.cssText(inner, ".anime-card-title")) || "";
      } catch (e) {}
      if (!title) {
        try {
          title = cleanTitle(await api.cssAttr(inner, "img", "alt")) || "";
        } catch (e) {}
      }
      if (!title) continue;
      var cover = "";
      try {
        cover = makeAbsolute(await api.cssAttr(inner, ".anime-card-poster img", "src") || "");
      } catch (e) {}
      if (!cover) {
        try {
          cover = makeAbsolute(await api.cssAttr(inner, "img", "src") || "");
        } catch (e) {}
      }
      out.push({
        title: title,
        coverUrl: isDefaultThumb(cover) ? "" : cover,
        detailUrl: detailUrl,
        contentType: "anime"
      });
    }
    return out;
  }

  async function parseEpisodeCards(html) {
    var items = await api.cssAll(html, ".episodes-card-container");
    var out = [];
    var seen = {};
    for (var i = 0; i < items.length; i++) {
      var item = items[i] || {};
      var inner = item.html || "";
      var href = "";
      try {
        href = await api.cssAttr(inner, ".episodes-card-title a[href*='/episode/']", "href") || "";
      } catch (e) {}
      if (!href || href.indexOf("/episode/") === -1) continue;
      var episodeUrl = makeAbsolute(href);
      if (seen[episodeUrl]) continue;
      seen[episodeUrl] = true;
      var epLabel = "";
      try {
        epLabel = cleanTitle(await api.cssText(inner, ".episodes-card-title")) || "";
      } catch (e) {}
      var animeName = "";
      try {
        animeName = cleanTitle(await api.cssText(inner, ".ep-card-anime-title")) || "";
      } catch (e) {}
      var title = animeName || epLabel;
      if (epLabel && animeName && epLabel !== animeName) title = animeName + " " + epLabel;
      if (!title) continue;
      var cover = "";
      try {
        cover = makeAbsolute(await api.cssAttr(inner, ".episodes-card img", "src") || "");
      } catch (e) {}
      out.push({
        title: title,
        coverUrl: isDefaultThumb(cover) ? "" : cover,
        detailUrl: episodeUrl,
        contentType: "anime"
      });
    }
    return out;
  }

  // WP search: ul.category-posts-list > li (.cat-post-details h2 a).
  // Results point at /episode/... (single films too) — resolvable on demand
  // via getMangaDetails (episode -> parent anime link).
  async function parseSearchItems(html) {
    var items = await api.cssAll(html, "ul.category-posts-list > li");
    var out = [];
    var seen = {};
    for (var i = 0; i < items.length; i++) {
      var inner = (items[i] || {}).html || "";
      var href = "";
      try {
        href = await api.cssAttr(inner, ".cat-post-details h2 a", "href") || "";
      } catch (e) {}
      if (!href) continue;
      var url = makeAbsolute(href);
      if (seen[url]) continue;
      seen[url] = true;
      var title = "";
      try {
        title = cleanTitle(await api.cssText(inner, ".cat-post-details h2 a")) || "";
      } catch (e) {}
      if (!title) continue;
      var cover = "";
      try {
        cover = makeAbsolute(await api.cssAttr(inner, ".cat-post-thumbnail img", "src") || "");
      } catch (e) {}
      out.push({
        title: title,
        coverUrl: isDefaultThumb(cover) ? "" : cover,
        detailUrl: url,
        contentType: "anime"
      });
    }
    return out;
  }

  async function parseAnimeDetails(html, url) {
    var title = "";
    try {
      title = cleanTitle(await api.cssText(html, "h1.anime-details-title")) || "";
    } catch (e) {}
    if (!title) {
      try {
        title = cleanTitle(await api.cssAttr(html, "meta[property='og:title']", "content")) || "";
      } catch (e) {}
    }
    var cover = "";
    try {
      cover = makeAbsolute(await api.cssAttr(html, ".anime-thumbnail img", "src") || "");
    } catch (e) {}
    if (!cover) {
      try {
        cover = makeAbsolute(await api.cssAttr(html, "meta[property='og:image']", "content") || "");
      } catch (e) {}
    }
    var description = "";
    try {
      description = cleanTitle(await api.cssText(html, "p.anime-story")) || "";
    } catch (e) {}
    if (!description) {
      try {
        description = cleanTitle(await api.cssAttr(html, "meta[name='description']", "content")) || "";
      } catch (e) {}
    }
    var genres = [];
    try {
      genres = (await api.cssList(html, "ul.anime-genres li a") || []).map(cleanTitle).filter(Boolean);
    } catch (e) {}

    var animeType = "", season = "", year = "", status = "";
    var episodeDurationMin = null, sourceMaterial = "";
    try {
      var rows = await api.cssAll(html, ".anime-info");
      for (var i = 0; i < rows.length; i++) {
        var text = cleanTitle((rows[i] || {}).text || "");
        var link = "";
        try {
          link = await api.cssAttr((rows[i] || {}).html || "", "a", "href") || "";
        } catch (e) {}
        if (text.indexOf("النوع") !== -1) {
          animeType = text.replace(/.*النوع\s*:?\s*/, "").trim() || animeType;
        } else if (text.indexOf("بداية العرض") !== -1) {
          var ym = text.match(/(\d{4})/);
          year = ym ? ym[1] : "";
        } else if (text.indexOf("حالة الأنمي") !== -1) {
          status = text.replace(/.*حالة الأنمي\s*:?\s*/, "").trim();
        } else if (text.indexOf("مدة الحلقة") !== -1) {
          var dm = text.match(/(\d+)/);
          episodeDurationMin = dm ? parseInt(dm[1], 10) : null;
        } else if (text.indexOf("الموسم") !== -1) {
          season = text.replace(/.*الموسم\s*:?\s*/, "").trim();
        } else if (text.indexOf("المصدر") !== -1) {
          sourceMaterial = text.replace(/.*المصدر\s*:?\s*/, "").trim();
        }
      }
    } catch (e) {}

    var trailerUrl = "";
    try {
      trailerUrl = makeAbsolute(await api.cssAttr(html, "a.anime-trailer", "href") || "");
    } catch (e) {}
    var malUrl = "";
    try {
      malUrl = makeAbsolute(await api.cssAttr(html, "a.anime-mal", "href") || "");
    } catch (e) {}

    var episodes = [];
    try {
      var blobMatch = String(html).match(/var processedEpisodeData\s*=\s*'([^']+)'/);
      if (blobMatch && blobMatch[1]) {
        var raw = await decodeEpisodesBlob(blobMatch[1]);
        var seenEp = {};
        for (var j = 0; j < raw.length; j++) {
          var ep = raw[j] || {};
          var epUrl = makeAbsolute(ep.url || "");
          if (!epUrl || seenEp[epUrl]) continue;
          seenEp[epUrl] = true;
          var num = String(ep.number || parseEpisodeNumber(epUrl) || "0");
          var epType = String(ep.type || "");
          episodes.push({
            number: num,
            title: /فيلم|movie/i.test(epType) ? ("فيلم " + title) : ("الحلقة " + num),
            url: epUrl,
            views: 0,
            isLocked: false,
            date: "",
            isFiller: /فلر|filler/i.test(epType),
            thumbnailUrl: ep.screenshot ? makeAbsolute(ep.screenshot) : null,
            durationSeconds: null,
            servers: []
          });
        }
        episodes.sort(function(a, b) {
          return (parseFloat(b.number) || 0) - (parseFloat(a.number) || 0);
        });
      }
    } catch (e) {}

    return {
      title: title || "غير معروف",
      coverUrl: isDefaultThumb(cover) ? "" : cover,
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
      malUrl: malUrl || null
    };
  }

  async function resolveParentAnime(episodeUrl) {
    // Episode pages carry .anime-page-link a[href*='/anime/'] to the parent.
    try {
      var html = await fetchHtml(episodeUrl);
      var parent = "";
      try {
        parent = makeAbsolute(await api.cssAttr(html, ".anime-page-link a[href*='/anime/']", "href") || "");
      } catch (e) {}
      if (parent && parent.indexOf("/anime/") !== -1) return parent;
    } catch (e) {}
    return "";
  }

  return {
    requiresCloudflare: false,

    async getHomepageManga(args) {
      try {
        var page = (args && args.page) || 1;
        if (page === 1) {
          var html = await fetchHtml(baseUrl + "/");
          var anime = await parseAnimeCards(html);
          var eps = await parseEpisodeCards(html);
          return anime.concat(eps);
        }
        var listHtml = await fetchHtml(baseUrl + "/قائمة-الانمي/page/" + page + "/");
        return await parseAnimeCards(listHtml);
      } catch (e) {
        return [];
      }
    },

    async search(args) {
      try {
        var query = (args && args.query) || "";
        if (!query.trim()) return [];
        var page = (args && args.page) || 1;
        var url = page === 1
          ? baseUrl + "/?s=" + encodeURIComponent(query)
          : baseUrl + "/page/" + page + "/?s=" + encodeURIComponent(query);
        return await parseSearchItems(await fetchHtml(url));
      } catch (e) {
        return [];
      }
    },

    async getMangaDetails(args) {
      var url = makeAbsolute((args && args.url) || "");
      try {
        if (url.indexOf("/episode/") !== -1) {
          var parent = await resolveParentAnime(url);
          if (parent) {
            var details = await parseAnimeDetails(await fetchHtml(parent), parent);
            details.originalUrl = parent;
            return details;
          }
          // Fallback: minimal row so the tap never renders an empty page.
          var epHtml = await fetchHtml(url);
          var epTitle = "";
          try {
            epTitle = cleanTitle(await api.cssText(epHtml, ".main-section h3")) || url;
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
        if (url.indexOf("/episode/") !== -1) {
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
        var html = await fetchHtml(url);
        return await decodeEpisodeServers(html);
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
        var status = cleanTitle((args && args.status) || "");
        var base = baseUrl;
        if (genre) {
          base = baseUrl + "/anime-genre/" + taxonomySlug(genre) + "/";
        } else if (type) {
          var t = type.toLowerCase();
          var slug = t.indexOf("movie") !== -1 || type.indexOf("فيلم") !== -1 ? "movie"
            : t.indexOf("tv") !== -1 ? "tv"
            : t.indexOf("ova") !== -1 ? "ova"
            : t.indexOf("ona") !== -1 ? "ona"
            : t.indexOf("special") !== -1 ? "special" : "tv";
          base = baseUrl + "/anime-type/" + slug + "/";
        } else if (status) {
          base = baseUrl + "/anime-status/" + taxonomySlug(status) + "/";
        } else {
          base = baseUrl + "/قائمة-الانمي/";
        }
        var url = page > 1 ? base.replace(/\/+$/, "") + "/page/" + page + "/" : base;
        return await parseAnimeCards(await fetchHtml(url));
      } catch (e) {
        return [];
      }
    },

    async getGenresAndTypes() {
      return { genres: defaultGenres, types: defaultTypes };
    },

    async fetchMoreChapters() {
      // Episode lists ship complete inside processedEpisodeData.
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
