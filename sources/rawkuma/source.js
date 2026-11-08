function createSource(api, config) {
  var baseUrl = ((config && config.base_url) || "https://rawkuma.net").replace(/\/+$/, "");
  var configHeaders = (config && config.headers) || {};
  var userAgent =
    configHeaders["User-Agent"] ||
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
  var lastChapterUrl = baseUrl + "/";
  var ajaxUrl = baseUrl + "/wp-admin/admin-ajax.php?action=advanced_search";

  // Sexual / adult genres that must NEVER appear in the catalog or in the
  // genre filter offered to the user. Verified against rawkuma.net taxonomy
  // (window.searchTerms) live 2026-11-08.
  var ADULT_GENRE_SLUGS = [
    "adult", "ecchi", "hentai", "yaoi", "yuri", "smut", "mature", "harem",
    "gender-bender", "girls-love", "shoujo-ai", "shounen-ai", "lolicon",
    "shotacon", "mecha", "thriller-2"
  ];
  var ADULT_GENRE_NAMES = [
    "Adult", "Ecchi", "Hentai", "Yaoi", "Yuri", "Smut", "Mature", "Harem",
    "Gender Bender", "Girls' Love", "Shoujo Ai", "Shounen Ai", "Lolicon",
    "Shotacon", "Mecha", "Thriller-2"
  ];
  var SITE_TYPES = ["manga", "manhwa", "manhua", "novel"];

  var defaultHeaders = {
    "User-Agent": userAgent,
    "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
    "Accept-Language": "ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7",
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

  function postForm(url, params) {
    var kv = [];
    for (var k in params) {
      var v = params[k];
      if (Array.isArray(v)) {
        for (var i = 0; i < v.length; i++) kv.push(encodeURIComponent(k) + "=" + encodeURIComponent(v[i]));
      } else {
        kv.push(encodeURIComponent(k) + "=" + encodeURIComponent(String(v)));
      }
    }
    return request(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" }, body: kv.join("&") });
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
    var m = /\/manga\/([^/?#]+)\/?$/.exec(String(url || ""));
    return m ? m[1] : "";
  }

  function chapterDate(text) {
    if (!text) return "";
    var m = /(\d{4})-(\d{2})-(\d{2})/.exec(String(text));
    return m ? m[1] + "-" + m[2] + "-" + m[3] : "";
  }

  function isAdultSlug(slug) {
    for (var i = 0; i < ADULT_GENRE_SLUGS.length; i++) {
      if (String(slug).toLowerCase() === ADULT_GENRE_SLUGS[i]) return true;
    }
    return false;
  }

  function isAdultName(name) {
    var l = String(name || "").toLowerCase();
    for (var i = 0; i < ADULT_GENRE_NAMES.length; i++) {
      if (l === ADULT_GENRE_NAMES[i].toLowerCase()) return true;
    }
    return false;
  }

  // ---------- catalogue parsing ----------

  // A library card:
  //   <a href=".../manga/{slug}/" ...> ... <img src="...cover..." ... />
  //   ... <a href=".../manga/{slug}/" ...>{Title}</a>
  function parseCatalog(html) {
    var out = [];
    var seen = {};
    var re = /<a[^>]+href="(https:\/\/rawkuma\.net\/manga\/((?!chapter-)[^"?#]+)\/)"[^>]*>[\s\S]{0,1800}?<img[^>]+src="([^"]+)"[\s\S]{0,2500}?<a[^>]+href="https:\/\/rawkuma\.net\/manga\/\2\/"[^>]*>([^<]{1,170})<\/a>/gi;
    var m;
    while ((m = re.exec(html))) {
      var slug = m[2];
      if (seen[slug]) continue;
      seen[slug] = 1;
      var title = cleanTitle(m[4]);
      if (!title) continue;
      var cover = makeAbsolute(m[3]);
      out.push({
        title: title,
        coverUrl: cover,
        detailUrl: makeAbsolute("https://rawkuma.net/manga/" + slug + "/"),
        contentType: "manga"
      });
    }
    return out;
  }

  async function ajaxLibrary(page, extra) {
    var params = {
      the_page: String(page > 0 ? page : 1),
      the_type: "",
      the_status: "",
      order: "desc",
      orderby: "popular",
      search_term: "",
      inclusion: "OR",
      exclusion: "OR",
      project: "0"
    };
    if (extra) {
      if (extra.type) params.the_type = extra.type;
      if (extra.status) params.the_status = extra.status;
      if (extra.order) params.order = extra.order;
      if (extra.orderby) params.orderby = extra.orderby;
      if (extra.query) params.search_term = extra.query;
      if (extra.genre) params.the_genre = Array.isArray(extra.genre) ? extra.genre.join(",") : extra.genre;
      if (extra.project !== undefined) params.project = extra.project ? "1" : "0";
    }
    // Exclude sexual/adult genres on every listing so they never reach the user.
    params.the_exclude = ADULT_GENRE_SLUGS.join(",");
    return postForm(ajaxUrl, params);
  }

  async function filteredList(page, extra) {
    var html = await ajaxLibrary(page, extra);
    return parseCatalog(html);
  }

  async function searchManga(query, page) {
    var html = await ajaxLibrary(page, { query: query });
    return parseCatalog(html);
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
        var type = cleanTitle((args && args.type) || "").toLowerCase();
        var extra = {};
        if (genre) extra.genre = genre;
        if (SITE_TYPES.indexOf(type) !== -1) extra.type = type;
        return filteredList(page, extra);
      } catch (e) {
        if (shouldPropagate(e)) throw e;
        return [];
      }
    },

    async getGenresAndTypes() {
      try {
        // Genre list comes from window.searchTerms embedded in the library page.
        var html = await fetchText(baseUrl + "/library/?the_page=1");
        var genres = [];
        var seen = {};
        var i = html.indexOf("searchTerms = {");
        if (i > 0) {
          var start = i + "searchTerms = ".length;
          var depth = 0, inStr = false, esc = false, end = -1;
          for (var k = start; k < html.length; k++) {
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
          if (end > start) {
            // Convert JS object literal to JSON: quote unquoted keys.
            var block = html.slice(start, end).replace(/([{,]\s*)([a-zA-Z_$][\w$]*)\s*:/g, '$1"$2":');
            try {
              var st = JSON.parse(block);
              var gobj = st.genre || {};
              for (var id in gobj) {
                var g = gobj[id];
                var name = g.name || "";
                var slug = g.slug || "";
                if (!isAdultSlug(slug) && !isAdultName(name) && !seen[slug]) {
                  seen[slug] = 1;
                  genres.push(name);
                }
              }
              var tarr = st.type || [];
              var types = [];
              for (var ti = 0; ti < tarr.length; ti++) {
                var t = tarr[ti];
                var ts = t.slug || "";
                var tn = t.name || "";
                if (SITE_TYPES.indexOf(ts) !== -1 && !isAdultName(tn)) types.push(ts);
              }
              if (!types.length) types = SITE_TYPES.slice();
              if (genres.length) return { genres: genres, types: types };
            } catch (e) {}
          }
        }
      } catch (e) {}
      return { genres: [], types: SITE_TYPES.slice() };
    },

    async getMangaDetails(args) {
      var url = makeAbsolute((args && args.url) || "");
      var slug = slugFromUrl(url);
      if (!slug) throw new Error("No manga slug in " + url);
      var d = await request(baseUrl + "/manga/" + slug + "/");

      var title = "";
      // Prefer JSON-LD headline (the first <h1> is "Last Updates" nav).
      var jd = /"headline"\s*:\s*"([^"\\]{0,300})"/.exec(d);
      if (jd) title = cleanTitle(jd[1]);
      if (!title) {
        var h1s = d.match(/<h1[^>]*>([\s\S]{0,300}?)<\/h1>/gi);
        if (h1s) {
          for (var hi = 0; hi < h1s.length; hi++) {
            var h1txt = stripHtml(h1s[hi]);
            if (h1txt && h1txt !== "Last Updates") { title = h1txt; break; }
          }
        }
      }
      if (!title) title = slug;

      var cover = "";
      // Prefer JSON-LD image (the real cover), then og:image.
      var ji = /"image"\s*:\s*\{\s*"@type"\s*:\s*"ImageObject"[\s\S]{0,300}?"url"\s*:\s*"([^"\\]+)"/i.exec(d);
      if (ji) cover = makeAbsolute(ji[1]);
      if (!cover) {
        var og = /<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i.exec(d);
        if (og) cover = makeAbsolute(og[1]);
      }
      if (!cover) {
        var cimg = /<img[^>]+src="([^"]*wp-content\/uploads\/[^"]+)"[^>]*>/i.exec(d);
        if (cimg) cover = makeAbsolute(cimg[1]);
      }

      var description = "";
      var jd = /"description"\s*:\s*"([\s\S]{0,6000}?)"/.exec(d);
      if (jd) description = cleanTitle(jd[1]);
      if (!description) {
        var ds = /itemprop="description"[\s\S]{0,4000}?>([\s\S]{0,4000}?)<\/div>/i.exec(d);
        if (ds) description = stripHtml(ds[1]);
      }

      var genresOut = [];
      var gseen = {};
      var jg = /"genre"\s*:\s*\[([\s\S]{0,2000}?)\]/i.exec(d);
      if (jg) {
        var names = jg[1].match(/"([^"\\]{0,60})"/g);
        if (names) {
          for (var i = 0; i < names.length; i++) {
            var gn = cleanTitle(names[i].slice(1, -1));
            if (gn && !gseen[gn] && !isAdultName(gn)) { gseen[gn] = 1; genresOut.push(gn); }
          }
        }
      }
      if (!genresOut.length) {
        var gr = /<a[^>]+href="[^"]*\/genre\/[^"]*"[^>]*>([^<]{0,80})<\/a>/gi;
        var gm;
        while ((gm = gr.exec(d))) {
          var gl = cleanTitle(gm[1]);
          if (gl && !gseen[gl] && !isAdultName(gl)) { gseen[gl] = 1; genresOut.push(gl); }
        }
      }

      var status = "";
      var st = /"creativeWorkStatus"\s*:\s*"([^"]+)"/i.exec(d);
      if (st) status = cleanTitle(st[1]);

      var siteType = "";
      var ty = /"@type"\s*:\s*"Manga"|"comicType"\s*:\s*"([^"]+)"/i.exec(d);
      if (!ty) {
        var tt = /<h4[^>]*>\s*Type\s*<\/h4>[\s\S]{0,300}?<p[^>]*>([^<]{0,80})<\/p>/i.exec(d);
        if (tt) siteType = cleanTitle(tt[1]);
      }

      var chapters = [];
      var chapRe = /<a[^>]+href="(https:\/\/rawkuma\.net\/manga\/[^"]+\/chapter-([\d.]+)\.(\d+)\/)"[^>]*>([\s\S]{0,120}?)<\/a>/gi;
      var cm;
      while ((cm = chapRe.exec(d))) {
        var chUrl = cm[1];
        var chNum = cm[2];
        var chId = cm[3];
        var chTitle = cleanTitle(cm[4]) || ("Chapter " + chNum);
        var dateM = /<time[^>]+datetime="([^"]+)"[^>]*>[\s\S]{0,120}?<\/time>/.exec(d.slice(cm.index));
        var chDate = chapterDate(dateM ? dateM[1] : "");
        chapters.push({
          number: chNum,
          title: chTitle,
          url: chUrl,
          views: 0,
          isLocked: false,
          date: chDate,
          id: chId
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
        originalUrl: baseUrl + "/manga/" + slug + "/",
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
      var pages = [];
      var seen = {};
      var re = /<img[^>]+src="(https:\/\/cdn\.rawkuma\.com\/images\/w\/[^"]+)"[^>]*>/gi;
      var m;
      while ((m = re.exec(html))) {
        var src = m[1];
        if (!seen[src]) { seen[src] = 1; pages.push(src); }
      }
      if (!pages.length) throw new Error("No chapter images in " + chapterUrl);
      return pages;
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
        "Origin": baseUrl,
        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "Accept-Language": "ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7",
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
