function createSource(api, config) {
  var DEFAULT_BASE_URL = "https://api.atheertoon.com";
  var baseUrl = ((config && config.base_url) || DEFAULT_BASE_URL).replace(/\/+$/, "");
  var userAgent = (config && config.user_agent) || "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
  var JSON_HEADERS = {
    "User-Agent": userAgent,
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "ar,en-US;q=0.9,en;q=0.8",
    "Referer": "https://atheertoon.com/"
  };
  var IMAGE_REFERER = "https://cdn.atheertoon.com/";
  var KNOWN_CONTENT_TYPES = ["manga", "manhwa", "manhua", "novel", "anime", "overlay"];

  function abs(url) {
    if (!url) return "";
    url = String(url).replace(/&amp;/g, "&").trim();
    if (!url || url.indexOf("data:image") === 0) return "";
    if (url.indexOf("//") === 0) return "https:" + url;
    if (url.indexOf("http://") === 0) return "https://" + url.substring(7);
    if (url.indexOf("https://") === 0) return url;
    if (url.charAt(0) === "/") return baseUrl + url;
    return baseUrl + "/" + url;
  }

  async function getJson(url) {
    if (api.http) {
      var res = await api.http(url, { method: "GET", headers: JSON_HEADERS });
      if (!res || !res.ok) throw new Error("HTTP " + (res ? res.status : 0) + " for " + url);
      return JSON.parse(res.body || "{}");
    }
    var text = await api.fetchText(url, JSON_HEADERS);
    return JSON.parse(text || "{}");
  }

  function mapContentType(typeSlug) {
    var t = String(typeSlug || "");
    if (t === "korean_manhwa") return "manhwa";
    if (t === "japanese_manga") return "manga";
    if (KNOWN_CONTENT_TYPES.indexOf(t) !== -1) return t;
    return "manhwa";
  }

  function genreName(g) {
    if (typeof g === "string") return g.trim();
    if (g && typeof g === "object") return String(g.name || g.title || g.slug || "").trim();
    return "";
  }

  function toManga(item) {
    item = item || {};
    var id = item.id;
    var title = String(item.title || "").trim();
    if (!title || id === undefined || id === null) return null;
    return {
      title: title,
      coverUrl: abs(item.cover_url || item.cover_sd_url || ""),
      detailUrl: baseUrl + "/api/v1/public/manhwas/" + id,
      contentType: mapContentType(item.type_slug)
    };
  }

  function toChapter(item) {
    item = item || {};
    var num = parseInt(item.chapter_number, 10);
    if (isNaN(num) || num <= 0) return null;
    var cid = item.id;
    if (cid === undefined || cid === null) return null;
    var views = item.views_count;
    var title = String(item.display_title || item.title || "").trim();
    return {
      number: num,
      title: title,
      views: typeof views === "number" ? views : 0,
      url: baseUrl + "/api/v1/public/chapters/" + cid + "/pages",
      isLocked: !!(item.requires_ad_unlock || item.ad_gate_reason),
      date: String(item.created_at || item.updated_at || "")
    };
  }

  function pageImages(payload) {
    var out = [];
    try {
      var pages = payload && payload.data && payload.data.pages;
      if (pages && pages.length) {
        for (var i = 0; i < pages.length; i++) {
          var u = abs(pages[i] ? pages[i].image_url : "");
          if (u) out.push(u);
        }
      }
    } catch (e) {}
    return out;
  }

  async function genreSlugFor(name) {
    var want = String(name || "").trim().toLowerCase();
    if (!want) return "";
    var list = await getJson(baseUrl + "/api/v1/public/genres");
    var arr = Array.isArray(list) ? list : (list && list.data ? list.data : []);
    for (var i = 0; i < arr.length; i++) {
      var g = arr[i] || {};
      var gname = String(g.name || "").trim();
      if (gname && gname.toLowerCase() === want && g.slug) return String(g.slug);
    }
    return "";
  }

  return {
    requiresCloudflare: false,

    async getHomepageManga(args) {
      var page = (args && args.page) || 1;
      if (page < 1) page = 1;
      try {
        var json = await getJson(baseUrl + "/api/v1/public/manhwas?page=" + page);
        var items = (json && json.data) || [];
        var out = [];
        for (var i = 0; i < items.length; i++) {
          var m = toManga(items[i]);
          if (m) out.push(m);
        }
        return out;
      } catch (e) {
        return [];
      }
    },

    async search(args) {
      var q = ((args && args.query) || "").trim();
      if (!q) return [];
      var page = (args && args.page) || 1;
      if (page < 1) page = 1;
      try {
        var json = await getJson(baseUrl + "/api/v1/public/manhwas?search=" + encodeURIComponent(q) + "&page=" + page);
        var items = (json && json.data) || [];
        var out = [];
        for (var i = 0; i < items.length; i++) {
          var m = toManga(items[i]);
          if (m) out.push(m);
        }
        return out;
      } catch (e) {
        return [];
      }
    },

    async getFilteredManga(args) {
      var genre = ((args && args.genre) || "").trim();
      var page = (args && args.page) || 1;
      if (page < 1) page = 1;
      try {
        var qs = "page=" + page;
        if (genre) {
          var slug = await genreSlugFor(genre);
          if (!slug) return [];
          qs = "genre=" + encodeURIComponent(slug) + "&" + qs;
        }
        var json = await getJson(baseUrl + "/api/v1/public/manhwas?" + qs);
        var items = (json && json.data) || [];
        var out = [];
        for (var i = 0; i < items.length; i++) {
          var m = toManga(items[i]);
          if (m) out.push(m);
        }
        return out;
      } catch (e) {
        return [];
      }
    },

    async getMangaDetails(args) {
      var url = abs((args && args.url) || "");
      var m = String(url).match(/\/manhwas\/(\d+)/);
      if (!m || !m[1]) throw new Error("bad detail url");
      var id = m[1];
      var detail = await getJson(baseUrl + "/api/v1/public/manhwas/" + id);
      var info = (detail && detail.data) || {};
      var chJson = await getJson(baseUrl + "/api/v1/public/manhwas/" + id + "/chapters");
      var raw = (chJson && chJson.data) || [];
      var chapters = [];
      for (var i = 0; i < raw.length; i++) {
        var c = toChapter(raw[i]);
        if (c) chapters.push(c);
      }
      chapters.sort(function (a, b) { return b.number - a.number; });
      var genres = [];
      var gSrc = info.genres_names || info.genres || [];
      for (var j = 0; j < gSrc.length; j++) {
        var g = genreName(gSrc[j]);
        if (g) genres.push(g);
      }
      return {
        title: String(info.title || "").trim() || ("manga-" + id),
        coverUrl: abs(info.cover_url || info.cover_sd_url || ""),
        description: String(info.synopsis || "").trim(),
        genres: genres,
        chapters: chapters,
        originalUrl: url,
        hasMoreChapters: false,
        lastFetchedPage: chapters.length,
        contentType: mapContentType(info.type_slug)
      };
    },

    async fetchMoreChapters(args) {
      return null;
    },

    async getChapterPages(args) {
      var url = abs((args && args.url) || "");
      if (!url) return [];
      try {
        return pageImages(await getJson(url));
      } catch (e) {
        return [];
      }
    },

    async getChapterContent(args) {
      var url = abs((args && args.url) || "");
      if (!url) return { kind: "image", imageUrls: [] };
      try {
        return { kind: "image", imageUrls: pageImages(await getJson(url)) };
      } catch (e) {
        return { kind: "image", imageUrls: [] };
      }
    },

    async getGenresAndTypes() {
      var genres = [];
      try {
        var list = await getJson(baseUrl + "/api/v1/public/genres");
        var arr = Array.isArray(list) ? list : (list && list.data ? list.data : []);
        var seen = {};
        for (var i = 0; i < arr.length; i++) {
          var name = String((arr[i] || {}).name || "").trim();
          if (name && !seen[name]) {
            seen[name] = true;
            genres.push(name);
          }
        }
      } catch (e) {}
      return { genres: genres, types: ["manhwa", "manga"] };
    },

    getImageHeaders(args) {
      return {
        "User-Agent": userAgent,
        "Referer": IMAGE_REFERER,
        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "Accept-Language": "ar,en-US;q=0.9,en;q=0.8"
      };
    },

    sanitizeCoverUrl(args) {
      return abs((args && args.url) || "");
    }
  };
}

if (typeof module !== "undefined") module.exports = { createSource: createSource };
