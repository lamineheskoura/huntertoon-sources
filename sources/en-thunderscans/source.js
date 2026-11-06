function createSource(api, config) {
  var baseUrl = ((config && config.base_url) || "https://en-thunderscans.com").replace(/\/+$/, "");
  var configHeaders = (config && config.headers) || {};
  var userAgent =
    configHeaders["User-Agent"] ||
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
  var lastChapterUrl = baseUrl + "/";
  var FILTER_COOKIES = "gt_hide_bl=1; gt_hide_adult=1";
  var ADULT_GENRE_KEYWORDS = [
    "성인", "19", "야한", "에로", "에로틱", "bl", "gl", "하렘", "백합", "성인만화",
    "adult", "hentai", "ecchi", "mature", "18+", "smut", "porn", "xxx"
  ];

  var defaultHeaders = {
    "User-Agent": userAgent,
    "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
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
    return String(s || "")
      .replace(/&#8220;/g, '"')
      .replace(/&#8221;/g, '"')
      .replace(/&#8216;/g, "'")
      .replace(/&#8217;/g, "'")
      .replace(/&#8230;/g, "...")
      .replace(/&#8211;/g, "-")
      .replace(/&#8212;/g, "-")
      .replace(/&#38;/g, "&")
      .replace(/&#39;/g, "'")
      .replace(/&#47;/g, "/")
      .replace(/&nbsp;/g, " ")
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/\s+/g, " ")
      .trim();
  }

  function stripHtml(s) {
    return cleanTitle(
      String(s || "")
        .replace(/<br\s*\/?>/gi, " ")
        .replace(/<\/p>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
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

  function now() {
    return typeof api.now === "function" ? api.now() : Date.now();
  }

  function parseCatalog(html) {
    var out = [];
    var cardRe = /<a[^>]+href="([^"]*\/comics\/[^"]+\/)"[^>]*>([\s\S]{0,1500}?)(?:<\/a>|<\/div>)/gi;
    var m;
    while ((m = cardRe.exec(html))) {
      var url = makeAbsolute(m[1]);
      var block = m[0];
      var titleM = block.match(/title="([^"]+)"/);
      var coverM = block.match(/<img[^>]+src="([^"]*wp-content\/uploads[^"]+)"[^>]*>/i);
      var title = titleM ? cleanTitle(titleM[1]) : "";
      var cover = coverM ? makeAbsolute(coverM[1]) : "";
      if (!title) continue;
      out.push({
        title: title,
        coverUrl: cover,
        detailUrl: url,
        contentType: "manga"
      });
    }
    return out;
  }

  function slugFromUrl(url) {
    var m = /\/([^/?#]+)\/?$/.exec(String(url || ""));
    if (!m) m = /\/([^/?#]+)-chapter-\d+-\d+\/$/.exec(String(url || ""));
    return m ? m[1] : "";
  }

  function chapterDate(text) {
    if (!text) return "";
    var m = /(\d{4})-(\d{2})-(\d{2})/.exec(String(text));
    return m ? m[1] + "-" + m[2] + "-" + m[3] : "";
  }

  return {
    requiresCloudflare: false,

    async getHomepageManga(args) {
      try {
        var page = (args && args.page) || 1;
        var html = await request(baseUrl + "/comics/?type=manhwa&page=" + page);
        return parseCatalog(html);
      } catch (e) {
        if (shouldPropagate(e)) throw e;
        return [];
      }
    },

    async search(args) {
      try {
        var query = cleanTitle((args && args.query) || "");
        if (!query) return [];
        var html = await request(baseUrl + "/?s=" + encodeURIComponent(query));
        return parseCatalog(html);
      } catch (e) {
        if (shouldPropagate(e)) throw e;
        return [];
      }
    },

    async getFilteredManga(args) {
      try {
        var page = (args && args.page) || 1;
        var genre = cleanTitle((args && args.genre) || "");
        var type = cleanTitle((args && args.type) || "").toLowerCase();
        var url = baseUrl + "/comics/?type=" + encodeURIComponent(type || "manhwa") + "&page=" + page;
        if (genre) url += "&genre=" + encodeURIComponent(genre);
        var html = await request(url);
        return parseCatalog(html);
      } catch (e) {
        if (shouldPropagate(e)) throw e;
        return [];
      }
    },

    async getGenresAndTypes() {
      try {
        var res = await request(baseUrl + "/comics/?type=manhwa&page=1");
        var genres = [];
        var gseen = {};
        var re = /<a[^>]+href="([^"]*\/genres\/[^"]+)"[^>]*>([^<]+)<\/a>/g;
        var gm;
        while ((gm = re.exec(res))) {
          var tag = cleanTitle(gm[2]);
          if (tag && !gseen[tag] && !isAdultGenre(tag)) { gseen[tag] = 1; genres.push(tag); }
        }
        if (genres.length) return { genres: genres, types: ["manga", "manhwa", "manhua"] };
      } catch (e) {}
      return { genres: [], types: ["manga", "manhwa", "manhua"] };
    },

    async getMangaDetails(args) {
      var url = makeAbsolute((args && args.url) || "");
      var slug = slugFromUrl(url);
      if (!slug) throw new Error("No manga slug in " + url);
      var d = await request(baseUrl + "/" + slug + "/");

      var title = "";
      var h1 = /<h1[^>]*>([\s\S]{0,300}?)<\/h1>/.exec(d);
      if (h1) title = cleanTitle(h1[1]);
      if (!title) title = slug;

      var cover = "";
      var og = /<meta[^>]+property="og:image"[^>]+content="([^"]+)"/.exec(d);
      if (!og) {
        var covM = d.match(/<img[^>]+src="([^"]*wp-content\/uploads[^"]+)"[^>]*>/i);
        if (covM) cover = makeAbsolute(covM[1]);
      } else {
        cover = makeAbsolute(og[1]);
      }

      var description = "";
      var desc = /<div[^>]+class="entry-content entry-content-single"[^>]*>([\s\S]{0,4000}?)<\/div>/.exec(d);
      if (desc) description = stripHtml(desc[1]);

      var genresOut = [];
      var gseen = {};
      var gre = /<a[^>]+href="[^"]*\/genres\/[^"]+"[^>]*>([^<]+)<\/a>/g;
      var gm;
      while ((gm = gre.exec(d))) {
        var tag = cleanTitle(gm[1]);
        if (tag && !gseen[tag]) { gseen[tag] = 1; genresOut.push(tag); }
      }

      var status = "";
      var stM = /<h1>\s*Status\s*<\/h1>\s*<i>([^<]+)<\/i>/.exec(d);
      if (stM) status = cleanTitle(stM[1]);

      var chapters = [];
      var chapRe = /href="([^"]*\/[^"]+-chapter-(\d+)-(\d+)\/)"[^>]*>/g;
      var cm;
      while ((cm = chapRe.exec(d))) {
        var chUrl = makeAbsolute(cm[1]);
        var chNum = cm[2];
        var chPart = cm[3];
        chapters.push({
          number: chNum + (chPart !== "1" ? "." + chPart : ""),
          title: "Chapter " + chNum + (chPart !== "1" ? "." + chPart : ""),
          url: chUrl,
          views: 0,
          isLocked: false,
          date: ""
        });
      }
      chapters.sort(function(a, b) {
        var na = parseFloat(a.number);
        var nb = parseFloat(b.number);
        return na - nb;
      });

      return {
        title: title,
        coverUrl: cover,
        description: description,
        genres: genresOut,
        chapters: chapters,
        originalUrl: baseUrl + "/" + slug + "/",
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
      var re = /https:\/\/en-thunderscans\.com\/wp-content\/uploads\/[^"\']+\.(?:jpg|jpeg|png|webp)/gi;
      var m;
      while ((m = re.exec(html))) {
        pages.push({ index: pages.length, url: m[0] });
      }
      if (!pages.length) throw new Error("No chapter images in " + chapterUrl);
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
