function createSource(api, config) {
  var baseUrl = ((config && config.base_url) || "https://hizomanga.net").replace(/\/+$/, "");
  var userAgent =
    (config && config.user_agent) ||
    "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
  var lastChapterUrl = baseUrl + "/";
  var headers = {
    "User-Agent": userAgent,
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "ar,en-US;q=0.9,en;q=0.8",
    Referer: baseUrl + "/"
  };

  function abs(url) {
    if (!url) return "";
    url = String(url).replace(/&/g, "&").trim();
    if (url.indexOf("//") === 0) return "https:" + url;
    if (url.indexOf("http://") === 0) return "https://" + url.substring(7);
    if (url.indexOf("https://") === 0) return url;
    if (url.charAt(0) === "/") return baseUrl + url;
    return baseUrl + "/" + url;
  }

  async function html(url) {
    if (api.http) {
      var res = await api.http(url, { method: "GET", headers: headers });
      if (!res || !res.ok) throw new Error("HTTP " + (res ? res.status : 0) + " for " + url);
      return res.body || "";
    }
    return (await api.fetchText(url, headers)) || "";
  }

  async function postHtml(url) {
    if (api.http) {
      var res = await api.http(url, { method: "POST", headers: headers, body: null });
      if (!res || !res.ok) throw new Error("HTTP " + (res ? res.status : 0) + " for " + url);
      return res.body || "";
    }
    return (await api.fetchText(url, headers)) || "";
  }

  function strip(s) {
    return String(s || "")
      .replace(/<br\s*\/?\s*>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&/g, "&")
      .replace(/"/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/[\u200B-\u200D\u2060-\u2064\uFEFF\u00AD\u2063]/g, "")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  // Convert innerHtml to readable text (preserving paragraph breaks)
  function htmlToText(htmlContent) {
    return String(htmlContent || "")
      .replace(/<br\s*\/?\s*>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<\/div>/gi, "\n")
      .replace(/<p[^>]*>/gi, "")
      .replace(/<div[^>]*>/gi, "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&/g, "&")
      .replace(/"/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/[\u200B-\u200D\u2060-\u2064\uFEFF\u00AD\u2063]/g, "")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function validImage(src) {
    src = abs(src);
    var lower = src.toLowerCase();
    if (!src || lower.indexOf("data:") === 0 || lower.indexOf(".svg") !== -1) return "";
    if (lower.indexOf(".gif") !== -1 && lower.indexOf("icon") !== -1) return "";
    return src;
  }

  function isNovelMarker(text) {
    text = String(text || "").toLowerCase();
    return text.indexOf("novel") !== -1 || text.indexOf("رواية") !== -1;
  }

  // ────────────────── Homepage ──────────────────

  async function listCards(pageHtml, selector) {
    var cards = await api.cssAll(pageHtml, selector || ".page-item-detail, .page-listing-item .row > div");
    var out = [];
    var seen = {};
    for (var i = 0; i < cards.length; i++) {
      var c = cards[i] || {};
      var h = c.html || "";

      var href =
        (await api.cssAttr(h, ".item-thumb a, .post-title a", "href")) ||
        (await api.cssAttr(h, "a", "href")) ||
        (c.attrs && c.attrs.href) ||
        "";
      var detail = abs(href);
      if (!detail || seen[detail]) continue;
      seen[detail] = true;

      var title =
        (await api.cssText(h, ".item-summary .post-title a, .post-title h3 a, .post-title a")) ||
        (await api.cssText(h, "a")) ||
        (await api.cssAttr(h, "img", "alt")) ||
        c.text ||
        "";
      title = strip(title);

      var cover =
        (await api.cssAttr(h, ".item-thumb img", "src")) ||
        (await api.cssAttr(h, ".item-thumb img", "data-src")) ||
        (await api.cssAttr(h, "img", "src")) ||
        "";

      var contentType = "manga";
      var cardText = (c.text || "").toLowerCase();
      if (cardText.indexOf("chapter-type-novel") !== -1 ||
          (await api.cssText(h, ".manga-type")) === "رواية" ||
          isNovelMarker(cardText)) {
        contentType = "novel";
      }

      if (title && detail) {
        out.push({
          title: title,
          coverUrl: validImage(cover),
          detailUrl: detail,
          contentType: contentType
        });
      }
    }
    return out;
  }

  // ────────────────── Search ──────────────────

  async function searchCards(pageHtml) {
    var cards = await api.cssAll(pageHtml, ".c-tabs-item__content, .page-item-detail");
    var out = [];
    var seen = {};
    for (var i = 0; i < cards.length; i++) {
      var c = cards[i] || {};
      var h = c.html || "";

      var href = (await api.cssAttr(h, ".post-title a", "href")) || (await api.cssAttr(h, "a", "href")) || "";
      var detail = abs(href);
      if (!detail || seen[detail]) continue;
      seen[detail] = true;

      var title = (await api.cssText(h, ".post-title a")) || (await api.cssText(h, "a")) || "";
      title = strip(title);

      var cover =
        (await api.cssAttr(h, ".tab-thumb img", "src")) ||
        (await api.cssAttr(h, ".tab-thumb img", "data-src")) ||
        "";

      var contentType = "manga";
      var cardText = c.text || "";
      if (cardText.indexOf("رواية") !== -1 || cardText.indexOf("Novel") !== -1) {
        contentType = "novel";
      }

      if (title && detail) {
        out.push({
          title: title,
          coverUrl: validImage(cover),
          detailUrl: detail,
          contentType: contentType
        });
      }
    }
    return out;
  }

  // ────────────────── Chapter list ──────────────────

  async function parseChapters(pageHtml) {
    var nodes = await api.cssAll(pageHtml, ".wp-manga-chapter, li.wp-manga-chapter, .chapter-item, #chapterlist li, .eplister li");
    var out = [];
    var seen = {};
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i] || {};
      var h = n.html || "";
      var href = (await api.cssAttr(h, "a", "href")) || (n.attrs && n.attrs.href) || "";
      var url = abs(href);
      if (!url || seen[url]) continue;
      seen[url] = true;

      var text = (await api.cssText(h, "a")) || n.text || "";
      var m = text.match(/\d+(?:\.\d+)?/);
      var num = m ? m[0] : "0";

      var date = (await api.cssText(h, ".chapter-release-date, .chapterdate, .date")) || "";

      out.push({
        number: num,
        title: strip(text),
        views: 0,
        url: url,
        isLocked: /locked|premium|fa-lock/.test(h),
        date: strip(date)
      });
    }
    out.sort(function (a, b) {
      return (parseFloat(b.number) || 0) - (parseFloat(a.number) || 0);
    });
    return out;
  }

  async function fetchChapters(detailUrl) {
    // Strategy 1: AJAX endpoint (Madara standard)
    var ajaxUrl = detailUrl;
    if (ajaxUrl.charAt(ajaxUrl.length - 1) !== "/") ajaxUrl += "/";
    ajaxUrl += "ajax/chapters/";

    try {
      var ajaxHtml = await postHtml(ajaxUrl);
      if (ajaxHtml && ajaxHtml.indexOf("wp-manga-chapter") !== -1) {
        var chapters = await parseChapters(ajaxHtml);
        if (chapters.length) return chapters;
      }
    } catch (e) {
      // fall through
    }

    // Strategy 2: parse the detail page directly
    try {
      var pageHtml = await html(detailUrl);
      return await parseChapters(pageHtml);
    } catch (e) {
      return [];
    }
  }

  // ────────────────── Public API ──────────────────

  return {
    requiresCloudflare: false,

    async getHomepageManga(args) {
      var page = (args && args.page) || 1;
      var url = page === 1
        ? baseUrl + "/releases/"
        : baseUrl + "/releases/page/" + page + "/";
      try {
        return await listCards(await html(url));
      } catch (e) {
        return [];
      }
    },

    async search(args) {
      var q = (args && args.query) || "";
      if (!q.trim()) return [];
      try {
        var pageHtml = await html(baseUrl + "/?s=" + encodeURIComponent(q) + "&post_type=wp-manga");
        return await searchCards(pageHtml);
      } catch (e) {
        return [];
      }
    },

    async getFilteredManga(args) {
      return await this.getHomepageManga(args);
    },

    async getMangaDetails(args) {
      var url = abs((args && args.url) || "");
      var pageHtml = await html(url);

      // Title
      var title =
        (await api.cssText(pageHtml, ".post-title h1")) ||
        (await api.cssAttr(pageHtml, "meta[property='og:title']", "content")) ||
        "بدون عنوان";

      // Cover
      var cover =
        (await api.cssAttr(pageHtml, ".summary_image img", "src")) ||
        (await api.cssAttr(pageHtml, ".summary_image img", "data-src")) ||
        (await api.cssAttr(pageHtml, "meta[property='og:image']", "content")) ||
        "";

      // Description
      var description =
        (await api.cssText(pageHtml, ".summary__content p, .description-summary p")) || "";

      // Genres
      var genres = await api.cssList(pageHtml, ".genres-content a");
      var genresClean = (genres || []).map(function (g) { return strip(g); }).filter(Boolean);

      // Content type detection — matches Dart: body class, genres, manga-type span
      var bodyClass = (await api.cssAttr(pageHtml, "body", "class")) || "";
      var contentType = "manga";
      if (bodyClass.indexOf("chapter-type-novel") !== -1 ||
          genresClean.some(function (g) { return g.indexOf("رواية") !== -1 || g.indexOf("Novel") !== -1; }) ||
          ((await api.cssText(pageHtml, ".manga-type")) || "").indexOf("رواية") !== -1) {
        contentType = "novel";
      }

      var chapters = await fetchChapters(url);

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
      var url = abs((args && args.url) || "");
      lastChapterUrl = url;

      var pageHtml = await html(url);

      // Novel detection — matches Dart:
      // 1. body class contains 'chapter-type-novel'
      // 2. .text-left element exists
      var bodyClass = (await api.cssAttr(pageHtml, "body", "class")) || "";
      var hasNovelClass = bodyClass.indexOf("chapter-type-novel") !== -1;
      var hasTextLeft = false;
      if (!hasNovelClass) {
        var tl = await api.cssHtml(pageHtml, ".text-left");
        hasTextLeft = !!(tl && tl.trim());
      }
      var isNovel = hasNovelClass || hasTextLeft;

      if (isNovel) {
        // Novel extraction — matches Dart:
        // selector: '.text-left, .reading-content'
        // returns innerHtml as TextChapter
        var selectors = [".text-left", ".reading-content"];
        var novelHtml = "";
        for (var i = 0; i < selectors.length; i++) {
          novelHtml = await api.cssHtml(pageHtml, selectors[i]);
          if (novelHtml && novelHtml.trim()) break;
        }

        if (novelHtml && novelHtml.trim()) {
          var textContent = htmlToText(novelHtml);
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

      // Manga logic — matches Dart:
      // selector: '.reading-content img, .page-break img'
      // Skip SVG, icon GIFs, and data: non-image
      var imgs = await api.cssAll(pageHtml, ".reading-content img, .page-break img, #readerarea img, .wp-manga-chapter-img");
      var urls = [];
      for (var i = 0; i < imgs.length; i++) {
        var a = imgs[i].attrs || {};
        var src =
          (a["data-src"] || a["data-lazy-src"] || a.src || "").trim();
        if (!src) continue;
        src = validImage(src);
        if (src && urls.indexOf(src) === -1) urls.push(src);
      }
      return { kind: "image", imageUrls: urls };
    },

    async fetchMoreChapters() { return null; },

    async getGenresAndTypes() { return { genres: [], types: ["manga", "novel"] }; },

    getImageHeaders(args) {
      return {
        "User-Agent": userAgent,
        Referer: lastChapterUrl || baseUrl + "/",
        Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "Accept-Language": "ar,en-US;q=0.9,en;q=0.8",
        "Sec-Fetch-Dest": "image",
        "Sec-Fetch-Mode": "no-cors",
        "Sec-Fetch-Site": "same-origin"
      };
    },

    sanitizeCoverUrl(args) {
      return validImage((args && args.url) || "") || ((args && args.url) || "");
    }
  };
}

if (typeof module !== "undefined") module.exports = { createSource: createSource };
