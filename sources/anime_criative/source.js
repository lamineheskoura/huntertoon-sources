function createSource(api, config) {
  var baseUrl = ((config && config.base_url) || "https://anime-site-api.animecriative.workers.dev").replace(/\/+$/, "");
  var configHeaders = (config && config.headers) || {};
  var userAgent =
    (config && config.user_agent) ||
    configHeaders["User-Agent"] ||
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
  var lastPageUrl = baseUrl + "/home";
  var customServers = {};

  var defaultHeaders = {
    "User-Agent": userAgent,
    "Accept": "application/json",
    "Accept-Language": "ar,en-US;q=0.9,en;q=0.8",
    "Referer": baseUrl + "/home"
  };

  var LIST_TYPES = {
    "أحدث الحلقات": "latest_episodes",
    "الأكثر شعبية": "top_anime",
    "يعرض الآن": "currently_airing",
    "مقترح لك": "featured",
    "قائمة الأنمي": "anime_list",
    "latest": "latest_episodes",
    "popular": "top_anime",
    "airing": "currently_airing"
  };
  var GENRES = [
    "Action", "Adventure", "Comedy", "Drama", "Fantasy", "Horror",
    "Mystery", "Romance", "Sci-Fi", "Sports", "Supernatural", "Thriller"
  ];

  function mergeHeaders(a, b) {
    var out = {};
    for (var k in a) out[k] = a[k];
    if (b) for (var x in b) out[x] = b[x];
    return out;
  }

  async function apiGet(path) {
    var url = path.indexOf("http") === 0 ? path : baseUrl + path;
    lastPageUrl = url;
    var res = await api.http(url, { method: "GET", headers: mergeHeaders(defaultHeaders, {}) });
    if (!res || !res.ok) throw new Error("HTTP " + (res ? res.status : 0) + " for " + url);
    try {
      return JSON.parse(res.body || "{}");
    } catch (e) {
      throw new Error("Bad JSON for " + url);
    }
  }

  function cleanTitle(s) {
    return String(s == null ? "" : s).replace(/\s+/g, " ").trim();
  }

  function stripTags(s) {
    return cleanTitle(String(s || "").replace(/<[^>]*>/g, " "));
  }

  function absUrl(url) {
    var u = String(url || "").trim();
    if (!u) return "";
    if (u.indexOf("/api/") === 0) return baseUrl + u;
    if (u.indexOf("//") === 0) return "https:" + u;
    return u;
  }

  function detailUrl(id) {
    return baseUrl + "/m-detail.html?id=" + encodeURIComponent(id);
  }

  function streamUrl(id, episode, title) {
    return baseUrl + "/api/catalog/stream?animeId=" + encodeURIComponent(id) +
      "&ep=" + encodeURIComponent(episode) + "&title=" + encodeURIComponent(title || "");
  }

  function toCard(item) {
    if (!item) return null;
    var id = cleanTitle(item.id || item.anime_id || item._contentId);
    var title = cleanTitle(item.title || item.titleEn || item.anime_name);
    if (!id || !title) return null;
    return {
      title: title,
      coverUrl: absUrl(item.cover || item.banner || item.poster || ""),
      detailUrl: detailUrl(id),
      contentType: "anime",
      year: cleanTitle(item.year) || null,
      animeType: cleanTitle(item.type) || null,
      latestEpisode: cleanTitle(item.latestEpisode) || null
    };
  }

  function toCards(data) {
    var list = (data && (data.results || data.items)) || [];
    var out = [];
    var seen = {};
    for (var i = 0; i < list.length; i++) {
      var card = toCard(list[i]);
      if (card && !seen[card.detailUrl]) {
        seen[card.detailUrl] = true;
        out.push(card);
      }
    }
    return out;
  }

  function idFromUrl(url) {
    var u = String(url || "");
    var m = u.match(/[?&](?:animeId|id)=([^&#]+)/);
    if (m) return decodeURIComponent(m[1]);
    m = u.match(/\/api\/catalog\/info\/([^/?#]+)/);
    if (m) return decodeURIComponent(m[1]);
    return u.indexOf("/") === -1 ? u : "";
  }

  function episodeFromUrl(url) {
    var m = String(url || "").match(/[?&]ep=([^&#]+)/);
    return m ? decodeURIComponent(m[1]) : "";
  }

  function titleFromUrl(url) {
    var m = String(url || "").match(/[?&]title=([^&#]+)/);
    return m ? decodeURIComponent(m[1]) : "";
  }

  function numericLatest(value) {
    var m = String(value == null ? "" : value).match(/(\d+(?:\.\d+)?)/);
    return m ? m[1] : "";
  }

  function qualityOf(value) {
    var q = cleanTitle(value);
    if (q) return q;
    return null;
  }

  function serverType(url, declared) {
    var u = String(url || "").toLowerCase();
    if (declared === "video" || /\.(mp4|webm|mkv)([?#]|$)/.test(u)) return "mp4";
    if (/\.m3u8([?#]|$)/.test(u)) return "m3u8";
    return "embed";
  }

  function mapServer(server, index, episodeKey) {
    if (!server) return null;
    var url = absUrl(server.url || server.u || server.link || "");
    if (!url) return null;
    var type = serverType(url, server.type);
    var direct = type === "embed" ? "" : url;
    return {
      id: cleanTitle(server._asl_id || server.id) || (episodeKey + "-" + index),
      name: cleanTitle(server.label || server.name || server.n) || ("سيرفر " + (index + 1)),
      embedUrl: url,
      url: url,
      directUrl: direct,
      type: type,
      quality: qualityOf(server.quality || server.q),
      qualities: [],
      selectedQualityIndex: 0,
      headers: { "User-Agent": userAgent, "Referer": baseUrl + "/home" }
    };
  }

  function customKey(id, episode) {
    return String(id) + "_" + String(episode);
  }

  function storeCustomServers(id, episodes) {
    for (var i = 0; i < episodes.length; i++) {
      var ep = episodes[i] || {};
      var num = ep.n != null ? ep.n : ep.number;
      var list = ep.s || ep.servers || [];
      var mapped = [];
      for (var j = 0; j < list.length; j++) {
        var server = mapServer(list[j], j, customKey(id, num));
        if (server) mapped.push(server);
      }
      customServers[customKey(id, num)] = mapped;
    }
  }

  function toChapters(id, anime, customDoc) {
    var episodes = Array.isArray(customDoc && customDoc.e) ? customDoc.e : [];
    var infoEpisodes = Array.isArray(anime._episodes) ? anime._episodes : [];
    var chapters = [];
    var title = cleanTitle(anime.title || (customDoc && customDoc.t));
    var i, num, epTitle;
    if (infoEpisodes.length) {
      for (i = 0; i < infoEpisodes.length; i++) {
        var ep = infoEpisodes[i] || {};
        num = ep.number != null ? ep.number : ep.n;
        if (num == null) continue;
        epTitle = cleanTitle(ep.name) || ("الحلقة " + num);
        chapters.push({
          number: String(num), title: epTitle,
          url: streamUrl(id, num, title), views: 0, isLocked: false,
          date: "", isFiller: false, thumbnailUrl: ep.image || null,
          durationSeconds: null, servers: []
        });
      }
    } else if (episodes.length) {
      for (i = 0; i < episodes.length; i++) {
        num = episodes[i] && episodes[i].n != null ? episodes[i].n : episodes[i] && episodes[i].number;
        if (num == null) continue;
        chapters.push({
          number: String(num), title: "الحلقة " + num,
          url: streamUrl(id, num, title), views: 0, isLocked: false,
          date: "", isFiller: false, thumbnailUrl: null,
          durationSeconds: null, servers: []
        });
      }
    } else {
      var latest = numericLatest(anime.latestEpisode || (customDoc && customDoc.latest));
      var count = parseInt(latest, 10);
      if (count > 0 && count < 3000) {
        for (i = count; i >= 1; i--) {
          chapters.push({
            number: String(i), title: "الحلقة " + i,
            url: streamUrl(id, i, title), views: 0, isLocked: false,
            date: "", isFiller: false, thumbnailUrl: null,
            durationSeconds: null, servers: []
          });
        }
      }
    }
    chapters.sort(function (a, b) {
      return (parseFloat(b.number) || 0) - (parseFloat(a.number) || 0);
    });
    return chapters;
  }

  return {
    requiresCloudflare: false,

    async getHomepageManga(args) {
      try {
        var page = parseInt((args && args.page) || 1, 10);
        if (!page || page < 1) page = 1;
        var limit = 24;
        var data = await apiGet("/api/catalog/list?type=latest_episodes&limit=" + limit + "&offset=" + ((page - 1) * limit));
        return toCards(data);
      } catch (e) {
        return [];
      }
    },

    async search(args) {
      try {
        var query = cleanTitle(args && args.query);
        if (!query) return [];
        var data = await apiGet("/api/catalog/search?q=" + encodeURIComponent(query));
        return toCards(data);
      } catch (e) {
        return [];
      }
    },

    async getMangaDetails(args) {
      var url = String((args && args.url) || "");
      var id = idFromUrl(url);
      if (!id) throw new Error("Bad anime URL: " + url);
      var info = await apiGet("/api/catalog/info/" + encodeURIComponent(id));
      var anime = (info && info.anime) || {};
      anime._episodes = (info && info.episodes) || [];
      var customDoc = null;
      try {
        var custom = await apiGet("/api/custom/doc/" + encodeURIComponent(id));
        if (custom && custom.success && custom.doc) customDoc = custom.doc;
      } catch (e) {}
      if (!cleanTitle(anime.title) && customDoc) anime.title = customDoc.t || "";
      if (!anime.cover && customDoc) anime.cover = customDoc.c || "";
      if (customDoc && Array.isArray(customDoc.e)) storeCustomServers(id, customDoc.e);
      var chapters = toChapters(id, anime, customDoc);
      if (!chapters.length && Array.isArray(customDoc && customDoc.e)) storeCustomServers(id, customDoc.e);
      return {
        title: cleanTitle(anime.title || anime.titleEn || (customDoc && customDoc.t)) || "غير معروف",
        coverUrl: absUrl(anime.cover || anime.banner || (customDoc && customDoc.c) || ""),
        description: stripTags(anime.description || ""),
        genres: Array.isArray(anime.genres) ? anime.genres : [],
        status: cleanTitle(anime.status || ""),
        chapters: chapters,
        originalUrl: detailUrl(id),
        hasMoreChapters: false,
        lastFetchedPage: 1,
        contentType: "anime",
        animeType: cleanTitle(anime.type) || null,
        season: cleanTitle(anime.season) || null,
        year: cleanTitle(anime.year) || null,
        episodeDurationMin: null,
        sourceMaterial: null,
        trailerUrl: null,
        malUrl: null
      };
    },

    async getChapterPages() {
      return [];
    },

    async getChapterContent(args) {
      try {
        var servers = await this.getEpisodeServers(args);
        return { kind: "video", servers: servers };
      } catch (e) {
        return { kind: "video", servers: [] };
      }
    },

    async getEpisodeServers(args) {
      try {
        var url = String((args && args.url) || "");
        var id = idFromUrl(url);
        var episode = episodeFromUrl(url);
        if (!id || !episode) return [];
        var title = titleFromUrl(url);
        var data = await apiGet(streamUrl(id, episode, title));
        var list = (data && data.servers) || [];
        var out = [];
        var seen = {};
        for (var i = 0; i < list.length; i++) {
          var server = mapServer(list[i], i, customKey(id, episode));
          if (server && !seen[server.embedUrl]) {
            seen[server.embedUrl] = true;
            out.push(server);
          }
        }
        var custom = customServers[customKey(id, episode)] || [];
        for (var j = 0; j < custom.length; j++) {
          if (!seen[custom[j].embedUrl]) {
            seen[custom[j].embedUrl] = true;
            out.push(custom[j]);
          }
        }
        return out;
      } catch (e) {
        return [];
      }
    },

    async resolveServer(args) {
      try {
        var url = absUrl((args && (args.serverUrl || args.url)) || "");
        if (!url) return null;
        var type = serverType(url, "");
        return {
          url: url,
          directUrl: type === "embed" ? "" : url,
          type: type,
          headers: {
            "User-Agent": userAgent,
            "Referer": baseUrl + "/home",
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
        var page = parseInt((args && args.page) || 1, 10);
        if (!page || page < 1) page = 1;
        var limit = 24;
        var offset = (page - 1) * limit;
        var genre = cleanTitle(args && args.genre);
        if (genre) {
          return toCards(await apiGet("/api/catalog/filter?genre=" + encodeURIComponent(genre) +
            "&limit=" + limit + "&offset=" + offset + "&sort=rating"));
        }
        var requested = cleanTitle(args && args.type) || "latest_episodes";
        var listType = LIST_TYPES[requested] || requested;
        if (!/^[a-z_]+$/.test(listType)) listType = "latest_episodes";
        return toCards(await apiGet("/api/catalog/list?type=" + encodeURIComponent(listType) +
          "&limit=" + limit + "&offset=" + offset));
      } catch (e) {
        return [];
      }
    },

    async getGenresAndTypes() {
      return { genres: GENRES.slice(), types: ["أحدث الحلقات", "الأكثر شعبية", "يعرض الآن", "مقترح لك", "قائمة الأنمي"] };
    },

    async fetchMoreChapters() {
      return null;
    },

    getImageHeaders() {
      return {
        "User-Agent": userAgent,
        "Referer": lastPageUrl || (baseUrl + "/home"),
        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "Accept-Language": "ar,en-US;q=0.9,en;q=0.8"
      };
    },

    getVideoHeaders(args) {
      return {
        "User-Agent": userAgent,
        "Referer": baseUrl + "/home",
        "Accept": "*/*",
        "Accept-Language": "ar,en-US;q=0.9,en;q=0.8"
      };
    },

    sanitizeCoverUrl(args) {
      return absUrl((args && args.url) || "");
    }
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { createSource: createSource };
}
