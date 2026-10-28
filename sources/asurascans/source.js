function createSource(api, config) {
  var baseUrl = ((config && config.base_url) || "https://asurascans.com").replace(/\/+$/, "");
  var configHeaders = (config && config.headers) || {};
  var userAgent =
    configHeaders["User-Agent"] ||
    "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
  var lastChapterUrl = baseUrl + "/";
  var apiBase = "https://api.asurascans.com";

  // Mirrors /api/genres exactly - a genre outside this list returns zero rows.
  var defaultGenres = [
    "Action", "Adventure", "Comedy", "Crazy MC", "Dark Fantasy", "Demon",
    "Drama", "Dungeons", "Fantasy", "Game", "Genius MC", "Isekai", "Magic",
    "Martial Arts", "Murim", "Mystery", "Necromancer", "Overpowered",
    "Psychological", "Regression", "Reincarnation", "Revenge", "Romance",
    "School Life", "Sci-fi", "Shoujo", "Shounen", "Slice of Life",
    "Supernatural", "System", "Tower", "Tragedy", "Transmigration",
    "Villain", "Violence"
  ];
  var defaultTypes = ["manhwa", "manga", "manhua"];

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

  // The server-rendered listing lives at /browse/comics (plain /browse?page=N
  // returns an empty client-side shell with no cards). The same route also
  // serves search (q) and filters (genres/type), so every list path uses it.
  function browseUrl(params) {
    var qs = [];
    for (var k in params) {
      var v = params[k];
      if (v === undefined || v === null || v === "") continue;
      qs.push(encodeURIComponent(k) + "=" + encodeURIComponent(v));
    }
    return baseUrl + "/browse/comics" + (qs.length ? "?" + qs.join("&") : "");
  }

  function browseListUrl(page) {
    return browseUrl({ page: page || 1 });
  }

  function cleanImageUrl(url) {
    if (!url) return "";
    url = String(url).trim();
    url = url.replace(/&quot;/gi, "").replace(/&amp;/gi, "&").replace(/&#39;/gi, "'");
    url = url.replace(/["'<>\\\]].*$/, "");
    url = url.replace(/&quot.*$/i, "");
    url = url.trim();
    return makeAbsolute(url);
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

  async function extractReaderImages(html) {
    var urls = [];
    var seen = {};

    function addUrl(u) {
      u = cleanImageUrl(u);
      if (!u || u.indexOf("data:image") === 0) return;
      if (u.indexOf("logo") !== -1 || u.indexOf("icon") !== -1 || u.indexOf("avatar") !== -1) return;
      if (u.indexOf("/covers/") !== -1) return;
      if (seen[u]) return;
      seen[u] = true;
      urls.push(u);
    }

    // Strategy 1: Astro Island ChapterReader props (direct ordered JSON payload)
    var islandMatch = html.match(/<astro-island\b[^>]*props="([^"]+)"/i);
    if (islandMatch) {
      try {
        var raw = islandMatch[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#39;/g, "'");
        var data = JSON.parse(raw);
        var pagesRaw = (data && data.pages) || null;
        if (Array.isArray(pagesRaw)) {
          var arr = Array.isArray(pagesRaw[1]) ? pagesRaw[1] : pagesRaw;
          for (var i = 0; i < arr.length; i++) {
            var item = arr[i];
            var obj = (Array.isArray(item) && item[1]) ? item[1] : item;
            if (!obj || typeof obj !== "object") continue;
            var u = obj.url;
            if (Array.isArray(u)) u = u[1] !== undefined ? u[1] : u[0];
            if (typeof u === "string" && u.trim()) {
              addUrl(u.trim());
            }
          }
        }
      } catch (e) {}
    }
    if (urls.length > 0) return urls;

    // Strategy 2: Direct Regex for Chapter CDN Images
    var cdnRegex = /https?:\/\/[^\s"'<>\\]+?\/(?:asura-images|cdn\.asurascans\.com)\/chapters\/[^\s"'<>\\]+?\.(?:webp|jpg|jpeg|png|avif|gif)(?:\?[^"'<>\s\\]+)?/gi;
    var cdnMatches = html.match(cdnRegex) || [];
    for (var c = 0; c < cdnMatches.length; c++) {
      addUrl(cdnMatches[c]);
    }
    if (urls.length > 0) return urls;

    // Strategy 3: HTML <img> tags regex
    var imgRegex = /<img\b([^>]*)>/gi;
    var m;
    while ((m = imgRegex.exec(html)) !== null) {
      var tagAttrs = m[1];
      var srcM = tagAttrs.match(/(?:data-src|data-lazy-src|src)="([^"]*)"/i);
      if (!srcM || !srcM[1]) continue;
      var src = srcM[1];
      var isChapterImage = src.indexOf("/chapters/") !== -1 || src.indexOf("asura-images") !== -1;
      if (!isChapterImage) {
        var ext = src.split("?").shift().split(".").pop().toLowerCase();
        if (["jpg", "jpeg", "png", "webp", "gif", "avif"].indexOf(ext) === -1) continue;
      }
      addUrl(src);
    }
    if (urls.length > 0) return urls;

    // Strategy 4: Fallback to api.cssAll
    try {
      var images = await api.cssAll(html, "img.w-full.block");
      if (!images || !images.length) {
        images = await api.cssAll(html, "main img");
        if (!images || !images.length) images = await api.cssAll(html, "img");
      }
      for (var k = 0; k < images.length; k++) {
        var attrs = (images[k] || {}).attrs || {};
        var s = attrs["data-src"] || attrs["data-lazy-src"] || attrs["src"] || "";
        addUrl(s);
      }
    } catch (e) {}

    return urls;
  }

  return {
    requiresCloudflare: false,

    async getHomepageManga(args) {
      try {
        var page = (args && args.page) || 1;
        return await parseCards(await fetchHtml(browseListUrl(page)));
      } catch (e) {
        return [];
      }
    },

    async search(args) {
      var query = (args && args.query) || "";
      if (!query.trim()) return [];
      try {
        return await parseCards(await fetchHtml(browseUrl({ q: query.trim(), page: 1 })));
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
        var params = { page: page };
        if (genre) {
          params.genres = genre.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
        } else if (type) {
          params.type = type.toLowerCase();
        }
        return await parseCards(await fetchHtml(browseUrl(params)));
      } catch (e) {
        return [];
      }
    },

    async getGenresAndTypes() {
      var genres = defaultGenres;
      if (api.http) {
        try {
          var res = await api.http(apiBase + "/api/genres", {
            method: "GET",
            headers: mergeHeaders(defaultHeaders, { "Accept": "application/json" })
          });
          var data = res && res.ok ? JSON.parse(res.body || "null") : null;
          var list = (data && data.data) || [];
          var names = [];
          for (var i = 0; i < list.length; i++) {
            var name = list[i] && list[i].name;
            if (name) names.push(String(name));
          }
          if (names.length) genres = names;
        } catch (e) {}
      }
      return { genres: genres, types: defaultTypes };
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
