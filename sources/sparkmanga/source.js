function createSource(api, config) {
  var baseUrl = (config && config.base_url) || "https://sparkmanga.net";
  var selectors = (config && config.selectors) || {};

  var userAgent = (config && config.user_agent) || "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
  var defaultHeaders = {
    "User-Agent": userAgent,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9,ar;q=0.8",
    "Referer": baseUrl + "/",
    "Origin": baseUrl,
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "same-origin",
    "Upgrade-Insecure-Requests": "1"
  };

  var lastChapterUrl = baseUrl + "/";
  var defaultGenres = [
    "اكشن", "مغامرة", "فانتازا", "دراما", "رومانسي", "كوميدي", "شونين",
    "رعب", "خارق للطبيعة", "نفسي", "غموض", "حياة مدرسية", "تاريخي",
    "نظام", "جنس", "ايتشي", "ميكا", "رياضة"
  ];
  var defaultTypes = ["manga", "manhwa", "manhua"];

  function sel(key, fallback) {
    return selectors[key] || fallback;
  }

  async function fetchHtml(url, extraHeaders, method) {
    var headers = {};
    for (var k in defaultHeaders) headers[k] = defaultHeaders[k];
    if (extraHeaders) for (var x in extraHeaders) headers[x] = extraHeaders[x];
    if (api.http) {
      var res = await api.http(url, { method: method || "GET", headers: headers });
      if (!res || !res.ok) throw new Error("HTTP " + (res ? res.status : 0) + " for " + url);
      return res.body || "";
    }
    if (method && method !== "GET") return "";
    var html = await api.fetchText(url, headers);
    if (!html) throw new Error("Empty response: " + url);
    return html;
  }

  function makeAbsolute(url) {
    if (!url) return "";
    if (url.indexOf("http") === 0) return url;
    if (url.indexOf("//") === 0) return "https:" + url;
    if (url.indexOf("/") === 0) return baseUrl + url;
    return baseUrl + "/" + url;
  }

  function extractNumber(url, title) {
    var text = String(url || "") + " " + String(title || "");
    var m = text.match(/(?:chapter|ch|الفصل|فصل)[- _]*(\d+(?:\.\d+)?)/i) || text.match(/(\d+(?:\.\d+)?)/);
    return m ? m[1] : "0";
  }

  function validImage(src) {
    src = makeAbsolute(src);
    if (!src || src.indexOf("data:image") === 0) return "";
    return src;
  }

  function strip(s) {
    return String(s || "")
      .replace(/<br\s*\/?\s*>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, "\"")
      .replace(/&#39;/g, "'")
      .replace(/[\u200B-\u200D\u2060-\u2064\uFEFF\u00AD\u2063]/g, "")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  async function toMangaList(html, listSel, opts) {
    opts = opts || {};
    var items = await api.cssMap(html, listSel, {
      title: { selector: opts.titleSel, type: "text" },
      href: { selector: opts.urlSel || opts.titleSel, type: "attr", attr: "href" },
      cover: { selector: opts.coverSel, type: "attr", attr: "src" },
      coverLazy: { selector: opts.coverSel, type: "attr", attr: "data-src" },
      coverSrc: { selector: opts.coverSel, type: "attr", attr: "data-lazy-src" }
    });
    var results = [];
    var seen = {};
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var title = (item.title || "").trim();
      var detailUrl = makeAbsolute(item.href || "");
      if (!title || !detailUrl || seen[detailUrl]) continue;
      seen[detailUrl] = true;
      var cover = item.cover || item.coverLazy || item.coverSrc || "";
      cover = validImage(cover);
      results.push({ title: title, detailUrl: detailUrl, coverUrl: cover, contentType: "manga" });
    }
    return results;
  }

  async function extractChapters(html) {
    var listSel = sel("chapter_list", ".wp-manga-chapter, li.wp-manga-chapter");
    var dateSel = sel("chapter_date", ".chapter-release-date i, .chapter-release-date");
    var lockSel = sel("chapter_locked", ".premium-chapter, .c-premium, .fa-lock, .premium-block");
    var items = await api.cssMap(html, listSel, {
      title: { selector: "a", type: "text" },
      href: { selector: "a", type: "attr", attr: "href" },
      date: { selector: dateSel, type: "text" },
      locked: { selector: lockSel, type: "html" }
    });
    var chapters = [];
    var seen = {};
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var chapterUrl = makeAbsolute(item.href || "");
      if (!chapterUrl || seen[chapterUrl]) continue;
      seen[chapterUrl] = true;
      var title = (item.title || "").trim();
      chapters.push({
        number: extractNumber(chapterUrl, title),
        title: title,
        views: 0,
        url: chapterUrl,
        isLocked: !!(item.locked && item.locked.trim()),
        date: (item.date || "").trim()
      });
    }
    return chapters;
  }

  return {
    requiresCloudflare: true,

    async getHomepageManga(args) {
      try {
        var page = (args && args.page) || 1;
        var url = page === 1
          ? baseUrl + "/manga/?m_orderby=latest"
          : baseUrl + "/manga/page/" + page + "/?m_orderby=latest";
        return await toMangaList(await fetchHtml(url), sel("homepage_list", ".page-item-detail"), {
          titleSel: sel("homepage_title", ".post-title a"),
          coverSel: sel("homepage_cover", ".item-thumb img"),
          urlSel: sel("homepage_url", ".item-thumb a, .post-title a")
        });
      } catch (e) {
        return [];
      }
    },

    async search(args) {
      try {
        var query = (args && args.query) || "";
        var page = (args && args.page) || 1;
        if (!query.trim()) return [];
        var url = page === 1
          ? baseUrl + "/?s=" + encodeURIComponent(query) + "&post_type=wp-manga"
          : baseUrl + "/page/" + page + "/?s=" + encodeURIComponent(query) + "&post_type=wp-manga";
        var html = await fetchHtml(url);
        return await toMangaList(html, sel("search_list", ".c-tabs-item__content"), {
          titleSel: sel("search_title", ".post-title a"),
          coverSel: sel("search_cover", ".tab-thumb img, .item-thumb img"),
          urlSel: sel("search_url", ".post-title a")
        });
      } catch (e) {
        return [];
      }
    },

    async getFilteredManga(args) {
      try {
        var page = (args && args.page) || 1;
        var url;
        if (args && args.genre) {
          var genreSlug = String(args.genre).toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9\u0621-\u064a-]+/g, "");
          url = page === 1
            ? baseUrl + "/genre/" + encodeURIComponent(genreSlug) + "/"
            : baseUrl + "/genre/" + encodeURIComponent(genreSlug) + "/page/" + page + "/";
        } else {
          var params = ["m_orderby=latest"];
          if (args && args.type) params.push("type=" + encodeURIComponent(args.type));
          url = page === 1
            ? baseUrl + "/manga/?" + params.join("&")
            : baseUrl + "/manga/page/" + page + "/?" + params.join("&");
        }
        return await toMangaList(await fetchHtml(url), sel("filter_list", ".page-item-detail"), {
          titleSel: sel("filter_title", ".post-title a"),
          coverSel: sel("filter_cover", ".item-thumb img"),
          urlSel: sel("filter_url", ".item-thumb a, .post-title a")
        });
      } catch (e) {
        return await this.getHomepageManga(args);
      }
    },

    async getGenresAndTypes() {
      return {
        genres: defaultGenres,
        types: defaultTypes
      };
    },

    async getMangaDetails(args) {
      var url = makeAbsolute((args && args.url) || "");
      var pageHtml = await fetchHtml(url);

      var title =
        (await api.cssText(pageHtml, ".post-title h1")) ||
        (await api.cssAttr(pageHtml, "meta[property='og:title']", "content")) ||
        "بدون عنوان";

      var cover =
        (await api.cssAttr(pageHtml, ".summary_image img", "src")) ||
        (await api.cssAttr(pageHtml, ".summary_image img", "data-src")) ||
        (await api.cssAttr(pageHtml, "meta[property='og:image']", "content")) ||
        "";

      var description =
        (await api.cssText(pageHtml, ".summary__content p, .description-summary p")) || "";

      var genres = await api.cssList(pageHtml, ".genres-content a");
      var genresClean = (genres || []).map(function (g) { return strip(g); }).filter(Boolean);

      var bodyClass = (await api.cssAttr(pageHtml, "body", "class")) || "";
      var contentType = "manga";
      if (bodyClass.indexOf("chapter-type-novel") !== -1 ||
          genresClean.some(function (g) { return g.indexOf("رواية") !== -1 || g.indexOf("Novel") !== -1; }) ||
          ((await api.cssText(pageHtml, ".manga-type")) || "").indexOf("رواية") !== -1) {
        contentType = "novel";
      }

      var chapters = await extractChapters(pageHtml);

      return {
        title: strip(title) || "بدون عنوان",
        coverUrl: validImage(cover),
        description: strip(description),
        genres: genresClean,
        chapters: chapters,
        originalUrl: url,
        hasMoreChapters: false,
        lastFetchedPage: 1,
        contentType: contentType
      };
    },

    async getChapterPages(args) {
      var content = await this.getChapterContent(args);
      return content.kind === "image" ? content.imageUrls : [];
    },

    async getChapterContent(args) {
      var url = makeAbsolute((args && args.url) || "");
      lastChapterUrl = url;

      var pageHtml = await fetchHtml(url);

      var bodyClass = (await api.cssAttr(pageHtml, "body", "class")) || "";
      var hasNovelClass = bodyClass.indexOf("chapter-type-novel") !== -1;
      var hasTextLeft = false;
      if (!hasNovelClass) {
        var tl = await api.cssHtml(pageHtml, ".text-left");
        hasTextLeft = !!(tl && tl.trim());
      }
      var isNovel = hasNovelClass || hasTextLeft;

      if (isNovel) {
        var novelSelectors = [".text-left", ".reading-content"];
        var novelHtml = "";
        for (var i = 0; i < novelSelectors.length; i++) {
          novelHtml = await api.cssHtml(pageHtml, novelSelectors[i]);
          if (novelHtml && novelHtml.trim()) break;
        }

        if (novelHtml && novelHtml.trim()) {
          var textContent = novelHtml
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
          var chapterTitle =
            (await api.cssText(pageHtml, ".chapter-title")) ||
            (await api.cssText(pageHtml, "#chapter-heading")) ||
            "";
          return {
            kind: "text",
            chapterTitle: strip(chapterTitle),
            textContent: textContent
          };
        }
      }

      var imgs = await api.cssAll(pageHtml, ".reading-content img, .page-break img, #readerarea img, .wp-manga-chapter-img");
      var urls = [];
      for (var i = 0; i < imgs.length; i++) {
        var a = imgs[i].attrs || {};
        var src = (a["src"] || a["data-src"] || a["data-lazy-src"] || "").trim();
        if (!src) continue;
        src = validImage(src);
        if (src && urls.indexOf(src) === -1) urls.push(src);
      }
      return { kind: "image", imageUrls: urls };
    },

    async fetchMoreChapters() { return null; },

    getImageHeaders(args) {
      return {
        "User-Agent": userAgent,
        Referer: lastChapterUrl || baseUrl + "/",
        Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9,ar;q=0.8",
        "Sec-Fetch-Dest": "image",
        "Sec-Fetch-Mode": "no-cors",
        "Sec-Fetch-Site": "cross-site"
      };
    },

    sanitizeCoverUrl(args) {
      return validImage((args && args.url) || "") || ((args && args.url) || "");
    }
  };
}

if (typeof module !== "undefined") module.exports = { createSource: createSource };
