function createSource(api, config) {
  var baseUrl = ((config && config.base_url) || "https://sunovels.com").replace(/\/+$/, "");
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
  var searchPagesToScan = 3;

  function abs(url) {
    if (!url) return "";
    url = String(url).replace(/&amp;/g, "&").trim();
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

  function extractChapterCount(pageHtml) {
    var m = String(pageHtml || "").match(/"numberOfPages"\s*:\s*(\d+)/);
    if (m && m[1]) return parseInt(m[1], 10);
    return 0;
  }

  async function listFromLibrary(pageHtml) {
    var items = await api.cssAll(pageHtml, "li.list-item a[href^='/novel/']");
    var out = [];
    var seen = {};
    for (var i = 0; i < items.length; i++) {
      var item = items[i] || {};
      var inner = item.html || "";
      var href = (item.attrs && item.attrs.href) || "";
      if (!href || href.indexOf("/novel/") === -1) continue;
      var detail = abs(href);
      if (detail === baseUrl + "/novel/" || seen[detail]) continue;
      seen[detail] = true;
      var title = await api.cssText(inner, "h4") || "";
      if (!title) continue;
      out.push({
        title: stripHtml(title),
        coverUrl: "",
        detailUrl: detail,
        contentType: "novel"
      });
    }
    return out;
  }

  function extractRscCovers(pageHtml) {
    var covers = {};
    try {
      var scriptTexts = pageHtml.match(/self\.__next_f\.push\(\[1,"(?:[^"\\]|\\.)*"\]\)/g) || [];
      var fullData = "";
      for (var s = 0; s < scriptTexts.length; s++) {
        var m = scriptTexts[s];
        try {
          var parsed = JSON.parse("[" + m.substring(m.indexOf('"')) );
        } catch (e) {
          var extracted = m.match(/\[1,"(.*)"\]\)/);
          if (extracted && extracted[1]) fullData += extracted[1];
        }
      }
      var slugImgMatches = fullData.match(/"href":"\/novel\/([^"]+)"[^}]+?"src":"\/uploads\/([^"]+)"/g) || [];
      for (var j = 0; j < slugImgMatches.length; j++) {
        var sm = slugImgMatches[j].match(/"href":"\/novel\/([^"]+)"[^}]+?"src":"\/uploads\/([^"]+)"/);
        if (sm) covers[sm[1]] = abs("/uploads/" + sm[2]);
      }
    } catch (e) {}
    return covers;
  }

  async function generateChapters(slug, start, count) {
    var out = [];
    for (var i = 0; i < count; i++) {
      var num = start + i;
      out.push({
        number: String(num),
        title: "",
        views: 0,
        url: baseUrl + "/novel/" + slug + "/" + num,
        isLocked: false,
        date: ""
      });
    }
    return out;
  }

  async function extractChapterText(pageHtml) {
    var nodes = await api.cssAll(pageHtml, "div.chapter-content > p");
    var parts = [];
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i] || {};
      var attrs = node.attrs || {};
      if ((attrs.class || "").indexOf("d-none") !== -1) continue;
      var text = node.text || "";
      if (!text.trim()) continue;
      parts.push(text.trim());
    }
    if (!parts.length) {
      var container = await api.cssHtml(pageHtml, ".chapter-content") || "";
      parts.push(stripHtml(container));
    }
    return parts.join("\n\n").trim();
  }

  return {
    requiresCloudflare: false,

    async getHomepageManga(args) {
      var page = (args && args.page) || 1;
      try {
        var pageHtml = await fetchHtml(baseUrl + "/library" + (page > 1 ? "?page=" + page : ""));
        var novels = await listFromLibrary(pageHtml);
        var rscCovers = extractRscCovers(pageHtml);
        for (var i = 0; i < novels.length; i++) {
          var slug = slugFromUrl(novels[i].detailUrl);
          if (rscCovers[slug]) novels[i].coverUrl = rscCovers[slug];
        }
        return novels;
      } catch (e) {
        return [];
      }
    },

    async search(args) {
      var q = ((args && args.query) || "").trim().toLowerCase();
      if (!q) return [];
      try {
        var seen = {};
        var results = [];
        for (var p = 1; p <= searchPagesToScan; p++) {
          var pageHtml = await fetchHtml(baseUrl + "/library" + (p > 1 ? "?page=" + p : ""));
          var items = await api.cssAll(pageHtml, "li.list-item a[href^='/novel/']");
          for (var i = 0; i < items.length; i++) {
            var item = items[i] || {};
            var inner = item.html || "";
            var href = (item.attrs && item.attrs.href) || "";
            if (!href || href.indexOf("/novel/") === -1) continue;
            var detail = abs(href);
            if (detail === baseUrl + "/novel/" || seen[detail]) continue;
            var title = stripHtml(await api.cssText(inner, "h4") || "");
            if (!title || title.toLowerCase().indexOf(q) === -1) continue;
            seen[detail] = true;
            results.push({ title: title, coverUrl: "", detailUrl: detail, contentType: "novel" });
          }
        }
        var rscCovers = {};
        for (var p2 = 1; p2 <= searchPagesToScan; p2++) {
          try {
            var ph = await fetchHtml(baseUrl + "/library" + (p2 > 1 ? "?page=" + p2 : ""));
            var cv = extractRscCovers(ph);
            for (var k in cv) rscCovers[k] = cv[k];
          } catch (e) {}
        }
        for (var j = 0; j < results.length; j++) {
          var slug = slugFromUrl(results[j].detailUrl);
          if (rscCovers[slug]) results[j].coverUrl = rscCovers[slug];
        }
        return results;
      } catch (e) {
        return [];
      }
    },

    async getFilteredManga(args) {
      return await this.getHomepageManga(args);
    },

    async getMangaDetails(args) {
      var url = abs((args && args.url) || "");
      var slug = slugFromUrl(url);
      var pageHtml = await fetchHtml(url);

      var title = await api.cssText(pageHtml, "div.main-head h1") || await api.cssAttr(pageHtml, "meta[property='og:title']", "content") || slug;
      var cover = await api.cssAttr(pageHtml, "figure.cover img", "src") || await api.cssAttr(pageHtml, "meta[property='og:image']", "content") || "";
      var arabicTitle = await api.cssText(pageHtml, "div.main-head h3") || "";

      var descP = await api.cssAll(pageHtml, "section.info-section div.description p");
      var description = "";
      for (var i = 0; i < descP.length; i++) {
        var d = stripHtml(descP[i].text || "");
        if (d && d.length > 50) { description = d; break; }
      }
      if (!description) description = await api.cssAttr(pageHtml, "meta[name='description']", "content") || "";

      var genreNodes = await api.cssAll(pageHtml, "div.categories li.tag a");
      var genres = [];
      for (var j = 0; j < genreNodes.length; j++) {
        var g = (genreNodes[j].text || "").trim();
        if (g) genres.push(g);
      }

      var totalChapters = extractChapterCount(pageHtml);
      if (!totalChapters) {
        var statText = await api.cssText(pageHtml, "div.header-stats span:first-child strong") || "";
        totalChapters = parseInt(statText.trim(), 10) || 0;
      }

      var batchSize = 20;
      var initialChapters = totalChapters > 0 ? await generateChapters(slug, 1, Math.min(batchSize, totalChapters)) : [];
      var hasMore = totalChapters > batchSize;

      return {
        title: stripHtml(title) + (arabicTitle ? " (" + stripHtml(arabicTitle) + ")" : ""),
        coverUrl: abs(cover),
        description: stripHtml(description),
        genres: genres,
        chapters: initialChapters,
        originalUrl: url,
        hasMoreChapters: hasMore,
        lastFetchedPage: batchSize,
        contentType: "novel"
      };
    },

    async fetchMoreChapters(args) {
      var url = abs((args && args.url) || "");
      var slug = slugFromUrl(url);
      var nextPage = (args && args.nextPage) || 21;
      var batchSize = 50;
      var totalChapters = 0;

      try {
        var pageHtml = await fetchHtml(url);
        totalChapters = extractChapterCount(pageHtml);
        if (!totalChapters) {
          var statText = await api.cssText(pageHtml, "div.header-stats span:first-child strong") || "";
          totalChapters = parseInt(statText.trim(), 10) || 0;
        }
      } catch (e) {}

      if (!totalChapters || nextPage > totalChapters) return null;

      var remaining = totalChapters - nextPage + 1;
      var batch = Math.min(batchSize, remaining);
      var chapters = await generateChapters(slug, nextPage, batch);
      if (!chapters.length) return null;

      var newNextPage = nextPage + batch;
      return {
        title: "", coverUrl: "", description: "", genres: [],
        chapters: chapters, originalUrl: url,
        hasMoreChapters: newNextPage <= totalChapters,
        lastFetchedPage: newNextPage - 1,
        contentType: "novel"
      };
    },

    async getChapterPages(args) {
      return [];
    },

    async getChapterContent(args) {
      var url = abs((args && args.url) || "");
      var pageHtml = await fetchHtml(url);

      var chapterTitle = await api.cssAttr(pageHtml, "meta[property='og:title']", "content") || await api.cssText(pageHtml, "title") || "";
      var textContent = await extractChapterText(pageHtml);

      if (!textContent) {
        var bodyText = stripHtml(await api.cssHtml(pageHtml, "body") || "");
        if (bodyText && bodyText.length > 100) {
          textContent = bodyText;
        }
      }

      return {
        kind: "text",
        chapterTitle: stripHtml(chapterTitle),
        textContent: textContent
      };
    },

    async getGenresAndTypes() {
      return { genres: [], types: ["novel"] };
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
