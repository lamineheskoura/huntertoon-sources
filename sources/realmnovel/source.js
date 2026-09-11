function createSource(api, config) {
  var baseUrl = ((config && config.base_url) || "http://62.171.141.197:5007").replace(/\/+$/, "");
  var userAgent = (config && config.user_agent) || "Dart/3.9 (dart:io)";
  var lastChapterUrl = baseUrl + "/";

  // Auth: NONE required. The server gates on exact header x-app-version: 10
  // (verified live: "10.0.0" and any other value -> 403/426).
  var defaultHeaders = {
    "x-app-version": "10",
    "User-Agent": userAgent,
    "Accept": "application/json, text/plain, */*",
    "Content-Type": "application/json"
  };

  function makeAbsolute(url) {
    if (!url) return "";
    url = String(url).trim();
    if (url.indexOf("http://") === 0 || url.indexOf("https://") === 0) return url;
    if (url.indexOf("//") === 0) return "http:" + url;
    if (url.indexOf("/") === 0) return baseUrl + url;
    return baseUrl + "/" + url;
  }

  function strip(s) {
    return String(s || "")
      .replace(/<br\s*\/?\s*>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, "\"")
      .replace(/&#39;/g, "'")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function coverUrl(novelId) {
    // API coverImage is an inline base64 blob — use the CDN file instead.
    if (!novelId) return "";
    return "https://www.realmnovel.com/img/novel/" + novelId + ".jpg";
  }

  async function apiGet(path) {
    var url = makeAbsolute(path);
    var res = await api.http(url, { method: "GET", headers: defaultHeaders });
    if (!res || !res.ok) throw new Error("HTTP " + (res ? res.status : 0) + " for " + url);
    return JSON.parse(res.body || "{}");
  }

  function novelToItem(n) {
    if (!n || typeof n !== "object") return null;
    var id = n._id || n.id || "";
    if (!id) return null;
    return {
      title: n.title || n.titleEn || "",
      coverUrl: coverUrl(id),
      detailUrl: baseUrl + "/novels/" + id,
      contentType: "novel"
    };
  }

  function chapterToItem(c, novelId) {
    if (!c || typeof c !== "object") return null;
    var num = String(c.chapterNumber != null ? c.chapterNumber : "");
    if (!num) return null;
    return {
      number: num,
      title: c.title || ("الفصل " + num),
      views: c.viewsCount || 0,
      url: baseUrl + "/novels/" + novelId + "/chapters/" + num,
      isLocked: false,
      date: (c.createdAt || "").split("T")[0]
    };
  }

  function novelIdFromUrl(url) {
    var m = String(url || "").match(/\/novels\/([0-9a-f]+)/i);
    return m ? m[1] : "";
  }

  async function fetchChapterPage(novelId, page, limit) {
    var data = await apiGet("/novels/" + novelId + "/chapters?limit=" + (limit || 100) + "&page=" + page);
    var items = data.data || [];
    var out = [];
    for (var i = 0; i < items.length; i++) {
      var it = chapterToItem(items[i], novelId);
      if (it) out.push(it);
    }
    var pag = data.pagination || {};
    return { chapters: out, hasMore: pag.hasNextPage === true };
  }

  return {
    requiresCloudflare: false,

    async getHomepageManga(args) {
      try {
        var page = (args && args.page) || 1;
        var data = await apiGet("/novels?limit=20&page=" + page);
        var items = data.data || [];
        var out = [];
        for (var i = 0; i < items.length; i++) {
          var it = novelToItem(items[i]);
          if (it) out.push(it);
        }
        return out;
      } catch (e) {
        return [];
      }
    },

    async search(args) {
      try {
        var query = (args && args.query) || "";
        var page = (args && args.page) || 1;
        if (!query.trim()) return [];
        var data = await apiGet("/novels/search?q=" + encodeURIComponent(query) + "&limit=20&page=" + page);
        var items = data.data || [];
        var out = [];
        for (var i = 0; i < items.length; i++) {
          var it = novelToItem(items[i]);
          if (it) out.push(it);
        }
        return out;
      } catch (e) {
        return [];
      }
    },

    async getFilteredManga(args) {
      return await this.getHomepageManga(args || {});
    },

    async getGenresAndTypes() {
      return { genres: [], types: ["novel"] };
    },

    async getMangaDetails(args) {
      var rawUrl = makeAbsolute((args && args.url) || "");
      var novelId = novelIdFromUrl(rawUrl);
      if (!novelId) throw new Error("Bad novel URL: " + rawUrl);

      var data = await apiGet("/novels/" + novelId);
      var novel = data.data || data;
      if (!novel || !novel._id) throw new Error("Manga not found: " + novelId);

      var first = await fetchChapterPage(novelId, 1, 100);

      var genres = [];
      if (Array.isArray(novel.tags)) {
        for (var i = 0; i < novel.tags.length; i++) {
          var g = String(novel.tags[i] == null ? "" : novel.tags[i]).trim();
          if (g) genres.push(g);
        }
      }

      return {
        title: novel.title || novel.titleEn || "بدون عنوان",
        coverUrl: coverUrl(novel._id),
        description: strip(novel.description || ""),
        genres: genres,
        status: novel.status || "",
        chapters: first.chapters,
        originalUrl: rawUrl,
        hasMoreChapters: first.hasMore,
        lastFetchedPage: 1,
        contentType: "novel"
      };
    },

    async fetchMoreChapters(args) {
      try {
        // App calls with FLAT args {url, nextPage}; also accept legacy
        // {previousResult: {originalUrl, lastFetchedPage}} shape.
        var prev = (args && args.previousResult) || {};
        var rawUrl = (args && args.url) || prev.originalUrl || "";
        var slug = novelIdFromUrl(rawUrl);
        if (!slug) return null;
        var nextPage = (args && args.nextPage) || ((prev.lastFetchedPage || 1) + 1);
        nextPage = parseInt(nextPage, 10) || 2;
        if (nextPage < 2) nextPage = 2;
        if (nextPage > 100) return null;
        var res = await fetchChapterPage(slug, nextPage, 100);
        if (!res.chapters.length) return null;
        return {
          chapters: res.chapters,
          hasMoreChapters: res.hasMore,
          lastFetchedPage: nextPage
        };
      } catch (e) {
        return null;
      }
    },

    async getChapterPages(args) {
      return [];
    },

    async getChapterContent(args) {
      var rawUrl = makeAbsolute((args && args.url) || "");
      lastChapterUrl = rawUrl || lastChapterUrl;
      var m = rawUrl.match(/\/novels\/([0-9a-f]+)\/chapters\/(\d+)/i);
      if (!m) throw new Error("Bad chapter URL: " + rawUrl);
      var data = await apiGet("/novels/" + m[1] + "/chapters/" + m[2]);
      var chapter = data.data || data;
      if (!chapter || !chapter.content) {
        return { kind: "text", chapterTitle: "", textContent: "" };
      }
      return {
        kind: "text",
        chapterTitle: strip(chapter.title || "") || ("الفصل " + m[2]),
        textContent: chapter.content
      };
    },

    getImageHeaders() {
      return {
        "User-Agent": userAgent,
        "Referer": "https://www.realmnovel.com/",
        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8"
      };
    },

    sanitizeCoverUrl(args) {
      var u = makeAbsolute((args && args.url) || "");
      var nid = novelIdFromUrl(u);
      return nid ? coverUrl(nid) : u;
    }
  };
}

if (typeof module !== "undefined") module.exports = { createSource: createSource };
