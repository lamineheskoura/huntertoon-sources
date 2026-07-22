function createSource(api, config) {
  var baseUrl = (config && config.base_url) || "http://62.171.141.197:5007";
  var userAgent = (config && config.user_agent) || "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";

  var defaultHeaders = {
    "x-app-version": "10.0.0",
    "User-Agent": userAgent,
    "Accept": "application/json, text/plain, */*"
  };

  var pageLimit = 20;

  function coverUrl(novelId) {
    return "https://realmnovel.com/img/novel/" + novelId + ".jpg";
  }

  function abs(url) {
    if (!url) return "";
    url = String(url).trim();
    if (url.indexOf("http://") === 0 || url.indexOf("https://") === 0) return url;
    if (url.indexOf("//") === 0) return "https:" + url;
    if (url.charAt(0) === "/") return baseUrl + url;
    return baseUrl + "/" + url;
  }

  function strip(s) {
    return String(s || "")
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

  function novelToItem(novel) {
    return {
      title: novel.title || novel.titleEn || "",
      coverUrl: coverUrl(novel._id),
      detailUrl: baseUrl + "/novels/" + novel._id,
      contentType: "novel"
    };
  }

  function chapterToItem(chapter, novelId) {
    return {
      number: String(chapter.chapterNumber),
      title: chapter.title || String(chapter.chapterNumber),
      views: chapter.viewsCount || 0,
      url: baseUrl + "/novels/" + novelId + "/chapters/" + chapter.chapterNumber,
      isLocked: false,
      date: (chapter.createdAt || "").split("T")[0]
    };
  }

  async function apiGet(path) {
    var url = abs(path);
    var res = await api.http(url, {
      method: "GET",
      headers: defaultHeaders
    });
    if (!res || !res.ok) throw new Error("HTTP " + (res ? res.status : 0) + " for " + url);
    return JSON.parse(res.body || "{}");
  }

  return {
    requiresCloudflare: false,

    async getHomepageManga(args) {
      try {
        var page = (args && args.page) || 1;
        var data = await apiGet("/novels?limit=" + pageLimit + "&page=" + page);
        var items = data.data || [];
        return items.map(novelToItem);
      } catch (e) {
        return [];
      }
    },

    async search(args) {
      try {
        var query = ((args && args.query) || "").trim();
        if (!query) return [];
        var data = await apiGet("/novels/search?q=" + encodeURIComponent(query) + "&limit=" + pageLimit);
        var items = data.data || [];
        return items.map(novelToItem);
      } catch (e) {
        return [];
      }
    },

    async getFilteredManga(args) {
      try {
        var page = (args && args.page) || 1;
        var data = await apiGet("/novels?limit=" + pageLimit + "&page=" + page);
        var items = data.data || [];
        return items.map(novelToItem);
      } catch (e) {
        return [];
      }
    },

    async getGenresAndTypes() {
      return { genres: [], types: ["novel"] };
    },

    async getMangaDetails(args) {
      var rawUrl = (args && args.url) || "";
      var novelId = "";
      var m = rawUrl.match(/\/novels\/([a-f0-9]+)/);
      if (m) novelId = m[1];
      if (!novelId && rawUrl) {
        var m2 = rawUrl.match(/\/novel\/([^/?#]+)/);
        if (m2) novelId = m2[1];
      }
      if (!novelId) throw new Error("Novel ID not found in URL: " + rawUrl);

      var data = await apiGet("/novels/" + novelId);
      var novel = data.data || data;
      if (!novel || !novel._id) throw new Error("Novel not found: " + novelId);

      var title = novel.title || novel.titleEn || "بدون عنوان";
      var cover = coverUrl(novelId);
      var desc = novel.description || "";
      var genres = novel.tags || [];
      var status = novel.status || "مستمرة";

      var chapters = [];
      var chPage = 1;
      var chLimit = 100;
      var hasMore = true;
      var maxPages = 100;
      while (hasMore && chPage <= maxPages) {
        var chData = await apiGet("/novels/" + novelId + "/chapters?limit=" + chLimit + "&page=" + chPage);
        var chItems = chData.data || [];
        chapters = chapters.concat(chItems.map(function(c) {
          return chapterToItem(c, novelId);
        }));
        var pag = chData.pagination || {};
        if (pag.hasNextPage) {
          chPage++;
        } else {
          hasMore = false;
        }
      }

      return {
        title: title,
        coverUrl: cover,
        description: strip(desc),
        genres: genres,
        status: status,
        chapters: chapters,
        originalUrl: rawUrl || (baseUrl + "/novels/" + novelId),
        hasMoreChapters: false,
        lastFetchedPage: 1,
        contentType: "novel"
      };
    },

    async getChapterPages(args) {
      return [];
    },

    async getChapterContent(args) {
      var rawUrl = (args && args.url) || "";
      var parts = rawUrl.match(/\/novels\/([a-f0-9]+)\/chapters\/(\d+)/);
      if (!parts) throw new Error("Invalid chapter URL: " + rawUrl);
      var novelId = parts[1];
      var chapterNum = parts[2];

      var data = await apiGet("/novels/" + novelId + "/chapters/" + chapterNum);
      var chapter = data.data || data;
      if (!chapter || !chapter.content) {
        return { kind: "text", chapterTitle: "", textContent: "" };
      }

      var chapterTitle = chapter.title || "الفصل " + chapterNum;
      var chapterText = chapter.content || "";

      return {
        kind: "text",
        chapterTitle: strip(chapterTitle),
        textContent: chapterText
      };
    },

    async fetchMoreChapters() {
      return null;
    },

    getImageHeaders(args) {
      return {
        "User-Agent": userAgent,
        "Referer": "https://realmnovel.com/",
        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8"
      };
    },

    sanitizeCoverUrl(args) {
      var url = (args && args.url) || "";
      var m = url.match(/\/novels\/([a-f0-9]+)/);
      if (m) return coverUrl(m[1]);
      return url;
    }
  };
}

if (typeof module !== "undefined") module.exports = { createSource: createSource };
