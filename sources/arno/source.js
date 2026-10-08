function createSource(api, config) {
  var baseUrl = ((config && config.base_url) || "https://ar-no.com").replace(/\/+$/, "");
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
  var GENRES = ["فنون قتال", "حريم", "رياضي", "دراما", "تاريخي", "جوسي", "رومانسي", "مغامرات", "اتشـي", "شونين", "منتهية", "بالغ", "كوميديا", "سينين", "غموض", "أكشن", "خيال", "حياة مدرسية", "خارق لطبيعي", "شريحة من الحياة", "راشد", "شوجو", "رعب", "ميكا", "تراجدي", "نفسي", "خيال علمي"];

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
    var m = String(url || "").match(/\/novel\/([^\/?#]+)/);
    return m ? m[1] : "";
  }

  function genreSlugFor(name) {
    return String(name || "").trim().replace(/\s+/g, "-");
  }

  async function parseChaptersFromHtml(novelUrl) {
    var pageHtml = await fetchHtml(
      novelUrl.replace(/\/+$/, "") + "/ajax/chapters/?t=1", "POST");
    var items = await api.cssAll(pageHtml, "li.wp-manga-chapter");
    var out = [];
    var seen = {};
    var lastNum = 0;
    for (var i = 0; i < items.length; i++) {
      var it = items[i] || {};
      var inner = it.html || "";
      var href = await api.cssAttr(inner, "a", "href") || "";
      var url = abs(href);
      if (!url || seen[url]) continue;
      var linkText = stripHtml(await api.cssText(inner, "a") || "");
      var nm = linkText.match(/(\d+)/);
      var num = nm ? parseInt(nm[1], 10) : 0;
      if ((!num || isNaN(num)) && lastNum > 1) num = lastNum - 1;
      if (!num || isNaN(num)) continue;
      lastNum = num;
      seen[url] = true;
      var title = linkText.replace(/^\s*\d+\s*[-–:]\s*/, "").trim();
      if (!title) title = "الفصل " + num;
      var date = stripHtml(await api.cssText(inner, ".chapter-release-date") || "");
      out.push({
        number: num,
        title: title,
        views: 0,
        url: url,
        isLocked: false,
        date: date
      });
    }
    out.sort(function (a, b) { return b.number - a.number; });
    return out;
  }

  async function parseNovelCards(pageHtml) {
    var anchors = await api.cssAll(pageHtml, "div.page-item-detail a[href*='/novel/']");
    if (!anchors.length) anchors = await api.cssAll(pageHtml, "a[href*='/novel/']");
    var out = [];
    var seen = {};
    for (var i = 0; i < anchors.length; i++) {
      var a = anchors[i] || {};
      var attrs = a.attrs || {};
      var href = attrs.href || "";
      if (!href || href.indexOf("/novel/") === -1) continue;
      if (/\/novel\/[^\/]+\/.+/.test(href.split("?")[0].split("#")[0])) continue;
      var detail = abs(href);
      if (!detail || seen[detail]) continue;
      var inner = a.html || "";
      var title = stripHtml(await api.cssText(inner, "h3") || "");
      if (!title) title = stripHtml(await api.cssText(inner, "h4") || "");
      if (!title) title = stripHtml(attrs.title || attrs["aria-label"] || "");
      if (!title) {
        var raw = stripHtml(a.text || "");
        if (raw && raw.length > 2) title = raw;
      }
      if (!title) continue;
      seen[detail] = true;
      var cover = "";
      var im = String(inner).match(/<img[^>]+(?:data-src|data-lazy-src|data-original|src)="([^"]+)"/i);
      if (im && im[1] && im[1].indexOf("data:image") !== 0) cover = abs(im[1]);
      out.push({ title: title, coverUrl: cover, detailUrl: detail, contentType: "novel" });
    }
    return out;
  }

  return {
    requiresCloudflare: false,

    async getHomepageManga(args) {
      var page = (args && args.page) || 1;
      if (page < 1) page = 1;
      try {
        var url = baseUrl + "/novels/" + (page > 1 ? "page/" + page + "/" : "");
        return await parseNovelCards(await fetchHtml(url));
      } catch (e) {
        return [];
      }
    },

    async search(args) {
      var q = ((args && args.query) || "").trim();
      if (!q) return [];
      var page = (args && args.page) || 1;
      if (page < 1) page = 1;
      try {
        var url = baseUrl + (page > 1 ? "/page/" + page + "/" : "/") +
          "?s=" + encodeURIComponent(q) + "&post_type=wp-manga";
        return await parseNovelCards(await fetchHtml(url));
      } catch (e) {
        return [];
      }
    },

    async getFilteredManga(args) {
      var genre = ((args && args.genre) || "").trim();
      var page = (args && args.page) || 1;
      if (page < 1) page = 1;
      try {
        var url;
        if (genre) {
          url = baseUrl + "/novel-genre/" + encodeURIComponent(genreSlugFor(genre)) + "/" +
            (page > 1 ? "page/" + page + "/" : "");
        } else {
          url = baseUrl + "/novels/" + (page > 1 ? "page/" + page + "/" : "");
        }
        return await parseNovelCards(await fetchHtml(url));
      } catch (e) {
        return [];
      }
    },

    async getMangaDetails(args) {
      var url = abs((args && args.url) || "");
      var slug = slugFromUrl(url);
      if (!slug) throw new Error("bad novel url");
      var pageHtml = await fetchHtml(url);
      var title = stripHtml(await api.cssText(pageHtml, "h1") || "");
      if (!title) title = slug;
      var cover = abs(await api.cssAttr(pageHtml, ".poster img", "src") ||
        await api.cssAttr(pageHtml, ".summary_image img", "src") ||
        await api.cssAttr(pageHtml, "meta[property='og:image']", "content") || "");
      var description = "";
      try {
        var blocks = await api.cssListHtml(pageHtml, ".summary__content");
        for (var bi = 0; bi < blocks.length; bi++) {
          var bt = stripHtml(blocks[bi] || "");
          if (bt.length > 50 && bt.length > description.length) description = bt;
        }
      } catch (e) {}
      if (!description) {
        description = stripHtml(await api.cssAttr(pageHtml, "meta[property='og:description']", "content") || "");
      }
      var genres = [];
      try {
        var gnodes = await api.cssAll(pageHtml, ".genres-content a");
        var gseen = {};
        for (var gi = 0; gi < gnodes.length; gi++) {
          var ga = (gnodes[gi] && gnodes[gi].attrs) || {};
          var gh = String(ga.href || "");
          if (gh.indexOf("/novel-genre/") === -1) continue;
          var gt = stripHtml((gnodes[gi] || {}).text || "");
          if (gt && gt.length > 1 && !gseen[gt]) {
            gseen[gt] = true;
            genres.push(gt);
          }
        }
      } catch (e2) {}
      var chapters = await parseChaptersFromHtml(url);
      return {
        title: title,
        coverUrl: cover,
        description: description,
        genres: genres,
        chapters: chapters,
        originalUrl: url,
        hasMoreChapters: false,
        lastFetchedPage: chapters.length,
        contentType: "novel"
      };
    },

    async fetchMoreChapters(args) {
      return null;
    },

    async getChapterPages(args) {
      return [];
    },

    async getChapterContent(args) {
      var url = abs((args && args.url) || "");
      if (!url || url.indexOf("/novel/") === -1) {
        return { kind: "text", chapterTitle: "", textContent: "" };
      }
      try {
        var pageHtml = await fetchHtml(url);
        var chapterTitle = stripHtml(await api.cssText(pageHtml, "h1#chapter-heading") || "");
        if (!chapterTitle) chapterTitle = stripHtml(await api.cssText(pageHtml, "h1") || "");
        var parts = [];
        try {
          var nodes = await api.cssAll(pageHtml, "div.reading-content div.text-left p");
          for (var i = 0; i < nodes.length; i++) {
            var t = String((nodes[i] || {}).text || "").trim();
            if (t) parts.push(t);
          }
        } catch (e) {}
        if (parts.length > 1 && chapterTitle && parts[0] === chapterTitle) parts.shift();
        var textContent = parts.join("\n\n").trim();
        if (!textContent) {
          try {
            var surface = await api.cssHtml(pageHtml, "div.reading-content") || "";
            var cleaned = stripHtml(surface);
            if (cleaned.length > 100) textContent = cleaned;
          } catch (e2) {}
        }
        return { kind: "text", chapterTitle: chapterTitle, textContent: textContent };
      } catch (e3) {
        return { kind: "text", chapterTitle: "", textContent: "" };
      }
    },

    async getGenresAndTypes() {
      return { genres: GENRES, types: ["novel"] };
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
