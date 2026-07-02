function createSource(api, config) {
  var baseUrl = ((config && config.base_url) || "https://hizomanga.net").replace(/\/+$/, "");
  var userAgent = (config && config.user_agent) || "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
  var lastChapterUrl = baseUrl + "/";
  var headers = {
    "User-Agent": userAgent,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "ar,en-US;q=0.9,en;q=0.8",
    "Referer": baseUrl + "/"
  };

  function abs(url) {
    if (!url) return "";
    url = String(url).replace(/&amp;/g, "&").trim();
    if (url.indexOf("//") === 0) return "https:" + url;
    if (url.indexOf("http://") === 0) return "https://" + url.substring(7);
    if (url.indexOf("https://") === 0) return url;
    if (url.charAt(0) === "/") return baseUrl + url;
    return baseUrl + "/" + url;
  }

  async function html(url, extra) {
    var h = {};
    for (var k in headers) h[k] = headers[k];
    if (extra) for (var x in extra) h[x] = extra[x];
    if (api.http) {
      var res = await api.http(url, { method: "GET", headers: h });
      if (!res || !res.ok) throw new Error("HTTP " + (res ? res.status : 0) + " for " + url);
      return res.body || "";
    }
    return await api.fetchText(url, h) || "";
  }

  function strip(s) {
    return String(s || "").replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
  }

  function isNovelText(text) {
    text = String(text || "").toLowerCase();
    return text.indexOf("novel") !== -1 || text.indexOf("رواية") !== -1 || text.indexOf("chapter-type-novel") !== -1 || text.indexOf("text-left") !== -1;
  }

  function validImage(src) {
    src = abs(src);
    var lower = src.toLowerCase();
    if (!src || lower.indexOf("data:") === 0 || lower.indexOf(".svg") !== -1) return "";
    if (lower.indexOf(".gif") !== -1 && lower.indexOf("icon") !== -1) return "";
    return src;
  }

  async function listCards(pageHtml, selector) {
    var cards = await api.cssAll(pageHtml, selector);
    var out = [];
    var seen = {};
    for (var i = 0; i < cards.length; i++) {
      var c = cards[i];
      var h = c.html || "";
      var href = await api.cssAttr(h, "a", "href") || (c.attrs && c.attrs.href) || "";
      var detail = abs(href);
      if (!detail || seen[detail]) continue;
      seen[detail] = true;
      var title = await api.cssText(h, ".post-title h3 a, .post-title h5 a, h3, h4, .tt, a") || await api.cssAttr(h, "img", "alt") || c.text || "";
      var cover = await api.cssAttr(h, "img", "data-src") || await api.cssAttr(h, "img", "data-lazy-src") || await api.cssAttr(h, "img", "src") || "";
      out.push({ title: strip(title), coverUrl: validImage(cover), detailUrl: detail, contentType: isNovelText(h) ? "novel" : "manga" });
    }
    return out;
  }

  async function parseChapters(pageHtml) {
    var nodes = await api.cssAll(pageHtml, ".wp-manga-chapter, li.wp-manga-chapter, .chapter-item, #chapterlist li, .eplister li");
    var out = [];
    var seen = {};
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      var h = n.html || "";
      var href = await api.cssAttr(h, "a", "href") || (n.attrs && n.attrs.href) || "";
      var url = abs(href);
      if (!url || seen[url]) continue;
      seen[url] = true;
      var text = await api.cssText(h, "a, .chapternum, .epx") || n.text || "";
      var m = (url + " " + text).match(/(?:chapter|ch|فصل|الفصل)[\s_.-]*(\d+(?:\.\d+)?)/i) || (url + " " + text).match(/(\d+(?:\.\d+)?)/);
      out.push({ number: m ? m[1] : "0", title: strip(text), views: 0, url: url, isLocked: /locked|premium|fa-lock/.test(h), date: strip(await api.cssText(h, ".chapter-release-date, .chapterdate, .date") || "") });
    }
    out.sort(function (a, b) { return (parseFloat(b.number) || 0) - (parseFloat(a.number) || 0); });
    return out;
  }

  return {
    requiresCloudflare: false,
    async getHomepageManga(args) {
      var page = (args && args.page) || 1;
      try { return await listCards(await html(page === 1 ? baseUrl + "/releases/" : baseUrl + "/releases/page/" + page + "/"), ".page-item-detail, .listupd .bs, .bsx"); } catch (e) { return []; }
    },
    async search(args) {
      var q = (args && args.query) || "";
      if (!q.trim()) return [];
      try { return await listCards(await html(baseUrl + "/?s=" + encodeURIComponent(q) + "&post_type=wp-manga"), ".c-tabs-item__content, .page-item-detail, .listupd .bs, .bsx"); } catch (e) { return []; }
    },
    async getFilteredManga(args) { return await this.getHomepageManga(args); },
    async getMangaDetails(args) {
      var url = abs((args && args.url) || "");
      var page = await html(url);
      var title = await api.cssText(page, ".post-title h1, h1, .entry-title") || await api.cssAttr(page, "meta[property='og:title']", "content") || "بدون عنوان";
      var cover = await api.cssAttr(page, ".summary_image img, .thumb img", "data-src") || await api.cssAttr(page, ".summary_image img, .thumb img", "src") || await api.cssAttr(page, "meta[property='og:image']", "content") || "";
      var description = await api.cssText(page, ".description-summary .summary__content, .description-summary, .entry-content") || "";
      var genres = await api.cssList(page, ".genres-content a, .mgen a, .genres a");
      return { title: strip(title), coverUrl: validImage(cover), description: strip(description), genres: genres.map(strip).filter(Boolean), chapters: await parseChapters(page), originalUrl: url, hasMoreChapters: false, lastFetchedPage: 1, contentType: isNovelText(page) ? "novel" : "manga" };
    },
    async getChapterPages(args) {
      var content = await this.getChapterContent(args);
      return content.kind === "image" ? content.imageUrls : [];
    },
    async getChapterContent(args) {
      var url = abs((args && args.url) || "");
      lastChapterUrl = url;
      var page = await html(url);
      if (isNovelText(page)) {
        var body = await api.cssHtml(page, ".text-left, .reading-content, .entry-content") || "";
        return { kind: "text", chapterTitle: strip(await api.cssText(page, "h1, .entry-title") || ""), textContent: body || strip(page) };
      }
      var imgs = await api.cssAll(page, ".reading-content .page-break img, #readerarea img, .wp-manga-chapter-img, img");
      var urls = [];
      for (var i = 0; i < imgs.length; i++) {
        var a = imgs[i].attrs || {};
        var src = validImage(a["data-src"] || a["data-lazy-src"] || a.src || "");
        if (src && urls.indexOf(src) === -1) urls.push(src);
      }
      return { kind: "image", imageUrls: urls };
    },
    async fetchMoreChapters() { return null; },
    async getGenresAndTypes() { return { genres: [], types: ["manga", "novel"] }; },
    getImageHeaders() { return { "User-Agent": userAgent, "Referer": lastChapterUrl || baseUrl + "/", "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8" }; },
    sanitizeCoverUrl(args) { return validImage((args && args.url) || "") || ((args && args.url) || ""); }
  };
}

if (typeof module !== "undefined") module.exports = { createSource: createSource };
