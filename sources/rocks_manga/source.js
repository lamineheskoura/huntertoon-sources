function createSource(api, config) {
  var baseUrl = ((config && config.base_url) || "https://rocksmanga.com").replace(/\/+$/, "");
  var configHeaders = (config && config.headers) || {};
  var userAgent =
    configHeaders["User-Agent"] ||
    "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
  var lastChapterUrl = baseUrl + "/";

  var defaultGenres = [
    "أكشن", "مغامرة", "دراما", "رومانسي", "فنتازيا", "خيال",
    "كوميدي", "شونين", "سينين", "رعب", "غموض", "نفسي",
    "تاريخي", "رياضة", "شريحة من الحياة", "خارق للطبيعة",
    "إثارة", "مأساة", "فنون قتالية", "مانهوا", "مانها", "مانجا",
    "إيسيكاي", "سحر", "حريم", "مدرسي", "جوسي", "شوجو",
    "خيال علمي", "إتشي"
  ];
  var defaultTypes = ["manga", "manhwa", "manhua", "comic", "one-shot"];

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

  async function parseCards(html) {
    var items = await api.cssAll(html, ".original.card-lg .unit");
    var out = [];
    var seen = {};
    for (var i = 0; i < items.length; i++) {
      var itemHtml = (items[i] || {}).html || "";
      var posterAnchor = await api.cssAttr(itemHtml, "a.poster", "href") || "";
      var infoAnchor = await api.cssAttr(itemHtml, ".info > a", "href") || "";
      var detailUrl = makeAbsolute(posterAnchor || infoAnchor);
      if (!detailUrl || seen[detailUrl]) continue;
      seen[detailUrl] = true;
      var title = await api.cssText(itemHtml, ".info > a") || "";
      if (!title || !title.trim()) continue;
      var cover = await extractCover(itemHtml, ".poster img");
      out.push({
        title: cleanTitle(title),
        coverUrl: cover,
        detailUrl: detailUrl,
        contentType: "manga"
      });
    }
    return out;
  }

  function extractChapterNumber(url, text) {
    var combined = String(url || "") + " " + String(text || "");
    var m = combined.match(/(?:chapter|ch|الفصل|فصل)[-\s_:.]*(\d+(?:\.\d+)?)/i);
    if (m) return m[1];
    m = url.match(/\/(\d+(?:\.\d+)?)(?:\/|$)/);
    if (m) return m[1];
    return "0";
  }

  async function extractChapters(html) {
    var items = await api.cssAll(html, "li.item");
    var chapters = [];
    var seen = {};
    for (var i = 0; i < items.length; i++) {
      var item = items[i] || {};
      var itemHtml = item.html || "";
      var itemAttrs = item.attrs || {};
      var href = await api.cssAttr(itemHtml, "a", "href") || "";
      var chapterUrl = makeAbsolute(href);
      if (!chapterUrl || seen[chapterUrl]) continue;
      seen[chapterUrl] = true;
      var chNum = itemAttrs["data-chapter"] || "";
      if (!chNum) {
        var text = await api.cssText(itemHtml, "zebi") || chapterUrl;
        chNum = extractChapterNumber(chapterUrl, text);
      }
      var date = await api.cssText(itemHtml, ".time") || "";
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
    var images = await api.cssAll(html, "#ch-images img.preload-image.fit-w");
    for (var i = 0; i < images.length; i++) {
      var attrs = (images[i] || {}).attrs || {};
      var src = attrs["data-src"] || attrs["data-lazy-src"] || attrs["src"] || "";
      if (!src || src.indexOf("data:image") === 0) continue;
      src = makeAbsolute(src);
      if (src && urls.indexOf(src) === -1) urls.push(src);
    }
    return urls;
  }

  return {
    requiresCloudflare: false,

    async getHomepageManga(args) {
      try {
        var page = (args && args.page) || 1;
        var url = baseUrl + "/manga/";
        if (page > 1) url += "?paged=" + page;
        return await parseCards(await fetchHtml(url));
      } catch (e) {
        return [];
      }
    },

    async search(args) {
      try {
        var query = (args && args.query) || "";
        if (!query.trim()) return [];
        var url = baseUrl + "/?s=" + encodeURIComponent(query) + "&post_type=wp-manga";
        return await parseCards(await fetchHtml(url));
      } catch (e) {
        return [];
      }
    },

    async getMangaDetails(args) {
      var url = makeAbsolute((args && args.url) || "");
      var html = await fetchHtml(url);
      var title = await api.cssText(html, "h1") || "";
      if (!title) title = await api.cssAttr(html, "meta[property='og:title']", "content") || "";
      var cover = await extractCover(html, ".poster img");
      if (!cover) {
        cover = await api.cssAttr(html, "meta[property='og:image']", "content").then(function(v) {
          return v ? makeAbsolute(v) : "";
        });
      }
      var description = await api.cssText(html, ".description") || "";
      description = cleanTitle(description).replace("متابعة قراءة", "").trim();
      var genres = await api.cssList(html, "a[href*='/manga-genre/']") || [];
      genres = genres.map(cleanTitle).filter(Boolean);
      var chapters = await extractChapters(html);
      return {
        title: cleanTitle(title) || "بدون عنوان",
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
      var html = await fetchHtml(chapterUrl);
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
          var slug = genre.replace(/\s+/g, "-");
          url = baseUrl + "/manga-genre/" + slug + "/";
          if (page > 1) url += "?paged=" + page;
        } else if (type) {
          var typeSlug = type.replace(/\s+/g, "-");
          url = baseUrl + "/manga-type/" + typeSlug + "/";
          if (page > 1) url += "?paged=" + page;
        } else {
          url = baseUrl + "/manga/";
          if (page > 1) url += "?paged=" + page;
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
        "Sec-Fetch-Site": "same-origin"
      };
    },

    sanitizeCoverUrl(args) {
      return makeAbsolute((args && args.url) || "");
    }
  };
}

if (typeof module !== "undefined") module.exports = { createSource: createSource };
