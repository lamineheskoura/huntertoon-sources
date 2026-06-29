function createSource(api, config) {
  const baseUrl = (config && config.base_url) || "https://appswat.com";
  const apiBase = baseUrl.replace(/\/$/, "") + "/v2/api/v2";

  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    Accept: "application/json",
    "Accept-Language": "ar,en-US;q=0.9,en;q=0.8",
    Referer: baseUrl + "/",
    Origin: baseUrl,
  };

  async function getJson(url) {
    const response = await fetch(url, {
      method: "GET",
      headers,
    });
    if (!response.ok) {
      console.log("[Swat] getJson response not OK: " + response.status + " for " + url);
      throw new Error("Request failed: " + response.status + " for " + url);
    }
    return await response.json();
  }

  function coverFromPoster(poster) {
    if (!poster || typeof poster !== "object") return "";
    return String(poster.medium || poster.small || poster.original || "");
  }

  function toManga(item) {
    const id = String(item.id || item.serie_id || "");
    return {
      title: String(item.title || "بدون عنوان"),
      detailUrl: baseUrl + "/series/" + id,
      coverUrl: coverFromPoster(item.poster),
      contentType: "manga",
    };
  }

  function toTypeParam(type) {
    if (!type) return null;
    if (type === "مانجا" || type === "Manga") return "manga";
    if (type === "مانهوا" || type === "Manhwa") return "manhwa";
    if (type === "رواية" || type === "Novel") return "novel";
    if (type.indexOf("صينية") !== -1 || type === "مانها" || type === "Manhua") {
      return "manhua";
    }
    return null;
  }

  function buildQuery(params) {
    var parts = [];
    for (var key in params) {
      if (!params.hasOwnProperty(key)) continue;
      var value = params[key];
      if (value !== null && value !== undefined && value !== "") {
        parts.push(encodeURIComponent(key) + "=" + encodeURIComponent(String(value)));
      }
    }
    return parts.length > 0 ? "?" + parts.join("&") : "";
  }

  async function fetchChapters(seriesId) {
    const chapters = [];
    let page = 1;

    while (true) {
      const data = await getJson(apiBase + "/series/" + seriesId + "/chapters/?page=" + page);
      const results = Array.isArray(data.results) ? data.results : [];
      if (results.length === 0) break;

      for (const ch of results) {
        const chapterId = String(ch.id || "");
        const chapterNum = String(ch.chapter || "0");
        const chapterTitle = String(ch.title || "");
        let title = chapterNum;
        if (chapterTitle && chapterTitle !== chapterNum) {
          title = chapterNum + " - " + chapterTitle;
        }
        chapters.push({
          number: chapterNum,
          title,
          views: Number(ch.views_count || 0),
          url: chapterId,
          isLocked: false,
          date: String(ch.created_at || ""),
        });
      }

      if (!data.next) break;
      page += 1;
    }

    return chapters;
  }

  return {
    requiresCloudflare: false,

    async getHomepageManga(args) {
      try {
        const page = args && args.page ? args.page : 1;
        const url = apiBase + "/series/releases/?page=" + page;
        const data = await getJson(url);
        const results = Array.isArray(data.results) ? data.results : [];
        return results.map(toManga);
      } catch (e) {
        console.log("[Swat] getHomepageManga error: " + (e && e.message ? e.message : String(e)));
        return [];
      }
    },

    async search(args) {
      try {
        const query = args && args.query ? args.query : "";
        const page = args && args.page ? args.page : 1;
        const qs = buildQuery({ search: query, page: page, limit: 20 });
        const data = await getJson(apiBase + "/series/" + qs);
        const results = Array.isArray(data.results) ? data.results : [];
        return results.map(toManga);
      } catch (e) {
        return [];
      }
    },

    async getFilteredManga(args) {
      try {
        const page = args && args.page ? args.page : 1;
        const type = args ? args.type : null;
        const typeParam = toTypeParam(type);
        const qs = buildQuery({ page: page, limit: 20, type__name: typeParam });
        const data = await getJson(apiBase + "/series/" + qs);
        const results = Array.isArray(data.results) ? data.results : [];
        return results.map(toManga);
      } catch (e) {
        return [];
      }
    },

    async getGenresAndTypes() {
      return {
        genres: [
          "أكشن", "إثارة", "إنتقام", "إيسيكاي", "الحياة المدرسيه", "الحياة اليومية",
          "السفر عبر الزمن", "النجاة", "تاريخي", "تشويق", "جوسى", "خيال", "دراما",
          "دموي", "رعب", "رومانسى", "رياضة", "سحر", "سينين", "شريحة من الحياة",
          "شوجو", "شونين", "شياطين", "غموض", "فانتازيا", "فنون قتاليه", "فوق الطبيعه",
          "قتال", "قوة خارقة", "كوميدي", "مأساوي", "مغامرات", "مغامرة", "نظام",
          "نفسي", "وحوش", "ويب تون"
        ],
        types: ["مانجا", "مانهوا", "مانهوا صينية", "رواية"],
      };
    },

    async getMangaDetails(args) {
      const url = args && args.url ? String(args.url) : "";
      const match = url.match(/\/series\/([^/?#]+)/);
      if (!match) {
        throw new Error("Invalid Swat URL: " + url);
      }

      const seriesId = match[1];
      const data = await getJson(apiBase + "/series/" + seriesId + "/");
      const genres = Array.isArray(data.genres)
        ? data.genres.map((g) => (g && typeof g === "object" ? String(g.name || "") : String(g || "")))
        : [];
      const chapters = await fetchChapters(seriesId);

      return {
        title: String(data.title || "بدون عنوان"),
        coverUrl: coverFromPoster(data.poster),
        description: String(data.story || ""),
        genres,
        chapters,
        originalUrl: url,
        hasMoreChapters: false,
        lastFetchedPage: 1,
        contentType: "manga",
      };
    },

    async getChapterPages(args) {
      const chapterId = args && args.url ? String(args.url) : "";
      if (!chapterId) {
        throw new Error("Invalid chapter ID");
      }

      const data = await getJson(apiBase + "/chapters/" + chapterId + "/");
      const images = Array.isArray(data.images) ? data.images : [];
      return images
        .map((img) => String((img && img.image) || ""))
        .filter((url) => url.length > 0);
    },

    async getChapterContent(args) {
      const imageUrls = await this.getChapterPages(args);
      return {
        kind: "image",
        imageUrls,
      };
    },

    async fetchMoreChapters() {
      return null;
    },

    getImageHeaders() {
      return {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Referer: baseUrl + "/",
      };
    },

    sanitizeCoverUrl(args) {
      return args && args.url ? String(args.url) : "";
    },
  };
}
