function createSource(api, config) {
  var baseUrl = ((config && config.base_url) || "https://ar.kenmanga.com").replace(/\/+$/, "");
  var configHeaders = (config && config.headers) || {};
  var userAgent =
    configHeaders["User-Agent"] ||
    "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
  var lastChapterUrl = baseUrl + "/";

  var defaultGenres = [
    "أكشن", "مغامرة", "دراما", "رومانسي", "فنتازيا", "خيال",
    "كوميدي", "شونين", "سينين", "رعب", "غموض", "نفسي",
    "تاريخي", "رياضة", "شريحة من الحياة", "خارق للطبيعة",
    "إثارة", "مأساة", "فنون قتالية", "مانهوا", "مانها", "مانجا"
  ];
  var defaultTypes = ["manga", "manhwa", "manhua"];

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
    var items = await api.cssAll(html, ".update-card");
    var out = [];
    var seen = {};
    for (var i = 0; i < items.length; i++) {
      var itemHtml = (items[i] || {}).html || "";
      var title = await api.cssText(itemHtml, ".u-title") || "";
      if (!title || !title.trim()) continue;
      var detailUrl = makeAbsolute(await api.cssAttr(itemHtml, "a[href*='/manga/']", "href") || "");
      if (!detailUrl || seen[detailUrl]) continue;
      seen[detailUrl] = true;
      var cover = await extractCover(itemHtml, ".u-poster img");
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
    m = url.match(/[\/-](\d+(?:\.\d+)?)(?:\/|$)/);
    if (m) return m[1];
    return "0";
  }

  async function extractChapters(html) {
    var items = await api.cssAll(html, "a.chapter-item.ch-item");
    var chapters = [];
    var seen = {};
    for (var i = 0; i < items.length; i++) {
      var item = items[i] || {};
      var itemHtml = item.html || "";
      var itemAttrs = item.attrs || {};
      var href = itemAttrs["href"] || "";
      if (!href) href = await api.cssAttr(itemHtml, "a", "href") || "";
      var chapterUrl = makeAbsolute(href);
      if (!chapterUrl || seen[chapterUrl]) continue;
      seen[chapterUrl] = true;
      var chNum = itemAttrs["data-ch"] || "";
      if (!chNum) {
        var text = await api.cssText(itemHtml, "a, .chap-num") || chapterUrl;
        chNum = extractChapterNumber(chapterUrl, text);
      }
      var date = await api.cssText(itemHtml, ".chapter-date, .chap-date") || "";
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

    var tsMatch = html.match(/ts_reader\.run\s*\(\s*({[\s\S]*?})\s*\)\s*;/);
    if (tsMatch) {
      try {
        var tsData = JSON.parse(tsMatch[1]);
        var sources = tsData.sources || tsData.sorces || [];
        for (var si = 0; si < sources.length; si++) {
          var imgs = sources[si].images || [];
          for (var ii = 0; ii < imgs.length; ii++) {
            var u = String(imgs[ii] || "");
            if (u && urls.indexOf(u) === -1) urls.push(makeAbsolute(u));
          }
          if (urls.length) break;
        }
      } catch (e) {}
    }

    if (!urls.length) {
      var images = await api.cssAll(html, "#readerarea img, .entry-content img, .comic-images-wrapper img, .page-break img");
      for (var i = 0; i < images.length; i++) {
        var attrs = (images[i] || {}).attrs || {};
        var src = attrs["data-src"] || attrs["data-lazy-src"] || attrs["src"] || "";
        if (!src || src.indexOf("data:image") === 0 || src.indexOf("readerarea.svg") !== -1) continue;
        src = makeAbsolute(src);
        if (src && urls.indexOf(src) === -1) urls.push(src);
      }
    }

    if (!urls.length) {
      var allImgs = await api.cssAll(html, "img");
      for (var i = 0; i < allImgs.length; i++) {
        var attrs = (allImgs[i] || {}).attrs || {};
        var src = attrs["data-src"] || attrs["data-lazy-src"] || attrs["src"] || "";
        if (!src || src.indexOf("data:image") === 0) continue;
        src = makeAbsolute(src);
        if (src.indexOf("icon") !== -1 || src.indexOf("logo") !== -1 || src.indexOf("avatar") !== -1) continue;
        if (src.indexOf(".svg") !== -1) continue;
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
        var url = page === 1 ? baseUrl + "/" : baseUrl + "/page/" + page + "/";
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
        return await parseCards(await fetchHtml(url));
      } catch (e) {
        return [];
      }
    },

    async getMangaDetails(args) {
      var url = makeAbsolute((args && args.url) || "");
      var html = await fetchHtml(url);
      var title = await api.cssText(html, "h1.entry-title") || "";
      if (!title) title = await api.cssAttr(html, "meta[property='og:title']", "content") || "";
      var cover = await extractCover(html, ".summary_image img, .manga-cover img");
      if (!cover) {
        cover = await api.cssAttr(html, "meta[property='og:image']", "content").then(function(v) {
          return v ? makeAbsolute(v) : "";
        });
      }
      var description = await api.cssText(html, ".summary__content, .entry-content, .description-summary") || "";
      description = cleanTitle(description).replace("متابعة قراءة", "").trim();
      var genres = await api.cssList(html, "span.mgen a, .genres-content a") || [];
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
          url = baseUrl + "/category/" + slug + "/";
          if (page > 1) url += "page/" + page + "/";
        } else if (type) {
          url = baseUrl + "/?s&type=" + encodeURIComponent(type);
        } else {
          url = page === 1 ? baseUrl + "/" : baseUrl + "/page/" + page + "/";
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
