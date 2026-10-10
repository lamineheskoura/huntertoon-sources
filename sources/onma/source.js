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
  var GENRES = [
    { name: "أكشن", slug: "action" },
    { name: "مغامرات", slug: "adventure" },
    { name: "كوميديا", slug: "comedy" },
    { name: "دراما", slug: "drama" },
    { name: "خيال", slug: "fantasy" },
    { name: "فنون قتال", slug: "martial-arts" },
    { name: "غموض", slug: "mystery" },
    { name: "خارق للطبيعة", slug: "supernatural" },
    { name: "شونين", slug: "shounen" },
    { name: "ون شوت", slug: "one-shot" },
    { name: "حياة مدرسية", slug: "school-life" },
    { name: "شريحة من الحياة", slug: "slice-of-life" },
    { name: "رياضة", slug: "sports" }
  ];
  var GENRE_NAMES = [];
  var GENRE_BY_NAME = {};
  for (var gi = 0; gi < GENRES.length; gi++) {
    GENRE_NAMES.push(GENRES[gi].name);
    GENRE_BY_NAME[GENRES[gi].name] = GENRES[gi].slug;
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
      var res = await api.http(url, { method: "GET", headers: headers });
      if (!res || !res.ok) throw new Error("HTTP " + (res ? res.status : 0) + " for " + url);
      return res.body || "";
    }
    return (await api.fetchText(url, headers)) || "";
  }


  function isOnmaUrl(url) {
    return String(url || "").indexOf("onma.top") !== -1;
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

  function safeList(v) {
    return Array.isArray(v) ? v : [];
  }

  async function extractItems(html) {
    var cards = safeList(await api.cssAll(html, "div.chapter-container, div.manga-item"));
    var items = [];
    var seen = {};
    for (var i = 0; i < cards.length; i++) {
      var inner = (cards[i] && cards[i].html) || "";
      if (!inner) continue;
      var href = await api.cssAttr(inner, "a.thumbnail", "href");
      if (!href) href = await api.cssAttr(inner, "h3 a", "href");
      if (!href) href = await api.cssAttr(inner, "a", "href");
      var url = abs(href);
      if (!url) continue;
      var slug = slugFromUrl(url);
      if (!slug || seen[url]) continue;
      seen[url] = 1;
      var title = stripHtml(await api.cssText(inner, "a.chart-title") || "");
      if (!title) title = stripHtml(await api.cssText(inner, "h3 a") || "");
      if (!title) title = stripHtml(await api.cssText(inner, "h5.media-heading") || "");
      if (!title) title = stripHtml((cards[i] && cards[i].text) || "");
      var cover = abs(await api.cssAttr(inner, "img", "src") || "");
      items.push({ title: title, coverUrl: cover, detailUrl: url, contentType: "manga" });
    }
    return items;
  }

  async function extractPageUrls(html) {
    var imgs = safeList(await api.cssAll(html, "div.viewer-cnt img"));
    var pages = [];
    for (var i = 0; i < imgs.length; i++) {
      var attrs = (imgs[i] && imgs[i].attrs) || {};
      var src = String(attrs["data-src"] || attrs["src"] || "");
      src = abs(src);
      if (src) pages.push(src);
    }
    if (pages.length > 1 && pages[pages.length - 1] === pages[0]) pages.pop();
    return pages;
  }

  return {
    requiresCloudflare: false,

    async getHomepageManga(args) {
      var page = (args && args.page) || 1;
      if (page < 1) page = 1;
      try {
        return await extractItems(await fetchHtml(baseUrl + "/manga-list?page=" + page));
      } catch (e) {
        return [];
      }
    },

    async search(args) {
      var q = ((args && args.query) || "").trim();
      if (!q) return [];
      try {
        return await extractItems(await fetchHtml(
          baseUrl + "/?s=" + encodeURIComponent(q) + "&post_type=wp-manga"));
      } catch (e) {
        return [];
      }
    },

    async getFilteredManga(args) {
      var genre = ((args && args.genre) || "").trim();
      var page = (args && args.page) || 1;
      if (page < 1) page = 1;
      try {
        var slug = GENRE_BY_NAME[genre] || "";
        if (!slug) return [];
        return await extractItems(await fetchHtml(
          baseUrl + "/manga-list/category/" + encodeURIComponent(slug) + "?page=" + page));
      } catch (e) {
        return [];
      }
    },

    async getMangaDetails(args) {
      var url = abs((args && args.url) || "");
      var slug = slugFromUrl(url);
      if (!slug || !isOnmaUrl(url)) throw new Error("bad manga url");
      var html = await fetchHtml(url);

      var title = stripHtml(await api.cssText(html, "div.panel-heading") || "");
      if (!title) title = slug;
      var cover = abs(await api.cssAttr(html, "div.boxed img", "src") || "");
      if (!cover) cover = abs(await api.cssAttr(html, "meta[property='og:image']", "content") || "");
      var description = stripHtml(await api.cssAttr(html, "meta[name='description']", "content") || "");

      var genres = [];
      try {
        var gnodes = safeList(await api.cssAll(html, "a[href*='/manga-list/category/']"));
        var gseen = {};
        for (var gi = 0; gi < gnodes.length; gi++) {
          var gt = stripHtml((gnodes[gi] && gnodes[gi].text) || "");
          if (gt && gt.length > 1 && !gseen[gt]) {
            gseen[gt] = true;
            genres.push(gt);
          }
        }
      } catch (e2) {}

      var author = "";
      try {
        var anodes = safeList(await api.cssAll(html, "a[href*='/manga-list/author/']"));
        if (anodes.length > 0) author = stripHtml((anodes[0] && anodes[0].text) || "");
      } catch (e3) {}

      var status = stripHtml(await api.cssText(html, "span.label") || "");

      var chapters = [];
      try {
        var items = safeList(await api.cssAll(html, "ul.chapters li"));
        var seen = {};
        for (var i = 0; i < items.length; i++) {
          var inner = (items[i] && items[i].html) || "";
          if (!inner) continue;
          var href = await api.cssAttr(inner, "h5 a", "href");
          var curl = abs(href);
          if (!curl || seen[curl]) continue;
          seen[curl] = true;
          var linkText = stripHtml(await api.cssText(inner, "h5 a") || "");
          var nm = linkText.match(/(\d+)/);
          var num = nm ? parseInt(nm[1], 10) : 0;
          if (!num || isNaN(num)) num = 0;
          var date = stripHtml(await api.cssText(inner, "div.date-chapter-title-rtl") || "");
          chapters.push({
            number: num,
            title: linkText || ("الفصل " + num),
            views: 0,
            url: curl,
            isLocked: false,
            date: date
          });
        }
        chapters.sort(function (a, b) { return b.number - a.number; });
      } catch (e4) {}

      return {
        title: title,
        coverUrl: cover,
        description: description,
        genres: genres,
        author: author,
        status: status,
        chapters: chapters,
        originalUrl: url,
        hasMoreChapters: false,
        lastFetchedPage: 1,
        contentType: "manga"
      };
    },

    async fetchMoreChapters(args) {
      return null;
    },

    async getChapterPages(args) {
      var url = abs((args && args.url) || "");
      if (!url || !isOnmaUrl(url) || url.indexOf("/manga/") === -1) return [];
      try {
        var html = await fetchHtml(url);
        return await extractPageUrls(html);
      } catch (e) {
        return [];
      }
    },

    async getChapterContent(args) {
      var url = abs((args && args.url) || "");
      if (!url || !isOnmaUrl(url) || url.indexOf("/manga/") === -1) {
        return { kind: "image", imageUrls: [] };
      }
      try {
        var html = await fetchHtml(url);
        var pages = await extractPageUrls(html);
        return { kind: "image", imageUrls: pages };
      } catch (e) {
        return { kind: "image", imageUrls: [] };
      }
    },

    async getGenresAndTypes() {
      return { genres: GENRE_NAMES, types: ["manga"] };
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
