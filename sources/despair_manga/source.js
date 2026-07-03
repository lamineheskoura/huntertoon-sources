function createSource(api, config) {
  var baseUrl = ((config && config.base_url) || "https://despair-manga.net").replace(/\/+$/, "");
  var configHeaders = (config && config.headers) || {};
  var userAgent =
    configHeaders["User-Agent"] ||
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
  var lastChapterUrl = baseUrl + "/";
  var defaultGenres = [
    "أكشن", "مغامرة", "خيال", "دراما", "رومانسي",
    "شونين", "سينين", "شريحة من الحياة", "نفسي", "غموض",
    "إثارة", "رعب", "فنون قتالية", "مأساة", "تاريخي",
    "رياضي", "مدرسي", "شياطين", "سحر", "مانهوا",
    "كوميديا", "تناسخ", "خارق للطبيعة", "عسكري"
  ];
  var defaultTypes = ["manga", "manhwa", "manhua", "comic"];

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

  function extractCoverFromImg(html, selector) {
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

  async function listCards(html) {
    var items = await api.cssAll(html, ".bs.styletere");
    var out = [];
    var seen = {};
    for (var i = 0; i < items.length; i++) {
      var item = items[i] || {};
      var itemHtml = item.html || "";
      var attrs = item.attrs || {};
      var href = attrs["href"] || "";
      if (!href) {
        var aHref = await api.cssAttr(itemHtml, "a[href*='/manga/']", "href");
        if (aHref) href = aHref;
      }
      if (!href) continue;
      var detailUrl = makeAbsolute(href);
      if (!detailUrl || seen[detailUrl]) continue;
      seen[detailUrl] = true;
      var cover = await extractCoverFromImg(itemHtml, ".limit img");
      var title = await api.cssText(itemHtml, ".bigor .tt");
      if (!title || !title.trim()) continue;
      out.push({
        title: cleanTitle(title),
        coverUrl: cover,
        detailUrl: detailUrl,
        contentType: "manga"
      });
    }
    return out;
  }

  async function extractChapters(html) {
    var items = await api.cssAll(html, "#chapterlist li");
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
      var num = itemAttrs["data-num"] || "";
      if (!num) {
        var text = await api.cssText(itemHtml, "a") || chapterUrl;
        var m = text.match(/(?:chapter|ch|الفصل|فصل)[\s_.-]*(\d+(?:\.\d+)?)/i);
        if (m) num = m[1];
        else {
          var m2 = chapterUrl.match(/(\d+(?:\.\d+)?)/);
          num = m2 ? m2[1] : "0";
        }
      }
      var date = await api.cssText(itemHtml, ".chapter-date, .date") || "";
      chapters.push({
        number: num,
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
            var url = String(imgs[ii] || "");
            if (url && urls.indexOf(url) === -1) urls.push(makeAbsolute(url));
          }
          if (urls.length) break;
        }
      } catch (e) {}
    }
    if (!urls.length) {
      var images = await api.cssAll(html, "#readerarea img[data-index]");
      for (var i = 0; i < images.length; i++) {
        var attrs = (images[i] || {}).attrs || {};
        var src = attrs["data-src"] || attrs["src"] || "";
        if (!src || src.indexOf("readerarea.svg") !== -1) continue;
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
        var url = page === 1 ? baseUrl + "/all-manga/" : baseUrl + "/all-manga/page/" + page + "/";
        return await listCards(await fetchHtml(url));
      } catch (e) {
        return [];
      }
    },
    async search(args) {
      try {
        var query = (args && args.query) || "";
        if (!query.trim()) return [];
        var page = (args && args.page) || 1;
        var url = baseUrl + "/page/" + page + "/?s=" + encodeURIComponent(query);
        return await listCards(await fetchHtml(url));
      } catch (e) {
        return [];
      }
    },
    async getMangaDetails(args) {
      var url = makeAbsolute((args && args.url) || "");
      var html = await fetchHtml(url);
      var title = await api.cssText(html, "h1.entry-title") || "";
      if (!title) title = await api.cssAttr(html, "meta[property='og:title']", "content") || "";
      var cover = await extractCoverFromImg(html, ".thumb img");
      if (!cover) cover = await api.cssAttr(html, "meta[property='og:image']", "content").then(function(v) { return v ? makeAbsolute(v) : ""; });
      var description = await api.cssText(html, ".entry-content-single p, .entry-content p") || "";
      description = cleanTitle(description).replace("متابعة قراءة", "").trim();
      var genres = await api.cssList(html, "span.mgen a") || [];
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
          var slug = genre.toLowerCase().replace(/ /g, "-");
          url = page === 1 ? baseUrl + "/genres/" + slug + "/" : baseUrl + "/genres/" + slug + "/page/" + page + "/";
        } else {
          url = page === 1 ? baseUrl + "/all-manga/" : baseUrl + "/all-manga/page/" + page + "/";
        }
        return await listCards(await fetchHtml(url));
      } catch (e) {
        return await this.getHomepageManga(args || {});
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