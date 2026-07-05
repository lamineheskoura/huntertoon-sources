function createSource(api, config) {
  var baseUrl = ((config && config.base_url) || "https://seanovel.org").replace(/\/+$/, "");
  var apiBase = baseUrl + "/api";
  var userAgent = (config && config.user_agent) || "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
  var headers = {
    "User-Agent": userAgent,
    "Accept": "application/json, text/html, */*",
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

  async function fetchJson(url) {
    if (api.http) {
      var res = await api.http(url, { method: "GET", headers: headers });
      if (!res || !res.ok) throw new Error("HTTP " + (res ? res.status : 0) + " for " + url);
      if (res.json) return res.json;
      return JSON.parse(res.body || "[]");
    }
    var text = await api.fetchText(url, headers);
    return JSON.parse(text || "[]");
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
    var m = String(url || "").match(/\/novels\/([^\/?#]+)/);
    return m ? m[1] : "";
  }

  function apiResultToNovel(item) {
    var slug = item.slug || "";
    var title = item.title_ar || item.title_original || slug;
    var cover = slug ? baseUrl + "/api/novel/" + slug + "/cover?type=webp&v=" + (item.cover_version || "") : "";
    return {
      title: title,
      coverUrl: cover,
      detailUrl: baseUrl + "/novels/" + slug,
      contentType: "novel"
    };
  }

  function extractChapterText(pageHtml) {
    var parts = [];
    var re = /\$\\",\\"p\\",\\"(\d+)\\",\{[^}]*?\\"children\\":\\"([^"\\]*)\\"/g;
    var m;
    while ((m = re.exec(pageHtml)) !== null) {
      var text = m[2] || "";
      if (text.trim()) parts.push(text.trim());
    }
    return parts.join("\n\n").trim();
  }

  function generateChapters(slug, start, count) {
    var out = [];
    for (var i = 0; i < count; i++) {
      var num = start + i;
      out.push({
        number: String(num),
        title: "",
        views: 0,
        url: baseUrl + "/novels/" + slug + "/chapters/" + num,
        isLocked: false,
        date: ""
      });
    }
    return out;
  }

  var allNovelsCache = null;

  async function fetchAllNovels() {
    if (allNovelsCache) return allNovelsCache;
    var data = await fetchJson(apiBase + "/novels?sort=latest&page=1");
    if (!Array.isArray(data)) data = [];
    allNovelsCache = data;
    return data;
  }

  async function listFromData(data) {
    if (!Array.isArray(data)) return [];
    return data.map(apiResultToNovel);
  }

  return {
    requiresCloudflare: false,

    async getHomepageManga(args) {
      try {
        return await listFromData(await fetchAllNovels());
      } catch (e) {
        return [];
      }
    },

    async search(args) {
      var q = ((args && args.query) || "").trim().toLowerCase();
      if (!q) return [];
      try {
        var data = await fetchAllNovels();
        var results = [];
        for (var i = 0; i < data.length; i++) {
          var title = (data[i].title_ar || data[i].title_original || "").toLowerCase();
          if (title.indexOf(q) !== -1) {
            results.push(apiResultToNovel(data[i]));
          }
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
      if (!slug) throw new Error("Invalid URL: " + url);

      var detail = await fetchJson(apiBase + "/novel/" + slug);
      var cover = baseUrl + "/api/novel/" + slug + "/cover?type=webp&v=" + (detail.cover_version || "");
      var genres = Array.isArray(detail.genres) ? detail.genres : [];
      var totalChapters = detail.chapters_count || 0;
      var description = stripHtml(detail.description || "");

      var batchSize = 20;
      var initialChapters = totalChapters > 0 ? generateChapters(slug, 1, Math.min(batchSize, totalChapters)) : [];
      var hasMore = totalChapters > batchSize;

      return {
        title: detail.title_ar || detail.title_original || slug,
        coverUrl: cover,
        description: description,
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
        var detail = await fetchJson(apiBase + "/novel/" + slug);
        totalChapters = detail.chapters_count || 0;
      } catch (e) {}

      if (!totalChapters || nextPage > totalChapters) return null;

      var remaining = totalChapters - nextPage + 1;
      var batch = Math.min(batchSize, remaining);
      var chapters = generateChapters(slug, nextPage, batch);
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

    async getChapterPages() {
      return [];
    },

    async getChapterContent(args) {
      var url = abs((args && args.url) || "");
      var pageHtml = await fetchHtml(url);

      var chapterTitle = await api.cssAttr(pageHtml, "meta[property='og:title']", "content") || await api.cssText(pageHtml, "title") || "";
      var textContent = extractChapterText(pageHtml);

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
