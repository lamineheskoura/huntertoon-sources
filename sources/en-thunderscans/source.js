function createSource(api, config) {
  var baseUrl = ((config && config.base_url) || "https://en-thunderscans.com").replace(/\/+$/, "");
  var configHeaders = (config && config.headers) || {};
  var userAgent =
    configHeaders["User-Agent"] ||
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
  var lastChapterUrl = baseUrl + "/";

  var DEFAULT_TYPE = "manhwa";
  var SITE_TYPES = ["manhwa", "manga", "manhua", "novel"];
  // The site's own taxonomy marks these labels as sexual/adult content.
  // Verified live 2026-11-07: they return results via the site's genre filter.
  var ADULT_GENRE_LABELS = [
    "adult",
    "ecchi",
    "mature",
    "manhwa hot",
    "yuri",
    "shoujo ai",
    "monster girls",
    "harem",
    "gender bender"
  ];
  var TTL = 1800000;

  var genreMap = null;
  var genreMapAt = 0;
  var blockedSlugs = null;
  var blockedAt = 0;

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
    return decodeEntities(String(s || "").replace(/\s+/g, " ").trim());
  }

  function stripHtml(s) {
    return cleanTitle(
      String(s || "")
        .replace(/<br\s*\/?>/gi, " ")
        .replace(/<\/p>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
    );
  }

  function attr(tag, name) {
    var re = new RegExp("\\b" + name + "\\s*=\\s*[\"']([^\"']*)[\"']", "i");
    var m = re.exec(tag);
    return m ? m[1] : "";
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

  // ---------- helpers ----------

  function slugFromUrl(url) {
    var m = /\/comics\/([^/?#]+)\/?$/.exec(String(url || ""));
    return m ? m[1] : "";
  }

  function chapterDate(text) {
    if (!text) return "";
    var s = String(text).trim();
    // July 13, 2026
    var m = /([A-Za-z]{3,})\s+(\d{1,2}),?\s+(\d{4})/.exec(s);
    if (m) {
      var mon = ["january","february","march","april","may","june","july","august","september","october","november","december"];
      var mi = mon.indexOf(m[1].toLowerCase());
      if (mi !== -1) {
        var mm = (mi + 1) < 10 ? "0" + (mi + 1) : String(mi + 1);
        var dd = m[2] < 10 ? "0" + m[2] : String(m[2]);
        return m[3] + "-" + mm + "-" + dd;
      }
    }
    m = /(\d{4})-(\d{2})-(\d{2})/.exec(s);
    return m ? m[1] + "-" + m[2] + "-" + m[3] : "";
  }

  function isAdultGenre(label) {
    var l = String(label || "").toLowerCase();
    for (var i = 0; i < ADULT_GENRE_LABELS.length; i++) {
      if (l === ADULT_GENRE_LABELS[i]) return true;
    }
    return false;
  }

  // Parse the site's own advanced-search genre panel: id -> raw label.
  async function getGenreMap() {
    if (genreMap && now() - genreMapAt < TTL) return genreMap;
    var html = await fetchText(baseUrl + "/comics/?type=" + DEFAULT_TYPE);
    var map = {};
    var re = /<label[^>]*for="genre-(\d+)"[^>]*>([^<]*)<\/label>/g;
    var m;
    while ((m = re.exec(html))) {
      var label = cleanTitle(m[2]);
      if (label) map[m[1]] = label;
    }
    if (!Object.keys(map).length) throw new Error("No genres parsed at " + baseUrl);
    genreMap = map;
    genreMapAt = now();
    return map;
  }

  // Slugs of series tagged with any adult genre, using the site's own
  // genre[] filter. Computed once per session, then cached.
  async function getBlockedSlugs() {
    if (blockedSlugs && now() - blockedAt < TTL) return blockedSlugs;
    var map = await getGenreMap();
    var ids = [];
    for (var id in map) {
      if (isAdultGenre(map[id])) ids.push(id);
    }
    var set = {};
    if (ids.length) {
      var concurrency = 4;
      var results = new Array(ids.length);
      var idx = 0;
      function worker() {
        while (idx < ids.length) {
          var i = idx++;
          results[i] = fetchText(baseUrl + "/comics/?type=" + DEFAULT_TYPE + "&genre[]=" + encodeURIComponent(ids[i])).catch(function () { return ""; });
        }
      }
      var workers = [];
      for (var w = 0; w < Math.min(concurrency, ids.length); w++) workers.push(worker());
      await Promise.all(workers);
      for (var i = 0; i < results.length; i++) {
        try {
          var html = await results[i];
        } catch (e) {
          html = "";
        }
        var re = /<a[^>]+href="[^"]*\/comics\/([^"?#\/]+)\/"[^>]*title="[^"]*"/g;
        var m;
        while ((m = re.exec(html))) set[m[1]] = 1;
      }
    }
    blockedSlugs = set;
    blockedAt = now();
    return set;
  }

  // ---------- catalogue parsing ----------

  function parseCatalog(html) {
    var out = [];
    var seen = {};
    var re = /<a\b([^>]*)>/gi;
    var m;
    while ((m = re.exec(html))) {
      var tag = m[0];
      var href = attr(tag, "href");
      if (!href) continue;
      var sm = /\/comics\/([^"?#\/]+)\/?$/.exec(href);
      if (!sm) continue;
      var slug = sm[1];
      if (seen[slug]) continue;
      var title = cleanTitle(attr(tag, "title") || "");
      var blockEnd = html.indexOf("</a>", m.index);
      if (blockEnd === -1) blockEnd = html.length;
      var block = html.slice(m.index, Math.min(blockEnd, m.index + 6000));
      if (!title) {
        var tt = /<div[^>]+class="tt"[^>]*>([\s\S]{0,200}?)<\/div>/.exec(block);
        if (tt) title = cleanTitle(stripHtml(tt[1]));
      }
      if (!title) continue;
      var cover = "";
      var im = /<img\b[^>]*>/i.exec(block);
      if (im) {
        var src = attr(im[0], "src") || attr(im[0], "data-src") || attr(im[0], "data-lazy-src");
        if (src && /wp-content\/uploads\//i.test(src)) cover = makeAbsolute(src);
      }
      seen[slug] = 1;
      out.push({
        title: title,
        coverUrl: cover,
        detailUrl: makeAbsolute(href),
        contentType: "manhwa"
      });
    }
    return out;
  }

  function fetchBrowse(page, extra) {
    var qs = ["type=" + DEFAULT_TYPE];
    if (extra && extra.type) qs[0] = "type=" + encodeURIComponent(extra.type);
    if (extra && extra.status) qs.push("status=" + encodeURIComponent(extra.status));
    if (extra && extra.order) qs.push("order=" + encodeURIComponent(extra.order));
    if (extra && extra.genreId) qs.push("genre[]=" + encodeURIComponent(extra.genreId));
    qs.push("page=" + (page > 0 ? page : 1));
    return baseUrl + "/comics/?" + qs.join("&");
  }

  async function filteredList(page, extra) {
    var blocked = await getBlockedSlugs();
    var html = await fetchText(fetchBrowse(page, extra));
    var list = parseCatalog(html);
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var slug = slugFromUrl(list[i].detailUrl);
      if (!slug || blocked[slug]) continue;
      out.push(list[i]);
    }
    return out;
  }

  async function searchManga(query, page) {
    var blocked = await getBlockedSlugs();
    var html = await fetchText(baseUrl + "/?s=" + encodeURIComponent(query) + "&post_type=wp-manga&page=" + page);
    var list = parseCatalog(html);
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var slug = slugFromUrl(list[i].detailUrl);
      if (!slug || blocked[slug]) continue;
      out.push(list[i]);
    }
    return out;
  }

  // ---------- source ----------

  return {
    requiresCloudflare: false,

    async getHomepageManga(args) {
      try {
        var page = (args && args.page) || 1;
        return filteredList(page, {});
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
        return searchManga(query, page);
      } catch (e) {
        if (shouldPropagate(e)) throw e;
        return [];
      }
    },

    async getFilteredManga(args) {
      try {
        var page = (args && args.page) || 1;
        var genre = cleanTitle((args && args.genre) || "");
        var type = cleanTitle((args && args.type) || DEFAULT_TYPE).toLowerCase();
        var extra = {};
        if (SITE_TYPES.indexOf(type) !== -1) extra.type = type;
        if (genre) {
          var map = await getGenreMap();
          for (var id in map) {
            if (String(map[id]).toLowerCase() === genre.toLowerCase()) {
              extra.genreId = id;
              break;
            }
          }
        }
        return filteredList(page, extra);
      } catch (e) {
        if (shouldPropagate(e)) throw e;
        return [];
      }
    },

    async getGenresAndTypes() {
      try {
        var map = await getGenreMap();
        var out = [];
        for (var id in map) {
          var label = map[id];
          if (!isAdultGenre(label)) out.push(label);
        }
        if (out.length) return { genres: out, types: SITE_TYPES.slice() };
      } catch (e) {}
      return { genres: [], types: SITE_TYPES.slice() };
    },

    async getMangaDetails(args) {
      var url = makeAbsolute((args && args.url) || "");
      var slug = slugFromUrl(url);
      if (!slug) throw new Error("No manga slug in " + url);
      var d = await request(baseUrl + "/comics/" + slug + "/");

      var title = "";
      var h1 = /<h1[^>]*>([\s\S]{0,300}?)<\/h1>/.exec(d);
      if (h1) title = cleanTitle(h1[1]);
      if (!title) title = slug;

      var cover = "";
      var cov = /<div[^>]+class="thumb"[^>]*>([\s\S]{0,600}?)<img[^>]+src="([^"]+)"/i.exec(d);
      if (cov) cover = makeAbsolute(cov[2]);
      if (!cover) {
        var bb = /<div[^>]+class="bigbanner"[^>]*style="background-image:\s*url\(['"]?([^"')]+)/i.exec(d);
        if (bb) cover = makeAbsolute(bb[1]);
      }

      var description = "";
      var desc = /<div[^>]+class="entry-content entry-content-single"[^>]*>([\s\S]{0,8000}?)<\/div>/i.exec(d);
      if (desc) description = stripHtml(desc[1]);

      var genresOut = [];
      var gseen = {};
      var gre = /<a[^>]+href="[^"]*\/genres\/[^"]*"[^>]+rel="tag"[^>]*>([^<]{0,120})<\/a>/gi;
      var gm;
      while ((gm = gre.exec(d))) {
        var gl = cleanTitle(gm[1]);
        if (gl && !gseen[gl]) { gseen[gl] = 1; genresOut.push(gl); }
      }

      var status = "";
      var stM = /<h1[^>]*>\s*Status\s*<\/h1>\s*<i>([^<]*)<\/i>/i.exec(d);
      if (stM) status = cleanTitle(stM[1]);

      var siteType = "";
      var tyM = /<h1[^>]*>\s*Type\s*<\/h1>\s*<i>([^<]*)<\/i>/i.exec(d);
      if (tyM) siteType = cleanTitle(tyM[1]);

      var chapters = [];
      var chapRe = /<li[^>]*data-num="(\d+)"[^>]*>([\s\S]{0,900}?)<\/li>/gi;
      var cm;
      while ((cm = chapRe.exec(d))) {
        var block = cm[2];
        var lm = /<a[^>]+href="([^"]*?-chapter-\d+(?:-\d+)?\/)"[^>]*>/.exec(block);
        if (!lm) continue;
        var chUrl = makeAbsolute(lm[1]);
        var num = /-chapter-(\d+)(?:-(\d+))?\/$/.exec(lm[1]);
        var chNum = num ? (num[2] ? num[1] + "." + num[2] : num[1]) : "";
        var titleM = /<span class="chapternum">([^<]*)<\/span>/.exec(block);
        var chTitle = cleanTitle(titleM ? titleM[1] : "");
        var dateM = /<span class="chapterdate">([^<]*)<\/span>/.exec(block);
        var chDate = chapterDate(dateM ? dateM[1] : "");
        chapters.push({
          number: chNum,
          title: chTitle || ("Chapter " + chNum),
          url: chUrl,
          views: 0,
          isLocked: false,
          date: chDate
        });
      }
      chapters.sort(function (a, b) {
        var na = parseFloat(a.number) || 0;
        var nb = parseFloat(b.number) || 0;
        return na - nb;
      });

      return {
        title: title,
        coverUrl: cover,
        description: description,
        genres: genresOut,
        chapters: chapters,
        originalUrl: baseUrl + "/comics/" + slug + "/",
        hasMoreChapters: false,
        lastFetchedPage: 1,
        status: status,
        type: siteType,
        contentType: "manhwa"
      };
    },

    async getChapterPages(args) {
      var chapterUrl = makeAbsolute((args && args.url) || "");
      lastChapterUrl = chapterUrl || lastChapterUrl;
      var html = await fetchText(chapterUrl, { "Accept": "text/html,application/xhtml+xml,*/*;q=0.8" });
      var pages = parseReaderImages(html);
      if (!pages.length) throw new Error("No chapter images in " + chapterUrl);
      var urls = [];
      var seen = {};
      for (var i = 0; i < pages.length; i++) {
        if (!seen[pages[i]]) { seen[pages[i]] = 1; urls.push(pages[i]); }
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

function parseReaderImages(html) {
  var out = [];
  var i = html.indexOf("ts_reader.run(");
  if (i !== -1) {
    var s = html.indexOf("{", i);
    var depth = 0, inStr = false, esc = false, end = -1;
    for (var k = s; k < html.length; k++) {
      var c = html[k];
      if (inStr) {
        if (esc) esc = false;
        else if (c === "\\") esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') { inStr = true; continue; }
      if (c === "{") depth++;
      else if (c === "}") { depth--; if (depth === 0) { end = k + 1; break; } }
    }
    if (end !== -1) {
      try {
        var obj = JSON.parse(html.slice(s, end));
        var sources = obj.sources || [];
        if (sources.length) {
          var imgs = sources[0].images || [];
          for (var j = 0; j < imgs.length; j++) out.push(makeAbsolute_local(imgs[j]));
        }
      } catch (e) {}
    }
  }
  if (!out.length) {
    var re = /<img[^>]+src="([^"]+)"[^>]*>/gi;
    var m;
    while ((m = re.exec(html))) {
      var src = m[1];
      if (/wp-content\/uploads\/manga\//i.test(src)) out.push(makeAbsolute_local(src));
    }
  }
  var urls = [];
  var seen = {};
  for (var i2 = 0; i2 < out.length; i2++) {
    var u = out[i2];
    if (!seen[u]) { seen[u] = 1; urls.push(u); }
  }
  return urls;
}

function makeAbsolute_local(url) {
  if (!url) return "";
  url = String(url).trim();
  if (url.indexOf("http://") === 0) return "https:" + url.substring(5);
  if (url.indexOf("https://") === 0) return url;
  if (url.indexOf("//") === 0) return "https:" + url;
  if (url.indexOf("/") === 0) return "https://en-thunderscans.com" + url;
  return "https://en-thunderscans.com/" + url;
}

if (typeof module !== "undefined") module.exports = { createSource: createSource };
