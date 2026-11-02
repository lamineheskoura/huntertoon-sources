function createSource(api, config) {
  var baseUrl = ((config && config.base_url) || "https://luacomic.org").replace(/\/+$/, "");
  var apiBase = ((config && config.api_base) || "https://api.luacomic.org").replace(/\/+$/, "");
  var configHeaders = (config && config.headers) || {};
  var userAgent =
    configHeaders["User-Agent"] ||
    "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
  var lastChapterUrl = baseUrl + "/";

  var defaultHeaders = {
    "User-Agent": userAgent,
    "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": baseUrl + "/",
    "Origin": baseUrl
  };

  function mergeHeaders(a, b) {
    var out = {};
    for (var k in a) out[k] = a[k];
    if (b) for (var x in b) out[x] = b[x];
    return out;
  }

  async function request(url, opts) {
    opts = opts || {};
    var headers = mergeHeaders(defaultHeaders, opts.headers);
    var lastErr = null;
    for (var attempt = 0; attempt < 2; attempt++) {
      try {
        if (api.http) {
          var res = await api.http(url, { method: opts.method || "GET", headers: headers, body: opts.body });
          if (!res || !res.ok) throw new Error("HTTP " + (res ? res.status : 0) + " for " + url);
          return res.body || "";
        }
        var text = await api.fetchText(url, headers);
        if (!text) throw new Error("Empty response: " + url);
        return text;
      } catch (e) {
        lastErr = e;
        var msg = String((e && e.message) || e || "");
        if (msg.indexOf("HTTP 403") !== -1 || msg.indexOf("HTTP 429") !== -1) throw e;
      }
    }
    throw lastErr;
  }

  function fetchText(url, extraHeaders) {
    return request(url, { headers: extraHeaders });
  }

  function cleanTitle(s) {
    return String(s || "").replace(/\s+/g, " ").trim();
  }

  function stripHtml(s) {
    return cleanTitle(
      String(s || "")
        .replace(/<br\s*\/?>/gi, " ")
        .replace(/<\/p>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/&/gi, "&")
        .replace(/"/gi, '"')
        .replace(/&#0?39;|&apos;/gi, "'")
        .replace(/</gi, "<")
        .replace(/>/gi, ">")
    );
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

  function shouldPropagate(e) {
    var s = String((e && e.message) || e || "");
    return (
      s.indexOf("HTTP 403") !== -1 ||
      s.indexOf("HTTP 429") !== -1 ||
      s.indexOf("rate_limited") !== -1 ||
      s.indexOf("waf_block") !== -1 ||
      s.indexOf("cloudflare_blocked") !== -1
    );
  }

  function now() {
    return typeof api.now === "function" ? api.now() : Date.now();
  }

  function apiUrl(path, params) {
    var u = apiBase + path;
    if (params) {
      var qs = [];
      for (var k in params) qs.push(encodeURIComponent(k) + "=" + encodeURIComponent(params[k]));
      if (qs.length) u += "?" + qs.join("&");
    }
    return u;
  }

  function browseParams(extra) {
    var p = { series_type: "Comic", per_page: "24", adult: "false", order: "desc", order_by: "updated_at" };
    if (extra) for (var k in extra) p[k] = extra[k];
    return p;
  }

  function parseSeriesList(data) {
    var out = [];
    if (!Array.isArray(data)) return out;
    for (var i = 0; i < data.length; i++) {
      var s = data[i] || {};
      if (!s.title || !s.series_slug) continue;
      out.push({
        title: cleanTitle(s.title),
        coverUrl: makeAbsolute(s.thumbnail || ""),
        detailUrl: baseUrl + "/series/" + s.series_slug + "/",
        contentType: "manga"
      });
    }
    return out;
  }

  async function fetchBrowsePages(extra, maxPages) {
    var out = [];
    var seen = {};
    for (var p = 1; p <= (maxPages || 1); p++) {
      var res = await request(apiUrl("/query/", browseParams({ page: String(p) })));
      var j;
      try { j = JSON.parse(res); } catch (e) { break; }
      var data = j && j.data ? j.data : [];
      if (!Array.isArray(data) || data.length === 0) break;
      for (var i = 0; i < data.length; i++) {
        var s = data[i] || {};
        if (!s.title || !s.series_slug) continue;
        var key = s.series_slug;
        if (seen[key]) continue;
        seen[key] = 1;
        out.push({
          title: cleanTitle(s.title),
          coverUrl: makeAbsolute(s.thumbnail || ""),
          detailUrl: baseUrl + "/series/" + s.series_slug + "/",
          contentType: "manga"
        });
      }
    }
    return out;
  }

  function slugFromUrl(url) {
    var m = /\/series\/([^/?#]+)\/?$/.exec(String(url || ""));
    if (!m) m = /\/series\/([^/?#]+)\/chapter\//.exec(String(url || ""));
    return m ? m[1] : "";
  }

  function chapterDate(iso) {
    if (!iso) return "";
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
    return m ? m[1] + "-" + m[2] + "-" + m[3] : "";
  }

  return {
    requiresCloudflare: false,

    async getHomepageManga(args) {
      try {
        var page = (args && args.page) || 1;
        var res = await request(apiUrl("/query/", browseParams({ page: String(page) })));
        var j = JSON.parse(res);
        return parseSeriesList(j && j.data ? j.data : []);
      } catch (e) {
        if (shouldPropagate(e)) throw e;
        return [];
      }
    },

    async search(args) {
      try {
        var query = cleanTitle((args && args.query) || "");
        if (!query) return [];
        var q = query.toLowerCase();
        var matches = [];
        var pages = await fetchBrowsePages({}, 8);
        for (var i = 0; i < pages.length; i++) {
          var s = pages[i];
          if (s.title.toLowerCase().indexOf(q) !== -1) matches.push(s);
          if (matches.length >= 24) break;
        }
        return matches;
      } catch (e) {
        if (shouldPropagate(e)) throw e;
        return [];
      }
    },

    async getFilteredManga(args) {
      try {
        var page = (args && args.page) || 1;
        var genre = cleanTitle((args && args.genre) || "");
        var type = cleanTitle((args && args.type) || "");
        var extra = { page: String(page) };
        if (genre) extra.tags_ids = genre;
        if (type) extra.series_type = type;
        var res = await request(apiUrl("/query/", browseParams(extra)));
        var j = JSON.parse(res);
        return parseSeriesList(j && j.data ? j.data : []);
      } catch (e) {
        if (shouldPropagate(e)) throw e;
        return [];
      }
    },

    async getGenresAndTypes() {
      try {
        var res = await request(apiUrl("/query/", browseParams({ page: "1", per_page: "100" })));
        var j = JSON.parse(res);
        var data = j && j.data ? j.data : [];
        var genres = [];
        var gseen = {};
        var types = [];
        var tseen = {};
        for (var i = 0; i < data.length; i++) {
          var s = data[i] || {};
          var tags = s.tags || [];
          if (Array.isArray(tags)) {
            for (var t = 0; t < tags.length; t++) {
              var tag = cleanTitle(tags[t]);
              if (tag && !gseen[tag]) { gseen[tag] = 1; genres.push(tag); }
            }
          }
          var st = cleanTitle(s.series_type || "");
          if (st && !tseen[st]) { tseen[st] = 1; types.push(st); }
        }
        return { genres: genres, types: types };
      } catch (e) {}
      return { genres: [], types: ["Comic"] };
    },

    async getMangaDetails(args) {
      var url = makeAbsolute((args && args.url) || "");
      var slug = slugFromUrl(url);
      if (!slug) throw new Error("No series slug in " + url);
      var res = await request(apiUrl("/series/" + slug + "/"));
      var s;
      try { s = JSON.parse(res); } catch (e) { throw new Error("No series data for " + url); }

      var title = cleanTitle(s.title || slug);
      var cover = makeAbsolute(s.thumbnail || "");
      var description = stripHtml(s.description || "");
      var genresOut = [];
      var gseen = {};
      var tags = s.tags || [];
      if (Array.isArray(tags)) {
        for (var t = 0; t < tags.length; t++) {
          var tag = cleanTitle(tags[t]);
          if (tag && !gseen[tag]) { gseen[tag] = 1; genresOut.push(tag); }
        }
      }
      var status = cleanTitle(s.status || "");

      var chapRes = await request(apiUrl("/chapter/all/" + slug + "/"));
      var chapters = [];
      try {
        var cdata = JSON.parse(chapRes);
        if (Array.isArray(cdata)) {
          for (var c = 0; c < cdata.length; c++) {
            var ch = cdata[c] || {};
            if (!ch.chapter_slug) continue;
            chapters.push({
              number: cleanTitle(ch.chapter_name || ch.index || ""),
              title: cleanTitle(ch.chapter_title || ch.chapter_name || ""),
              url: baseUrl + "/series/" + slug + "/" + ch.chapter_slug + "/",
              views: 0,
              isLocked: !!(ch.price && ch.price > 0),
              date: chapterDate(ch.created_at)
            });
          }
        }
      } catch (e) {}

      return {
        title: title,
        coverUrl: cover,
        description: description,
        genres: genresOut,
        chapters: chapters,
        originalUrl: baseUrl + "/series/" + slug + "/",
        hasMoreChapters: false,
        lastFetchedPage: 1,
        status: status,
        type: cleanTitle(s.series_type || ""),
        contentType: "manga"
      };
    },

    async getChapterPages(args) {
      var chapterUrl = makeAbsolute((args && args.url) || "");
      lastChapterUrl = chapterUrl || lastChapterUrl;
      var html = await fetchText(chapterUrl, { "Accept": "text/html,application/xhtml+xml,*/*;q=0.8" });
      var pages = [];
      var re = /https:\/\/media\.luacomic\.org\/file\/[^"\']*\/uploads\/series\/[^"\']+\/(\d+)\.(?:jpg|jpeg|png|webp)/gi;
      var m;
      while ((m = re.exec(html))) {
        pages.push({ index: parseInt(m[1], 10), url: m[0].replace(/\\(?:["'])/g, "$1") });
      }
      if (!pages.length) {
        var re2 = /_next\/image\?url=https%3A%2F%2Fmedia\.luacomic\.org%2Ffile%2F[^"%&]+/gi;
        while ((m = re2.exec(html))) {
          var enc = m[0].match(/url=([^&]+)/);
          if (enc) pages.push({ index: pages.length, url: decodeURIComponent(enc[1]) });
        }
      }
      if (!pages.length) throw new Error("No chapter images in " + chapterUrl);
      pages.sort(function (a, b) {
        return a.index - b.index;
      });
      var urls = [];
      var useen = {};
      for (var i = 0; i < pages.length; i++) {
        var u = pages[i].url;
        if (!useen[u]) { useen[u] = 1; urls.push(u); }
      }
      return urls;
    },

    async getChapterContent(args) {
      var urls = await this.getChapterPages(args);
      return { kind: "image", imageUrls: urls, chapterTitle: "" };
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
