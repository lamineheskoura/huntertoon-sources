function createSource(api, config) {
  var baseUrl = ((config && config.base_url) || "https://manhuatop.org").replace(/\/+$/, "");
  var configHeaders = (config && config.headers) || {};
  var userAgent =
    configHeaders["User-Agent"] ||
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
  var lastChapterUrl = baseUrl + "/";
  var DEFAULT_TYPE = "manhwa";
  var SITE_TYPES = ["manhwa", "manga"];
  var SITE_TYPE_VALUES = { manhwa: "Manhwa", manga: "Manga" };
  var ALLOWED_SITE_TYPES = { Manhwa: 1, Manga: 1, Webtoons: 1 };
  // Every adult/sexual label the site itself uses (from /popular-genres/).
  var ADULT_GENRE_LABELS = {
    "adult": 1, "smut": 1, "ecchi": 1, "mature": 1, "manhwa hot": 1, "harem": 1,
    "reverse harem": 1, "fantasy harem": 1, "yaoi": 1, "yaoi(bl)": 1, "soft yaoi": 1,
    "shounen ai": 1, "shoujo ai": 1, "girls love": 1, "boys love": 1,
    "gender bender": 1, "yuri": 1, "yuri (gl)": 1, "doujinshi": 1, "19+": 1,
    "monster girls": 1, "omegaverse": 1, "liexing": 1, "ping ping jun": 1,
    "crossdressin": 1, "crossdressing": 1, "mecha": 1
  };
  var STATUS_LABELS = {
    updating: "Ongoing", "on-going": "Ongoing", ongoing: "Ongoing",
    end: "Completed", completed: "Completed",
    "on-hold": "On Hiatus", "on hold": "On Hiatus",
    canceled: "Canceled", cancelled: "Canceled"
  };
  var TTL = 1800000;
  var genreMap = null;
  var genreMapAt = 0;

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

  function slugFromUrl(url) {
    var m = /\/manhua\/([^/?#]+)\/?$/.exec(String(url || ""));
    return m ? m[1] : "";
  }

  // ---------- catalogue ----------

  function listingBlock(html) {
    var re = /<ul class="[^"]*manga-grid[^"]*"/g;
    var m;
    while ((m = re.exec(html))) {
      var end = html.indexOf("</ul>", m.index);
      var block = html.slice(m.index, end === -1 ? html.length : end);
      if (block.indexOf('data-card-variant="main"') !== -1 && block.indexOf('class="cover-link"') !== -1) {
        return block;
      }
    }
    return "";
  }

  function parseGrid(html) {
    var out = [];
    var block = listingBlock(html);
    if (!block) return out;
    var re = /<li[^>]*manga-card[^>]*data-manga-type="([^"]*)"[^>]*>([\s\S]*?)<\/li>/g;
    var m;
    while ((m = re.exec(block))) {
      var siteType = m[1];
      var card = m[2];
      var hrefM = /<a[^>]+class="cover-link"[^>]+href="([^"]+)"/.exec(card);
      if (!hrefM) continue;
      var href = hrefM[1];
      var slugM = /\/manhua\/([^"/?#]+)\//.exec(href);
      if (!slugM) continue;
      var title = "";
      var titleM = /<h3[^>]*>\s*<a[^>]*>([^<]{1,240})<\/a>/.exec(card);
      if (titleM) title = cleanTitle(titleM[1]);
      if (!title) {
        var ariaM = /<a[^>]+aria-label="([^"]{1,240})"/.exec(card);
        if (ariaM) title = cleanTitle(ariaM[1]);
      }
      if (!title) continue;
      var cover = "";
      var imgM = /<img[^>]+src="([^"]+)"/.exec(card);
      if (imgM) cover = makeAbsolute(imgM[1]);
      out.push({
        title: title,
        coverUrl: cover,
        detailUrl: makeAbsolute(href),
        slug: slugM[1],
        siteType: siteType,
        contentType: "manga"
      });
    }
    return out;
  }

  function listUrl(page, extra) {
    var qs = ["sort=latest_update"];
    if (extra && extra.type) qs.push("manga_type=" + encodeURIComponent(extra.type));
    if (extra && extra.genreId) qs.push("genre=" + encodeURIComponent(extra.genreId));
    if (extra && extra.status) qs.push("status=" + encodeURIComponent(extra.status));
    qs.push("page=" + (page > 0 ? page : 1));
    return baseUrl + "/series/?" + qs.join("&");
  }

  async function getGenreMap() {
    if (genreMap && now() - genreMapAt < TTL) return genreMap;
    var html = await fetchText(baseUrl + "/series/?page=1");
    var map = {};
    var sel = /<select[^>]*name="genre"[^>]*>([\s\S]*?)<\/select>/.exec(html);
    if (sel) {
      var re = /<option[^>]*value="([^"]*)"[^>]*>([^<]*)<\/option>/g;
      var m;
      while ((m = re.exec(sel[1]))) {
        var id = m[1];
        var label = cleanTitle(m[2]);
        if (id && label) map[id] = label;
      }
    }
    if (!Object.keys(map).length) throw new Error("No genres parsed at " + baseUrl);
    genreMap = map;
    genreMapAt = now();
    return map;
  }

  function isAdultLabel(label) {
    return !!ADULT_GENRE_LABELS[cleanTitle(label).toLowerCase()];
  }

  function parseDetailGenres(html) {
    var out = [];
    var gd = /<dd[^>]*class="genre-chips"[^>]*>([\s\S]{0,6000}?)<\/dd>/.exec(html);
    if (!gd) return out;
    var gre = /<a[^>]+href="\/manhua-genre\/[^"]*\/"[^>]*>([^<]{0,80})<\/a>/gi;
    var gm;
    while ((gm = gre.exec(gd[1]))) {
      var gl = cleanTitle(gm[1]);
      if (gl) out.push(gl);
    }
    return out;
  }

  // The site has no "exclude this genre" parameter, so each listed title is
  // checked against the site's own classification and adult titles are dropped.
  var titleCache = {};

  async function isAdultTitle(item) {
    var key = item.detailUrl;
    var cached = titleCache[key];
    if (cached && now() - cached.at < TTL) return cached.adult;
    var adult = false;
    try {
      var html = await fetchText(item.detailUrl);
      var genres = parseDetailGenres(html);
      for (var i = 0; i < genres.length; i++) {
        if (isAdultLabel(genres[i])) {
          adult = true;
          break;
        }
      }
      titleCache[key] = { adult: adult, at: now() };
    } catch (e) {}
    return adult;
  }

  async function filterList(items) {
    var kept = [];
    var idx = 0;
    async function worker() {
      while (idx < items.length) {
        var it = items[idx++];
        if (!ALLOWED_SITE_TYPES[it.siteType]) continue;
        if (await isAdultTitle(it)) continue;
        kept.push(it);
      }
    }
    var workers = [];
    for (var w = 0; w < 6 && w < items.length; w++) workers.push(worker());
    await Promise.all(workers);
    kept.sort(function (a, b) {
      return items.indexOf(a) - items.indexOf(b);
    });
    return kept;
  }

  async function filteredList(page, extra) {
    var html = await fetchText(listUrl(page, extra));
    return filterList(parseGrid(html));
  }

  async function searchManga(query, page) {
    var html = await fetchText(baseUrl + "/search?q=" + encodeURIComponent(query) + "&page=" + (page > 0 ? page : 1));
    return filterList(parseGrid(html));
  }

  // ---------- chapters ----------

  function parseChapters(html) {
    var out = [];
    var re = /<article[^>]*class="chapter-item"[^>]*>([\s\S]*?)<\/article>/g;
    var m;
    while ((m = re.exec(html))) {
      var card = m[1];
      var hrefM = /<a[^>]+href="([^"]*\/chapter-([\d]+(?:-[\d]+)?)\/)"/.exec(card);
      if (!hrefM) continue;
      var num = hrefM[2].replace(/-/g, ".");
      if (num === "0") continue;
      var title = "";
      var strongM = /<strong[^>]*>([\s\S]{0,120}?)<\/strong>/.exec(card);
      if (strongM) title = cleanTitle(stripHtml(strongM[1]));
      if (!title) title = "Chapter " + num;
      var date = "";
      var timeM = /<time[^>]+dateTime="([^"]+)"/i.exec(card);
      if (timeM) date = timeM[1].substring(0, 10);
      out.push({
        number: num,
        title: title,
        url: makeAbsolute(hrefM[1]),
        views: 0,
        isLocked: false,
        date: date
      });
    }
    return out;
  }

  async function fetchChapterPage(slug, page) {
    var url = baseUrl + "/manhua/" + slug + "/?tab=chapters&chapter_page=" + (page > 0 ? page : 1);
    var html = await fetchText(url);
    var chapters = parseChapters(html);
    var hasMore = false;
    var pre = /chapter_page=(\d+)/g;
    var pm;
    while ((pm = pre.exec(html))) {
      if (parseInt(pm[1], 10) > page) hasMore = true;
    }
    return { chapters: chapters, hasMore: hasMore };
  }

  // ---------- source ----------

  return {
    requiresCloudflare: true,

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
        if (SITE_TYPES.indexOf(type) !== -1) extra.type = SITE_TYPE_VALUES[type];
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
        var genres = [];
        for (var id in map) {
          if (!isAdultLabel(map[id])) genres.push(map[id]);
        }
        if (genres.length) return { genres: genres, types: SITE_TYPES.slice() };
      } catch (e) {}
      return { genres: [], types: SITE_TYPES.slice() };
    },

    async getMangaDetails(args) {
      var url = makeAbsolute((args && args.url) || "");
      var slug = slugFromUrl(url);
      if (!slug) throw new Error("No manga slug in " + url);
      var html = await fetchText(baseUrl + "/manhua/" + slug + "/");

      var title = "";
      var h1 = /<h1[^>]*id="manga-title"[^>]*>([\s\S]{0,300}?)<\/h1>/.exec(html);
      if (!h1) h1 = /<h1[^>]*>([\s\S]{0,300}?)<\/h1>/.exec(html);
      if (h1) title = cleanTitle(stripHtml(h1[1]));
      if (!title) {
        var ogt = /<meta[^>]+property="og:title"[^>]+content="([^"\\]{0,300})"/i.exec(html);
        if (ogt) title = cleanTitle(ogt[1]);
      }
      if (!title) title = slug;

      var cover = "";
      var og = /<meta[^>]+property="og:image"[^>]+content="([^"\\]+)"/i.exec(html);
      if (og) cover = makeAbsolute(og[1]);

      var description = "";
      var syn = /<div[^>]*class="[^"]*synopsis[^"]*"[^>]*>([\s\S]{0,12000}?)<\/div>/.exec(html);
      if (syn) description = stripHtml(syn[1]);
      if (!description) {
        var md = /<meta[^>]+name="description"[^>]+content="([\s\S]{0,6000}?)"/i.exec(html);
        if (md) description = cleanTitle(md[1]);
      }

      var genres = [];
      var gseen = {};
      var gd = /<dd[^>]*class="genre-chips"[^>]*>([\s\S]{0,6000}?)<\/dd>/.exec(html);
      if (gd) {
        var gre = /<a[^>]+href="\/manhua-genre\/[^"]*\/"[^>]*>([^<]{0,80})<\/a>/gi;
        var gm;
        while ((gm = gre.exec(gd[1]))) {
          var gl = cleanTitle(gm[1]);
          if (gl && !gseen[gl]) {
            gseen[gl] = 1;
            genres.push(gl);
          }
        }
      }

      var status = "";
      var stM = /\\?"status\\?":\\?"([a-z\-]+)\\?"/i.exec(html);
      if (stM) {
        var stKey = stM[1].toLowerCase();
        if (STATUS_LABELS[stKey]) status = STATUS_LABELS[stKey];
      }
      if (!status) {
        var rel = /<dt[^>]*>\s*Release\s*<\/dt>\s*<dd[^>]*>([\s\S]{0,900}?)<\/dd>/.exec(html);
        if (rel) {
          var re = /\/manhua-release\/([^"'\/]+)\//g;
          var rm;
          while ((rm = re.exec(rel[1]))) {
            var key = decodeURIComponent(rm[1]).toLowerCase();
            if (STATUS_LABELS[key]) {
              status = STATUS_LABELS[key];
              break;
            }
          }
        }
      }

      var cp = await fetchChapterPage(slug, 1);
      var chapters = cp.chapters;

      return {
        title: title,
        coverUrl: cover,
        description: description,
        genres: genres,
        chapters: chapters,
        originalUrl: baseUrl + "/manhua/" + slug + "/",
        hasMoreChapters: cp.hasMore,
        lastFetchedPage: 1,
        status: status,
        type: "",
        contentType: "manga",
        _chapterSlug: slug
      };
    },

    async fetchMoreChapters(args) {
      try {
        var url = makeAbsolute((args && args.url) || "");
        var slug = slugFromUrl(url);
        var nextPage = (args && args.nextPage) || 2;
        if (!slug || nextPage < 2) return null;
        var cp = await fetchChapterPage(slug, nextPage);
        if (!cp.chapters.length) return null;
        return {
          title: "",
          coverUrl: "",
          description: "",
          genres: [],
          chapters: cp.chapters,
          originalUrl: baseUrl + "/manhua/" + slug + "/",
          hasMoreChapters: cp.hasMore,
          lastFetchedPage: nextPage,
          contentType: "manga"
        };
      } catch (e) {
        if (shouldPropagate(e)) throw e;
        return null;
      }
    },

    async getChapterPages(args) {
      var chapterUrl = makeAbsolute((args && args.url) || "");
      lastChapterUrl = chapterUrl || lastChapterUrl;
      var html = await fetchText(chapterUrl, { Accept: "text/html,application/xhtml+xml,*/*;q=0.8" });
      var pages = [];
      var seen = {};
      var re = /<img[^>]+alt="Chapter image\s*\d+"[^>]*src="([^"]+)"/gi;
      var m;
      while ((m = re.exec(html))) {
        var src = m[1];
        if (!seen[src]) {
          seen[src] = 1;
          pages.push(src);
        }
      }
      if (!pages.length) {
        var re2 = /https:\/\/[a-z0-9]+\.manhuatop\.org\/manga_[^"'\s\/]+\/[^"'\s]*\d+\.(?:webp|jpe?g|png)/gi;
        while ((m = re2.exec(html))) {
          var src2 = m[0];
          if (!seen[src2]) {
            seen[src2] = 1;
            pages.push(src2);
          }
        }
      }
      pages.sort(function (a, b) {
        var na = parseInt(/(\d+)\.[a-z]+$/i.exec(a)[1], 10);
        var nb = parseInt(/(\d+)\.[a-z]+$/i.exec(b)[1], 10);
        return na - nb;
      });
      if (!pages.length) throw new Error("No chapter images in " + chapterUrl);
      return pages;
    },

    async getChapterContent(args) {
      var urls = await this.getChapterPages(args);
      return { kind: "image", imageUrls: urls, chapterTitle: "" };
    },

    getImageHeaders() {
      return {
        "User-Agent": userAgent,
        "Referer": lastChapterUrl || baseUrl + "/",
        "Origin": baseUrl,
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
