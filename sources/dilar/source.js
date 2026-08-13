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

  function base64UrlDecode(str) {
    var b64 = String(str || "").replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    var out = "";
    var buffer = 0, bits = 0;
    for (var i = 0; i < b64.length; i++) {
      var c = b64.charAt(i);
      if (c === "=") break;
      var idx = chars.indexOf(c);
      if (idx < 0) continue;
      buffer = (buffer << 6) | idx;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        out += String.fromCharCode((buffer >> bits) & 0xff);
      }
    }
    return out;
  }

  function jwtPayload(token) {
    try {
      var parts = String(token || "").split(".");
      if (parts.length < 2) return null;
      return JSON.parse(base64UrlDecode(parts[1]));
    } catch (e) {
      return null;
    }
  }

  async function getStorageKey(relId) {
    try {
      var res = await api.http(apiBase + "/releases/" + relId + "/grant", {
        method: "POST",
        headers: {
          "User-Agent": headers["User-Agent"],
          "Accept": "application/json, text/plain, */*",
          "Accept-Language": "ar,en-US;q=0.9,en;q=0.8",
          "Content-Type": "application/json",
          "Referer": baseUrl + "/"
        },
        body: "{}"
      });
      var text = (res && res.body) || "";
      var data = JSON.parse(text);
      var payload = jwtPayload(data && data.grant);
      return (payload && payload.sk) || "";
    } catch (e) {
      return "";
    }
  }

  function pageExists(url) {
    return api.http(url, { method: "HEAD", headers: { "Referer": baseUrl + "/" } })
      .then(function (res) { return !!(res && res.ok); })
      .catch(function () { return false; });
  }

  async function collectPages(storageKey) {
    var found = [];
    var hqBase = baseUrl + "/uploads/releases/" + storageKey + "/hq/";
    var useC = await pageExists(hqBase + "0c.webp");
    var start = 0;
    if (!useC) {
      if (await pageExists(hqBase + "1.webp")) start = 1;
      else if (await pageExists(hqBase + "0.webp")) start = 0;
      else return found;
    }
    for (var i = start; i < 200; i++) {
      var name = useC ? i + "c.webp" : i + ".webp";
      if (!(await pageExists(hqBase + name))) break;
      found.push(hqBase + name);
    }
    return found;
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
      var storageKey = await getStorageKey(relId);
      if (!storageKey) return [];
      return collectPages(storageKey);
    },

    async getChapterContent(args) {
      try {
        var relId = getRelId(args && args.url);
        var storageKey = await getStorageKey(relId);
        if (storageKey) {
          var pages = await collectPages(storageKey);
          if (pages.length) return { kind: "image", imageUrls: pages };
        }
      } catch (e) { }
      return { kind: "image", imageUrls: [] };
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
