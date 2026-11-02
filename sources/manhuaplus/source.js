function createSource(api, config) {
  var baseUrl = ((config && config.base_url) || "https://manhuaplus.org").replace(/\/+$/, "");
  var configHeaders = (config && config.headers) || {};
  var userAgent =
    configHeaders["User-Agent"] ||
    "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
  var lastChapterUrl = baseUrl + "/";
  var genreMap = null;
  var genreMapAt = 0;
  var GENRE_TTL = 1800000;

  // The site's own advanced-search exclusion list (genre ids).
  // Adult(31) / Ecchi(67) / Loli(13546) / Mature(12) - verified live 2026-11-02.
  var ADULT_GENRE_LABELS = ["adult", "ecchi", "loli", "mature"];
  var ADULT_GENRE_IDS_FALLBACK = ["31", "67", "13546", "12"];
  var SITE_TYPES = ["manga", "manhua", "manhwa", "vncomic"];

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

  async function fetchText(url, extraHeaders) {
    var headers = mergeHeaders(defaultHeaders, extraHeaders);
    var lastErr = null;
    for (var attempt = 0; attempt < 2; attempt++) {
      try {
        if (api.http) {
          var res = await api.http(url, { method: "GET", headers: headers });
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

  // genre id -> label, parsed from the site's own advanced-search panel
  async function genres() {
    if (genreMap && now() - genreMapAt < GENRE_TTL) return genreMap;
    var html = await fetchText(baseUrl + "/filter/1/?sex=All&chapter_count=0");
    var map = {};
    var re = /<label[^>]*for="genre-(\d+)"[^>]*>([^<]*)<\/label>/g;
    var m;
    while ((m = re.exec(html))) {
      var label = cleanTitle(m[2]);
      if (label) map[m[1]] = label;
    }
    if (!Object.keys(map).length) throw new Error("No genres parsed at " + baseUrl + "/filter");
    genreMap = map;
    genreMapAt = now();
    return map;
  }

  function adultGenreIds(map) {
    var ids = [];
    for (var id in map) {
      var label = String(map[id] || "").toLowerCase();
      for (var i = 0; i < ADULT_GENRE_LABELS.length; i++) {
        if (label === ADULT_GENRE_LABELS[i]) {
          ids.push(id);
          break;
        }
      }
    }
    return ids.length ? ids : ADULT_GENRE_IDS_FALLBACK;
  }

  // /filter/{page}/ is the site's advanced search: it takes keyword, genres,
  // notGenres, type and status, and paginates at 25 works per page.
  function filterUrl(page, opts) {
    var p = page > 0 ? page : 1;
    var q = [];
    if (opts.keyword) q.push("keyword=" + encodeURIComponent(opts.keyword));
    if (opts.genreId) q.push("genres=" + encodeURIComponent(opts.genreId));
    q.push("notGenres=" + encodeURIComponent(opts.notGenres.join(",")));
    if (opts.type) q.push("type=" + encodeURIComponent(opts.type));
    if (opts.status) q.push("status=" + encodeURIComponent(opts.status));
    q.push("sex=All");
    q.push("chapter_count=0");
    return baseUrl + "/filter/" + p + "/?" + q.join("&");
  }

  function parseList(html) {
    var out = [];
    var seen = {};
    // the results grid sits before the sidebar; the "popular manga" widget
    // inside the sidebar repeats 5 works on every page (and is all that is
    // left when a search has no hit)
    var start = html.indexOf("gtc-f141a");
    var sidebar = html.indexOf('id="sidebar"');
    if (start !== -1) {
      html = html.slice(start, sidebar !== -1 && sidebar > start ? sidebar : html.length);
    } else if (sidebar !== -1) {
      html = html.slice(0, sidebar);
    }
    var re = /<img\b[^>]*>/g;
    var m;
    while ((m = re.exec(html))) {
      var tag = m[0];
      var cov = /data-src="([^"]*\/uploads\/covers\/[^"]+)"/.exec(tag) || /src="([^"]*\/uploads\/covers\/[^"]+)"/.exec(tag);
      if (!cov) continue;
      var slug = /\/uploads\/covers\/([^"?]+)/.exec(cov[1]);
      if (!slug) continue;
      slug = slug[1].replace(/\.[a-z0-9]+$/i, "");
      if (!slug || seen[slug]) continue;
      var t = /alt="([^"]*)"/.exec(tag) || /title="([^"]*)"/.exec(tag);
      var title = cleanTitle(t ? t[1] : "");
      if (!title) continue;
      seen[slug] = 1;
      out.push({
        title: title,
        coverUrl: makeAbsolute(cov[1]),
        detailUrl: baseUrl + "/manga/" + slug,
        contentType: "manga"
      });
    }
    return out;
  }

  function slugFromUrl(url) {
    var m = /\/manga\/([^/?#]+)/.exec(String(url || ""));
    return m ? m[1] : "";
  }

  function chapterDate(unixSeconds) {
    var sec = parseInt(unixSeconds, 10);
    if (!sec) return "";
    var d = new Date(sec * 1000);
    if (isNaN(d.getTime())) return "";
    return d.toISOString().slice(0, 10);
  }

  return {
    requiresCloudflare: false,

    async getHomepageManga(args) {
      try {
        var page = (args && args.page) || 1;
        var map = await genres();
        var html = await fetchText(filterUrl(page, { notGenres: adultGenreIds(map) }));
        return parseList(html);
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
        var map = await genres();
        var html = await fetchText(filterUrl(page, { keyword: query, notGenres: adultGenreIds(map) }));
        return parseList(html);
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
        var map = await genres();
        var genreId = "";
        for (var id in map) {
          if (String(map[id]).toLowerCase() === genre.toLowerCase()) {
            genreId = id;
            break;
          }
        }
        var html = await fetchText(
          filterUrl(page, {
            genreId: genreId,
            type: SITE_TYPES.indexOf(type) !== -1 ? type : "",
            notGenres: adultGenreIds(map)
          })
        );
        return parseList(html);
      } catch (e) {
        if (shouldPropagate(e)) throw e;
        return [];
      }
    },

    async getGenresAndTypes() {
      try {
        var map = await genres();
        var out = [];
        for (var id in map) out.push(map[id]);
        if (out.length) return { genres: out, types: SITE_TYPES.slice() };
      } catch (e) {}
      return { genres: [], types: SITE_TYPES.slice() };
    },

    async getMangaDetails(args) {
      var url = makeAbsolute((args && args.url) || "");
      var slug = slugFromUrl(url);
      if (!slug) throw new Error("No manga slug in " + url);
      var html = await fetchText(baseUrl + "/manga/" + slug);

      var title = "";
      var h1 = /<h1[^>]*>([\s\S]{0,300}?)<\/h1>/.exec(html);
      if (h1) title = stripHtml(h1[1]);
      if (!title) title = slug;

      var cover = "";
      var og = /<meta[^>]+property="og:image"[^>]+content="([^"]+)"/.exec(html);
      if (og) cover = makeAbsolute(og[1]);
      if (!cover) cover = baseUrl + "/uploads/covers/" + slug + ".jpg";

      var description = "";
      var desc = /<div[^>]+id="syn-target"[^>]*>([\s\S]{0,4000}?)<\/div>/.exec(html);
      if (desc) description = stripHtml(desc[1]);

      // the site's own genre labels, raw - the app's Block Filter owns the vocabulary
      var genresOut = [];
      var gseen = {};
      var gre = /<a[^>]*class="label[^"]*"[^>]*href="[^"]*\/genres\/[^"]*"[^>]*>([\s\S]{0,120}?)<\/a>/g;
      var gm;
      while ((gm = gre.exec(html))) {
        var gl = cleanTitle(gm[1]);
        if (gl && !gseen[gl]) {
          gseen[gl] = 1;
          genresOut.push(gl);
        }
      }

      var status = "";
      var st = /Status\s*<span[^>]*class="dt"[^>]*>([\s\S]{0,80}?)<\/span>/.exec(html);
      if (st) status = cleanTitle(st[1]);

      var siteType = "";
      var ty = /href="[^"]*\/manga-type\/([^"]+)"/.exec(html);
      if (ty) siteType = cleanTitle(ty[1]);

      var chapters = [];
      var cre = /<li[^>]*class="chapter"[^>]*>([\s\S]{0,600}?)<\/li>/g;
      var cm;
      while ((cm = cre.exec(html))) {
        var block = cm[1];
        var link = /<a[^>]+href="([^"]*\/manga\/[^"]*\/chapter-[^"]*)"[^>]*>([\s\S]{0,120}?)<\/a>/.exec(block);
        if (!link) continue;
        var chUrl = makeAbsolute(link[1]);
        var num = /chapter-(\d+)/.exec(link[1]);
        var time = /datetime="(\d+)"/.exec(block);
        chapters.push({
          number: num ? num[1] : cleanTitle(link[2]),
          title: cleanTitle(link[2]),
          url: chUrl,
          views: 0,
          isLocked: false,
          date: time ? chapterDate(time[1]) : ""
        });
      }

      return {
        title: title,
        coverUrl: cover,
        description: description,
        genres: genresOut,
        chapters: chapters,
        originalUrl: baseUrl + "/manga/" + slug,
        hasMoreChapters: false,
        lastFetchedPage: 1,
        status: status,
        type: siteType,
        contentType: "manga"
      };
    },

    async getChapterPages(args) {
      var chapterUrl = makeAbsolute((args && args.url) || "");
      lastChapterUrl = chapterUrl || lastChapterUrl;
      var html = await fetchText(chapterUrl, { "Accept": "text/html,application/xhtml+xml,*/*;q=0.8" });
      var idm = /CHAPTER_ID\s*=\s*(\d+)/.exec(html);
      if (!idm) throw new Error("No CHAPTER_ID in " + chapterUrl);
      var raw = await fetchText(baseUrl + "/ajax/image/list/chap/" + idm[1], {
        "Accept": "application/json,text/javascript,*/*;q=0.8",
        "X-Requested-With": "XMLHttpRequest",
        "Referer": chapterUrl
      });
      var body = raw;
      try {
        var j = JSON.parse(raw);
        if (j && j.html) body = j.html;
      } catch (e) {}
      var pages = [];
      var re = /data-index="(\d+)"[^>]*>[\s\S]{0,400}?<a[^>]+href="([^"]+)"/g;
      var m;
      while ((m = re.exec(body))) {
        pages.push({ index: parseInt(m[1], 10), url: makeAbsolute(m[2]) });
      }
      if (!pages.length) {
        var re2 = /<a[^>]+href="([^"]+)"[^>]*class="readImg"/g;
        while ((m = re2.exec(body))) pages.push({ index: pages.length, url: makeAbsolute(m[1]) });
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
