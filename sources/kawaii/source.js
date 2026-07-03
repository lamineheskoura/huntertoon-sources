function createSource(api, config) {
  var baseUrl = ((config && config.base_url) || "https://kawaiimanga.org").replace(/\/+$/, "");
  var apiBase = "https://manga-api.kawaii-anime.com/api/manga/own";
  var cdnBase = "https://manga-cdn.kawaii-anime.com";
  var apiKey = "km_2026_live";
  var userAgent = (config && config.user_agent) || "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";

  var headers = {
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

  var apiHeaders = {
    "User-Agent": userAgent,
    "Accept": "application/json",
    "Accept-Language": "ar,en-US;q=0.9,en;q=0.8",
    "Referer": baseUrl + "/",
    "x-app-key": apiKey
  };

  var defaultGenres = ["أكشن", "رومانسي", "خيال", "إثارة", "كوميديا", "دراما", "رعب", "مدرسي", "مغامرة", "سحر", "وحوش", "سفر بالزمن", "خارق للطبيعة"];
  var defaultTypes = ["مانجا", "مانهوا", "مانها"];
  var seriesCache = {};

  function fetchHtml(url) {
    if (api.http) {
      return api.http(url, { method: "GET", headers: headers }).then(function(res) {
        if (!res || !res.ok) throw new Error("HTTP " + (res ? res.status : 0) + " for " + url);
        return res.body || "";
      });
    }
    return api.fetchText(url, headers).then(function(html) {
      if (!html) throw new Error("Empty response: " + url);
      return html;
    });
  }

  function callApi(slug) {
    if (seriesCache[slug]) return Promise.resolve(seriesCache[slug]);
    var url = apiBase + "?action=series&slug=" + encodeURIComponent(slug);
    return api.http(url, { method: "GET", headers: apiHeaders }).then(function(res) {
      if (!res || !res.ok) return null;
      var data = JSON.parse(res.body);
      if (data) seriesCache[slug] = data;
      return data;
    });
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

  function sanitizeImage(url) {
    url = makeAbsolute(url);
    if (!url || url.indexOf("data:") === 0) return "";
    var m = url.match(/[?&]url=([^&]+)/);
    if (m) {
      try { url = decodeURIComponent(m[1]); } catch (e) {}
    }
    return url;
  }

  function extractSlug(url) {
    var m = String(url || "").match(/\/(?:manga|reader)\/([^\/?#]+)/);
    return m ? m[1] : "";
  }

  function scrapeCards(html) {
    return api.cssMap(html, "a[href*='/manga/']", {
      title: { selector: "h3", type: "text" },
      cover: { selector: "img", type: "attr", attr: "src" },
      href: { selector: "", type: "attr", attr: "href" }
    }).then(function(items) {
      var results = [];
      var seen = {};
      for (var i = 0; i < items.length; i++) {
        var title = (items[i].title || "").trim();
        var detailUrl = makeAbsolute(items[i].href || "");
        if (!title || !detailUrl || seen[detailUrl]) continue;
        if (detailUrl.indexOf("/manga/") === -1) continue;
        seen[detailUrl] = true;
        results.push({
          title: title,
          detailUrl: detailUrl,
          coverUrl: sanitizeImage(items[i].cover),
          contentType: "manga"
        });
      }
      return results;
    });
  }

  return {
    requiresCloudflare: false,

    getHomepageManga: function(args) {
      try {
        var page = (args && args.page) || 1;
        var url = baseUrl + "/browse" + (page > 1 ? "?page=" + page : "");
        return fetchHtml(url).then(scrapeCards);
      } catch (e) { return Promise.resolve([]); }
    },

    search: function(args) {
      try {
        var query = (args && args.query) || "";
        var page = (args && args.page) || 1;
        if (!query.trim()) return Promise.resolve([]);
        var url = baseUrl + "/search?q=" + encodeURIComponent(query) + (page > 1 ? "&page=" + page : "");
        return fetchHtml(url).then(scrapeCards);
      } catch (e) { return Promise.resolve([]); }
    },

    getFilteredManga: function(args) {
      try {
        var page = (args && args.page) || 1;
        var params = [];
        if (args && args.genre) params.push("genre=" + encodeURIComponent(args.genre));
        if (args && args.type) params.push("type=" + encodeURIComponent(args.type));
        if (page > 1) params.push("page=" + page);
        var suffix = params.length ? "?" + params.join("&") : "";
        return fetchHtml(baseUrl + "/browse" + suffix).then(scrapeCards);
      } catch (e) { return Promise.resolve([]); }
    },

    getMangaDetails: function(args) {
      var url = makeAbsolute((args && args.url) || "");
      var slug = extractSlug(url);
      if (!slug) {
        return Promise.resolve({
          title: "بدون عنوان",
          coverUrl: "",
          description: "",
          genres: [],
          chapters: [],
          originalUrl: url,
          hasMoreChapters: false,
          lastFetchedPage: 1,
          contentType: "manga"
        });
      }
      return callApi(slug).then(function(data) {
        if (!data) {
          return {
            title: slug,
            coverUrl: "",
            description: "",
            genres: [],
            chapters: [],
            originalUrl: url,
            hasMoreChapters: false,
            lastFetchedPage: 1,
            contentType: "manga"
          };
        }

        var coverUrl = data.coverUrl || data.image || data.cover || "";
        if (coverUrl && coverUrl.indexOf("http") === -1 && coverUrl.indexOf("/") === 0) {
          coverUrl = cdnBase + coverUrl;
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
              url: baseUrl + "/reader/" + slug + "/" + num,
              isLocked: false,
              date: ch.date || String(ch.createdAt || "")
            });
          }
          chapters.sort(function(a, b) {
            return (parseFloat(b.number) || 0) - (parseFloat(a.number) || 0);
          });
        }

        return {
          title: data.title || data.titleAr || slug,
          coverUrl: sanitizeImage(coverUrl),
          description: data.description || data.summary || "",
          genres: Array.isArray(data.genres) ? data.genres : [],
          chapters: chapters,
          originalUrl: url,
          hasMoreChapters: false,
          lastFetchedPage: 1,
          contentType: "manga"
        };
      });
    },

    getChapterPages: function(args) {
      var chapterUrl = (args && args.url) || "";
      var m = chapterUrl.match(/\/(?:manga|reader)\/([^\/]+)\/(\d+)/);
      if (!m) return Promise.resolve([]);
      var slug = m[1];
      var chNum = m[2];

      return callApi(slug).then(function(data) {
        if (!data || !data.chapters) return [];

        var pageCount = 0;
        for (var i = 0; i < data.chapters.length; i++) {
          if (String(data.chapters[i].number) === chNum) {
            pageCount = data.chapters[i].pageCount || 0;
            break;
          }
        }
        if (!pageCount) return [];

        var urls = [];
        for (var p = 1; p <= pageCount; p++) {
          var pad = ("000" + p).slice(-3);
          urls.push(cdnBase + "/manga/" + slug + "/chapters/" + chNum + "/p" + pad + ".webp");
        }
        return urls;
      });
    },

    getChapterContent: function(args) {
      return this.getChapterPages(args).then(function(urls) {
        return { kind: "image", imageUrls: urls };
      });
    },

    fetchMoreChapters: function() {
      return Promise.resolve(null);
    },

    getGenresAndTypes: function() {
      return Promise.resolve({ genres: defaultGenres, types: defaultTypes });
    },

    getImageHeaders: function() {
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

    sanitizeCoverUrl: function(args) {
      return sanitizeImage((args && args.url) || "");
    }
  };
}

if (typeof module !== "undefined") module.exports = { createSource: createSource };