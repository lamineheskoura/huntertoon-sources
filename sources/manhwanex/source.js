function createSource(api, config) {
  var baseUrl = ((config && config.base_url) || "https://manhwanex.com").replace(/\/+$/, "");
  var configHeaders = (config && config.headers) || {};
  var userAgent =
    configHeaders["User-Agent"] ||
    "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
  var lastChapterUrl = baseUrl + "/";
  var genreMap = null;
  var genreMapAt = 0;
  var GENRE_TTL = 1800000;

  // The site publishes exactly these genres (verified live 2026-11-02);
  // there is no adult term in its taxonomy, so no adult work can be tagged.
  var FALLBACK_GENRES = {
    "Action": "action",
    "Romance": "romance",
    "Fantasy": "fantasy",
    "Martial Arts": "martial-arts",
    "Adventure": "adventure",
    "Ghost": "ghost-manhwa",
    "Cultivation": "cultivation-manhwa",
    "System": "system-manhwa"
  };

  var MONTHS = {
    jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
    jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12"
  };

  var defaultHeaders = {
    "User-Agent": userAgent,
    "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": baseUrl + "/"
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
          var res = await api.http(url, {
            method: opts.method || "GET",
            headers: headers,
            body: opts.body
          });
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

  function decodeEntities(s) {
    return String(s || "")
      .replace(/&(?:nbsp|#160);/gi, " ")
      .replace(/&(?:quot|#34);/gi, '"')
      .replace(/&(?:#0?39|apos|#8217|rsquo);/gi, "'")
      .replace(/&(?:lt|#60);/gi, "<")
      .replace(/&(?:gt|#62);/gi, ">")
      .replace(/&(?:amp|#38);/gi, "&");
  }

  function cleanTitle(s) {
    return decodeEntities(String(s || "").replace(/\s+/g, " ").trim()).trim();
  }

  function stripHtml(s) {
    return cleanTitle(
      String(s || "")
        .replace(/<br\s*\/?>/gi, " ")
        .replace(/<\/p>/gi, " ")
        .replace(/<[^>]+>/g, " ")
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

  // genre label -> slug, from the site menu (every page carries the full list)
  async function genres() {
    if (genreMap && now() - genreMapAt < GENRE_TTL) return genreMap;
    var html = await fetchText(baseUrl + "/manga/");
    var map = {};
    var re = /href="[^"]*\/manga-genre\/([a-z0-9\-]+)\/"[^>]*>([^<]{1,40}?)</g;
    var m;
    while ((m = re.exec(html))) {
      var label = cleanTitle(m[2]);
      if (label && !map[label]) map[label] = m[1];
    }
    if (!Object.keys(map).length) map = FALLBACK_GENRES;
    genreMap = map;
    genreMapAt = now();
    return map;
  }

  function archiveUrl(page) {
    var p = page > 0 ? page : 1;
    return p === 1 ? baseUrl + "/manga/" : baseUrl + "/manga/page/" + p + "/";
  }

  function searchUrl(query, page) {
    var p = page > 0 ? page : 1;
    var q = "?s=" + encodeURIComponent(query) + "&post_type=wp-manga";
    return p === 1 ? baseUrl + "/" + q : baseUrl + "/page/" + p + "/" + q;
  }

  function genreUrl(slug, page) {
    var p = page > 0 ? page : 1;
    return p === 1
      ? baseUrl + "/manga-genre/" + slug + "/"
      : baseUrl + "/manga-genre/" + slug + "/page/" + p + "/";
  }

  // archive cards: <div id="manga-item-399" class="item-thumb"><a href title><img src>
  function parseArchive(html) {
    var out = [];
    var seen = {};
    var re = /<div id="manga-item-\d+" class="item-thumb[^"]*"[^>]*>\s*<a href="([^"]+)" title="([^"]*)"[^>]*>\s*<img[^>]+src="([^"]+)"/g;
    var m;
    while ((m = re.exec(html))) {
      var url = makeAbsolute(m[1]);
      var title = cleanTitle(m[2]);
      if (!title || seen[url]) continue;
      seen[url] = 1;
      out.push({
        title: title,
        coverUrl: makeAbsolute(m[3]),
        detailUrl: url,
        contentType: "manga"
      });
    }
    return out;
  }

  // search cards: <div class="tab-thumb"><a href title><img src>
  function parseSearch(html) {
    var out = [];
    var seen = {};
    var re = /<div class="tab-thumb[^"]*"[^>]*>\s*<a href="([^"]+)" title="([^"]*)"[^>]*>\s*<img[^>]+src="([^"]+)"/g;
    var m;
    while ((m = re.exec(html))) {
      var url = makeAbsolute(m[1]);
      var title = cleanTitle(m[2]);
      if (!title || seen[url]) continue;
      seen[url] = 1;
      out.push({
        title: title,
        coverUrl: makeAbsolute(m[3]),
        detailUrl: url,
        contentType: "manga"
      });
    }
    return out;
  }

  function slugFromUrl(url) {
    var m = /\/manga\/([^/?#]+)/.exec(String(url || ""));
    return m ? m[1] : "";
  }

  function parseDate(text) {
    var m = /([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/.exec(String(text || ""));
    if (!m) return "";
    var mon = MONTHS[String(m[1]).slice(0, 3).toLowerCase()];
    if (!mon) return "";
    var day = m[2].length < 2 ? "0" + m[2] : m[2];
    return m[3] + "-" + mon + "-" + day;
  }

  return {
    requiresCloudflare: false,

    async getHomepageManga(args) {
      try {
        var page = (args && args.page) || 1;
        var html = await fetchText(archiveUrl(page));
        return parseArchive(html);
      } catch (e) {
        if (shouldPropagate(e)) throw e;
        return [];
      }
    },

    async search(args) {
      try {
        var query = cleanTitle((args && args.query) || "");
        if (!query) return [];
        var page = (args && args.page) || 1;
        var html = await fetchText(searchUrl(query, page));
        return parseSearch(html);
      } catch (e) {
        if (shouldPropagate(e)) throw e;
        return [];
      }
    },

    async getFilteredManga(args) {
      try {
        var page = (args && args.page) || 1;
        var genre = cleanTitle((args && args.genre) || "");
        var map = await genres();
        var slug = "";
        for (var label in map) {
          if (label.toLowerCase() === genre.toLowerCase()) {
            slug = map[label];
            break;
          }
        }
        var html = await fetchText(slug ? genreUrl(slug, page) : archiveUrl(page));
        return parseArchive(html);
      } catch (e) {
        if (shouldPropagate(e)) throw e;
        return [];
      }
    },

    async getGenresAndTypes() {
      try {
        var map = await genres();
        var out = [];
        for (var label in map) out.push(label);
        if (out.length) return { genres: out, types: [] };
      } catch (e) {}
      var fallback = [];
      for (var key in FALLBACK_GENRES) fallback.push(key);
      return { genres: fallback, types: [] };
    },

    async getMangaDetails(args) {
      var url = makeAbsolute((args && args.url) || "");
      var slug = slugFromUrl(url);
      if (!slug) throw new Error("No manga slug in " + url);
      var html = await fetchText(baseUrl + "/manga/" + slug + "/");

      var title = "";
      var h1 = /<h1[^>]*>([\s\S]{0,300}?)<\/h1>/.exec(html);
      if (h1) title = stripHtml(h1[1]);
      if (!title) title = slug;

      var cover = "";
      var og = /<meta[^>]+property="og:image"[^>]+content="([^"]+)"/.exec(html);
      if (og) cover = makeAbsolute(og[1]);

      var description = "";
      var sIdx = html.indexOf('class="summary__content');
      if (sIdx !== -1) {
        var seg = html.slice(sIdx, sIdx + 30000);
        var ps = seg.match(/<p[^>]*>[\s\S]*?<\/p>/g) || [];
        var parts = [];
        for (var p = 0; p < ps.length; p++) {
          var txt = stripHtml(ps[p]);
          if (txt) parts.push(txt);
        }
        description = parts.join(" ");
      }

      // the site's own genre labels, raw - the app's Block Filter owns the vocabulary
      var genresOut = [];
      var gseen = {};
      var gre = /href="[^"]*\/manga-genre\/([a-z0-9\-]+)\/"[^>]*>([^<]{1,40}?)</g;
      var gm;
      while ((gm = gre.exec(html))) {
        var gl = cleanTitle(gm[2]);
        if (gl && !gseen[gl]) {
          gseen[gl] = 1;
          genresOut.push(gl);
        }
      }

      var status = "";
      var st = /<h5>\s*Status\s*<\/h5>[\s\S]{0,300}?class="summary-content"[^>]*>([^<]{1,40})/.exec(html);
      if (st) status = cleanTitle(st[1]);

      var year = "";
      var yr = /<h5>\s*Release\s*<\/h5>[\s\S]{0,300}?class="summary-content"[^>]*>[\s\S]{0,200}?>(20\d{2})</.exec(html);
      if (yr) year = yr[1];

      // the chapter list is loaded by the theme through its own AJAX endpoint
      var raw = await request(baseUrl + "/manga/" + slug + "/ajax/chapters/?t=1", {
        method: "POST",
        body: "",
        headers: {
          "X-Requested-With": "XMLHttpRequest",
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "Referer": baseUrl + "/manga/" + slug + "/"
        }
      });
      var cIdx = raw.indexOf("version-chap");
      var cSeg = cIdx !== -1 ? raw.slice(cIdx) : raw;
      var chapters = [];
      var cre = /<li class="wp-manga-chapter[^"]*"[^>]*>([\s\S]{0,600}?)<\/li>/g;
      var cm;
      while ((cm = cre.exec(cSeg))) {
        var block = cm[1];
        var link = /<a[^>]+href="([^"]*\/manga\/[^"]*\/chapter-[^"]+)"[^>]*>([\s\S]{0,160}?)<\/a>/.exec(block);
        if (!link) continue;
        var num = /chapter-(\d+)/.exec(link[1]);
        var date = /<i>([^<]{4,40})<\/i>/.exec(block);
        chapters.push({
          number: num ? num[1] : cleanTitle(link[2]),
          title: cleanTitle(link[2]),
          url: makeAbsolute(link[1]),
          views: 0,
          isLocked: false,
          date: date ? parseDate(date[1]) : ""
        });
      }

      return {
        title: title,
        coverUrl: cover,
        description: description,
        genres: genresOut,
        chapters: chapters,
        originalUrl: baseUrl + "/manga/" + slug + "/",
        hasMoreChapters: false,
        lastFetchedPage: 1,
        status: status,
        year: year,
        contentType: "manga"
      };
    },

    async getChapterPages(args) {
      var chapterUrl = makeAbsolute((args && args.url) || "");
      lastChapterUrl = chapterUrl || lastChapterUrl;
      var html = await fetchText(chapterUrl, { "Accept": "text/html,application/xhtml+xml,*/*;q=0.8" });
      var pages = [];
      var re = /<img[^>]+id="image-(\d+)"[^>]+src="([^"]+)"[^>]*class="wp-manga-chapter-img"/g;
      var m;
      while ((m = re.exec(html))) {
        pages.push({ index: parseInt(m[1], 10), url: makeAbsolute(m[2]) });
      }
      if (!pages.length) {
        var re2 = /<img[^>]+src="([^"]+)"[^>]*class="wp-manga-chapter-img"/g;
        while ((m = re2.exec(html))) pages.push({ index: pages.length, url: makeAbsolute(m[1]) });
      }
      if (!pages.length) throw new Error("No chapter images in " + chapterUrl);
      pages.sort(function (a, b) {
        return a.index - b.index;
      });
      var urls = [];
      for (var i = 0; i < pages.length; i++) urls.push(pages[i].url);
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
