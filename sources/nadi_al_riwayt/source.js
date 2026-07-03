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
    if (url.charAt(0) === "/") return apiCoverBase + url;
    return apiCoverBase + "/" + url;
  }

  async function html(url) {
    if (api.http) {
      var res = await api.http(url, { method: "GET", headers: headers });
      if (!res || !res.ok) throw new Error("HTTP " + (res ? res.status : 0) + " for " + url);
      return res.body || "";
    }
    return await api.fetchText(url, headers) || "";
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
      try { return await listCards(await html(baseUrl + "/library" + (page > 1 ? "?page=" + page : ""))); } catch (e) { return []; }
    },

    async search(args) {
      var q = (args && args.query) || "";
      if (!q.trim()) return [];
      try { return await listCards(await html("https://api.rewayat.club/api/novels/?search=" + encodeURIComponent(q))); } catch (e) { return []; }
    },

    async getFilteredManga(args) { return await this.getHomepageManga(args); },

    async getMangaDetails(args) {
      var url = abs((args && args.url) || "");
      var slug = slugFromUrl(url);
      var pageHtml = await html(url);
      var covers = extractCoverMap(pageHtml);
      var title = await api.cssText(pageHtml, "h1.font-cairo, h1, .v-card-title, .novel-title") || await api.cssAttr(pageHtml, "meta[property='og:title']", "content") || slug;
      var cover = await api.cssAttr(pageHtml, "meta[property='og:image']", "content") || await api.cssAttr(pageHtml, "img", "src") || covers[slug] || "";
      var description = await api.cssText(pageHtml, ".description, .summary, .v-card-text, .novel-description") || "";
      var chapters = await fetchChapterBatch(url, 1, 2);
      return { title: strip(title), coverUrl: coverAbs(cover), description: strip(description), genres: [], chapters: chapters, originalUrl: url, hasMoreChapters: await hasMoreChapters(url, 3), lastFetchedPage: 2, contentType: "novel" };
    },

    async fetchMoreChapters(args) {
      var url = abs((args && args.url) || "");
      var nextPage = (args && args.nextPage) || 3;
      var chapters = await fetchChapterBatch(url, nextPage, 2);
      if (!chapters.length) return null;
      return { title: "", coverUrl: "", description: "", genres: [], chapters: chapters, originalUrl: url, hasMoreChapters: await hasMoreChapters(url, nextPage + 2), lastFetchedPage: nextPage + 1, contentType: "novel" };
    },

    async getChapterPages() { return []; },

    async getChapterContent(args) {
      var url = abs((args && args.url) || "");
      var pageHtml = await html(url);
      return { kind: "text", chapterTitle: strip(await api.cssText(pageHtml, "h1.font-cairo, h1, .chapter-title") || ""), textContent: await extractChapterText(pageHtml) };
    },

    async getGenresAndTypes() { return { genres: [], types: ["novel"] }; },

    getImageHeaders(args) {
      var url = (args && args.url) || "";
      var referer = url.indexOf("api.rewayat.club") !== -1 ? baseUrl + "/" : baseUrl + "/";
      return { "User-Agent": userAgent, "Referer": referer, "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8", "Cache-Control": "max-age=86400" };
    },

    sanitizeCoverUrl(args) { return coverAbs((args && args.url) || ""); }
  };
}

if (typeof module !== "undefined") module.exports = { createSource: createSource };
