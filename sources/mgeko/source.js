function createSource(api, config) {
  var baseUrl = ((config && config.base_url) || "https://www.mgeko.cc").replace(/\/+$/, "");
  var configHeaders = (config && config.headers) || {};
  var userAgent =
    configHeaders["User-Agent"] ||
    "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
  var lastChapterUrl = baseUrl + "/";

  var defaultGenres = [
    "Action", "Adventure", "Comedy", "Drama", "Fantasy", "Romance",
    "Horror", "Mystery", "Psychological", "Sci-Fi", "Slice of Life",
    "Sports", "Supernatural", "Thriller", "Tragedy", "Martial Arts",
    "Manhwa", "Manhua", "Manga", "Isekai", "Magic", "Harem",
    "School Life", "Shounen", "Shoujo", "Seinen", "Josei",
    "Historical", "Mecha", "Video Games", "Ecchi", "Smut",
    "Gender Bender", "Webtoons", "Long Strip", "Full Color"
  ];
  var defaultTypes = ["manga", "manhwa", "manhua", "comic", "one-shot"];

  var defaultHeaders = {
    "User-Agent": userAgent,
    "Accept": "application/json, text/html, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": baseUrl + "/",
    "Origin": baseUrl,
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin"
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

  async function fetchJson(url, extraHeaders) {
    var text = await fetchHtml(url, extraHeaders);
    return JSON.parse(text || "{}");
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
    if (url.indexOf("/") === 0) return baseUrl.replace(/\/$/, "") + url;
    return baseUrl.replace(/\/$/, "") + "/" + url;
  }

  function extractCover(html, selector) {
    return api.cssAttr(html, selector, "data-src")
      .then(function(src) {
        if (!src || src.indexOf("data:image") === 0) return api.cssAttr(html, selector, "data-lazy-src");
        return src;
      })
      .then(function(src) {
        if (!src || src.indexOf("data:image") === 0) return api.cssAttr(html, selector, "src");
        return src;
      })
      .then(function(src) {
        if (!src || src.indexOf("data:image") === 0) return "";
        return makeAbsolute(src);
      });
  }

  async function apiCards(html) {
    var items = await api.cssAll(html, "article.comic-card");
    var out = [];
    var seen = {};
    for (var i = 0; i < items.length; i++) {
      var itemHtml = (items[i] || {}).html || "";
      var link = await api.cssAttr(itemHtml, ".comic-card__cover a", "href") || "";
      var detailUrl = makeAbsolute(link);
      if (!detailUrl || seen[detailUrl]) continue;
      seen[detailUrl] = true;
      var title = await api.cssText(itemHtml, ".comic-card__title a") || "";
      if (!title || !title.trim()) continue;
      var cover = await extractCover(itemHtml, ".comic-card__cover img");
      out.push({
        title: cleanTitle(title),
        coverUrl: cover,
        detailUrl: detailUrl,
        contentType: "manga"
      });
    }
    return out;
  }

  async function fetchAndParseCards(url) {
    var data = await fetchJson(url);
    var resultsHtml = (data && data.results_html) || "";
    if (!resultsHtml) return [];
    return await apiCards(resultsHtml);
  }

  function extractChapterNumber(url, text) {
    var combined = String(url || "") + " " + String(text || "");
    var m = combined.match(/(?:chapter|ch|episode)[-\s_:.]*(\d+(?:\.\d+)?)/i);
    if (m) return m[1];
    m = url.match(/chapter[-\s_]*(\d+(?:\.\d+)?)/i);
    if (m) return m[1];
    m = url.match(/(\d+(?:\.\d+)?)(?:\/|$)/);
    if (m) return m[1];
    return "0";
  }

  async function extractChapters(html) {
    var items = await api.cssAll(html, "ul.chapter-list li, ul li a[href*='/reader/en/']");
    var chapters = [];
    var seen = {};
    for (var i = 0; i < items.length; i++) {
      var item = items[i] || {};
      var itemHtml = item.html || "";
      var itemAttrs = item.attrs || {};
      var href = itemAttrs["href"] || (await api.cssAttr(itemHtml, "a", "href") || "");
      if (!href) {
        var linkFromChild = await api.cssAttr(itemHtml, "a", "href");
        href = linkFromChild || "";
      }
      var chapterUrl = makeAbsolute(href);
      if (!chapterUrl || seen[chapterUrl]) continue;
      seen[chapterUrl] = true;
      var linkText = await api.cssText(itemHtml, "a") || chapterUrl;
      var chNum = extractChapterNumber(chapterUrl, linkText);
      var date = await api.cssText(itemHtml, ".chapter-date, .date, time") || "";
      chapters.push({
        number: chNum,
        title: "",
        url: chapterUrl,
        views: 0,
        isLocked: false,
        date: cleanTitle(date)
      });
    }
    chapters.sort(function(a, b) {
      return (parseFloat(b.number) || 0) - (parseFloat(a.number) || 0);
    });
    return chapters;
  }

  async function extractReaderImages(html) {
    var urls = [];
    var images = await api.cssAll(html, "#reader img, .reading-content img, .chapter-content img, img[src*='imgsrv4']");
    for (var i = 0; i < images.length; i++) {
      var attrs = (images[i] || {}).attrs || {};
      var src = attrs["data-src"] || attrs["data-lazy-src"] || attrs["src"] || "";
      if (!src || src.indexOf("data:image") === 0) continue;
      src = makeAbsolute(src);
      if (src && urls.indexOf(src) === -1) urls.push(src);
    }
    if (!urls.length) {
      var allImages = await api.cssAll(html, "img");
      for (var i = 0; i < allImages.length; i++) {
        var attrs = (allImages[i] || {}).attrs || {};
        var src = attrs["data-src"] || attrs["data-lazy-src"] || attrs["src"] || "";
        if (!src || src.indexOf("data:image") === 0) continue;
        src = makeAbsolute(src);
        if (src && urls.indexOf(src) === -1) urls.push(src);
      }
    }
    return urls;
  }

  return {
    requiresCloudflare: false,

    async getHomepageManga(args) {
      try {
        var page = (args && args.page) || 1;
        var url = baseUrl + "/browse-comics/data/?sort=recently_added&page=" + page;
        return await fetchAndParseCards(url);
      } catch (e) {
        return [];
      }
    },

    async search(args) {
      try {
        var query = (args && args.query) || "";
        if (!query.trim()) return [];
        var url = baseUrl + "/browse-comics/data/?q=" + encodeURIComponent(query);
        return await fetchAndParseCards(url);
      } catch (e) {
        return [];
      }
    },

    async getMangaDetails(args) {
      var url = makeAbsolute((args && args.url) || "");
      var html = await fetchHtml(url, { "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" });
      var title = await api.cssText(html, "h1") || "";
      if (!title) title = await api.cssAttr(html, "meta[property='og:title']", "content") || "";
      var cover = await extractCover(html, ".manga-detail img, .detail-cover img, .summary-image img");
      if (!cover) {
        cover = await api.cssAttr(html, "meta[property='og:image']", "content").then(function(v) {
          return v ? makeAbsolute(v) : "";
        });
      }
      var description = await api.cssText(html, ".description, .summary-content, .manga-description") || "";
      description = cleanTitle(description);
      var genres = await api.cssList(html, "a[href*='/browse-comics/?genre_included=']") || [];
      genres = genres.map(cleanTitle).filter(Boolean);
      var chapters = await extractChapters(html);
      return {
        title: cleanTitle(title) || "Unknown",
        coverUrl: cover || "",
        description: description,
        genres: genres,
        chapters: chapters,
        originalUrl: url,
        hasMoreChapters: false,
        lastFetchedPage: 1,
        contentType: "manga"
      };
    },

    async getChapterPages(args) {
      var chapterUrl = makeAbsolute((args && args.url) || "");
      lastChapterUrl = chapterUrl || lastChapterUrl;
      var html = await fetchHtml(chapterUrl, { "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" });
      return await extractReaderImages(html);
    },

    async getChapterContent(args) {
      return { kind: "image", imageUrls: await this.getChapterPages(args) };
    },

    async getFilteredManga(args) {
      try {
        var page = (args && args.page) || 1;
        var genre = (args && args.genre) || "";
        var type = (args && args.type) || "";
        var url;
        if (genre) {
          url = baseUrl + "/browse-comics/data/?genre_included=" + encodeURIComponent(genre.toLowerCase()) + "&page=" + page;
        } else if (type) {
          url = baseUrl + "/browse-comics/data/?type=" + encodeURIComponent(type.toLowerCase()) + "&page=" + page;
        } else {
          url = baseUrl + "/browse-comics/data/?sort=recently_added&page=" + page;
        }
        return await fetchAndParseCards(url);
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
        "Accept-Language": "en-US,en;q=0.9",
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
