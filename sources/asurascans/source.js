function createSource(api, config) {
  var baseUrl = ((config && config.base_url) || "https://asurascans.com").replace(/\/+$/, "");
  var configHeaders = (config && config.headers) || {};
  var userAgent =
    configHeaders["User-Agent"] ||
    "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
  var lastChapterUrl = baseUrl + "/";
  var weservBase = "https://images.weserv.nl/";

  var defaultGenres = [
    "Action", "Adventure", "Comedy", "Drama", "Fantasy", "Romance",
    "Horror", "Mystery", "Psychological", "Sci-Fi", "Slice of Life",
    "Sports", "Supernatural", "Thriller", "Tragedy", "Martial Arts",
    "Manhwa", "Manhua", "Manga", "Isekai", "Magic", "Harem",
    "School Life", "Shounen", "Shoujo", "Seinen", "Josei",
    "Historical", "Mecha", "Video Games", "Ecchi", "Smut",
    "Gender Bender", "Webtoons", "Long Strip", "Full Color",
    "Cultivation", "System", "Apocalypse", "Dungeon", "Monster",
    "Hentai"
  ];
  var defaultTypes = ["manga", "manhwa", "manhua", "comic", "one-shot"];

  var defaultHeaders = {
    "User-Agent": userAgent,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
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

  function stripLeadingRating(s) {
    return String(s || "").replace(/^\d+(?:\.\d+)?\s*/, "").trim();
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

  async function parseCards(html) {
    var items = await api.cssAll(html, "div.grid.grid-cols-12.gap-2.py-4.px-2");
    var isBrowse = false;
    if (!items || !items.length) {
      items = await api.cssAll(html, ".series-card");
      isBrowse = true;
    }
    var out = [];
    var seen = {};
    for (var i = 0; i < items.length; i++) {
      var item = items[i] || {};
      var inner = item.html || "";

      var links = await api.cssAll(inner, "a[href*='/comics/']");
      if (!links || links.length < 2) continue;

      var detailUrl = makeAbsolute(((links[1] || {}).attrs || {}).href || "");
      if (!detailUrl || seen[detailUrl]) continue;
      seen[detailUrl] = true;

      var title = cleanTitle(stripLeadingRating((links[1] || {}).text || ""));
      if (!title) continue;

      var cover = await api.cssAttr(inner, "img", "data-src")
        .then(function(src) {
          if (!src || src.indexOf("data:image") === 0) return api.cssAttr(inner, "img", "src");
          return src;
        });
      cover = makeAbsolute(cover);

      out.push({
        title: title,
        coverUrl: cover,
        detailUrl: detailUrl,
        contentType: "manga"
      });
    }
    return out;
  }

  function extractChapterNumber(url) {
    var m = url.match(/\/chapter\/(\d+(?:\.\d+)?)/);
    if (m) return m[1];
    return "0";
  }

  async function extractChapters(html) {
    var items = await api.cssAll(html, "div[class*='divide'] a[href*='chapter']");
    if (!items || !items.length) items = await api.cssAll(html, "a[href*='chapter']");
    var chapters = [];
    var seen = {};
    for (var i = 0; i < items.length; i++) {
      var it = items[i] || {};
      var attrs = it.attrs || {};
      var href = attrs.href || "";
      if (!href) continue;
      var chapterUrl = makeAbsolute(href);
      if (!chapterUrl || seen[chapterUrl]) continue;
      seen[chapterUrl] = true;

      var chNum = extractChapterNumber(chapterUrl);
      var ine = it.html || "";
      var isLocked = ine.toLowerCase().indexOf("lock") !== -1;

      var dateStr = "";
      var dateRes = ine.match(/(\d+\s+(?:hour|day|week|month|minute|second|year)s?\s+ago)/i);
      if (dateRes) dateStr = cleanTitle(dateRes[1]);

      chapters.push({
        number: chNum,
        title: "",
        url: chapterUrl,
        views: 0,
        isLocked: isLocked,
        date: dateStr
      });
    }
    chapters.sort(function(a, b) {
      return (parseFloat(b.number) || 0) - (parseFloat(a.number) || 0);
    });
    return chapters;
  }

  function proxyReaderImage(url) {
    if (url.indexOf("cdn.asurascans.com") === -1) return url;
    var target = url.replace(/^https?:\/\//, "");
    return weservBase + "?url=" + encodeURIComponent(target) + "&output=jpeg&quality=85";
  }

  async function extractReaderImages(html) {
    var urls = [];
    var seen = {};

    var images = await api.cssAll(html, "img.w-full.block");
    if (!images || !images.length) {
      images = await api.cssAll(html, "main img");
      if (!images || !images.length) images = await api.cssAll(html, "img");
    }

    for (var i = 0; i < images.length; i++) {
      var attrs = (images[i] || {}).attrs || {};
      var src = attrs["data-src"] || attrs["src"] || "";
      if (!src || src.indexOf("data:image") === 0) continue;
      src = makeAbsolute(src);
      if (src.indexOf("logo") !== -1 || src.indexOf("icon") !== -1 || src.indexOf("avatar") !== -1) continue;
      if (src.indexOf("/covers/") !== -1) continue;
      var isChapterImage = src.indexOf("/chapters/") !== -1 || src.indexOf("asura-images") !== -1;
      if (!isChapterImage) {
        var ext = src.split("?").shift().split(".").pop().toLowerCase();
        if (["jpg", "jpeg", "png", "webp", "gif", "avif"].indexOf(ext) === -1) continue;
      }
      if (seen[src]) continue;
      seen[src] = true;
      urls.push(proxyReaderImage(src));
    }
    return urls;
  }

  return {
    requiresCloudflare: false,

    async getHomepageManga(args) {
      try {
        var page = (args && args.page) || 1;
        var url = baseUrl + "/";
        if (page > 1) url = baseUrl + "/browse?page=" + page;
        return await parseCards(await fetchHtml(url));
      } catch (e) {
        return [];
      }
    },

    async search(args) {
      try {
        var query = (args && args.query) || "";
        if (!query.trim()) return [];
        var url = baseUrl + "/browse?search=" + encodeURIComponent(query);
        var result = await parseCards(await fetchHtml(url));
        if (!result || !result.length) {
          url = baseUrl + "/?s=" + encodeURIComponent(query);
          result = await parseCards(await fetchHtml(url));
        }
        return result;
      } catch (e) {
        return [];
      }
    },

    async getMangaDetails(args) {
      var url = makeAbsolute((args && args.url) || "");
      var html = await fetchHtml(url);
      var title = await api.cssText(html, "h1") || "";
      if (!title) title = await api.cssAttr(html, "meta[property='og:title']", "content") || "";
      var cover = await api.cssAttr(html, "meta[property='og:image']", "content").then(function(v) {
        return v ? makeAbsolute(v) : "";
      });
      if (!cover) {
        cover = await api.cssAttr(html, "img[class*='cover'], img[class*='poster']", "src")
          .then(function(v) { return v ? makeAbsolute(v) : ""; });
      }
      var description = await api.cssAttr(html, "meta[name='description']", "content") || "";
      if (!description) description = await api.cssText(html, "[class*='description'], [class*='summary']") || "";
      description = cleanTitle(description);
      var genres = await api.cssList(html, "a[href*='genre']") || [];
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
          var slug = genre.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
          url = baseUrl + "/browse?genres=" + slug + "&page=" + page;
        } else if (type) {
          url = baseUrl + "/browse?type=" + encodeURIComponent(type.toLowerCase()) + "&page=" + page;
        } else {
          url = baseUrl + "/browse?page=" + page;
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
