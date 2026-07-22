function createSource(api, config) {
  var baseUrl = ((config && config.base_url) || "https://www.realmnovel.com").replace(/\/+$/, "");
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
  var searchPagesToScan = 5;

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
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function novelIdFromUrl(url) {
    var m = String(url || "").match(/\/novel\/([^\/?#]+)/);
    return m ? m[1] : "";
  }

  function extractTitleFromAlt(alt) {
    if (!alt) return "";
    var cleaned = alt.replace(/^غلاف\s*رواية\s*/i, "").trim();
    var parts = cleaned.split(" - ");
    return parts[0].trim();
  }

  function extractTitleFromText(text) {
    var lines = text.split("\n").map(function(l) { return l.trim(); }).filter(Boolean);
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (line.indexOf("📖") !== -1) continue;
      if (line.indexOf("♡") !== -1) continue;
      if (line === "مترجمة" || line === "مكتملة" || line === "مستمرة") continue;
      if (line.indexOf("غلاف") !== -1) continue;
      if (line.length > 3 && line.length < 100) return line;
    }
    return "";
  }

  async function parseCards(pageHtml) {
    var links = await api.cssAll(pageHtml, "a[href^='/novel/']");
    var out = [];
    var seen = {};
    for (var i = 0; i < links.length; i++) {
      var link = links[i] || {};
      var href = (link.attrs && link.attrs.href) || "";
      if (!href || href.indexOf("/novel/") === -1) continue;
      var detail = abs(href);
      if (detail === baseUrl + "/novel/" || seen[detail]) continue;
      seen[detail] = true;

      var inner = link.html || "";
      var cover = await api.cssAttr(inner, "img", "src") || "";
      var alt = await api.cssAttr(inner, "img", "alt") || "";

      var title = extractTitleFromAlt(alt);
      if (!title) title = extractTitleFromText(stripHtml(inner));
      if (!title) continue;

      out.push({
        title: title,
        coverUrl: abs(cover),
        detailUrl: detail,
        contentType: "novel"
      });
    }
    return out;
  }

  return {
    requiresCloudflare: false,

    async getHomepageManga(args) {
      try {
        var page = (args && args.page) || 1;
        var pageHtml = await fetchHtml(baseUrl + (page > 1 ? "/?page=" + page : "/"));
        return await parseCards(pageHtml);
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
          var pageHtml = await fetchHtml(baseUrl + (p > 1 ? "/?page=" + p : "/"));
          var links = await api.cssAll(pageHtml, "a[href^='/novel/']");
          for (var i = 0; i < links.length; i++) {
            var link = links[i] || {};
            var href = (link.attrs && link.attrs.href) || "";
            if (!href || href.indexOf("/novel/") === -1) continue;
            var detail = abs(href);
            if (detail === baseUrl + "/novel/" || seen[detail]) continue;

            var inner = link.html || "";
            var alt = await api.cssAttr(inner, "img", "alt") || "";
            var title = extractTitleFromAlt(alt);
            if (!title) title = extractTitleFromText(stripHtml(inner));
            if (!title) continue;
            if (title.toLowerCase().indexOf(q) === -1) continue;

            seen[detail] = true;
            results.push({ title: title, coverUrl: "", detailUrl: detail, contentType: "novel" });
          }
        }
        return results;
      } catch (e) {
        return [];
      }
    },

    async getFilteredManga(args) {
      try {
        var page = (args && args.page) || 1;
        var tag = (args && args.genre) || "";
        var url = baseUrl;
        if (tag) {
          url += "/?tag=" + encodeURIComponent(tag) + (page > 1 ? "&page=" + page : "");
        } else {
          url += page > 1 ? "/?page=" + page : "/";
        }
        var pageHtml = await fetchHtml(url);
        return await parseCards(pageHtml);
      } catch (e) {
        return [];
      }
    },

    async getMangaDetails(args) {
      var url = abs((args && args.url) || "");
      var novelId = novelIdFromUrl(url);
      var pageHtml = await fetchHtml(url);

      var title = await api.cssText(pageHtml, "h1") || novelId;
      var englishTitle = await api.cssText(pageHtml, "h2") || "";
      var cover = await api.cssAttr(pageHtml, "img[src*='/img/novel/']", "src") || "";
      if (!cover) cover = await api.cssAttr(pageHtml, "meta[property='og:image']", "content") || "";

      var allPs = await api.cssAll(pageHtml, "p");
      var description = "";
      for (var dp = 0; dp < allPs.length; dp++) {
        var pt = (allPs[dp].text || "").trim();
        if (pt.indexOf("الوصف") !== -1 || pt.indexOf("وصف") !== -1) {
          description = pt.replace(/^[^:]*:\s*/i, "").trim();
          break;
        }
      }
      if (!description && allPs.length > 0) {
        for (var dp2 = 0; dp2 < allPs.length && dp2 < 5; dp2++) {
          var pt2 = (allPs[dp2].text || "").trim();
          if (pt2.length > 60) { description = pt2; break; }
        }
      }

      var genreNodes = await api.cssAll(pageHtml, "a[href^='/?tag=']");
      var genres = [];
      for (var g = 0; g < genreNodes.length; g++) {
        var gn = (genreNodes[g].text || "").trim();
        if (gn) genres.push(gn);
      }

      var chLinks = await api.cssAll(pageHtml, "a[href*='/chapter/']");
      var chapters = [];
      var chSeen = {};
      for (var c = 0; c < chLinks.length; c++) {
        var ch = chLinks[c] || {};
        var chHref = (ch.attrs && ch.attrs.href) || "";
        if (!chHref || chHref.indexOf("/chapter/") === -1) continue;
        if (!novelId || chHref.indexOf(novelId) === -1) continue;
        var chUrl = abs(chHref);
        if (chSeen[chUrl]) continue;
        chSeen[chUrl] = true;

        var chText = stripHtml(ch.html || ch.text || "");
        var numMatch = chHref.match(/\/chapter\/(\d+)/);
        var chNum = numMatch ? numMatch[1] : String(c + 1);

        var chTitle = chText.replace(/^الفصل\s+\d+\s*[-–—]?\s*/i, "").trim();
        chTitle = chTitle.replace(/🔒/g, "").trim();
        chTitle = chTitle.replace(/اقرأ$/i, "").trim();

        chapters.push({
          number: chNum,
          title: chTitle || chNum,
          views: 0,
          url: chUrl,
          isLocked: chText.indexOf("🔒") !== -1,
          date: ""
        });
      }

      var fullTitle = title;
      if (englishTitle) fullTitle = title + " (" + englishTitle + ")";

      return {
        title: fullTitle,
        coverUrl: abs(cover),
        description: stripHtml(description),
        genres: genres,
        chapters: chapters,
        originalUrl: url,
        hasMoreChapters: false,
        lastFetchedPage: 1,
        contentType: "novel"
      };
    },

    async getChapterPages(args) {
      return [];
    },

    async getChapterContent(args) {
      var url = abs((args && args.url) || "");
      var pageHtml = await fetchHtml(url);

      var chapterTitle = await api.cssText(pageHtml, "h1") || "";
      var parts = [];

      var contentSelectors = ["div.content p", "main p", "article p", ".chapter-content p", "#content p"];
      for (var s = 0; s < contentSelectors.length; s++) {
        try {
          var nodes = await api.cssAll(pageHtml, contentSelectors[s]);
          if (nodes && nodes.length > 3) {
            for (var n = 0; n < nodes.length; n++) {
              var t = stripHtml(nodes[n].html || nodes[n].text || "");
              if (t && t.length > 10) parts.push(t);
            }
            if (parts.length > 0) break;
          }
        } catch (e) {}
      }

      if (parts.length < 3) {
        var allP = await api.cssAll(pageHtml, "p");
        var started = false;
        for (var ap = 0; ap < allP.length; ap++) {
          var aText = stripHtml(allP[ap].html || allP[ap].text || "");
          if (!aText) continue;
          if (!started && aText.length > 10) started = true;
          if (started) {
            if (aText.indexOf("نهاية الفصل") !== -1 || aText.indexOf("تابع القراءة") !== -1) break;
            if (aText.length > 10 || (parts.length > 0 && aText.length > 0)) parts.push(aText);
          }
        }
      }

      var chapterText = parts.join("\n\n");

      if (!chapterText) {
        var bodyText = stripHtml(await api.cssHtml(pageHtml, "body") || "");
        if (bodyText && bodyText.length > 100) {
          var idx = bodyText.indexOf("\n\n");
          if (idx > 0) chapterText = bodyText.substring(idx);
          else chapterText = bodyText;
        }
      }

      return {
        kind: "text",
        chapterTitle: stripHtml(chapterTitle),
        textContent: chapterText
      };
    },

    async getGenresAndTypes() {
      return { genres: [], types: ["novel"] };
    },

    async fetchMoreChapters() {
      return null;
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
