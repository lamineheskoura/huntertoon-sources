function createSource(api, config) {
  var baseUrl = ((config && config.base_url) || "https://rewayat.club").replace(/\/+$/, "");
  var apiCoverBase = "https://api.rewayat.club";
  var userAgent = (config && config.user_agent) || "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
  var headers = {
    "User-Agent": userAgent,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "ar,en-US;q=0.9,en;q=0.8",
    "Referer": baseUrl + "/",
    "Origin": baseUrl,
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "same-origin",
    "Upgrade-Insecure-Requests": "1"
  };
  // The JSON API (api.rewayat.club) answers 406 to text/html Accept —
  // API calls MUST use the JSON Accept below (verified live).
  var jsonHeaders = {
    "User-Agent": userAgent,
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "ar,en-US;q=0.9,en;q=0.8",
    "Referer": baseUrl + "/",
    "Origin": baseUrl
  };

  function abs(url) {
    if (!url) return "";
    url = String(url).replace(/&amp;/g, "&").replace(/\\u002F/gi, "/").trim();
    if (url.indexOf("//") === 0) return "https:" + url;
    if (url.indexOf("http://") === 0) return "https://" + url.substring(7);
    if (url.indexOf("https://") === 0) return url;
    if (url.charAt(0) === "/") return baseUrl + url;
    return baseUrl + "/" + url;
  }

  function coverAbs(url) {
    if (!url) return "";
    url = String(url).replace(/&amp;/g, "&").replace(/\\u002F/gi, "/").trim();
    if (url.indexOf("//") === 0) return "https:" + url;
    if (url.indexOf("http://") === 0) return "https://" + url.substring(7);
    if (url.indexOf("https://") === 0) return url;
    // Site assets: API media lives under /media/ on the API host,
    // everything else relative resolves against the website host.
    if (url.charAt(0) === "/") {
      if (url.indexOf("/media/") === 0) return apiCoverBase + url;
      return baseUrl + url;
    }
    if (url.indexOf("media/") === 0) return apiCoverBase + "/" + url;
    return baseUrl + "/" + url;
  }

  async function html(url) {
    if (api.http) {
      var res = await api.http(url, { method: "GET", headers: headers });
      if (!res || !res.ok) throw new Error("HTTP " + (res ? res.status : 0) + " for " + url);
      return res.body || "";
    }
    return await api.fetchText(url, headers) || "";
  }

  async function apiJson(url) {
    if (api.http) {
      var res = await api.http(url, { method: "GET", headers: jsonHeaders });
      if (!res || !res.ok) throw new Error("HTTP " + (res ? res.status : 0) + " for " + url);
      try { return JSON.parse(res.body || "{}"); } catch (e) { throw new Error("Bad JSON: " + url); }
    }
    return JSON.parse(await api.fetchText(url, jsonHeaders) || "{}");
  }

  function mapApiNovel(n) {
    n = n || {};
    var slug = String(n.slug || "");
    if (!slug) return null;
    var title = strip(String(n.arabic || n.english || ""));
    if (!title) return null;
    return {
      title: title,
      coverUrl: coverAbs(String(n.poster_url || "")),
      detailUrl: baseUrl + "/novel/" + slug,
      contentType: "novel"
    };
  }

  function mapApiNovels(results) {
    var out = [];
    var seen = {};
    results = results || [];
    for (var i = 0; i < results.length; i++) {
      var c = mapApiNovel(results[i]);
      if (!c || seen[c.detailUrl]) continue;
      seen[c.detailUrl] = true;
      out.push(c);
    }
    return out;
  }

  var genreIdCache = null;

  async function genreIdMap() {
    if (genreIdCache && Object.keys(genreIdCache).length) return genreIdCache;
    var map = {};
    for (var p = 1; p <= 3; p++) {
      try {
        var data = await apiJson(apiCoverBase + "/api/novels/?page=" + p);
        var results = data.results || [];
        if (!results.length) break;
        for (var i = 0; i < results.length; i++) {
          var gs = (results[i] && results[i].genre) || [];
          for (var g = 0; g < gs.length; g++) {
            if (gs[g] && gs[g].arabic) map[String(gs[g].arabic)] = gs[g].id;
          }
        }
        if (!data.next) break;
      } catch (e) { break; }
    }
    // Cache only non-empty maps: a flaky first run must not poison later
    // filters into permanent [].
    if (Object.keys(map).length) genreIdCache = map;
    return map;
  }

  function strip(value) {
    return String(value || "")
      .replace(/<br\s*\/?\s*>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, "\"")
      .replace(/&#39;/g, "'")
      .replace(/[\u200B-\u200D\u2060-\u2064\uFEFF\u00AD\u2063]/g, "")
      .replace(/\s+\n/g, "\n")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function slugFromUrl(url) {
    var m = String(url || "").match(/\/novel\/([^\/?#]+)/);
    return m ? m[1] : "";
  }

  function extractCoverMap(pageHtml) {
    var body = String(pageHtml || "").replace(/\\u002F/gi, "/");
    var slugs = [];
    var posters = [];
    var match;
    var slugRe = /["']?slug["']?\s*:\s*["']([^"']+)["']/g;
    var posterRe = /["']?poster_url["']?\s*:\s*["']([^"']+)["']/g;
    while ((match = slugRe.exec(body)) !== null) slugs.push(match[1]);
    while ((match = posterRe.exec(body)) !== null) posters.push(match[1]);
    var out = {};
    var n = Math.min(slugs.length, posters.length);
    for (var i = 0; i < n; i++) out[slugs[i]] = posters[i];
    return out;
  }

  async function listCards(pageHtml) {
    var covers = extractCoverMap(pageHtml);
    var nodes = await api.cssAll(pageHtml, ".v-card, .book-card, .novel-card, a[href^='/novel/']");
    var out = [];
    var seen = {};
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i] || {};
      var h = node.html || "";
      var href = await api.cssAttr(h, "a[href^='/novel/']", "href") || (node.attrs && node.attrs.href) || "";
      var detail = abs(href);
      if (!detail || detail.indexOf("/novel/") === -1 || seen[detail]) continue;
      seen[detail] = true;
      var slug = slugFromUrl(detail);
      var title = await api.cssText(h, ".v-list-item__title.headerClassRTL, .v-card-title, h3, h2, .title, a") || node.text || slug;
      var cover = await api.cssAttr(h, "img", "src") || await api.cssAttr(h, "img", "data-src") || covers[slug] || "";
      out.push({ title: strip(title), coverUrl: coverAbs(cover), detailUrl: detail, contentType: "novel" });
    }
    return out;
  }

  async function fetchChapterPage(detailUrl, page) {
    var slug = slugFromUrl(detailUrl);
    if (!slug) return [];
    var pageUrl = page === 1 ? detailUrl : (detailUrl.indexOf("?") !== -1 ? detailUrl + "&page=" + page : detailUrl + "?page=" + page);
    var pageHtml = await html(pageUrl);
    var links = await api.cssAll(pageHtml, "a[href^='/novel/" + slug + "/']");
    var out = [];
    var seen = {};
    for (var i = 0; i < links.length; i++) {
      var link = links[i] || {};
      var href = (link.attrs && link.attrs.href) || await api.cssAttr(link.html || "", "a", "href") || "";
      if (href === "/novel/" + slug || href === "/novel/" + slug + "/") continue;
      var m = href.match(new RegExp("^/novel/" + slug.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&") + "/(\\d+)/?(?:\\?.*)?$"));
      if (!m) continue;
      var url = abs(href);
      if (seen[url]) continue;
      seen[url] = true;
      var title = await api.cssText(link.html || "", ".v-list-item__title, .headerClassRTL") || link.text || "الفصل " + m[1];
      out.push({ number: m[1], title: strip(title), views: 0, url: url, isLocked: false, date: "" });
    }
    out.sort(function (a, b) { return (parseInt(b.number, 10) || 0) - (parseInt(a.number, 10) || 0); });
    return out;
  }

  async function fetchChapterBatch(detailUrl, startPage, maxPages) {
    var all = [];
    var seen = {};
    for (var i = 0; i < maxPages; i++) {
      var page = startPage + i;
      var pageItems = await fetchChapterPage(detailUrl, page);
      if (!pageItems.length) break;
      var added = 0;
      for (var j = 0; j < pageItems.length; j++) {
        if (seen[pageItems[j].url]) continue;
        seen[pageItems[j].url] = true;
        all.push(pageItems[j]);
        added++;
      }
      if (!added) break;
    }
    all.sort(function (a, b) { return (parseInt(b.number, 10) || 0) - (parseInt(a.number, 10) || 0); });
    return all;
  }

  async function hasMoreChapters(detailUrl, page) {
    try { return (await fetchChapterPage(detailUrl, page)).length > 0; } catch (e) { return false; }
  }

  function cleanChapterText(raw) {
    var text = strip(raw);
    var lines = text.split(/\n+/);
    var out = [];
    var junk = /تأكد\s*من\s*قراءة\s*الرواية\s*على\s*موقع\s*نادي\s*الروايات|اقرأ\s*من\s*المصدر|محتوى\s*الفصل\s*محمي|club\.rewayt\.app/;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line || junk.test(line)) continue;
      out.push(line);
    }
    return out.join("\n").trim();
  }

  async function extractChapterText(pageHtml) {
    var selectors = [
      ".v-card__text.unselectable.pre-formatted",
      ".v-card__text.unselectable",
      "[unselectable='on'][class*='pre-formatted']",
      "[unselectable='on'].v-card__text"
    ];
    var htmlParts = [];
    for (var i = 0; i < selectors.length && !htmlParts.length; i++) {
      var nodes = await api.cssAll(pageHtml, selectors[i]);
      for (var j = 0; j < nodes.length; j++) htmlParts.push(nodes[j].html || nodes[j].text || "");
    }
    if (!htmlParts.length) return "";
    return cleanChapterText(htmlParts.join("\n"));
  }

  return {
    requiresCloudflare: false,

    async getHomepageManga(args) {
      var page = (args && args.page) || 1;
      // Primary: JSON API (paginated, honest shapes). HTML fallback below.
      try {
        var data = await apiJson(apiCoverBase + "/api/novels/?page=" + page);
        var mapped = mapApiNovels(data.results || []);
        if (mapped.length) return mapped;
      } catch (eApi) {}
      try { return await listCards(await html(baseUrl + "/library" + (page > 1 ? "?page=" + page : ""))); } catch (e) { return []; }
    },

    async search(args) {
      var q = (args && args.query) || "";
      if (!q.trim()) return [];
      try {
        var data = await apiJson(apiCoverBase + "/api/novels/?search=" + encodeURIComponent(q.trim()));
        return mapApiNovels(data.results || []);
      } catch (e) { return []; }
    },

    async getFilteredManga(args) {
      try {
        var page = (args && args.page) || 1;
        var genre = strip((args && args.genre) || "");
        if (genre) {
          var map = await genreIdMap();
          var gid = map[genre];
          if (gid !== undefined && gid !== null && String(gid) !== "") {
            var fdata = await apiJson(apiCoverBase + "/api/novels/?genre=" + encodeURIComponent(String(gid)) + "&page=" + page);
            return mapApiNovels(fdata.results || []);
          }
          return [];
        }
        return await this.getHomepageManga(args);
      } catch (e) {
        try { return await this.getHomepageManga(args); } catch (e2) { return []; }
      }
    },

    async getMangaDetails(args) {
      var url = abs((args && args.url) || "");
      var slug = slugFromUrl(url);
      // Authoritative metadata from the JSON API (genres included).
      var apiMeta = null;
      if (slug) {
        try { apiMeta = await apiJson(apiCoverBase + "/api/novels/" + slug + "/"); } catch (eApi) {}
      }
      // HTML chapters below are best-effort: a failed page fetch must not
      // discard the API metadata already collected (fail-soft, not empty).
      var pageHtml = "";
      try { pageHtml = await html(url); } catch (eHtml) {}
      var covers = extractCoverMap(pageHtml);
      var title = "";
      var cover = "";
      var description = "";
      if (pageHtml) {
        try { title = await api.cssText(pageHtml, "h1.font-cairo, h1, .v-card-title, .novel-title"); } catch (eT) {}
        if (!title) {
          try { title = await api.cssAttr(pageHtml, "meta[property='og:title']", "content"); } catch (eT2) {}
        }
        if (!title) title = slug;
        try { cover = await api.cssAttr(pageHtml, "meta[property='og:image']", "content"); } catch (eC) {}
        if (!cover) {
          try { cover = await api.cssAttr(pageHtml, "img", "src"); } catch (eC2) {}
        }
        if (!cover && covers[slug]) cover = covers[slug];
        try { description = await api.cssText(pageHtml, ".description, .summary, .v-card-text, .novel-description"); } catch (eD) {}
      }
      var genres = [];
      if (apiMeta && apiMeta.genre) {
        for (var gi = 0; gi < apiMeta.genre.length; gi++) {
          if (apiMeta.genre[gi] && apiMeta.genre[gi].arabic) genres.push(String(apiMeta.genre[gi].arabic));
        }
      }
      if (apiMeta && apiMeta.arabic) title = String(apiMeta.arabic);
      if (apiMeta && apiMeta.poster_url) cover = String(apiMeta.poster_url);
      if (apiMeta && apiMeta.about) description = String(apiMeta.about);
      var chapters = [];
      var more = false;
      if (pageHtml) {
        try {
          chapters = await fetchChapterBatch(url, 1, 1);
          more = await hasMoreChapters(url, 2);
        } catch (eCh) {}
      }
      return { title: strip(title) || strip(slug), coverUrl: coverAbs(cover), description: strip(description), genres: genres, chapters: chapters, originalUrl: url, hasMoreChapters: more, lastFetchedPage: 1, contentType: "novel" };
    },

    async fetchMoreChapters(args) {
      var url = abs((args && args.url) || "");
      var nextPage = (args && args.nextPage) || 2;
      try {
        var chapters = await fetchChapterBatch(url, nextPage, 1);
        if (!chapters.length) return null;
        return { title: "", coverUrl: "", description: "", genres: [], chapters: chapters, originalUrl: url, hasMoreChapters: await hasMoreChapters(url, nextPage + 1), lastFetchedPage: nextPage, contentType: "novel" };
      } catch (e) {
        return null;
      }
    },

    async getChapterPages() { return []; },

    async getChapterContent(args) {
      var url = abs((args && args.url) || "");
      var pageHtml = await html(url);
      return { kind: "text", chapterTitle: strip(await api.cssText(pageHtml, "h1.font-cairo, h1, .chapter-title") || ""), textContent: await extractChapterText(pageHtml) };
    },

    async getGenresAndTypes() {
      try {
        var map = await genreIdMap();
        var gs = Object.keys(map);
        if (gs.length) return { genres: gs, types: ["novel"] };
      } catch (e) {}
      return { genres: [], types: ["novel"] };
    },

    getImageHeaders(args) {
      return { "User-Agent": userAgent, "Referer": baseUrl + "/", "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8", "Cache-Control": "max-age=86400" };
    },

    sanitizeCoverUrl(args) { return coverAbs((args && args.url) || ""); }
  };
}

if (typeof module !== "undefined") module.exports = { createSource: createSource };
