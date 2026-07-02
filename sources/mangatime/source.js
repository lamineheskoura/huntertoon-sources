function createSource(api, config) {
  var baseUrl = ((config && config.base_url) || "https://mangatime.org").replace(/\/+$/, "");
  var userAgent = (config && config.user_agent) || "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";

  var headers = {
    "User-Agent": userAgent,
    "Accept": "application/json, text/html, */*",
    "Accept-Language": "ar,en-US;q=0.9,en;q=0.8",
    "Referer": baseUrl + "/",
    "Origin": baseUrl
  };

  function buildInput(json) {
    return encodeURIComponent(JSON.stringify({ json: json || {} }));
  }

  async function requestText(url) {
    if (api.http) {
      var res = await api.http(url, { method: "GET", headers: headers });
      if (!res || !res.ok) throw new Error("HTTP " + (res ? res.status : 0) + " for " + url);
      return res.body || "";
    }
    var text = await api.fetchText(url, headers);
    if (!text) throw new Error("Empty response: " + url);
    return text;
  }

  async function getJson(url) {
    return JSON.parse(await requestText(url));
  }

  function unwrap(value) {
    if (!value) return value;
    if (value.result && value.result.data) return unwrap(value.result.data);
    if (value.data && value.data.json !== undefined) return unwrap(value.data.json);
    if (value.json !== undefined) return unwrap(value.json);
    return value;
  }

  function makeAbsolute(url) {
    if (!url) return "";
    url = String(url).replace(/&amp;/g, "&").trim();
    if (url.indexOf("//") === 0) return "https:" + url;
    if (url.indexOf("http://") === 0) return "https://" + url.substring(7);
    if (url.indexOf("https://") === 0) return url;
    if (url.charAt(0) === "/") return baseUrl + url;
    return baseUrl + "/" + url;
  }

  function sanitizeImage(url) {
    url = makeAbsolute(url || "");
    if (!url || url.indexOf("data:image") === 0) return "";
    var m = url.match(/[?&]url=([^&]+)/);
    if (m) {
      try { url = decodeURIComponent(m[1]); } catch (e) {}
    }
    return makeAbsolute(url);
  }

  function slugFromUrl(url) {
    var m = String(url || "").match(/\/(?:manga|series)\/([^\/?#]+)/);
    if (m) return m[1];
    return String(url || "").replace(/[?#].*$/, "").replace(/\/+$/, "").split("/").pop();
  }

  function listFromPayload(payload) {
    payload = unwrap(payload);
    if (!payload) return [];
    if (Array.isArray(payload)) return payload;
    return payload.items || payload.series || payload.results || payload.data || payload.posts || [];
  }

  function itemToManga(item) {
    item = item || {};
    var slug = item.slug || item.seriesSlug || item.urlSlug || "";
    var title = item.title || item.name || item.seriesTitle || "";
    if (!slug || !title) return null;
    var cover = item.cover || item.coverUrl || item.thumbnail || item.image || item.poster || "";
    return {
      title: String(title),
      coverUrl: sanitizeImage(cover),
      detailUrl: baseUrl + "/manga/" + slug,
      contentType: "manga"
    };
  }

  async function searchApi(query, page, genre, type) {
    var input = {
      query: query || "",
      filters: {
        genres: genre ? [genre] : [],
        type: type || undefined
      },
      page: page || 1,
      limit: 20,
      sortBy: query ? "relevance" : "latest"
    };
    var url = baseUrl + "/api/trpc/search.searchSeries?input=" + buildInput(input);
    return listFromPayload(await getJson(url));
  }

  async function getSeries(slug) {
    var url = baseUrl + "/api/trpc/content.getSeriesBySlug?input=" + buildInput({ slug: slug });
    return unwrap(await getJson(url));
  }

  async function getChapters(slug) {
    var url = baseUrl + "/api/trpc/content.getChapters?input=" + buildInput({ slug: slug });
    return listFromPayload(await getJson(url));
  }

  async function getChapterPayload(slug, number) {
    var url = baseUrl + "/api/trpc/content.getChapterPages?input=" + buildInput({ slug: slug, number: number });
    return unwrap(await getJson(url));
  }

  return {
    requiresCloudflare: false,

    async getHomepageManga(args) {
      try {
        var page = (args && args.page) || 1;
        return (await searchApi("", page)).map(itemToManga).filter(function (x) { return !!x; });
      } catch (e) { return []; }
    },

    async search(args) {
      try {
        var query = (args && args.query) || "";
        if (!query.trim()) return [];
        return (await searchApi(query, (args && args.page) || 1)).map(itemToManga).filter(function (x) { return !!x; });
      } catch (e) { return []; }
    },

    async getFilteredManga(args) {
      try {
        return (await searchApi("", (args && args.page) || 1, args && args.genre, args && args.type)).map(itemToManga).filter(function (x) { return !!x; });
      } catch (e) { return []; }
    },

    async getMangaDetails(args) {
      var url = makeAbsolute((args && args.url) || "");
      var slug = slugFromUrl(url);
      var series = await getSeries(slug);
      series = series && (series.series || series.post || series);
      var chaptersRaw = await getChapters(slug);
      var chapters = [];
      for (var i = 0; i < chaptersRaw.length; i++) {
        var ch = chaptersRaw[i] || {};
        var num = String(ch.number || ch.chapterNumber || ch.slug || i + 1).match(/\d+(?:\.\d+)?/);
        num = num ? num[0] : String(i + 1);
        chapters.push({
          number: num,
          title: String(ch.title || "الفصل " + num),
          views: 0,
          url: JSON.stringify({ slug: slug, number: num }),
          isLocked: ch.isLocked === true || ch.locked === true || ch.isAccessible === false,
          date: String(ch.createdAt || ch.date || "")
        });
      }
      chapters.sort(function (a, b) { return (parseFloat(b.number) || 0) - (parseFloat(a.number) || 0); });
      return {
        title: String((series && (series.title || series.name)) || slug),
        coverUrl: sanitizeImage(series && (series.cover || series.coverUrl || series.thumbnail || series.image || series.poster)),
        description: String((series && (series.description || series.summary)) || ""),
        genres: Array.isArray(series && series.genres) ? series.genres.map(function (g) { return String((g && g.name) || g); }) : [],
        chapters: chapters,
        originalUrl: url,
        hasMoreChapters: false,
        lastFetchedPage: 1,
        contentType: "manga"
      };
    },

    async getChapterPages(args) {
      var raw = (args && args.url) || "";
      var ref = {};
      try { ref = JSON.parse(raw); } catch (e) { ref = { slug: slugFromUrl(raw), number: String(raw).match(/\d+(?:\.\d+)?/) ? String(raw).match(/\d+(?:\.\d+)?/)[0] : "1" }; }
      var payload = await getChapterPayload(ref.slug, ref.number);
      var chapterId = payload && (payload.chapterId || payload.id || (payload.chapter && payload.chapter.id));
      var pages = payload && (payload.pages || payload.images || (payload.chapter && payload.chapter.pages)) || [];
      var urls = [];
      if (Array.isArray(pages) && pages.length) {
        for (var i = 0; i < pages.length; i++) {
          var p = pages[i];
          var src = typeof p === "string" ? p : (p.url || p.src || p.image || "");
          if (src) urls.push(sanitizeImage(src));
        }
      }
      if (!urls.length && chapterId) {
        var count = Number(payload.pageCount || payload.pagesCount || payload.count || 0) || 80;
        for (var n = 1; n <= count; n++) {
          urls.push(baseUrl + "/uploads/chapters/" + chapterId + "/" + ("000" + n).slice(-3) + ".webp");
        }
      }
      return urls.filter(function (x) { return !!x; });
    },

    async getChapterContent(args) {
      return { kind: "image", imageUrls: await this.getChapterPages(args) };
    },

    async fetchMoreChapters() { return null; },

    async getGenresAndTypes() {
      return { genres: [], types: ["manga", "manhwa", "manhua", "novel"] };
    },

    getImageHeaders() {
      return {
        "User-Agent": userAgent,
        "Referer": baseUrl + "/",
        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8"
      };
    },

    sanitizeCoverUrl(args) { return sanitizeImage((args && args.url) || ""); }
  };
}

if (typeof module !== "undefined") module.exports = { createSource: createSource };
