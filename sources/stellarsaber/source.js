function createSource(api, config) {
  var baseUrl = ((config && config.base_url) || "https://stellarsaber.pro").replace(/\/+$/, "");
  var configHeaders = (config && config.headers) || {};
  var userAgent =
    configHeaders["User-Agent"] ||
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
  var lastChapterUrl = baseUrl + "/";

  var typeBadgeMap = {
    "\u0645\u0627\u0646\u062C\u0627": "manga",
    "\u0645\u0627\u0646\u0647\u0627": "manhua",
    "\u0623\u0646\u0645\u064A": "anime",
    "\u0631\u0648\u0627\u064A\u0629": "novel",
    "\u0641\u064A\u0644\u0645": "movie"
  };

  var defaultGenres = [
    "Action", "Thriller", "Isekai", "Historical", "Josei", "Harem",
    "School Life", "Supernatural", "Sci-Fi", "Drama", "Horror",
    "Romance", "Sports", "Seinen", "Slice of Life", "Shoujo", "Shounen",
    "Mystery", "Fantasy", "Martial Arts", "Comedy", "Adult", "Tragedy",
    "Manhua", "Adventure", "Mecha", "Mature", "Psychological"
  ];

  var genreSlugMap = {
    "action": "action", "thriller": "thriller", "isekai": "isekai",
    "historical": "historical", "josei": "josei", "harem": "harem",
    "school life": "school-life", "supernatural": "supernatural",
    "sci-fi": "sci-fi", "drama": "drama", "horror": "horror",
    "romance": "romance", "sports": "sports", "seinen": "seinen",
    "slice of life": "slice-of-life", "shoujo": "shoujo", "shounen": "shounen",
    "mystery": "mystery", "fantasy": "fantasy", "martial arts": "martial-arts",
    "comedy": "comedy", "adult": "adult", "tragedy": "tragedy",
    "manhua": "manhua", "adventure": "adventure", "mecha": "mecha",
    "mature": "mature", "psychological": "psychological"
  };

  var defaultTypes = ["manga", "manhua", "anime", "novel", "movie"];

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

  function mergeHeaders(a, b) {
    var out = {};
    for (var k in a) out[k] = a[k];
    if (b) for (var x in b) out[x] = b[x];
    return out;
  }

  async function fetchHtml(url, extraHeaders, method) {
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
    if (url.indexOf("/") === 0) return baseUrl.replace(/\/+$/, "") + url;
    return baseUrl.replace(/\/+$/, "") + "/" + url;
  }

  function guessContentType(typeText) {
    var mapped = typeBadgeMap[typeText];
    return mapped || "manga";
  }

  function extractChapterNumber(url) {
    var m = url.match(/\u0627\u0644\u0641\u0635\u0644-(\d+)/);
    if (m) return m[1];
    var m2 = url.match(/\/chapter\/[^/]+?-(\d+)\/?$/);
    if (m2) return m2[1];
    return "0";
  }

  var statusMap = {
    "\u0645\u0633\u062A\u0645\u0631\u0629": "ongoing",
    "\u0645\u0643\u062A\u0645\u0644\u0629": "completed",
    "\u0645\u062A\u0648\u0642\u0641\u0629": "hiatus",
    "\u0642\u0627\u062F\u0645\u0629": "upcoming",
    "\u0645\u0644\u063A\u0627\u0629": "cancelled"
  };

  async function parseCards(html) {
    var items = await api.cssAll(html, "a.card");
    var out = [];
    var seen = {};
    for (var i = 0; i < items.length; i++) {
      var item = items[i] || {};
      var inner = item.html || "";
      var attrs = item.attrs || {};
      var detailUrl = makeAbsolute(attrs.href || "");
      if (!detailUrl || detailUrl.indexOf("/manga/") === -1 && detailUrl.indexOf("/anime/") === -1 && detailUrl.indexOf("/novel/") === -1) continue;
      if (seen[detailUrl]) continue;
      seen[detailUrl] = true;

      var title = "";
      var titleEl = await api.cssText(inner, ".card__title");
      if (titleEl) title = cleanTitle(titleEl);
      if (!title) {
        var imgAlt = await api.cssAttr(inner, "img", "alt");
        if (imgAlt) title = cleanTitle(imgAlt);
      }
      if (!title) continue;

      var cover = await api.cssAttr(inner, "img", "src");
      if (cover) cover = makeAbsolute(cover);

      var typeText = await api.cssText(inner, ".card__type-badge") || "";
      var contentType = guessContentType(cleanTitle(typeText));

      out.push({
        title: title,
        coverUrl: cover || "",
        detailUrl: detailUrl,
        contentType: contentType
      });
    }
    return out;
  }

  async function extractChapters(html) {
    var items = await api.cssAll(html, "a.chapter-item");
    var chapters = [];
    var seen = {};
    for (var i = 0; i < items.length; i++) {
      var item = items[i] || {};
      var attrs = item.attrs || {};
      var inner = item.html || "";
      var href = attrs.href || "";
      if (!href) continue;
      var chapterUrl = makeAbsolute(href);
      if (!chapterUrl || seen[chapterUrl]) continue;
      seen[chapterUrl] = true;

      var numText = await api.cssText(inner, ".chapter-item__number") || "";
      var chNum = numText.replace(/\u0627\u0644\u0641\u0635\u0644\s*/i, "").trim();
      if (!chNum) chNum = extractChapterNumber(chapterUrl);

      var titleText = await api.cssText(inner, ".chapter-item__title") || "";
      var title = titleText.replace(/^\u0627\u0644\u0641\u0635\u0644\s+\d+[\s:]*/, "").trim();
      if (!title) title = titleText;

      var dateStr = await api.cssText(inner, ".chapter-item__date") || "";

      chapters.push({
        number: chNum,
        title: cleanTitle(title),
        url: chapterUrl,
        views: 0,
        isLocked: false,
        date: cleanTitle(dateStr)
      });
    }
    chapters.sort(function(a, b) {
      return (parseFloat(b.number) || 0) - (parseFloat(a.number) || 0);
    });
    return chapters;
  }

  async function extractReaderImages(html) {
    var urls = [];
    var seen = {};
    var images = await api.cssAll(html, "img[data-cdn-url]");
    for (var i = 0; i < images.length; i++) {
      var attrs = (images[i] || {}).attrs || {};
      var dataCdnUrl = attrs["data-cdn-url"] || "";
      if (!dataCdnUrl || seen[dataCdnUrl]) continue;
      seen[dataCdnUrl] = true;
      urls.push(dataCdnUrl);
    }
    return urls;
  }

  async function extractStatus(html) {
    try {
      var jsonLd = await api.cssText(html, "script[type='application/ld+json']");
      if (jsonLd) {
        var m = jsonLd.match(/"creativeWorkStatus"\s*:\s*"([^"]+)"/);
        if (m && m[1]) {
          var ar = m[1].trim();
          return statusMap[ar] || ar;
        }
      }
    } catch (e) {}

    try {
      var labels = await api.cssAll(html, ".detail-meta__label");
      var values = await api.cssAll(html, ".detail-meta__value");
      if (labels && labels.length && values && values.length) {
        for (var li = 0; li < labels.length && li < values.length; li++) {
          var lbl = cleanTitle(labels[li].text || "");
          if (lbl.indexOf("\u0627\u0644\u062D\u0627\u0644\u0629") !== -1) {
            var val = cleanTitle(values[li].text || "");
            return statusMap[val] || val;
          }
        }
      }
    } catch (e) {}
    return "";
  }

  return {
    requiresCloudflare: true,

    async getHomepageManga(args) {
      try {
        var page = (args && args.page) || 1;
        var url = page === 1 ? baseUrl + "/manga/" : baseUrl + "/manga/page/" + page + "/";
        return await parseCards(await fetchHtml(url));
      } catch (e) {
        return [];
      }
    },

    async search(args) {
      try {
        var query = (args && args.query) || "";
        if (!query.trim()) return [];
        var url = baseUrl + "/?s=" + encodeURIComponent(query);
        var result = await parseCards(await fetchHtml(url));
        if (!result || !result.length) {
          url = baseUrl + "/manga/?s=" + encodeURIComponent(query);
          result = await parseCards(await fetchHtml(url));
        }
        return result;
      } catch (e) {
        return [];
      }
    },

    async getMangaDetails(args) {
      try {
        var url = makeAbsolute((args && args.url) || "");
        var html = await fetchHtml(url);

        var title = await api.cssText(html, "h1") || "";
        if (!title) title = await api.cssAttr(html, "meta[property='og:title']", "content") || "";
        title = cleanTitle(title);

        var cover = await api.cssAttr(html, "meta[property='og:image']", "content");
        cover = cover ? makeAbsolute(cover) : "";

        var description = await api.cssAttr(html, "meta[name='description']", "content") || "";
        description = cleanTitle(description);

        var genres = await api.cssList(html, "a[href*='/genre/']") || [];
        genres = genres.map(cleanTitle).filter(Boolean);

        var statusText = await extractStatus(html);
        var chapters = await extractChapters(html);

        return {
          title: title || "Unknown",
          coverUrl: cover,
          description: description,
          genres: genres,
          status: statusText,
          chapters: chapters,
          originalUrl: url,
          hasMoreChapters: false,
          lastFetchedPage: 1,
          contentType: "manga"
        };
      } catch (e) {
        return {
          title: "Error",
          coverUrl: "",
          description: "",
          genres: [],
          status: "",
          chapters: [],
          originalUrl: (args && args.url) || "",
          hasMoreChapters: false,
          lastFetchedPage: 1,
          contentType: "manga"
        };
      }
    },

    async getChapterPages(args) {
      var chapterUrl = makeAbsolute((args && args.url) || "");
      lastChapterUrl = chapterUrl || lastChapterUrl;
      var html = await fetchHtml(chapterUrl);
      return await extractReaderImages(html);
    },

    async getChapterContent(args) {
      return { kind: "image", imageUrls: await this.getChapterPages(args) };
    },

    async getFilteredManga(args) {
      try {
        var page = (args && args.page) || 1;
        var genre = ((args && args.genre) || "").toLowerCase().trim();
        var type = ((args && args.type) || "").toLowerCase().trim();
        var status = ((args && args.status) || "").toLowerCase().trim();

        var baseListing = page === 1 ? baseUrl + "/manga/" : baseUrl + "/manga/page/" + page + "/";

        var params = [];
        if (genre) {
          var slug = genreSlugMap[genre] || genre.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
          params.push("genre[0]=" + encodeURIComponent(slug));
        }
        if (type) params.push("type=" + encodeURIComponent(type));
        if (status) params.push("status=" + encodeURIComponent(status));

        var url = baseListing;
        if (params.length > 0) {
          url = baseListing + (baseListing.indexOf("?") === -1 ? "?" : "&") + params.join("&");
        }

        return await parseCards(await fetchHtml(url));
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
        "Referer": lastChapterUrl || baseUrl + "/",
        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "Accept-Language": "ar,en-US;q=0.9,en;q=0.8",
        "Sec-Fetch-Dest": "image",
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
