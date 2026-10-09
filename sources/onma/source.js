function createSource(api, config) {
  var baseUrl = ((config && config.base_url) || "https://mail.onma.top").replace(/\/+$/, "");
  var userAgent = (config && config.user_agent) || "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
  var headers = {
    "User-Agent": userAgent,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "ar,en-US;q=0.9,en;q=0.8",
    "Referer": baseUrl + "/",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "same-origin",
    "Upgrade-Insecure-Requests": "1"
  };
  var GENRES = ["أكشن", "خارق للطبيعة", "فنون قتال", "دراما", "شونين", "غموض", "كوميديا", "خيال", "مغامرات"];

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

  async function fetchHtml(url, method) {
    if (api.http) {
      var res = await api.http(url, { method: method || "GET", headers: headers });
      if (!res || !res.ok) throw new Error("HTTP " + (res ? res.status : 0) + " for " + url);
      return res.body || "";
    }
    if (method && method !== "GET") return "";
    return (await api.fetchText(url, headers)) || "";
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
    var m = String(url || "").match(/\/manga\/([^\/?#]+)/);
    return m ? m[1] : "";
  }

  function parseCards(html) {
    var raw = html;
    var out = [];
    var re = /<div class="chapter-container">([\s\S]*?)(?=<div class="chapter-container">|<\/div>\s*<div class="row">|$)/gi;
    var m;
    while ((m = re.exec(raw)) !== null) {
      out.push(m[1]);
    }
    if (out.length === 0) {
      var re2 = /<div class="col-sm-4">([\s\S]*?)(?=<div class="col-sm-4">|$)/gi;
      while ((m = re2.exec(raw)) !== null) {
        out.push(m[1]);
      }
    }
    return out;
  }

  async function extractItems(html) {
    var cards = parseCards(html);
    var items = [];
    var seen = {};
    for (var i = 0; i < cards.length; i++) {
      var inner = cards[i];
      var href = await api.cssAttr(inner, "a.thumbnail", "href") || await api.cssAttr(inner, "a.chart-title", "href") || "";
      var url = abs(href);
      if (!url) continue;
      var slug = slugFromUrl(url);
      if (!slug || seen[url]) continue;
      seen[url] = 1;
      var title = stripHtml(await api.cssText(inner, "a.chart-title") || "");
      if (!title) title = stripHtml(await api.cssText(inner, "h5.media-heading") || "");
      var cover = await api.cssAttr(inner, "img", "src") || "";
      cover = abs(cover);
      items.push({ title: title, coverUrl: cover, detailUrl: url, contentType: "manga" });
    }
    return items;
  }

  async function parseLibraryPage(page) {
    var url = baseUrl + "/manga-list?page=" + page;
    var html = await fetchHtml(url);
    var items = await extractItems(html);
    var hasMore = items.length > 0 && page < 15;
    return { items: items, hasMore: hasMore, lastFetchedPage: page };
  }

  async function search(query) {
    var url = baseUrl + "/?s=" + encodeURIComponent(query) + "&post_type=wp-manga";
    var html = await fetchHtml(url);
    return await extractItems(html);
  }

  async function getDetails(url) {
    var html = await fetchHtml(url);
    var title = stripHtml(await api.cssText(html, "div.panel-heading") || "");
    if (!title) title = stripHtml(await api.cssText(html, "h1") || "");
    var cover = await api.cssAttr(html, "div.boxed img", "src") || "";
    cover = abs(cover);
    var desc = await api.cssAttr(html, "meta[name='description']", "content") || "";
    desc = stripHtml(desc);
    var genreEls = await api.cssAll(html, "a[href*='/manga-list/category/']");
    var genres = [];
    for (var i = 0; i < genreEls.length; i++) {
      var g = stripHtml((genreEls[i] || {}).text || "");
      if (g) genres.push(g);
    }
    var authorEl = await api.cssAll(html, "a[href*='/manga-list/author/']");
    var author = authorEl.length > 0 ? stripHtml((authorEl[0] || {}).text || "") : "";
    var status = stripHtml(await api.cssText(html, "span.label") || "");
    return {
      title: title,
      coverUrl: cover,
      description: desc,
      genres: genres,
      author: author,
      status: status
    };
  }

  async function getChapters(url) {
    var html = await fetchHtml(url);
    var items = await api.cssAll(html, "ul.chapters li");
    var out = [];
    var seen = {};
    for (var i = 0; i < items.length; i++) {
      var it = items[i] || {};
      var inner = it.html || "";
      var href = await api.cssAttr(inner, "h5 a", "href") || "";
      var curl = abs(href);
      if (!curl || seen[curl]) continue;
      seen[curl] = 1;
      var linkText = stripHtml(await api.cssText(inner, "h5 a") || "");
      var nm = linkText.match(/(\d+)/);
      var num = nm ? parseInt(nm[1], 10) : 0;
      if (!num || isNaN(num)) num = 0;
      var date = stripHtml(await api.cssText(inner, "div.date-chapter-title-rtl") || "");
      out.push({ number: num, title: linkText, url: curl, date: date });
    }
    out.sort(function (a, b) { return b.number - a.number; });
    return out;
  }

  async function getChapterContent(url) {
    var html = await fetchHtml(url);
    var title = stripHtml(await api.cssText(html, "h1") || "");
    var images = await api.cssAll(html, "div.viewer-cnt img.img-responsive");
    var pages = [];
    for (var i = 0; i < images.length; i++) {
      var el = images[i] || {};
      var src = el.attrs && el.attrs["data-src"] ? el.attrs["data-src"] : "";
      if (!src) src = await api.cssAttr(el.html || "", "data-src") || "";
      src = abs(src);
      if (src) pages.push(src);
    }
    if (pages.length === 0) {
      var allImgs = await api.cssAll(html, "div.viewer-cnt img");
      for (var j = 0; j < allImgs.length; j++) {
        var el2 = allImgs[j] || {};
        var s = el2.attrs && el2.attrs["src"] ? el2.attrs["src"] : "";
        if (!s) s = await api.cssAttr(el2.html || "", "src") || "";
        s = abs(s);
        if (s && s.indexOf("data:image") !== 0) pages.push(s);
      }
    }
    return { title: title, kind: "images", pages: pages };
  }

  return {
    requiresCloudflare: false,

    async getHomepageManga(args) {
      var page = (args && args.page) || 1;
      if (page < 1) page = 1;
      try {
        return await parseLibraryPage(page);
      } catch (e) {
        return { items: [], hasMore: false, lastFetchedPage: page };
      }
    },

    async search(args) {
      var q = ((args && args.query) || "").trim();
      if (!q) return [];
      try {
        return await search(q);
      } catch (e) {
        return [];
      }
    },

    async getFilteredManga(args) {
      var genre = ((args && args.genre) || "").trim();
      var page = (args && args.page) || 1;
      if (page < 1) page = 1;
      try {
        var url = baseUrl + "/manga-list/category/" + encodeURIComponent(genre) + "?page=" + page;
        var html = await fetchHtml(url);
        return await extractItems(html);
      } catch (e) {
        return [];
      }
    },

    async getMangaDetails(args) {
      var url = abs((args && args.url) || "");
      var slug = slugFromUrl(url);
      if (!slug) throw new Error("bad manga url");
      try {
        var details = await getDetails(url);
        var chapters = await getChapters(url);
        return {
          title: details.title,
          coverUrl: details.coverUrl,
          description: details.description,
          genres: details.genres,
          chapters: chapters,
          originalUrl: url,
          hasMoreChapters: false,
          lastFetchedPage: chapters.length,
          contentType: "manga"
        };
      } catch (e) {
        throw e;
      }
    },

    async fetchMoreChapters(args) {
      return null;
    },

    async getChapterPages(args) {
      return [];
    },

    async getChapterContent(args) {
      var url = abs((args && args.url) || "");
      if (!url || url.indexOf("/manga/") === -1) {
        return { kind: "images", chapterTitle: "", pages: [] };
      }
      try {
        return await getChapterContent(url);
      } catch (e) {
        return { kind: "images", chapterTitle: "", pages: [] };
      }
    },

    async getGenresAndTypes() {
      return { genres: GENRES, types: ["manga"] };
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

if (typeof module !== "undefined" && module.exports) {
  module.exports = { createSource };
}
