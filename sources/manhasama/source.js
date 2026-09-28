function createSource(api, config) {
  var baseUrl = ((config && config.base_url) || "https://realmnovel.com").replace(/\/+$/, "");
  // User-Agent keeps the Dart prefix AND a Chrome/ token suffix (verified live):
  // the app's fetch orchestrator rewrites any caller UA lacking "Chrome/".
  // NOTE: manifest config headers User-Agent must carry the same value —
  // the app injects it as config.user_agent, which takes precedence here.
  var userAgent = (config && config.user_agent) || "Dart/3.6 (dart:io) Chrome/124";

  // Referer: explicit empty (not absent). The app's fetch orchestrator injects
  // "Referer: <site>/" whenever the caller omits it — an explicit empty value
  // keeps the wire referer-less (verified 200 on /_more, /novel, /chapter).
  function buildHeaders() {
    return {
      "User-Agent": userAgent,
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,application/json,*/*;q=0.8",
      "Accept-Language": "ar,en-US;q=0.9,en;q=0.8",
      "Referer": ""
    };
  }

  var defaultTypes = ["novel"];
  var defaultGenres = [];
  // Detail pages embed the first 200 chapter rows; novels can hold 6000+.
  var CHAPTER_PAGE_SIZE = 200;

  function abs(url) {
    if (!url) return "";
    url = String(url).replace(/&amp;/g, "&").trim();
    if (url.indexOf("//") === 0) return "https:" + url;
    if (url.indexOf("http://") === 0) return "https://" + url.substring(7);
    if (url.indexOf("https://") === 0) return url;
    if (url.charAt(0) === "/") return baseUrl + url;
    return baseUrl + "/" + url;
  }

  function strip(s) {
    return String(s || "")
      .replace(/<br\s*\/?\s*>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, "\"")
      .replace(/&#34;/g, "\"")
      .replace(/&#39;/g, "'")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function decodeEntities(s) {
    return strip(String(s || ""));
  }

  async function html(url) {
    if (api.http) {
      var res = await api.http(url, { method: "GET", headers: buildHeaders() });
      if (!res || !res.ok) throw new Error("HTTP " + (res ? res.status : 0) + " for " + url);
      return res.body || "";
    }
    return (await api.fetchText(url, buildHeaders())) || "";
  }

  async function getJson(url) {
    var text = await html(url);
    try { return JSON.parse(text); } catch (e) { throw new Error("Bad JSON for " + url); }
  }

  function novelIdFromUrl(rawUrl) {
    var m = String(rawUrl || "").match(/\/novel\/([^/?#]+)/);
    return m ? m[1] : "";
  }

  function toNovel(doc) {
    var id = (doc && (doc.id || doc._id)) || "";
    var title = (doc && (doc.title || doc.titleEn)) || "";
    return {
      title: decodeEntities(title) || "بدون عنوان",
      detailUrl: baseUrl + "/novel/" + id,
      coverUrl: id ? baseUrl + "/img/novel/" + id + ".jpg" : "",
      contentType: "novel"
    };
  }

  function chapterNumFromHref(href) {
    var m = String(href || "").match(/\/chapter\/(\d+)/);
    return m ? m[1] : "0";
  }

  async function novelTotalChapters(novelId, detailHtml) {
    // Prefer the explicit "NNNN فصل" counter on the detail page.
    var m = String(detailHtml || "").match(/(\d[\d,]*)\s*فصل/);
    if (m) {
      var n = parseInt(m[1].replace(/,/g, ""), 10);
      if (n > 0) return n;
    }
    return 0;
  }

  async function parseChapterRows(pageHtml, novelId) {
    var nodes = [];
    try { nodes = await api.cssAll(pageHtml, "a.chapter-row"); } catch (e) { nodes = []; }
    var out = [];
    var seen = {};
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i] || {};
      var h = node.html || "";
      // The href lives on the row anchor itself (node.attrs), not nested.
      var href = (node.attrs && node.attrs.href) || "";
      if (!href) {
        try { href = await api.cssAttr(h, "a", "href"); } catch (e2) { href = ""; }
      }
      var num = chapterNumFromHref(href);
      if (num === "0" || seen[num]) continue;
      seen[num] = true;
      var text = strip(node.text || "");
      out.push({
        number: num,
        title: text || ("الفصل " + num),
        views: 0,
        url: baseUrl + "/novel/" + novelId + "/chapter/" + num,
        isLocked: false,
        date: ""
      });
    }
    out.sort(function (a, b) { return (parseInt(a.number, 10) || 0) - (parseInt(b.number, 10) || 0); });
    return out;
  }

  function synthChapters(novelId, fromNum, toNum) {
    var out = [];
    for (var n = fromNum; n <= toNum; n++) {
      out.push({
        number: String(n),
        title: "الفصل " + n,
        views: 0,
        url: baseUrl + "/novel/" + novelId + "/chapter/" + n,
        isLocked: false,
        date: ""
      });
    }
    return out;
  }

  // Search + genre archives share the g3card markup (verified live):
  // <a class="g3card" href="/novel/{id}"><img src="/img/novel/{id}.jpg"
  //   alt="غلاف رواية {title}"></a>
  async function parseG3Cards(pageHtml) {
    var nodes = [];
    try { nodes = await api.cssAll(pageHtml, "a.g3card"); } catch (e) { nodes = []; }
    var out = [];
    var seen = {};
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i] || {};
      var h = node.html || "";
      // The href lives on the card anchor itself (node.attrs), not nested.
      var href = (node.attrs && node.attrs.href) || "";
      if (!href) {
        try { href = await api.cssAttr(h, "a", "href"); } catch (e2) { href = ""; }
      }
      var id = novelIdFromUrl(href);
      if (!id || seen[id]) continue;
      seen[id] = true;
      var cover = "";
      try { cover = await api.cssAttr(h, "img", "src"); } catch (e3) { cover = ""; }
      var alt = "";
      try { alt = await api.cssAttr(h, "img", "alt"); } catch (e4) { alt = ""; }
      alt = decodeEntities(alt).replace(/^غلاف رواية\s*/, "").trim();
      var title = alt || decodeEntities(strip(node.text || ""));
      out.push({
        title: title || "بدون عنوان",
        detailUrl: baseUrl + "/novel/" + id,
        coverUrl: abs(cover) || (baseUrl + "/img/novel/" + id + ".jpg"),
        contentType: "novel"
      });
    }
    return out;
  }

  async function filterByTagsWalk(genre, page) {
    // Fallback: filter /_more docs client-side on tags. Walk a bounded window.
    var matched = [];
    for (var p = 1; p <= 30; p++) {
      var data = null;
      try { data = await getJson(baseUrl + "/_more?page=" + p); } catch (eP) { break; }
      var docs = (data && data.docs) || [];
      if (!docs.length) break;
      for (var i = 0; i < docs.length; i++) {
        var tags = (docs[i] && docs[i].tags) || [];
        for (var t = 0; t < tags.length; t++) {
          var tag = String(tags[t] || "").toLowerCase();
          if (tag && (tag === genre || tag.indexOf(genre) !== -1 || genre.indexOf(tag) !== -1)) {
            matched.push(docs[i]);
            break;
          }
        }
      }
      if (data && data.hasMore === false) break;
    }
    var perPage = 20;
    var start = (page - 1) * perPage;
    return matched.slice(start, start + perPage).map(toNovel);
  }

  return {
    requiresCloudflare: false,

    async getHomepageManga(args) {
      try {
        var page = (args && args.page) || 1;
        var data = await getJson(baseUrl + "/_more?page=" + page);
        var docs = (data && data.docs) || [];
        return docs.map(toNovel);
      } catch (e) {
        return [];
      }
    },

    async search(args) {
      try {
        var q = (args && args.query) || "";
        if (!q.trim()) return [];
        var pageHtml = await html(baseUrl + "/?q=" + encodeURIComponent(q));
        return await parseG3Cards(pageHtml);
      } catch (e) {
        return [];
      }
    },

    async getFilteredManga(args) {
      // Server-side genre archive /?tag={slug} (verified live); falls back
      // to the client-side tags walk when the archive yields nothing.
      try {
        var page = (args && args.page) || 1;
        var genre = String((args && args.genre) || "").trim();
        if (!genre) return await this.getHomepageManga(args);
        var ghtml = "";
        try { ghtml = await html(baseUrl + "/?tag=" + encodeURIComponent(genre)); } catch (eG) { ghtml = ""; }
        var items = ghtml ? await parseG3Cards(ghtml) : [];
        if (items.length) {
          var perPage = 20;
          var start = (page - 1) * perPage;
          return items.slice(start, start + perPage);
        }
        return await filterByTagsWalk(genre.toLowerCase(), page);
      } catch (e) {
        return [];
      }
    },

    async getGenresAndTypes() {
      try {
        var data = await getJson(baseUrl + "/api/categories");
        var items = (data && data.items) || [];
        var names = items.map(function (c) { return (c && c.name) || ""; }).filter(Boolean);
        if (names.length) defaultGenres = names;
      } catch (e) {}
      return { genres: defaultGenres, types: defaultTypes };
    },

    async getMangaDetails(args) {
      var rawUrl = (args && args.url) || "";
      var novelId = novelIdFromUrl(rawUrl);
      if (!novelId) throw new Error("Novel not found: " + rawUrl);
      var detailUrl = baseUrl + "/novel/" + novelId;
      var pageHtml = await html(detailUrl);

      var title = "";
      try { title = await api.cssText(pageHtml, "h1"); } catch (e) {}
      if (!title) {
        try { title = await api.cssAttr(pageHtml, "meta[property='og:title']", "content"); } catch (e0) {}
      }
      if (!title) {
        var tm = String(pageHtml).match(/<title>([\s\S]*?)<\/title>/i);
        title = tm ? tm[1] : "";
      }
      title = decodeEntities(title).replace(/\s*[—|]\s*قراءة أونلاين\s*\|\s*realmnovel\s*$/i, "").replace(/\s*\|\s*realmnovel\s*$/i, "").trim() || "بدون عنوان";

      var cover = "";
      try { cover = await api.cssAttr(pageHtml, "meta[property='og:image']", "content"); } catch (e2) {}
      if (!cover) cover = baseUrl + "/img/novel/" + novelId + ".jpg";

      var description = "";
      try { description = await api.cssAttr(pageHtml, "meta[name='description']", "content"); } catch (e3) {}
      if (!description) {
        try { description = await api.cssAttr(pageHtml, "meta[property='og:description']", "content"); } catch (e4) {}
      }

      var genres = [];
      try {
        var tagList = await api.cssList(pageHtml, "a[href*='tag=']");
        if (tagList) for (var gi = 0; gi < tagList.length; gi++) {
          var gv = decodeEntities(tagList[gi]).trim();
          if (gv && genres.indexOf(gv) === -1) genres.push(gv);
        }
      } catch (e5) {}

      var chapters = await parseChapterRows(pageHtml, novelId);
      var total = await novelTotalChapters(novelId, pageHtml);
      if (!total) total = chapters.length;

      return {
        title: title,
        coverUrl: abs(cover),
        description: decodeEntities(description),
        genres: genres,
        chapters: chapters,
        originalUrl: detailUrl,
        hasMoreChapters: total > chapters.length,
        lastFetchedPage: 1,
        contentType: "novel"
      };
    },

    async getChapterPages(args) {
      var content = await this.getChapterContent(args);
      return content.kind === "image" ? content.imageUrls : [];
    },

    async getChapterContent(args) {
      var rawUrl = (args && args.url) || "";
      var m = String(rawUrl).match(/\/novel\/([^/?#]+)\/chapter\/(\d+)/);
      if (!m) throw new Error("Bad chapter url: " + rawUrl);
      var url = baseUrl + "/novel/" + m[1] + "/chapter/" + m[2];
      var pageHtml = await html(url);

      var container = "";
      try { container = await api.cssHtml(pageHtml, ".chapter-content"); } catch (e) { container = ""; }
      if (!container) throw new Error("Empty chapter: " + url);
      var text = strip(container);
      // Drop prev/next navigation paragraphs ("الفصل السابق/التالي").
      var paras = String(text).split(/\n+/);
      var kept = [];
      for (var pi = 0; pi < paras.length; pi++) {
        var pl = paras[pi].trim();
        if (!pl) continue;
        if (/^الفصل\s+(السابق|التالي)$/.test(pl)) continue;
        kept.push(paras[pi].trim());
      }
      text = kept.join("\n\n").trim();
      if (!text) throw new Error("Empty chapter: " + url);

      var chapterTitle = "";
      var tm = String(pageHtml).match(/<title>([\s\S]*?)<\/title>/i);
      if (tm) chapterTitle = decodeEntities(tm[1]).replace(/\s*\|\s*realmnovel\s*$/i, "").trim();
      return { kind: "text", chapterTitle: chapterTitle, textContent: text };
    },

    async fetchMoreChapters(args) {
      try {
        var prev = (args && args.previousResult) || {};
        var rawUrl = (args && args.url) || prev.originalUrl || "";
        var novelId = novelIdFromUrl(rawUrl);
        if (!novelId) return null;
        var nextPage = (args && args.nextPage) || ((prev.lastFetchedPage || 1) + 1);
        nextPage = parseInt(nextPage, 10) || 2;
        if (nextPage < 2) nextPage = 2;
        if (nextPage > 100) return null;
        // Detail embeds page 1 (first 200 rows); later pages are synthesized
        // — chapter URLs are numerically addressable (verified live).
        var detailHtml = await html(baseUrl + "/novel/" + novelId);
        var total = await novelTotalChapters(novelId, detailHtml);
        if (!total) return null;
        var start = (nextPage - 1) * CHAPTER_PAGE_SIZE + 1;
        if (start > total) return null;
        var end = Math.min(start + CHAPTER_PAGE_SIZE - 1, total);
        return {
          chapters: synthChapters(novelId, start, end),
          hasMoreChapters: end < total,
          lastFetchedPage: nextPage
        };
      } catch (e) {
        return null;
      }
    },

    getImageHeaders(args) {
      return {
        "User-Agent": userAgent,
        Referer: baseUrl + "/",
        Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "Accept-Language": "ar,en-US;q=0.9,en;q=0.8"
      };
    },

    sanitizeCoverUrl(args) {
      return abs((args && args.url) || "") || ((args && args.url) || "");
    }
  };
}

if (typeof module !== "undefined") module.exports = { createSource: createSource };
