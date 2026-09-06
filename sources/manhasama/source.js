function createSource(api, config) {
  var baseUrl = (config && config.base_url) || "https://realmnovel.com";
  var apiUrl = baseUrl + "/api";
  var userAgent = (config && config.user_agent) || "Dart/3.6 (dart:io)";

  var defaultHeaders = {
    "User-Agent": userAgent,
    "Accept": "application/json",
    "Authorization": "Bearer guest",
    "X-Device-ID": "manha-huntertoon-" + (config && config.deviceId ? config.deviceId : "app")
  };

  var defaultGenres = [];
  var defaultTypes = ["manga", "manhwa", "manhua"];

  function makeAbsolute(url) {
    if (!url) return "";
    if (url.indexOf("http") === 0) return url;
    if (url.indexOf("//") === 0) return "https:" + url;
    return baseUrl + url;
  }

  function makeCdnUrl(url) {
    if (!url) return "";
    if (url.indexOf("http") === 0) return url;
    return "https://cdn.realmnovel.com" + url;
  }

  function extractNumber(str) {
    var m = String(str || "").match(/(\d+(?:\.\d+)?)/);
    return m ? m[1] : "0";
  }

  function validImage(src) {
    src = makeAbsolute(src);
    if (!src || src.indexOf("data:image") === 0) return "";
    return src;
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

  async function apiGet(path) {
    var url = apiUrl + path;
    var res = await api.http(url, {
      method: "GET",
      headers: defaultHeaders
    });
    if (!res || !res.ok) throw new Error("HTTP " + (res ? res.status : 0) + " for " + url);
    return JSON.parse(res.body || "{}");
  }

  function toManga(item) {
    var cover = item.cover || item.coverThumb || "";
    return {
      title: item.arabicTitle || item.englishTitle || "",
      detailUrl: baseUrl + "/manga/" + (item.slug || item._id || ""),
      coverUrl: makeCdnUrl(cover),
      contentType: "manga"
    };
  }

  return {
    requiresCloudflare: false,

    async getHomepageManga(args) {
      try {
        var page = (args && args.page) || 1;
        var data = await apiGet("/manga?page=" + page + "&limit=20");
        var items = data.items || [];
        return items.map(toManga);
      } catch (e) {
        return [];
      }
    },

    async search(args) {
      try {
        var query = (args && args.query) || "";
        if (!query.trim()) return [];
        var data = await apiGet("/manga?search=" + encodeURIComponent(query) + "&limit=20");
        var items = data.items || [];
        return items.map(toManga);
      } catch (e) {
        return [];
      }
    },

    async getFilteredManga(args) {
      try {
        var page = (args && args.page) || 1;
        var params = ["page=" + page, "limit=20"];
        if (args && args.genre) {
          params.push("cat=" + encodeURIComponent(args.genre));
        }
        if (args && args.status) {
          params.push("status=" + encodeURIComponent(args.status));
        }
        var data = await apiGet("/manga?" + params.join("&"));
        var items = data.items || [];
        return items.map(toManga);
      } catch (e) {
        return [];
      }
    },

    async getGenresAndTypes() {
      try {
        var data = await apiGet("/categories");
        var items = data.items || [];
        defaultGenres = items.map(function (c) { return c.name || ""; }).filter(Boolean);
      } catch (e) {}
      return { genres: defaultGenres, types: defaultTypes };
    },

    async getMangaDetails(args) {
      var slug = "";
      var rawUrl = (args && args.url) || "";
      var m = rawUrl.match(/\/manga\/([^/?#]+)/);
      if (m) slug = m[1];

      var data = await apiGet("/manga/" + slug);
      var manga = data.manga || data;
      if (!manga || !manga._id) throw new Error("Manga not found: " + slug);

      var title = manga.arabicTitle || manga.englishTitle || "بدون عنوان";
      var coverRaw = manga.cover || manga.coverThumb || "";
      var cover = makeCdnUrl(coverRaw);
      var desc = manga.description || "";
      var genres = (manga.categories || []).map(function (c) { return c.name || ""; }).filter(Boolean);
      var status = manga.status || "ongoing";

      var chData = await apiGet("/manga/" + slug + "/chapters?limit=200&page=1");
      var allItems = chData.items || [];
      var total = chData.total || 0;
      var limit = chData.limit || 200;
      var totalPages = Math.ceil(total / limit);
      for (var p = 2; p <= totalPages; p++) {
        var more = await apiGet("/manga/" + slug + "/chapters?limit=200&page=" + p);
        var moreItems = more.items || [];
        allItems = allItems.concat(moreItems);
      }
      var chapters = allItems.map(function (c) {
        return {
          number: extractNumber(c.number),
          title: c.title || c.number || "",
          views: 0,
          url: baseUrl + "/chapters/" + c._id,
          isLocked: false,
          date: (c.createdAt || "").split("T")[0]
        };
      });

      return {
        title: title,
        coverUrl: cover,
        description: strip(desc),
        genres: genres,
        chapters: chapters,
        originalUrl: rawUrl || (baseUrl + "/manga/" + slug),
        hasMoreChapters: false,
        lastFetchedPage: 1,
        contentType: "manga"
      };
    },

    async getChapterPages(args) {
      var content = await this.getChapterContent(args);
      if (content.kind === "image") return content.imageUrls || [];
      if (content.kind === "overlay") return content.imageUrls || [];
      return [];
    },

    async getChapterContent(args) {
      var rawUrl = (args && args.url) || "";
      var m = rawUrl.match(/\/chapters\/([^/?#]+)/);
      var chapterId = m ? m[1] : "";

      var data = await apiGet("/chapters/" + chapterId);
      var chapter = data.chapter || data;
      if (!chapter || !chapter.pages) {
        return { kind: "image", imageUrls: [] };
      }

      var pages = chapter.pages || [];
      var urls = pages.map(function (p) {
        return validImage(p.image || p.url || "");
      }).filter(Boolean);

      var hasOverlay = pages.some(function (p) { return p.hasOverlay === true; });

      if (!hasOverlay) {
        return { kind: "image", imageUrls: urls };
      }

      var pageOverlays = pages.map(function (p, idx) {
        var bubbles = p.bubbles || [];
        var overlays = bubbles.map(function (b) {
          var box = b.box || [0, 0, 0, 0];
          // boxNorm = resolution-independent [nx, ny, nw, nh] (0-1). Prefer it in
          // the app renderer over pixel box (immune to per-page size variance).
          var norm = b.boxNorm || null;
          return {
            id: b.id || "",
            text: b.text || "",
            english: b.english || "",
            x: box[0] || 0,
            y: box[1] || 0,
            w: box[2] || 0,
            h: box[3] || 0,
            nx: norm ? (Number(norm[0]) || 0) : 0,
            ny: norm ? (Number(norm[1]) || 0) : 0,
            nw: norm ? (Number(norm[2]) || 0) : 0,
            nh: norm ? (Number(norm[3]) || 0) : 0,
            hasNorm: !!norm,
            angle: 0
          };
        });
        return overlays;
      });

      var naturalImageWidth = 0;
      var naturalImageHeight = 0;
      for (var i = 0; i < pages.length; i++) {
        var pw = Number(pages[i].width) || 0;
        var ph = Number(pages[i].height) || 0;
        if (pw > naturalImageWidth) naturalImageWidth = pw;
        if (ph > naturalImageHeight) naturalImageHeight = ph;
      }

      return {
        kind: "overlay",
        imageUrls: urls,
        pageOverlays: pageOverlays,
        naturalImageWidth: naturalImageWidth,
        naturalImageHeight: naturalImageHeight
      };
    },

    async fetchMoreChapters(args) {
      try {
        var prev = (args && args.previousResult) || {};
        var rawUrl = prev.originalUrl || "";
        var m = rawUrl.match(/\/manga\/([^/?#]+)/);
        var slug = m ? m[1] : "";
        if (!slug) return null;

        var nextPage = (prev.lastFetchedPage || 1) + 1;
        var chData = await apiGet("/manga/" + slug + "/chapters?limit=200&page=" + nextPage);
        var chItems = chData.items || [];
        if (chItems.length === 0) return null;

        var chapters = chItems.map(function (c) {
          return {
            number: extractNumber(c.number),
            title: c.title || c.number || "",
            views: 0,
            url: baseUrl + "/chapters/" + c._id,
            isLocked: false,
            date: (c.createdAt || "").split("T")[0]
          };
        });

        return {
          chapters: chapters,
          hasMoreChapters: !!chData.hasMore,
          lastFetchedPage: nextPage
        };
      } catch (e) {
        return null;
      }
    },

    getImageHeaders(args) {
      return {
        "User-Agent": userAgent,
        Referer: baseUrl + "/",
        Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8"
      };
    },

    sanitizeCoverUrl(args) {
      return makeCdnUrl((args && args.url) || "") || ((args && args.url) || "");
    }
  };
}

if (typeof module !== "undefined") module.exports = { createSource: createSource };
