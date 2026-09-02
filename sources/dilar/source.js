function createSource(api, config) {
  var baseUrl = (config && config.base_url) || "https://dilar.tube";
  var apiBase = baseUrl.replace(/\/$/, "") + "/api";

  var headers = {
    "User-Agent": (config && config.user_agent) || "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "ar,en-US;q=0.9,en;q=0.8",
    "Referer": baseUrl + "/"
  };

  function mergeHeaders(extra) {
    var out = {};
    for (var k in headers) if (headers.hasOwnProperty(k)) out[k] = headers[k];
    if (extra) for (var k2 in extra) if (extra.hasOwnProperty(k2)) out[k2] = extra[k2];
    return out;
  }

  function buildQuery(params) {
    var parts = [];
    for (var key in params) {
      if (!params.hasOwnProperty(key)) continue;
      var value = params[key];
      if (value !== null && value !== undefined && value !== "") {
        parts.push(encodeURIComponent(key) + "=" + encodeURIComponent(String(value)));
      }
    }
    return parts.length ? "?" + parts.join("&") : "";
  }

  async function getJson(url) {
    var text = await api.fetchText(url, headers);
    if (!text) throw new Error("Empty response: " + url);
    text = String(text);
    if (text.charAt(0) !== "{" && text.charAt(0) !== "[") {
      var inner = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
      if (inner) text = inner[0];
    }
    return JSON.parse(text);
  }

  // ==================== SOURCE HELPERS ====================
  function coverUrl(id, filename) {
    if (!id || !filename) return "";
    return baseUrl + "/uploads/manga/cover/" + id + "/large_" + filename;
  }

  function toManga(item) {
    var id = String(item.id || "");
    var title = String(item.title || "");
    var slug = String(item.slug || "");
    if (!id || !title) return null;
    return {
      title: title,
      detailUrl: baseUrl + "/series/" + id + "/" + slug,
      coverUrl: coverUrl(id, String(item.cover || "")),
      contentType: "manga"
    };
  }

  function formatChapter(value) {
    if (!value) return "0";
    var n = parseFloat(String(value));
    if (!isNaN(n)) return n === Math.floor(n) ? String(Math.floor(n)) : String(n);
    return String(value).trim();
  }

  function isNovelToken(value) {
    if (!value) return false;
    var v = String(value).toLowerCase().trim();
    return v === "novel" || v === "light_novel" || v === "lightnovel" ||
      v === "light-novel" || v === "web_novel" || v === "webnovel" ||
      v === "web-novel" || v === "رواية" || v === "روايه" || v === "روايات";
  }

  function detectContentType(series) {
    if (!series || typeof series !== "object") return "manga";
    if (isNovelToken(series.type) || isNovelToken(series.series_type) || isNovelToken(series.category)) {
      return "novel";
    }
    if (series.seriesType && typeof series.seriesType === "object") {
      if (isNovelToken(series.seriesType.title) || isNovelToken(series.seriesType.name)) return "novel";
    }
    var categories = Array.isArray(series.categories) ? series.categories : [];
    for (var i = 0; i < categories.length; i++) {
      var c = categories[i];
      if (c && typeof c === "object" && isNovelToken(c.name || c.title)) return "novel";
    }
    return "manga";
  }

  function getSeriesId(url) {
    var match = String(url || "").match(/\/(?:series|reader|novel|chapter)\/(\d+)/);
    return match ? match[1] : "";
  }

  function getRelId(url) {
    var match = String(url || "").match(/\/chapters\/(\d+)/);
    if (match) return match[1];
    var m2 = String(url || "").match(/\/(?:reader|chapter)\/.*?(\d+)(?:[^\d]|$)/);
    return m2 ? m2[1] : String(url || "").replace(/[^\d]/g, "");
  }

  function toChapter(ch) {
    var releases = Array.isArray(ch.releases) ? ch.releases : [];
    if (!releases.length) return null;
    var relId = String(releases[0].id || "");
    if (!relId) return null;
    var number = formatChapter(ch.chapter || "0");
    var title = String(ch.title || "").trim();
    if (!title) title = "الفصل " + number;
    return {
      number: number,
      title: title,
      views: 0,
      url: apiBase + "/chapters/" + relId,
      isLocked: false,
      date: String(ch.created_at || "")
    };
  }

  return {
    requiresCloudflare: false,

    async getHomepageManga(args) {
      return this.getFilteredManga(args || {});
    },

    async search(args) {
      try {
        var query = (args && args.query) || "";
        var page = (args && args.page) || 1;
        var data = await getJson(apiBase + "/series" + buildQuery({ page: page, title: query }));
        var series = Array.isArray(data.series) ? data.series : [];
        return series.map(toManga).filter(function (x) { return !!x; });
      } catch (e) {
        return [];
      }
    },

    async getFilteredManga(args) {
      try {
        var page = (args && args.page) || 1;
        var data = await getJson(apiBase + "/series" + buildQuery({ page: page }));
        var series = Array.isArray(data.series) ? data.series : [];
        return series.map(toManga).filter(function (x) { return !!x; });
      } catch (e) {
        return [];
      }
    },

    async getMangaDetails(args) {
      var url = (args && args.url) || "";
      var id = getSeriesId(url);
      if (!id) throw new Error("Could not find series id in: " + url);

      var data = await getJson(apiBase + "/series/" + id);
      var series = data.series || data;

      var chData = {};
      try {
        chData = await getJson(apiBase + "/series/" + id + "/chapters");
      } catch (e) { }

      var rawChapters = Array.isArray(chData.chapters) ? chData.chapters : [];
      var chapters = [];
      for (var i = 0; i < rawChapters.length; i++) {
        var ch = toChapter(rawChapters[i]);
        if (ch) chapters.push(ch);
      }
      chapters.sort(function (a, b) {
        return (parseFloat(b.number) || 0) - (parseFloat(a.number) || 0);
      });

      var rawGenres = Array.isArray(series.categories) ? series.categories : [];
      var genres = [];
      for (var gi = 0; gi < rawGenres.length; gi++) {
        var name = String((rawGenres[gi] && (rawGenres[gi].name || rawGenres[gi].title)) || "").trim();
        if (name) genres.push(name);
      }

      var type = detectContentType(series);

      return {
        title: String(series.title || "").trim(),
        coverUrl: coverUrl(String(series.id || id), String(series.cover || "")),
        description: String(series.summary || series.description || "").trim(),
        genres: genres,
        chapters: chapters,
        originalUrl: url,
        hasMoreChapters: false,
        lastFetchedPage: 1,
        contentType: type
      };
    },

    async getChapterPages(args) {
      var relId = getRelId(args && args.url);
      if (!relId) return [];

      // 1. Preferred: High-performance native Dart ECDH P-256 + AES-GCM v12
      if (typeof api.dilarChapter === "function") {
        try {
          var res = await api.dilarChapter(relId);
          if (res && res.imageUrls && res.imageUrls.length) {
            return res.imageUrls;
          }
        } catch (e) { }
      }

      // 2. Headless browser fallback
      if (typeof api.browser === "function") {
        try {
          var html = await api.browser(baseUrl + "/reader/" + relId, { waitForSelector: "img", timeoutSeconds: 8 });
          if (html) {
            var urls = [];
            var re = /https:\/\/dilar\.tube\/uploads\/releases\/[^"']+\/hq\/[^"']+/g;
            var m;
            while ((m = re.exec(html)) !== null) {
              if (m[0] && urls.indexOf(m[0]) === -1) urls.push(m[0]);
            }
            if (urls.length) return urls;
          }
        } catch (e2) { }
      }

      return [];
    },

    async getChapterContent(args) {
      var relId = getRelId(args && args.url);
      if (!relId) return { kind: "image", imageUrls: [] };

      // 1. Preferred: Native Dart bridge (handles both novel text and manga images)
      if (typeof api.dilarChapter === "function") {
        try {
          var res = await api.dilarChapter(relId);
          if (res && res.kind === "text" && res.textContent) {
            return { kind: "text", textContent: res.textContent };
          }
          if (res && res.imageUrls && res.imageUrls.length) {
            return { kind: "image", imageUrls: res.imageUrls };
          }
        } catch (e) { }
      }

      var pages = await this.getChapterPages(args);
      return { kind: "image", imageUrls: pages || [] };
    },

    async fetchMoreChapters() {
      return null;
    },

    async getGenresAndTypes() {
      return { genres: [], types: [] };
    },

    getImageHeaders() {
      return {
        "User-Agent": headers["User-Agent"],
        "Referer": baseUrl + "/"
      };
    },

    sanitizeCoverUrl(args) {
      return (args && args.url) || "";
    }
  };
}
