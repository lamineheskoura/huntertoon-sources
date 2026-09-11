function createSource(api, config) {
  var baseUrl = ((config && config.base_url) || "https://mangatime.org").replace(/\/+$/, "");
  var apiBase = baseUrl + "/api/trpc";
  var userAgent = (config && config.user_agent) || "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";

  var headers = {
    "User-Agent": userAgent,
    "Accept": "application/json, text/html, */*",
    "Accept-Language": "ar,en-US;q=0.9,en;q=0.8",
    "Referer": baseUrl + "/"
  };

  function jsonInput(obj) {
    return encodeURIComponent(JSON.stringify({ json: obj || {} }));
  }

  function batchInput(obj) {
    return encodeURIComponent(JSON.stringify({ "0": { json: obj || {} } }));
  }

  async function fetchApi(procedure, input, isBatch) {
    var enc = isBatch ? batchInput(input) : jsonInput(input);
    var url = apiBase + "/" + procedure + "?batch=1&input=" + enc;
    if (api.http) {
      var res = await api.http(url, { method: "GET", headers: headers });
      if (!res || !res.ok) return null;
      return JSON.parse(res.body);
    }
    var text = await api.fetchText(url, headers);
    if (!text) return null;
    return JSON.parse(text);
  }

  function unwrap(value) {
    if (!value) return value;
    if (Array.isArray(value) && value.length === 1) return unwrap(value[0]);
    if (value.result && value.result.data) return unwrap(value.result.data);
    if (value.data && value.data.json !== undefined) return unwrap(value.data.json);
    if (value.json !== undefined) return unwrap(value.json);
    return value;
  }

  function makeAbsolute(url) {
    if (!url) return "";
    url = String(url).replace(/&amp;/g, "&").trim();
    if (url.indexOf("http://") === 0) return "https://" + url.substring(7);
    if (url.indexOf("https://") === 0) return url;
    if (url.indexOf("//") === 0) return "https:" + url;
    return baseUrl + (url.charAt(0) === "/" ? url : "/" + url);
  }

  function sanitizeImage(url) {
    if (!url) return "";
    url = String(url).trim();
    if (url.indexOf("data:image") === 0) return "";
    return makeAbsolute(url);
  }

  function slugFromUrl(url) {
    var m = String(url || "").match(/\/(?:manga|manhwa|manhua|webtoon|series)\/([^\/?#]+)/);
    if (m) return m[1];
    return String(url || "").replace(/[?#].*$/, "").replace(/\/+$/, "").split("/").pop();
  }

  function toManga(item) {
    if (!item || !item.slug || !item.title) return null;

    return {
      title: String(item.title),
      coverUrl: sanitizeImage(item.coverUrl || item.cover || item.thumbnail || ""),
      detailUrl: baseUrl + "/" + (item.type || "manga") + "/" + item.slug,
      contentType: "manga"
    };
  }

  var sortMap = {
    "popular": "popularity",
    "latest": "recent",
    "rating": "rating",
    "alphabetical": "alphabetical",
    "chapters": "chapters",
    "trending": "TRENDING"
  };

    function parseChapterRef(raw) {
      var ref = {};
      try { ref = JSON.parse(raw); } catch (e) {
        var slug = slugFromUrl(raw);
        var numM = String(raw).match(/\/(\d+(?:\.\d+)?)\/?$/);
        ref = { seriesSlug: slug, chapterNumber: numM ? numM[1] : "1" };
      }
      if (!ref.seriesSlug && ref.slug) ref.seriesSlug = ref.slug;
      if (!ref.chapterNumber && ref.number) ref.chapterNumber = ref.number;
      return ref;
    }

    async function fetchChapterData(ref) {
      return unwrap(await fetchApi("content.getChapterPages", {
        seriesSlug: ref.seriesSlug || ref.slug || "",
        chapterNumber: ref.chapterNumber || ref.number || 1
      }, true));
    }

    // Overlay item normalization — accepts both known schemas so text works
    // the moment the backend publishes it (currently pages carry images only):
    //  - manhasama shape: {text, box:[x,y,w,h], boxNorm:[nx,ny,nw,nh]}
    //  - tek/sid shape: {text, x,y,w,h, font_family, font_size_px, ...}
    function normalizeOverlayItem(item) {
      if (!item || typeof item !== "object") return null;
      var box = item.box || null;
      var norm = item.boxNorm || item.box_norm || null;
      var text = item.text;
      if (text === undefined || text === null) text = "";
      var angle = item.angle;
      if (angle === undefined || angle === null) angle = item.rotate;
      var out = {
        text: String(text),
        x: box ? (Number(box[0]) || 0) : (Number(item.x) || 0),
        y: box ? (Number(box[1]) || 0) : (Number(item.y) || 0),
        w: box ? (Number(box[2]) || 0) : (Number(item.w || item.width) || 0),
        h: box ? (Number(box[3]) || 0) : (Number(item.h || item.height) || 0),
        angle: Number(angle) || 0
      };
      if (norm && norm.length >= 4) {
        out.nx = Number(norm[0]) || 0;
        out.ny = Number(norm[1]) || 0;
        out.nw = Number(norm[2]) || 0;
        out.nh = Number(norm[3]) || 0;
        out.hasNorm = true;
      }
      // Styling passthrough (tek/sid schema) — app renders when present.
      var styleKeys = ["font_family", "font_size_px", "line_height", "color",
        "stroke_color", "stroke_width_px", "text_align", "direction", "bubble_shape"];
      for (var i = 0; i < styleKeys.length; i++) {
        if (item[styleKeys[i]] !== undefined && item[styleKeys[i]] !== null) {
          out[styleKeys[i]] = item[styleKeys[i]];
        }
      }
      return out;
    }

    function naturalDims(data) {
      var w = 0, h = 0;
      var dims = (data && data.pageDimensions) || [];
      var wc = {}, hc = {};
      for (var i = 0; i < dims.length; i++) {
        var dw = Number(dims[i] && dims[i].w) || 0;
        var dh = Number(dims[i] && dims[i].h) || 0;
        if (dw > 0) wc[dw] = (wc[dw] || 0) + 1;
        if (dh > 0) hc[dh] = (hc[dh] || 0) + 1;
      }
      var mc = 0;
      for (var k in wc) { if (wc[k] > mc) { mc = wc[k]; w = Number(k); } }
      mc = 0;
      for (var k2 in hc) { if (hc[k2] > mc) { mc = hc[k2]; h = Number(k2); } }
      return { w: w || 800, h: h || 1200 };
    }

    function buildOverlayResult(data, imageUrls) {
      var pages = (data && data.pages) || [];
      var nat = naturalDims(data);
      var pageOverlays = [];
      for (var p = 0; p < imageUrls.length; p++) {
        var rawPage = pages[p];
        var list = [];
        var rawOverlays = (rawPage && typeof rawPage === "object")
          ? (rawPage.overlays || rawPage.bubbles || rawPage.texts || rawPage.words || rawPage.segments || [])
          : [];
        if (!Array.isArray(rawOverlays)) rawOverlays = [];
        for (var j = 0; j < rawOverlays.length; j++) {
          var norm = normalizeOverlayItem(rawOverlays[j]);
          if (norm) list.push(norm);
        }
        pageOverlays.push(list);
      }
      return {
        kind: "overlay",
        imageUrls: imageUrls,
        pageOverlays: pageOverlays,
        naturalImageWidth: nat.w,
        naturalImageHeight: nat.h
      };
    }

    async function getChapterImages(ref) {
      var data = await fetchChapterData(ref);
      if (!data) return { imageUrls: [], data: null };
      var rawPages = data.pages || [];
      var urls = [];
      for (var pi = 0; pi < rawPages.length; pi++) {
        var item = rawPages[pi];
        var src = (item && typeof item === "object")
          ? (item.image || item.url || item.src || "")
          : item;
        src = sanitizeImage(src);
        if (src) urls.push(src);
      }
      return { imageUrls: urls, data: data };
    }

  return {
    requiresCloudflare: false,

    async getHomepageManga(args) {
      try {
        var data = unwrap(await fetchApi("homepage.getHomepage", {}, true));
        if (!data || !data.sections) return [];
        var items = [];
        for (var si = 0; si < data.sections.length; si++) {
          var sec = data.sections[si];
          if (sec.items && sec.items.length) {
            for (var ii = 0; ii < sec.items.length; ii++) {
              var mapped = toManga(sec.items[ii]);
              if (mapped) items.push(mapped);
            }
            if (items.length >= 50) break;
          }
        }
        return items.slice(0, 50);
      } catch (e) { return []; }
    },

    async search(args) {
      try {
        var query = (args && args.query) || "";
        if (!query.trim()) return [];
        var data = unwrap(await fetchApi("search.searchSeries", {
          query: query, page: (args && args.page) || 1, limit: 20, sortBy: "relevance"
        }, true));
        if (!data || !data.results) return [];
        return data.results.map(toManga).filter(function(x) { return !!x; });
      } catch (e) { return []; }
    },

    async getFilteredManga(args) {
      try {
        var page = (args && args.page) || 1;
        var sort = (args && args.sort && sortMap[args.sort]) || "recent";
        var filters = {};
        if (args && args.genre) filters.genres = [args.genre];
        if (args && args.type) filters.type = [args.type];
        if (args && args.status) filters.status = [args.status];
        var data = unwrap(await fetchApi("search.searchSeries", {
          query: "", page: page, limit: 30, sortBy: sort, filters: filters
        }, true));
        if (!data || !data.results) return [];
        return data.results.map(toManga).filter(function(x) { return !!x; });
      } catch (e) { return []; }
    },

    async getMangaDetails(args) {
      var url = makeAbsolute((args && args.url) || "");
      var slug = slugFromUrl(url);
      if (!slug) {
        return {
          title: "", coverUrl: "", description: "", genres: [],
          chapters: [], originalUrl: url,
          hasMoreChapters: false, lastFetchedPage: 1, contentType: "manga"
        };
      }
      var series = unwrap(await fetchApi("content.getSeriesBySlug", { slug: slug }, true));
      if (!series) {
        return {
          title: slug, coverUrl: "", description: "", genres: [],
          chapters: [], originalUrl: url,
          hasMoreChapters: false, lastFetchedPage: 1, contentType: "manga"
        };
      }
      var seriesId = series.id || "";
      var title = series.title || slug;
      var cover = sanitizeImage(series.coverUrl || series.cover || "");
      var description = series.description || "";
      var genres = [];
      if (series.genres && series.genres.length) {
        for (var gi = 0; gi < series.genres.length; gi++) {
          var g = series.genres[gi];
          genres.push(String((g && g.name) || g));
        }
      }
      var chapters = [];
      if (seriesId) {
        var chData = unwrap(await fetchApi("content.getChapters", { seriesId: seriesId }, true));
        if (chData && chData.chapters && chData.chapters.length) {
          for (var ci = 0; ci < chData.chapters.length; ci++) {
            var ch = chData.chapters[ci];
            var num = String(ch.number || ch.chapterNumber || ci + 1);
            chapters.push({
              number: num,
              title: ch.title || "الفصل " + num,
              views: 0,
              url: JSON.stringify({ seriesSlug: slug, chapterNumber: ch.number || num, id: ch.id }),
              isLocked: ch.isPremium === true || ch.isUnlocked === false,
              date: ch.publishedAt || ch.createdAt || ""
            });
          }
          chapters.sort(function(a, b) {
            return (parseFloat(b.number) || 0) - (parseFloat(a.number) || 0);
          });
        }
      }
      return {
        title: title,
        coverUrl: cover,
        description: description,
        genres: genres,
        chapters: chapters,
        originalUrl: url,
        hasMoreChapters: false,
        lastFetchedPage: 1,
        contentType: "manga"
      };
    },


    async getChapterPages(args) {
      var ref = parseChapterRef((args && args.url) || "");
      var r = await getChapterImages(ref);
      return r.imageUrls;
    },

    async getChapterContent(args) {
      var ref = parseChapterRef((args && args.url) || "");
      var r = await getChapterImages(ref);
      if (!r.imageUrls.length) return { kind: "image", imageUrls: [] };
      var fmt = String((r.data && r.data.format) || "");
      if (fmt === "json-overlay") {
        return buildOverlayResult(r.data, r.imageUrls);
      }
      return { kind: "image", imageUrls: r.imageUrls };
    },

    async fetchMoreChapters() { return null; },

    async getGenresAndTypes() {
      return {
        genres: ["أكشن","رومانسي","خيال","إثارة","كوميديا","دراما","رعب","مدرسي","خارق للطبيعة","شونين","شوجو","إيسيكاي","رياضة","غموض"],
        types: ["manga","manhwa","manhua","webtoon"]
      };
    },

    getImageHeaders() {
      return {
        "User-Agent": userAgent,
        "Referer": baseUrl + "/",
        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8"
      };
    },

    sanitizeCoverUrl(args) {
      return sanitizeImage((args && args.url) || "");
    }
  };
}

if (typeof module !== "undefined") module.exports = { createSource: createSource };