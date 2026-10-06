function createSource(api, config) {
  var DEFAULT_BASE_URL = "https://galaxynovels.com";
  var baseUrl = ((config && config.base_url) || DEFAULT_BASE_URL).replace(/\/+$/, "");
  var userAgent = (config && config.user_agent) || "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
  var HTML_HEADERS = {
    "User-Agent": userAgent,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "ar,en-US;q=0.9,en;q=0.8",
    "Referer": baseUrl + "/",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "same-origin",
    "Upgrade-Insecure-Requests": "1"
  };
  var NOVEL_PATH_RE = /\/novel\/([^\/?#]+)\/?$/;
  var CHAPTER_NUM_RE = /\/chapter-(\d+)/;
  var RENDERED_TOTAL_RE = /data-rendered-total="(\d+)"/;
  var MANIFEST_URL_RE = /data-manifest-url="([^"]*chapters\/manifest[^"]*)"/;
  var NOVEL_ID_RE = /data-novel-id="(\d+)"/;
  var MANIFEST_BY_ID_TPL = "/wp-content/uploads/wor-reader-cache/chapters/manifest/novel-";
  var READ_MORE_AR = "اقرأ الآن";
  var BADGE_WORDS_RE = /مستمرة|مكتملة|مستمر|مكتمل|اقرأ الآن|اقرا الان/g;
  var FETCH_MORE_BATCH = 5;
  var FETCH_MORE_MAX_STEPS = 25;
  var LIBRARY_PATH = "/library/";
  var GENRES_SITEMAP_PATH = "/wor-sitemap-genres.xml";
  var GENRE_URL_RE = /\/novel-genre\/([^\/\s"']+)\/?/g;
  var PREV_URL_RE = /data-previous-url="([^"]+)"/;
  var CHAIN_NUM_RE = /data-chapter-number="(\d+)"/;
  var CHAIN_TITLE_RE = /data-chapter-title="([^"]*)"/;

  function escapeRegExp(s) {
    return String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function statusValueFor(type) {
    var t = String(type || "").trim();
    if (!t || t === "novel" || t === "رواية") return "";
    if (t === "مستمرة" || t === "ongoing") return "ongoing";
    if (t === "مكتملة" || t === "completed") return "completed";
    if (t === "متوقفة" || t === "hiatus") return "hiatus";
    return "";
  }

  function genreSlugFor(name) {
    return String(name || "").trim().replace(/\s+/g, "-");
  }

  function cleanBadgeText(s) {
    return String(s || "").replace(BADGE_WORDS_RE, " ").replace(/\s+/g, " ").trim();
  }

  function resolveCardTitle(pageHtml, detailUrl, innerHtml) {
    var inner = String(innerHtml || "");
    try {
      var him = inner.match(/<img[^>]+alt="([^"]+)"/i);
      if (him && him[1]) {
        var alt = cleanBadgeText(stripHtml(him[1]));
        if (alt && alt.length >= 2) return alt;
      }
    } catch (e) {}
    var page = String(pageHtml || "");
    if (!page || !detailUrl) return "";
    try {
      var esc = escapeRegExp(detailUrl);
      var patterns = [
        new RegExp("<h[23][^>]*>\\s*<a[^>]*href=\"" + esc + "\"[^>]*>([^<]+)</a>", "i"),
        new RegExp("<a[^>]*href=\"" + esc + "\"[^>]*aria-label=\"([^\"]+)\"", "i"),
        new RegExp("<a[^>]*href=\"" + esc + "\"[^>]*title=\"([^\"]+)\"", "i")
      ];
      for (var i = 0; i < patterns.length; i++) {
        var m = page.match(patterns[i]);
        if (m && m[1]) {
          var t = cleanBadgeText(stripHtml(m[1]));
          if (t && t.length >= 2) return t;
        }
      }
    } catch (e) {}
    return "";
  }

  function abs(url) {
    if (!url) return "";
    url = String(url).replace(/&amp;/g, "&").trim();
    if (!url || url.indexOf("data:image") === 0) return "";
    if (url.indexOf("//") === 0) return "https:" + url;
    if (url.indexOf("http://") === 0) return "https://" + url.substring(7);
    if (url.indexOf("https://") === 0) return url;
    if (url.charAt(0) === "/") return baseUrl + url;
    return baseUrl + "/" + url;
  }

  async function fetchHtml(url) {
    if (api.http) {
      var res = await api.http(url, { method: "GET", headers: HTML_HEADERS });
      if (!res || !res.ok) throw new Error("HTTP " + (res ? res.status : 0) + " for " + url);
      return res.body || "";
    }
    return (await api.fetchText(url, HTML_HEADERS)) || "";
  }

  async function fetchJson(url) {
    if (api.http) {
      var res = await api.http(url, { method: "GET", headers: HTML_HEADERS });
      if (!res || !res.ok) throw new Error("HTTP " + (res ? res.status : 0) + " for " + url);
      return JSON.parse(res.body || "{}");
    }
    var text = await api.fetchText(url, HTML_HEADERS);
    return JSON.parse(text || "{}");
  }

  function stripHtml(value) {
    return String(value || "")
      .replace(/<br\s*\/?\s*>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<\/div>/gi, "\n")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, "\"")
      .replace(/&#39;/g, "'")
      .replace(/[\u200B-\u200D\u2060-\u2064\uFEFF\u00AD\u2063]/g, "")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function slugFromUrl(url) {
    var m = String(url || "").match(/\/novel\/([^\/?#]+)/);
    return m ? m[1] : "";
  }

  function chapterNumFromUrl(url) {
    var m = String(url || "").match(CHAPTER_NUM_RE);
    if (!m || !m[1]) return 0;
    var n = parseInt(m[1], 10);
    return isNaN(n) ? 0 : n;
  }

  function firstImageSrc(innerHtml) {
    var patterns = [
      /<img[^>]+data-src="([^"]+)"/i,
      /<img[^>]+data-lazy-src="([^"]+)"/i,
      /<img[^>]+data-original="([^"]+)"/i,
      /<img[^>]+src="([^"]+)"/i
    ];
    for (var i = 0; i < patterns.length; i++) {
      var m = String(innerHtml || "").match(patterns[i]);
      if (m && m[1] && m[1].indexOf("data:image") !== 0) return m[1];
    }
    return "";
  }

  function isNovelCardUrl(href) {
    if (!href || href.indexOf("/novel/") === -1) return false;
    if (href.indexOf("/chapter-") !== -1) return false;
    var clean = href.split("?")[0].split("#")[0];
    return NOVEL_PATH_RE.test(clean);
  }

  async function parseNovelCards(pageHtml) {
    var anchors = await api.cssAll(pageHtml, "a[href*='/novel/']");
    var out = [];
    var seen = {};
    for (var i = 0; i < anchors.length; i++) {
      var a = anchors[i] || {};
      var attrs = a.attrs || {};
      var href = attrs.href || "";
      if (!isNovelCardUrl(href)) continue;
      var detail = abs(href);
      if (!detail) continue;
      var inner = a.html || "";
      var title = stripHtml(await api.cssText(inner, "h3") || "");
      if (!title) title = stripHtml(await api.cssText(inner, "h2") || "");
      if (!title) title = stripHtml(attrs.title || "");
      if (!title) title = resolveCardTitle(pageHtml, detail, inner);
      if (!title) {
        var raw = cleanBadgeText(stripHtml(a.text || ""));
        title = raw;
      }
      if (!title) continue;
      var cover = abs(firstImageSrc(inner));
      if (seen[detail] === undefined) {
        seen[detail] = out.length;
        out.push({ title: title, coverUrl: cover, detailUrl: detail, contentType: "novel" });
      } else {
        var prev = out[seen[detail]];
        if (!prev.coverUrl && cover) prev.coverUrl = cover;
        if ((!prev.title || prev.title.length < title.length) && title.length > 3) prev.title = title;
      }
    }
    return out;
  }

  function parseBookGenres(pageHtml) {
    var genres = [];
    try {
      var m = String(pageHtml || "").match(/"genre"\s*:\s*\[([^\]]*)\]/);
      if (m && m[1]) {
        var gm = m[1].match(/"((?:[^"\\]|\\.)*)"/g);
        if (gm) {
          for (var i = 0; i < gm.length; i++) {
            var g = gm[i].substring(1, gm[i].length - 1).trim();
            if (g) genres.push(g);
          }
        }
      }
    } catch (e) {}
    return genres;
  }

  function parseAlternateName(pageHtml) {
    try {
      var m = String(pageHtml || "").match(/"alternateName"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      if (m && m[1]) return m[1].trim();
    } catch (e) {}
    return "";
  }

  function parseRenderedTotal(pageHtml, chapters) {
    try {
      var m = String(pageHtml || "").match(RENDERED_TOTAL_RE);
      if (m && m[1]) {
        var t = parseInt(m[1], 10);
        if (!isNaN(t) && t > 0) return t;
      }
    } catch (e) {}
    var max = 0;
    for (var i = 0; i < chapters.length; i++) {
      if (chapters[i].number > max) max = chapters[i].number;
    }
    return max > 0 ? max : chapters.length;
  }

  function findManifestUrl(pageHtml) {
    try {
      var m = String(pageHtml || "").match(MANIFEST_URL_RE);
      if (m && m[1]) return abs(m[1].replace(/&amp;/g, "&"));
      var idm = String(pageHtml || "").match(NOVEL_ID_RE);
      if (idm && idm[1]) return baseUrl + MANIFEST_BY_ID_TPL + idm[1] + ".json";
    } catch (e) {}
    return "";
  }

  function manifestTailToChapters(tail) {
    var out = [];
    var seenNums = {};
    for (var i = 0; i < tail.length; i++) {
      var item = tail[i] || {};
      var num = parseInt(item.number, 10);
      if (isNaN(num) || num <= 0 || seenNums[num]) continue;
      var url = abs(item.url || "");
      if (!url) continue;
      seenNums[num] = true;
      var label = String(item.label || "").trim();
      var name = String(item.title || "").trim();
      var title = label && name ? label + ": " + name : (label || name || "");
      out.push({
        number: num,
        title: title,
        views: typeof item.views === "number" ? item.views : 0,
        url: url,
        isLocked: false,
        date: String(item.date_iso || item.date || "")
      });
    }
    return out;
  }

  async function parseSsrChapters(pageHtml) {
    var items = await api.cssAll(pageHtml, "article.wor-novel-chapter-item");
    if (!items.length) items = await api.cssAll(pageHtml, "a.wor-novel-chapter-item__num");
    var out = [];
    var seenUrls = {};
    var useArticles = items.length > 0 && (items[0].html || "").indexOf("wor-novel-chapter-item__num") !== -1;
    if (useArticles) {
      for (var i = 0; i < items.length; i++) {
        var inner = items[i].html || "";
        var href = await api.cssAttr(inner, "a.wor-novel-chapter-item__num", "href") || "";
        if (!href) href = await api.cssAttr(inner, "h3 a", "href") || "";
        var url = abs(href);
        if (!url || seenUrls[url]) continue;
        var num = chapterNumFromUrl(url);
        if (!num) continue;
        seenUrls[url] = true;
        var title = await api.cssAttr(inner, "h3 a", "title") || "";
        if (!title) title = await api.cssText(inner, "h3 a") || "";
        title = stripHtml(title);
        if (!title) title = String(await api.cssText(inner, "a.wor-novel-chapter-item__num") || "").trim();
        if (!title) title = "";
        var date = await api.cssAttr(inner, "time", "datetime") || "";
        if (!date) date = stripHtml(await api.cssText(inner, "time") || "");
        out.push({ number: num, title: title, views: 0, url: url, isLocked: false, date: date });
      }
    } else {
      for (var j = 0; j < items.length; j++) {
        var n = items[j] || {};
        var nattrs = n.attrs || {};
        var nurl = abs(nattrs.href || "");
        if (!nurl || seenUrls[nurl]) continue;
        var nnum = chapterNumFromUrl(nurl);
        if (!nnum) continue;
        seenUrls[nurl] = true;
        out.push({ number: nnum, title: "", views: 0, url: nurl, isLocked: false, date: "" });
      }
    }
    return out;
  }

  function resolvePackUrl(manifest, manifestUrl) {
    try {
      manifest = manifest || {};
      if (manifest.pack_url) return String(manifest.pack_url);
      if (!manifest.pack) return "";
      var base = String(manifestUrl || "").split("?")[0].replace(/\/manifest\/[^\/]*$/, "/packs/");
      return base + String(manifest.pack).replace(/^\/+/, "");
    } catch (e) {
      return "";
    }
  }

  function packToChapters(packChapters) {
    var out = [];
    var seen = {};
    var list = packChapters || [];
    for (var i = 0; i < list.length; i++) {
      var item = list[i] || {};
      var num = parseInt(item.number, 10);
      if (isNaN(num) || num <= 0) continue;
      var url = abs(item.url || "");
      if (!url || seen[url]) continue;
      seen[url] = true;
      var label = String(item.label || "").trim();
      var name = String(item.title || "").trim();
      out.push({
        number: num,
        title: label && name ? label + ": " + name : (label || name || ""),
        views: typeof item.views === "number" ? item.views : 0,
        url: url,
        isLocked: false,
        date: String(item.date_iso || item.date || "")
      });
    }
    out.sort(function (a, b) { return b.number - a.number; });
    return out;
  }

  async function loadFullPack(pageHtml) {
    var manifestUrl = findManifestUrl(pageHtml);
    if (!manifestUrl) return null;
    var manifest = await fetchJson(manifestUrl);
    if (!manifest) return null;
    var packUrl = resolvePackUrl(manifest, manifestUrl);
    if (!packUrl) return null;
    var pack = await fetchJson(packUrl);
    if (!pack || !pack.chapters || !pack.chapters.length) return null;
    var chapters = packToChapters(pack.chapters);
    if (!chapters.length) return null;
    var total = parseInt(pack.total, 10);
    if (isNaN(total) || total <= 0) total = parseInt(manifest.total, 10);
    if (isNaN(total) || total <= 0) total = chapters.length;
    return { chapters: chapters, total: total };
  }

  function mergeChaptersDesc(primary, extra) {
    var seen = {};
    var out = [];
    var i;
    for (i = 0; i < primary.length; i++) {
      if (!seen[primary[i].url]) { seen[primary[i].url] = true; out.push(primary[i]); }
    }
    for (i = 0; i < extra.length; i++) {
      if (!seen[extra[i].url]) { seen[extra[i].url] = true; out.push(extra[i]); }
    }
    out.sort(function (a, b) { return b.number - a.number; });
    return out;
  }

  function isBlockedPage(pageHtml) {
    var low = String(pageHtml || "").toLowerCase();
    return low.indexOf("you have been blocked") !== -1 ||
      low.indexOf("just a moment") !== -1 ||
      low.indexOf("cf-chl") !== -1 ||
      low.indexOf("cf_chl") !== -1;
  }

  async function extractChapterParagraphs(pageHtml) {
    var selectors = [
      "div.wor-reader-text-surface p",
      "article.wor-reading-page p",
      "article p"
    ];
    for (var s = 0; s < selectors.length; s++) {
      try {
        var nodes = await api.cssAll(pageHtml, selectors[s]);
        var parts = [];
        for (var i = 0; i < nodes.length; i++) {
          var text = String((nodes[i] || {}).text || "").trim();
          if (text) parts.push(text);
        }
        if (parts.length) return parts;
      } catch (e) {}
    }
    return [];
  }

  return {
    requiresCloudflare: true,

    async getHomepageManga(args) {
      var page = (args && args.page) || 1;
      if (page < 1) page = 1;
      try {
        var libUrl = baseUrl + LIBRARY_PATH + (page > 1 ? "?library_page=" + page : "");
        return await parseNovelCards(await fetchHtml(libUrl));
      } catch (e) {
        return [];
      }
    },

    async search(args) {
      var q = ((args && args.query) || "").trim();
      if (!q) return [];
      try {
        var pageHtml = await fetchHtml(baseUrl + "/?s=" + encodeURIComponent(q) + "&post_type=wp-manga");
        return await parseNovelCards(pageHtml);
      } catch (e) {
        return [];
      }
    },

    async getFilteredManga(args) {
      var genre = ((args && args.genre) || "").trim();
      var type = ((args && args.type) || "").trim();
      var page = (args && args.page) || 1;
      if (page < 1) page = 1;
      try {
        var qs = [];
        if (genre) qs.push("genre=" + encodeURIComponent(genreSlugFor(genre)));
        var status = statusValueFor(type);
        if (status) qs.push("status=" + status);
        if (page > 1) qs.push("library_page=" + page);
        var url = baseUrl + LIBRARY_PATH + (qs.length ? "?" + qs.join("&") : "");
        return await parseNovelCards(await fetchHtml(url));
      } catch (e) {
        return [];
      }
    },

    async getMangaDetails(args) {
      var url = abs((args && args.url) || "");
      var slug = slugFromUrl(url);
      var pageHtml = await fetchHtml(url);

      var title = stripHtml(await api.cssText(pageHtml, "h1") || "");
      if (!title) title = stripHtml(await api.cssAttr(pageHtml, "meta[property='og:title']", "content") || "");
      if (!title) title = slug;
      var alt = parseAlternateName(pageHtml);
      if (alt && alt.toLowerCase() !== title.toLowerCase()) title = title + " (" + alt + ")";

      var cover = abs(await api.cssAttr(pageHtml, "meta[property='og:image']", "content") || "");
      var description = stripHtml(await api.cssAttr(pageHtml, "meta[property='og:description']", "content") || "");
      if (!description) description = stripHtml(await api.cssAttr(pageHtml, "meta[name='description']", "content") || "");
      var genres = parseBookGenres(pageHtml);

      var chapters = [];
      var total = 0;
      try {
        var pack = await loadFullPack(pageHtml);
        if (pack) {
          chapters = pack.chapters;
          total = pack.total;
        }
      } catch (e) {}
      if (!chapters.length) {
        var ssr = await parseSsrChapters(pageHtml);
        var extra = [];
        try {
          var manifestUrl = findManifestUrl(pageHtml);
          if (manifestUrl) {
            var manifest = await fetchJson(manifestUrl);
            if (manifest && manifest.live_tail && manifest.live_tail.length) {
              extra = manifestTailToChapters(manifest.live_tail);
            }
          }
        } catch (e2) {}
        chapters = mergeChaptersDesc(ssr, extra);
        total = parseRenderedTotal(pageHtml, chapters);
      }
      var hasMore = total > chapters.length;

      return {
        title: title,
        coverUrl: cover,
        description: description,
        genres: genres,
        chapters: chapters,
        originalUrl: url,
        hasMoreChapters: hasMore,
        lastFetchedPage: chapters.length,
        contentType: "novel"
      };
    },

    async fetchMoreChapters(args) {
      var url = abs((args && args.url) || "");
      if (!url) return null;
      var pageHtml = "";
      try {
        pageHtml = await fetchHtml(url);
      } catch (e) {
        return null;
      }
      var ssr = await parseSsrChapters(pageHtml);
      var extra = [];
      try {
        var manifestUrl = findManifestUrl(pageHtml);
        if (manifestUrl) {
          var manifest = await fetchJson(manifestUrl);
          if (manifest && manifest.live_tail && manifest.live_tail.length) {
            extra = manifestTailToChapters(manifest.live_tail);
          }
        }
      } catch (e) {}
      var known = mergeChaptersDesc(ssr, extra);
      if (!known.length) return null;
      var total = parseRenderedTotal(pageHtml, known);
      if (total <= known.length) return null;
      try {
        var fullPack = await loadFullPack(pageHtml);
        if (fullPack && fullPack.chapters.length > known.length) {
          var have = (args && args.nextPage) ? args.nextPage - 1 : known.length;
          if (have < known.length) have = known.length;
          if (have < fullPack.chapters.length) {
            var slice = fullPack.chapters.slice(have, have + FETCH_MORE_BATCH);
            if (slice.length) {
              var newHave = have + slice.length;
              return {
                title: "", coverUrl: "", description: "", genres: [],
                chapters: slice, originalUrl: url,
                hasMoreChapters: newHave < fullPack.chapters.length,
                lastFetchedPage: newHave,
                contentType: "novel"
              };
            }
          }
          return null;
        }
      } catch (e3) {}
      var loaded = (args && args.nextPage) ? args.nextPage - 1 : known.length;
      if (loaded < known.length) loaded = known.length;
      var needTop = total - loaded;
      var needBottom = needTop - FETCH_MORE_BATCH + 1;
      if (needBottom < 1) needBottom = 1;
      if (needTop < 1) return null;
      var oldest = known[known.length - 1];
      var curUrl = oldest.url;
      var visited = {};
      visited[curUrl] = true;
      var batch = [];
      var seenBatch = {};
      var steps = 0;
      while (steps < FETCH_MORE_MAX_STEPS) {
        steps++;
        var chHtml = "";
        try {
          chHtml = await fetchHtml(curUrl);
        } catch (e) {
          break;
        }
        if (!chHtml || isBlockedPage(chHtml)) break;
        if (curUrl !== oldest.url) {
          var curNum = 0;
          try {
            var nm = String(chHtml).match(CHAIN_NUM_RE);
            if (nm && nm[1]) curNum = parseInt(nm[1], 10);
          } catch (e3) {}
          if (!curNum || isNaN(curNum)) curNum = chapterNumFromUrl(curUrl);
          if (curNum && curNum <= oldest.number) {
            if (curNum < needBottom) break;
            if (!seenBatch[curUrl]) {
              seenBatch[curUrl] = true;
              var curTitle = "";
              try {
                var tm = String(chHtml).match(CHAIN_TITLE_RE);
                if (tm && tm[1]) curTitle = stripHtml(tm[1]);
              } catch (e2) {}
              batch.push({ number: curNum, title: curTitle, views: 0, url: curUrl, isLocked: false, date: "" });
              if (batch.length >= FETCH_MORE_BATCH) break;
            }
          }
        }
        var prevm = String(chHtml).match(PREV_URL_RE);
        if (!prevm || !prevm[1]) break;
        var prevUrl = abs(prevm[1].replace(/&amp;/g, "&"));
        if (!prevUrl || visited[prevUrl]) break;
        visited[prevUrl] = true;
        curUrl = prevUrl;
      }
      if (!batch.length) return null;
      batch.sort(function (a, b) { return b.number - a.number; });
      var newOldest = batch[batch.length - 1].number;
      var newLoaded = loaded + batch.length;
      return {
        title: "", coverUrl: "", description: "", genres: [],
        chapters: batch, originalUrl: url,
        hasMoreChapters: newOldest > 1 && newLoaded < total,
        lastFetchedPage: newLoaded,
        contentType: "novel"
      };
    },

    async getChapterPages(args) {
      return [];
    },

    async getChapterContent(args) {
      var url = abs((args && args.url) || "");
      var pageHtml = await fetchHtml(url);
      if (isBlockedPage(pageHtml)) {
        return { kind: "text", chapterTitle: "", textContent: "" };
      }
      var chapterTitle = stripHtml(await api.cssText(pageHtml, "article.wor-reading-page h1") || "");
      if (!chapterTitle) chapterTitle = stripHtml(await api.cssAttr(pageHtml, "meta[property='og:title']", "content") || "");
      var parts = await extractChapterParagraphs(pageHtml);
      if (parts.length > 1 && chapterTitle && parts[0] === chapterTitle) parts.shift();
      var textContent = parts.join("\n\n").trim();
      if (!textContent) {
        try {
          var surface = await api.cssHtml(pageHtml, "div.wor-reader-text-surface") || "";
          var cleaned = stripHtml(surface);
          if (cleaned.length > 100) textContent = cleaned;
        } catch (e) {}
      }
      return { kind: "text", chapterTitle: chapterTitle, textContent: textContent };
    },

    async getGenresAndTypes() {
      var genres = [];
      try {
        var txt = await fetchHtml(baseUrl + GENRES_SITEMAP_PATH);
        GENRE_URL_RE.lastIndex = 0;
        var seen = {};
        var m;
        while ((m = GENRE_URL_RE.exec(txt)) !== null) {
          var name = "";
          try {
            name = decodeURIComponent(m[1]).replace(/-/g, " ").replace(/\s+/g, " ").trim();
          } catch (e) {}
          if (name && !seen[name]) {
            seen[name] = true;
            genres.push(name);
          }
        }
      } catch (e) {}
      return { genres: genres, types: ["رواية", "مستمرة", "مكتملة", "متوقفة"] };
    },

    getImageHeaders(args) {
      return {
        "User-Agent": userAgent,
        "Referer": baseUrl + "/",
        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "Accept-Language": "ar,en-US;q=0.9,en;q=0.8"
      };
    },

    sanitizeCoverUrl(args) {
      return abs((args && args.url) || "");
    }
  };
}

if (typeof module !== "undefined") module.exports = { createSource: createSource };
