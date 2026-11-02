function createSource(api, config) {
  var baseUrl = ((config && config.base_url) || "https://flamecomics.xyz").replace(/\/+$/, "");
  var cdnBase = "https://cdn.flamecomics.xyz";
  var configHeaders = (config && config.headers) || {};
  var userAgent =
    configHeaders["User-Agent"] ||
    "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
  var lastChapterUrl = baseUrl + "/";
  var buildId = "";
  var catalog = null;
  var catalogAt = 0;
  var PAGE_SIZE = 24;

  // Site taxonomy (flamecomics.xyz/browse, verified 2026-11-01)
  var defaultGenres = [
    "Academy", "Action", "Adaptation", "Adventure", "Apocalypse", "Betrayal",
    "Calm Protagonist", "Comedy", "Cultivation", "Dungeons", "Ecchi",
    "Ecchi comedy", "Fantasy", "Fusion Fantasy", "Games", "Harem", "Historical",
    "Horror", "Hunter", "Isekai", "Josei", "Leveling", "Magic", "Martial Arts",
    "Military", "Modern Fantasy", "Monster", "Murim", "Mature", "Mystery",
    "Noir", "Official", "Post-Apocalyptic", "Psychological", "Regression",
    "Revenge", "Romance", "School Life", "Sci-fi", "Seinen", "Shoujo",
    "Shoujo Ai", "Shounen", "Slice of Life", "Supernatural", "Survival",
    "Sword and Magic", "Swordmaster", "System", "Thriller", "Time Travel",
    "Tragedy", "Transmigration", "VR", "Vampires", "Video Games", "Youth",
    "Zombies"
  ];
  var defaultTypes = ["manhwa", "manga", "manhua", "comic", "russian"];

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

  async function fetchText(url, extraHeaders) {
    var headers = mergeHeaders(defaultHeaders, extraHeaders);
    if (api.http) {
      var res = await api.http(url, { method: "GET", headers: headers });
      if (!res || !res.ok) throw new Error("HTTP " + (res ? res.status : 0) + " for " + url);
      return res.body || "";
    }
    var text = await api.fetchText(url, headers);
    if (!text) throw new Error("Empty response: " + url);
    return text;
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
        .replace(/'|&apos;/gi, "'")
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

  function pagePropsOf(data) {
    if (!data) return {};
    // the data route returns {pageProps}, the HTML page nests it under props
    if (data.pageProps) return data.pageProps;
    if (data.props && data.props.pageProps) return data.props.pageProps;
    return data;
  }

  async function fetchBuildId() {
    if (buildId) return buildId;
    var html = await fetchText(baseUrl + "/blog", { "Accept": "text/html,application/xhtml+xml,*/*;q=0.8" });
    var m = /"buildId":"([^"]+)"/.exec(html);
    if (!m) throw new Error("buildId not found at " + baseUrl + "/blog");
    buildId = m[1];
    return buildId;
  }

  // The Next.js data route serves the same pageProps as the HTML page without
  // the 1.5 MB markup, so it is the primary transport.
  async function fetchProps(path) {
    var id = await fetchBuildId();
    try {
      var txt = await fetchText(baseUrl + "/_next/data/" + id + "/" + path + ".json", {
        "Accept": "application/json,text/plain,*/*"
      });
      return pagePropsOf(JSON.parse(txt));
    } catch (e) {
      buildId = "";
    }
    try {
      var fresh = await fetchBuildId();
      var txt2 = await fetchText(baseUrl + "/_next/data/" + fresh + "/" + path + ".json", {
        "Accept": "application/json,text/plain,*/*"
      });
      return pagePropsOf(JSON.parse(txt2));
    } catch (e2) {
      var html = await fetchText(baseUrl + "/" + path, {
        "Accept": "text/html,application/xhtml+xml,*/*;q=0.8"
      });
      var m = /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
      if (!m) throw new Error("No page props for " + path);
      return pagePropsOf(JSON.parse(m[1]));
    }
  }

  async function catalogSeries() {
    var now = typeof api.now === "function" ? api.now() : Date.now();
    if (catalog && now - catalogAt < 600000) return catalog;
    var props = await fetchProps("browse");
    var list = props.series || [];
    catalog = Array.isArray(list) ? list : [];
    catalogAt = now;
    return catalog;
  }

  function coverUrl(series) {
    if (!series || !series.series_id || !series.cover) return "";
    return (
      cdnBase +
      "/uploads/images/series/" +
      series.series_id +
      "/" +
      series.cover +
      (series.last_edit ? "?" + series.last_edit : "")
    );
  }

  function toItem(series) {
    // novels carry a novel_id and have no /series page — they are not comics
    if (!series || !series.series_id || !series.title) return null;
    return {
      title: cleanTitle(series.title),
      coverUrl: coverUrl(series),
      detailUrl: baseUrl + "/series/" + series.series_id,
      contentType: "manga"
    };
  }

  function pageSlice(list, page) {
    var p = page > 0 ? page : 1;
    var start = (p - 1) * PAGE_SIZE;
    var out = [];
    for (var i = start; i < list.length && out.length < PAGE_SIZE; i++) {
      var item = toItem(list[i]);
      if (item) out.push(item);
    }
    return out;
  }

  function seriesIdFromUrl(url) {
    var m = /\/series\/(\d+)/.exec(String(url || ""));
    return m ? m[1] : "";
  }

  function chapterDate(unixSeconds) {
    var sec = parseInt(unixSeconds, 10);
    if (!sec) return "";
    var d = new Date(sec * 1000);
    if (isNaN(d.getTime())) return "";
    return d.toISOString().slice(0, 10);
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

  return {
    requiresCloudflare: false,

    async getHomepageManga(args) {
      try {
        var page = (args && args.page) || 1;
        return pageSlice(await catalogSeries(), page);
      } catch (e) {
        if (shouldPropagate(e)) throw e;
        return [];
      }
    },

    async search(args) {
      try {
        var query = String((args && args.query) || "").trim().toLowerCase();
        if (!query) return [];
        var page = (args && args.page) || 1;
        var list = await catalogSeries();
        var matched = [];
        for (var i = 0; i < list.length; i++) {
          var s = list[i];
          if (!s || !s.title) continue;
          if (String(s.title).toLowerCase().indexOf(query) !== -1) matched.push(s);
        }
        return pageSlice(matched, page);
      } catch (e) {
        if (shouldPropagate(e)) throw e;
        return [];
      }
    },

    async getFilteredManga(args) {
      try {
        var page = (args && args.page) || 1;
        var genre = String((args && args.genre) || "").trim();
        var type = String((args && args.type) || "").trim();
        var list = await catalogSeries();
        var matched = [];
        for (var i = 0; i < list.length; i++) {
          var s = list[i];
          if (!s) continue;
          if (genre) {
            var cats = s.categories || [];
            var hit = false;
            for (var c = 0; c < cats.length; c++) {
              if (String(cats[c]).toLowerCase() === genre.toLowerCase()) {
                hit = true;
                break;
              }
            }
            if (!hit) continue;
          }
          if (type && String(s.type || "").toLowerCase() !== type.toLowerCase()) continue;
          matched.push(s);
        }
        return pageSlice(matched, page);
      } catch (e) {
        if (shouldPropagate(e)) throw e;
        return [];
      }
    },

    async getGenresAndTypes() {
      try {
        var list = await catalogSeries();
        var out = [];
        for (var i = 0; i < list.length; i++) {
          var cats = (list[i] && list[i].categories) || [];
          for (var c = 0; c < cats.length; c++) {
            var name = cleanTitle(cats[c]);
            if (name && out.indexOf(name) === -1) out.push(name);
          }
        }
        if (out.length) return { genres: out, types: defaultTypes };
      } catch (e) {}
      return { genres: defaultGenres, types: defaultTypes };
    },

    async getMangaDetails(args) {
      var url = makeAbsolute((args && args.url) || "");
      var id = seriesIdFromUrl(url);
      if (!id) throw new Error("No series id in " + url);
      var props = await fetchProps("series/" + id);
      var series = props.series || {};
      var chapters = props.chapters || [];
      var out = [];
      for (var i = 0; i < chapters.length; i++) {
        var ch = chapters[i] || {};
        if (!ch.token) continue;
        out.push({
          number: String(ch.chapter || "0"),
          title: cleanTitle(ch.title || ""),
          url: baseUrl + "/series/" + (ch.series_id || id) + "/" + ch.token,
          views: 0,
          isLocked: false,
          date: chapterDate(ch.release_date)
        });
      }
      return {
        title: cleanTitle(series.title) || "Unknown",
        coverUrl: coverUrl(series),
        description: stripHtml(series.description),
        // the site's own labels, raw — the app's Block Filter owns the vocabulary
        genres: (series.tags || []).map(cleanTitle).filter(Boolean),
        chapters: out,
        originalUrl: baseUrl + "/series/" + id,
        hasMoreChapters: false,
        lastFetchedPage: 1,
        contentType: "manga"
      };
    },

    async getChapterPages(args) {
      var chapterUrl = makeAbsolute((args && args.url) || "");
      lastChapterUrl = chapterUrl || lastChapterUrl;
      var m = /\/series\/(\d+)\/([^/?#]+)/.exec(chapterUrl);
      if (!m) throw new Error("No chapter path in " + chapterUrl);
      var props = await fetchProps("series/" + m[1] + "/" + m[2]);
      var chapter = props.chapter || {};
      var images = chapter.images || {};
      var keys = [];
      for (var k in images) keys.push(k);
      keys.sort(function(a, b) {
        return (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0);
      });
      var urls = [];
      var stamp = chapter.release_date ? "?" + chapter.release_date : "";
      for (var i = 0; i < keys.length; i++) {
        var img = images[keys[i]] || {};
        if (!img.name) continue;
        urls.push(
          cdnBase +
            "/uploads/images/series/" +
            (chapter.series_id || m[1]) +
            "/" +
            (chapter.token || m[2]) +
            "/" +
            img.name +
            stamp
        );
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
