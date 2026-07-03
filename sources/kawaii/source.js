function createSource(api, config) {
  var baseUrl = ((config && config.base_url) || "https://kawaiimanga.org").replace(/\/+$/, "");
  var apiBase = "https://manga-api.kawaii-anime.com/api/manga/own";
  var apiKey = "km_2026_live";
  var userAgent = (config && config.user_agent) || "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";

  var headers = {
    "User-Agent": userAgent,
    "Accept": "application/json",
    "Accept-Language": "ar,en-US;q=0.9,en;q=0.8",
    "Referer": baseUrl + "/",
    "x-app-key": apiKey
  };

  var defaultGenres = ["أكشن","رومانسي","خيال","إثارة","كوميديا","دراما","رعب","مدرسي","خارق للطبيعة","شونين","شوجو","إيسيكاي","رياضة","غموض"];
  var defaultTypes = ["مانجا","مانهوا","مانها"];
  var sortMap = { "popular": "views", "latest": "", "rating": "rating", "alphabetical": "alphabetical" };
  var cache = {};

  async function apiCall(action, params) {
    var cacheKey = action + ":" + JSON.stringify(params || {});
    if (cache[cacheKey]) return cache[cacheKey];
    var url = apiBase + "?action=" + encodeURIComponent(action);
    if (params) {
      for (var key in params) {
        if (params[key] !== null && params[key] !== undefined && params[key] !== "") {
          url += "&" + encodeURIComponent(key) + "=" + encodeURIComponent(String(params[key]));
        }
      }
    }
    if (api.http) {
      var res = await api.http(url, { method: "GET", headers: headers });
      if (!res || !res.ok) return null;
      var data = JSON.parse(res.body);
      if (data) cache[cacheKey] = data;
      return data;
    }
    var text = await api.fetchText(url, headers);
    if (!text) return null;
    var data = JSON.parse(text);
    if (data) cache[cacheKey] = data;
    return data;
  }

  function sanitizeImage(url) {
    if (!url) return "";
    url = String(url).trim();
    if (url.indexOf("http://") === 0) return "https:" + url.substring(5);
    if (url.indexOf("https://") === 0) return url;
    if (url.indexOf("//") === 0) return "https:" + url;
    if (url.indexOf("/") === 0) return baseUrl + url;
    if (url.indexOf("data:") === 0) return "";
    if (url.indexOf("http") !== 0) return baseUrl + "/" + url;
    return url;
  }

  function extractSlug(url) {
    var m = String(url || "").match(/\/(?:manga|reader)\/([^\/?#]+)/);
    return m ? m[1] : "";
  }

  function mapStatus(status) {
    if (status === "completed") return "مكتملة";
    if (status === "ongoing") return "مستمرة";
    return status || "";
  }

  function mapType(type) {
    if (type === "manhwa") return "مانهوا";
    if (type === "manhua") return "مانها";
    if (type === "manga") return "مانجا";
    return type || "";
  }

  function toManga(item) {
    return {
      title: item.title || "",
      coverUrl: sanitizeImage(item.coverUrl || ""),
      detailUrl: baseUrl + "/manga/" + (item.slug || item.id || ""),
      contentType: "manga"
    };
  }

  return {
    requiresCloudflare: false,

    async getHomepageManga(args) {
      try {
        var page = (args && args.page) || 1;
        var data = await apiCall("browse", { page: page, limit: 30, sort: "" });
        if (!data || !data.results) return [];
        return data.results.map(toManga);
      } catch (e) { return []; }
    },

    async search(args) {
      try {
        var query = (args && args.query) || "";
        if (!query.trim()) return [];
        var data = await apiCall("search", { q: query });
        if (!data || !data.results) return [];
        return data.results.map(toManga);
      } catch (e) { return []; }
    },

    async getFilteredManga(args) {
      try {
        var page = (args && args.page) || 1;
        var sort = "";
        if (args && args.sort && sortMap[args.sort]) sort = sortMap[args.sort];
        var data = await apiCall("browse", { page: 1, limit: 200, sort: sort });
        if (!data || !data.results) return [];
        var results = data.results;
        if (args && args.genre) {
          results = results.filter(function(item) {
            return item.genres && item.genres.indexOf(args.genre) !== -1;
          });
        }
        if (args && args.type) {
          results = results.filter(function(item) {
            return mapType(item.type) === args.type || item.type === args.type;
          });
        }
        if (args && args.status) {
          results = results.filter(function(item) {
            return item.status === args.status;
          });
        }
        var perPage = 30;
        var start = (page - 1) * perPage;
        var paged = results.slice(start, start + perPage);
        return paged.map(toManga);
      } catch (e) { return this.getHomepageManga(args); }
    },

    async getMangaDetails(args) {
      var url = (args && args.url) || "";
      var slug = extractSlug(url);
      if (!slug) {
        return {
          title: "بدون عنوان", coverUrl: "", description: "",
          genres: [], chapters: [], originalUrl: url,
          hasMoreChapters: false, lastFetchedPage: 1, contentType: "manga"
        };
      }
      var data = await apiCall("series", { slug: slug });
      if (!data) {
        return {
          title: slug, coverUrl: "", description: "",
          genres: [], chapters: [], originalUrl: url,
          hasMoreChapters: false, lastFetchedPage: 1, contentType: "manga"
        };
      }
      var chapters = [];
      if (data.chapters && data.chapters.length) {
        for (var i = 0; i < data.chapters.length; i++) {
          var ch = data.chapters[i];
          var num = String(ch.number);
          chapters.push({
            number: num,
            title: ch.title || "الفصل " + num,
            views: 0,
            url: JSON.stringify({ slug: slug, num: num, id: ch.id }),
            isLocked: false,
            date: ch.createdAt || ""
          });
        }
        chapters.sort(function(a, b) {
          return (parseFloat(b.number) || 0) - (parseFloat(a.number) || 0);
        });
      }
      return {
        title: data.title || slug,
        coverUrl: sanitizeImage(data.coverUrl || ""),
        description: data.description || "",
        genres: data.genres || [],
        chapters: chapters,
        originalUrl: url,
        hasMoreChapters: false,
        lastFetchedPage: 1,
        contentType: "manga"
      };
    },

    async getChapterPages(args) {
      var raw = (args && args.url) || "";
      var ref = {};
      try { ref = JSON.parse(raw); } catch (e) {
        var m = String(raw).match(/\/(?:manga|reader)\/([^\/]+)\/(\d+)/);
        if (m) ref = { slug: m[1], num: m[2] };
        else return [];
      }
      if (ref.id) {
        var data = await apiCall("pages", { chapterId: ref.id });
        if (data && data.pages && data.pages.length) return data.pages;
      }
      if (ref.slug && ref.num) {
        var series = await apiCall("series", { slug: ref.slug });
        if (series && series.chapters) {
          var pageCount = 0;
          for (var i = 0; i < series.chapters.length; i++) {
            if (String(series.chapters[i].number) === ref.num) {
              pageCount = series.chapters[i].pageCount || 0;
              if (series.chapters[i].id && !ref.id) ref.id = series.chapters[i].id;
              break;
            }
          }
          if (ref.id) {
            var pagesData = await apiCall("pages", { chapterId: ref.id });
            if (pagesData && pagesData.pages && pagesData.pages.length) return pagesData.pages;
          }
          if (pageCount > 0) {
            var urls = [];
            for (var p = 1; p <= pageCount; p++) {
              var pad = ("000" + p).slice(-3);
              urls.push("https://manga-cdn.kawaii-anime.com/manga/" + ref.slug + "/chapters/" + ref.num + "/p" + pad + ".webp");
            }
            return urls;
          }
        }
      }
      return [];
    },

    async getChapterContent(args) {
      return { kind: "image", imageUrls: await this.getChapterPages(args) };
    },

    async fetchMoreChapters() {
      return null;
    },

    async getGenresAndTypes() {
      return { genres: defaultGenres, types: defaultTypes };
    },

    getImageHeaders() {
      return {
        "User-Agent": userAgent,
        "Referer": baseUrl + "/",
        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "Accept-Language": "ar,en-US;q=0.9,en;q=0.8",
        "Sec-Fetch-Dest": "image",
        "Sec-Fetch-Mode": "no-cors",
        "Sec-Fetch-Site": "cross-site"
      };
    },

    sanitizeCoverUrl(args) {
      return sanitizeImage((args && args.url) || "");
    }
  };
}

if (typeof module !== "undefined") module.exports = { createSource: createSource };