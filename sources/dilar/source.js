function createSource(api, config) {
  var baseUrl = (config && config.base_url) || "https://dilar.tube";
  var apiBase = baseUrl.replace(/\/$/, "") + "/api";

  var headers = {
    "User-Agent": (config && config.user_agent) || "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "ar,en-US;q=0.9,en;q=0.8",
    "Referer": baseUrl + "/"
  };

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
    return JSON.parse(text);
  }

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

  function getRelId(urlOrId) {
    var value = String(urlOrId || "");
    if (/^\d+$/.test(value)) return value;
    var api = value.match(/\/api\/chapters\/(\d+)/);
    if (api) return api[1];
    var reader = value.match(/\/reader\/\d+\/(\d+)/);
    if (reader) return reader[1];
    var tail = value.match(/\/(\d+)\/?$/);
    return tail ? tail[1] : value;
  }

  async function fetchChapters(seriesId) {
    var data = await getJson(apiBase + "/series/" + seriesId + "/chapters");
    var list = Array.isArray(data.chapters) ? data.chapters : [];
    var chapters = [];
    for (var i = 0; i < list.length; i++) {
      var ch = list[i];
      var releases = Array.isArray(ch.releases) ? ch.releases : [];
      if (!releases.length) continue;
      var relId = String(releases[0].id || "");
      if (!relId) continue;
      var number = formatChapter(ch.chapter || "0");
      var title = String(ch.title || "").trim();
      if (!title) title = "الفصل " + number;
      chapters.push({
        number: number,
        title: title,
        views: 0,
        url: apiBase + "/chapters/" + relId,
        isLocked: false,
        date: String(ch.created_at || "")
      });
    }
    chapters.sort(function (a, b) {
      return (parseFloat(b.number) || 0) - (parseFloat(a.number) || 0);
    });
    return chapters;
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
      var seriesId = getSeriesId(url);
      if (!seriesId) throw new Error("Invalid Dilar URL: " + url);
      var series = await getJson(apiBase + "/series/" + seriesId);
      var type = detectContentType(series);
      var genres = Array.isArray(series.genres)
        ? series.genres.map(function (g) { return String((g && (g.title || g.name)) || ""); }).filter(function (g) { return !!g; })
        : [];
      var chapters = await fetchChapters(seriesId);
      return {
        title: String(series.title || "بدون عنوان"),
        coverUrl: coverUrl(seriesId, String(series.cover || "")),
        description: String(series.summary || ""),
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
      var data = await getJson(apiBase + "/chapters/" + relId);
      var pages = Array.isArray(data.pages) ? data.pages : [];
      var storageKey = String(data.storage_key || "");
      if (!pages.length || !storageKey) return [];
      return pages.map(function (p) {
        return baseUrl + "/uploads/releases/" + storageKey + "/hq/" + String(p.url || "");
      }).filter(function (u) { return u && u.indexOf("/hq/") !== -1; });
    },

    async getChapterContent(args) {
      var relId = getRelId(args && args.url);
      var data = await getJson(apiBase + "/chapters/" + relId);
      var content = data.content ? String(data.content) : "";
      if (content.trim()) {
        var title = data.chapter && data.chapter.title ? String(data.chapter.title) : null;
        return { kind: "text", textContent: content, chapterTitle: title };
      }
      var pages = await this.getChapterPages({ url: apiBase + "/chapters/" + relId });
      return { kind: "image", imageUrls: pages };
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
