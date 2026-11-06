function createSource(api, config) {
  var baseUrl = ((config && config.base_url) || "https://www.goodtoon010.com").replace(/\/+$/, "");
  var configHeaders = (config && config.headers) || {};
  var userAgent =
    configHeaders["User-Agent"] ||
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
  var lastChapterUrl = baseUrl + "/";
  var FILTER_COOKIES = "gt_hide_bl=1; gt_hide_adult=1";
  var ADULT_GENRE_KEYWORDS = [
    "성인", "19", "야한", "에로", "에로틱", "bl", "gl", "하렘", "백합", "성인만화",
    "adult", "hentai", "ecchi", "mature", "18+", "smut"
  ];

  var defaultHeaders = {
    "User-Agent": userAgent,
    "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
    "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8",
    "Referer": baseUrl + "/",
    "Origin": baseUrl,
    "Cookie": FILTER_COOKIES
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

  function isAdultGenre(label) {
    var l = String(label || "").toLowerCase();
    for (var i = 0; i < ADULT_GENRE_KEYWORDS.length; i++) {
      if (l.indexOf(ADULT_GENRE_KEYWORDS[i].toLowerCase()) !== -1) return true;
    }
    return false;
  }

  return {
    requiresCloudflare: false,

    async getHomepageManga(args) {
      try {
        var page = (args && args.page) || 1;
        var items = await this._fetchList(baseUrl + "/?pg=" + page + "&mcat=all");
        return items;
      } catch (e) {
        if (shouldPropagate(e)) throw e;
        return [];
      }
    },

    async search(args) {
      try {
        var query = cleanTitle((args && args.query) || "");
        if (!query) return [];
        return await this._parseList(await request(baseUrl + "/?s=" + encodeURIComponent(query)));
      } catch (e) {
        if (shouldPropagate(e)) throw e;
        return [];
      }
    },

    async getFilteredManga(args) {
      try {
        var page = (args && args.page) || 1;
        var genre = cleanTitle((args && args.genre) || "");
        var mcat = genre || "all";
        return await this._fetchList(baseUrl + "/?pg=" + page + "&mcat=" + encodeURIComponent(mcat));
      } catch (e) {
        if (shouldPropagate(e)) throw e;
        return [];
      }
    },

    async getGenresAndTypes() {
      try {
        var res = await request(baseUrl + "/?pg=1&mcat=all");
        var genres = [];
        var gseen = {};
        var re = /<div class="genre">([^<]+)<\/div>/g;
        var m;
        while ((m = re.exec(res))) {
          var g = cleanTitle(m[1]);
          if (g && !gseen[g] && !isAdultGenre(g)) { gseen[g] = 1; genres.push(g); }
        }
        if (genres.length) return { genres: genres, types: ["만화"] };
      } catch (e) {}
      return { genres: [], types: ["만화"] };
    },

    async getMangaDetails(args) {
      var url = makeAbsolute((args && args.url) || "");
      var slug = this._slugFromUrl(url);
      if (!slug) throw new Error("No manga slug in " + url);
      var d = await request(baseUrl + "/manga/" + slug + "/");

      var title = "";
      var h1 = /<h1[^>]*>([\s\S]{0,200}?)<\/h1>/.exec(d);
      if (h1) title = stripHtml(h1[1]);
      if (!title) title = slug;

      var cover = "";
      var og = /<meta[^>]+property="og:image"[^>]+content="([^"]+)"/.exec(d);
      if (og) cover = makeAbsolute(og[1]);

      var description = "";
      var desc = /<div[^>]+class="manga-summary-desc"[^>]*>([\s\S]{0,4000}?)<\/div>/.exec(d);
      if (desc) description = stripHtml(desc[1]);

      var genresOut = [];
      var gseen = {};
      var gre = /<a[^>]+href="[^"]*\/manga-genre\/[^"]+"[^>]*>([^<]+)<\/a>/g;
      var gm;
      while ((gm = gre.exec(d))) {
        var tag = cleanTitle(gm[1]);
        if (tag && !gseen[tag]) { gseen[tag] = 1; genresOut.push(tag); }
      }

      var status = "";
      var st = /완결|연재/.exec(d);
      if (st) status = st[0];

      var latestCh = 0;
      var latestM = /<a[^>]*href="([^"]*\/manga\/[^"]+\/\d+\/)"[^>]*class="btn-latest-ep"/i.exec(d);
      if (latestM) {
        var lm = /\/(\d+)\/?$/.exec(latestM[1]);
        if (lm) latestCh = parseInt(lm[1], 10);
      }

      var chapters = [];
      for (var c = 1; c <= latestCh; c++) {
        chapters.push({
          number: String(c),
          title: "Chapter " + c,
          url: baseUrl + "/manga/" + slug + "/" + c + "/",
          views: 0,
          isLocked: false,
          date: ""
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
        type: "만화",
        contentType: "manga"
      };
    },

    async getChapterPages(args) {
      var chapterUrl = makeAbsolute((args && args.url) || "");
      lastChapterUrl = chapterUrl || lastChapterUrl;
      var html = await fetchText(chapterUrl, { "Accept": "text/html,application/xhtml+xml,*/*;q=0.8" });
      var pages = [];
      var re = /https:\/\/img\.goodtoon9001\.top\/[^"\']+\/(\d+)\.(?:jpg|jpeg|png|webp)/gi;
      var m;
      while ((m = re.exec(html))) {
        pages.push({ index: parseInt(m[1], 10), url: m[0] });
      }
      if (!pages.length) throw new Error("No chapter images in " + chapterUrl);
      pages.sort(function (a, b) { return a.index - b.index; });
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
        "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8",
        "Sec-Fetch-Dest": "image",
        "Sec-Fetch-Mode": "no-cors",
        "Sec-Fetch-Site": "cross-site"
      };
    },

    sanitizeCoverUrl(args) {
      return makeAbsolute((args && args.url) || "");
    },

    _fetchList(url) {
      return request(url).then(function (html) {
        return this._parseList(html);
      }.bind(this));
    },

    _parseList(html) {
      var out = [];
      var cardRe = /<a[^>]+href="([^"]*\/manga\/[^"]+\/)"[^>]*class="[^"]*card[^"]*"[\s\S]{0,1200}?<\/a>/gi;
      var m;
      while ((m = cardRe.exec(html))) {
        var url = makeAbsolute(m[1]);
        var block = m[0];
        var titleM = block.match(/<div class="subject">([^<]+)<\/div>/);
        var genreM = block.match(/<div class="genre">([^<]+)<\/div>/);
        var title = titleM ? cleanTitle(titleM[1]) : "";
        var genre = genreM ? cleanTitle(genreM[1]) : "";
        if (!title || isAdultGenre(genre)) continue;
        var coverUrl = "";
        var covM = block.match(/<img[^>]+src="([^"]*(?:img\.goodtoon9001\.top|goodtoon010\.com\/wp-content\/uploads\/)[^"]+)"[^>]*>/i);
        if (covM) coverUrl = makeAbsolute(covM[1]);
        out.push({ title: title, coverUrl: coverUrl, detailUrl: url, contentType: "manga" });
      }
      return out;
    },

    _slugFromUrl(url) {
      var m = /\/manga\/([^/?#]+)\/?$/.exec(String(url || ""));
      if (!m) m = /\/manga\/([^/?#]+)\/\d+\//.exec(String(url || ""));
      return m ? m[1] : "";
    }
  };
}

if (typeof module !== "undefined") module.exports = { createSource: createSource };
