function createSource(api, config) {
  var baseUrl = ((config && config.base_url) || "https://w1.anime4up.rest").replace(/\/+$/, "");
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
    "تاريخي", "عسكري", "فضاء", "ميكا", "موسيقى",
    "لعبة", "ساخر", "مصاصي دماء", "شياطين", "سحر", "ساموراي",
    "تحقيق", "بوليسي", "ايتشي", "حريم", "جوسي", "شوجو آي",
    "إثارة", "تشويق", "خارق للطبيعة", "فنون قتالية", "أطفال"
  ];
  var defaultTypes = ["TV", "Movie", "ONA", "OVA", "Special"];

  // Site taxonomy slugs use dashes, never spaces.
  function taxonomySlug(name) {
    return encodeURIComponent(cleanTitle(name).replace(/\s+/g, "-"));
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
    return !url || url.indexOf("thumbnail-default") !== -1;
  }

  // Theme lazy-loads covers: img.imgInit[data-image] (waLoadImages copies
  // data-image -> src in the browser). Prefer data-image, fall back to src.
  async function extractCover(inner) {
    var cover = "";
    try {
      cover = await api.cssAttr(inner, "img.imgInit", "data-image") || "";
    } catch (e) {}
    if (!cover) {
      try {
        cover = await api.cssAttr(inner, "img", "data-image") || "";
      } catch (e) {}
    }
    if (!cover) {
      try {
        cover = await api.cssAttr(inner, ".anime-card-poster img", "src") || "";
      } catch (e) {}
    }
    if (!cover) {
      try {
        cover = await api.cssAttr(inner, "img", "src") || "";
      } catch (e) {}
    }
    return makeAbsolute(cover);
  }

  function parseEpisodeNumber(url) {
    var m = String(url || "").match(/الحلقة-(\d+)/);
    if (m) return m[1];
    return "0";
  }

  function qualityOf(serverName) {
    var n = String(serverName || "").toUpperCase();
    if (n.indexOf("FHD") !== -1 || n.indexOf("1080") !== -1) return "FHD";
    if (n.indexOf("HD") !== -1 || n.indexOf("720") !== -1) return "HD";
    if (n.indexOf("SD") !== -1 || n.indexOf("480") !== -1) return "SD";
    return null;
  }

  // ---- card parsers (shared card markup on home/search/list/genre) ----

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
          href = await api.cssAttr(inner, "a.overlay", "href") || "";
        } catch (e) {
          href = "";
        }
      }
      if (!href) continue;
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
      var cover = await extractCover(inner);
      out.push({
        title: title,
        coverUrl: isDefaultThumb(cover) ? "" : cover,
        detailUrl: detailUrl,
        contentType: "anime"
      });
    }
    return out;
  }

  // Full episode list: initial #episodesList page + follow
  // .episodes-load-more[href] (/anime/<slug>/page/N/, 48/page).
  // Bounded by data-max-pages with a hard cap of 40 pages.
  async function parseAllEpisodes(html) {
    var episodes = await parseEpisodeCards(html);
    var seen = {};
    var i;
    for (i = 0; i < episodes.length; i++) seen[episodes[i].url] = true;
    var nextUrl = "";
    var maxPages = 40;
    try {
      nextUrl = await api.cssAttr(html, ".episodes-load-more", "href") || "";
    } catch (e) {}
    try {
      var maxAttr = await api.cssAttr(html, ".episodes-load-more", "data-max-pages") || "";
      var maxNum = parseInt(maxAttr, 10);
      if (!isNaN(maxNum) && maxNum > 1 && maxNum < maxPages) maxPages = maxNum;
    } catch (e) {}
    var page = 1;
    while (nextUrl && page < maxPages) {
      page++;
      var pageHtml = "";
      try {
        pageHtml = await fetchHtml(makeAbsolute(nextUrl));
      } catch (e) {
        break;
      }
      var more = await parseEpisodeCards(pageHtml);
      if (!more.length) break;
      for (var j = 0; j < more.length; j++) {
        if (!seen[more[j].url]) {
          seen[more[j].url] = true;
          episodes.push(more[j]);
        }
      }
      nextUrl = "";
      try {
        nextUrl = await api.cssAttr(pageHtml, ".episodes-load-more", "href") || "";
      } catch (e) {}
    }
    episodes.sort(function(a, b) {
      return (parseFloat(b.number) || 0) - (parseFloat(a.number) || 0);
    });
    return episodes;
  }

  // Anime page episodes: DOM list #episodesList .anime-card-themex.
  // Number from .ep_num link text, URL from overlay or .ep_num href.
  async function parseEpisodeCards(html) {
    var items = await api.cssAll(html, "#episodesList .anime-card-themex");
    if (!items.length) {
      try {
        items = await api.cssAll(html, "#episodesList .anime-card-container");
      } catch (e) {}
    }
    var out = [];
    var seen = {};
    for (var i = 0; i < items.length; i++) {
      var item = items[i] || {};
      var inner = item.html || "";
      var href = "";
      try {
        href = await api.cssAttr(inner, "a.overlay[href*='/episode/']", "href") || "";
      } catch (e) {}
      if (!href) {
        try {
          href = await api.cssAttr(inner, ".ep_num a[href*='/episode/']", "href") || "";
        } catch (e) {}
      }
      if (!href || href.indexOf("/episode/") === -1) continue;
      var episodeUrl = makeAbsolute(href);
      if (seen[episodeUrl]) continue;
      seen[episodeUrl] = true;
      var num = "";
      try {
        var epText = await api.cssText(inner, ".ep_num") || "";
        var m = epText.match(/(\d+)/);
        num = m ? m[1] : parseEpisodeNumber(episodeUrl);
      } catch (e) {
        num = parseEpisodeNumber(episodeUrl);
      }
      var cover = await extractCover(inner);
      out.push({
        number: num,
        title: "الحلقة " + num,
        url: episodeUrl,
        views: 0,
        isLocked: false,
        date: "",
        isFiller: false,
        thumbnailUrl: isDefaultThumb(cover) ? null : cover,
        durationSeconds: null,
        servers: []
      });
    }
    out.sort(function(a, b) {
      return (parseFloat(b.number) || 0) - (parseFloat(a.number) || 0);
    });
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
        if (text.indexOf("النوع") !== -1) {
          animeType = text.replace(/.*النوع\s*:?\s*/, "").trim() || animeType;
        } else if (text.indexOf("بداية العرض") !== -1 || text.indexOf("سنة") !== -1) {
          var ym = text.match(/(\d{4})/);
          year = ym ? ym[1] : "";
        } else if (text.indexOf("حالة الأنمي") !== -1 || text.indexOf("الحالة") !== -1) {
          status = text.replace(/.*الحالة\s*:?\s*/, "").trim();
        } else if (text.indexOf("مدة الحلقة") !== -1 || text.indexOf("المدة") !== -1) {
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

    var episodes = await parseAllEpisodes(html);

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

  // Episode page servers: ul#episode-servers (or ul#watch-servers) with
  // li[data-watch="DIRECT-EMBED-URL"]. No obfuscation on this theme.
  async function decodeEpisodeServers(html) {
    var out = [];
    try {
      var links = await api.cssAll(html, "#episode-servers li[data-watch]");
      if (!links.length) {
        try {
          links = await api.cssAll(html, "#watch-servers li[data-watch]");
        } catch (e) {}
      }
      for (var i = 0; i < links.length; i++) {
        var item = links[i] || {};
        var attrs = item.attrs || {};
        var rawUrl = makeAbsolute(attrs["data-watch"] || "");
        if (!rawUrl) continue;
        var inner = item.html || "";
        var name = "";
        try {
          name = cleanTitle(await api.cssText(inner, ".watch-server-name")) || "";
        } catch (e) {}
        if (!name) {
          try {
            name = cleanTitle(await api.cssText(inner, "bdi")) || "";
          } catch (e) {}
        }
        if (!name) {
          try {
            name = cleanTitle(await api.cssText(inner, "a")) || ("سيرفر " + (i + 1));
          } catch (e) {
            name = "سيرفر " + (i + 1);
          }
        }
        var quality = null;
        try {
          var qText = await api.cssText(inner, ".quality") || "";
          quality = qualityOf(qText) || qualityOf(name);
        } catch (e) {
          quality = qualityOf(name);
        }
        out.push({
          id: String(i),
          name: name,
          embedUrl: rawUrl,
          url: rawUrl,
          type: "embed",
          quality: quality
        });
      }
    } catch (e) {}
    return out;
  }

  return {
    requiresCloudflare: false,

    async getHomepageManga(args) {
      try {
        var page = (args && args.page) || 1;
        if (page === 1) {
          var html = await fetchHtml(baseUrl + "/home8/");
          var cards = await parseAnimeCards(html);
          if (!cards.length) {
            cards = await parseAnimeCards(await fetchHtml(baseUrl + "/"));
          }
          return cards;
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
        return await parseAnimeCards(await fetchHtml(url));
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
          var slug = t.indexOf("movie") !== -1 || type.indexOf("فيلم") !== -1 ? "movie-3"
            : t.indexOf("tv") !== -1 ? "tv2"
            : t.indexOf("ova") !== -1 ? "ova"
            : t.indexOf("ona") !== -1 ? "ona"
            : t.indexOf("special") !== -1 ? "special" : "tv2";
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
