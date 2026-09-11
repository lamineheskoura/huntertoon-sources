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

  function mapChapters(list, slug) {
    var out = [];
    if (!Array.isArray(list)) return out;
    for (var ci = 0; ci < list.length; ci++) {
      var ch = list[ci] || {};
      var num = String(ch.number != null ? ch.number : (ch.chapterNumber != null ? ch.chapterNumber : (ci + 1)));
      out.push({
        number: num,
        title: ch.title || ("الفصل " + num),
        views: 0,
        url: JSON.stringify({ seriesSlug: slug, chapterNumber: (ch.number != null ? ch.number : num), id: ch.id }),
        isLocked: ch.isPremium === true || ch.isUnlocked === false,
        date: ch.publishedAt || ch.createdAt || ""
      });
    }
    out.sort(function (a, b) {
      return (parseFloat(b.number) || 0) - (parseFloat(a.number) || 0);
    });
    return out;
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

    // Overlay item normalization — accepts all known schemas:
    //  - mangatime overlay-chunk shape: {text, bbox:[x0,y0,x1,y1], templateId,
    //    fineType, style:{size,color,weight,align,dir,lineHeight,font,
    //    strokeColor,strokeW,...}}  (+ optional bubbleBbox/safeBbox)
    //  - manhasama shape: {text, box:[x,y,w,h], boxNorm:[nx,ny,nw,nh]}
    //  - tek/sid shape: {text, x,y,w,h, font_family, font_size_px, ...}
    function normalizeOverlayItem(item) {
      if (!item || typeof item !== "object") return null;
      var box = item.box || null;
      var bbox = item.bbox || null;
      var norm = item.boxNorm || item.box_norm || null;
      var text = item.text;
      if (text === undefined || text === null) text = "";
      var angle = item.angle;
      if (angle === undefined || angle === null) angle = item.rotate;
      var out = {
        text: String(text),
        x: box ? (Number(box[0]) || 0) : (bbox ? (Number(bbox[0]) || 0) : (Number(item.x) || 0)),
        y: box ? (Number(box[1]) || 0) : (bbox ? (Number(bbox[1]) || 0) : (Number(item.y) || 0)),
        w: box ? (Number(box[2]) || 0) : (bbox ? ((Number(bbox[2]) || 0) - (Number(bbox[0]) || 0)) : (Number(item.w || item.width) || 0)),
        h: box ? (Number(box[3]) || 0) : (bbox ? ((Number(bbox[3]) || 0) - (Number(bbox[1]) || 0)) : (Number(item.h || item.height) || 0)),
        angle: Number(angle) || 0
      };
      if (norm && norm.length >= 4) {
        out.nx = Number(norm[0]) || 0;
        out.ny = Number(norm[1]) || 0;
        out.nw = Number(norm[2]) || 0;
        out.nh = Number(norm[3]) || 0;
        out.hasNorm = true;
      }
      // mangatime style object -> flat styling fields the app renderer reads.
      var st = (item.style && typeof item.style === "object") ? item.style : null;
      if (st) {
        if (st.size != null) out.font_size_px = Number(st.size) || 0;
        if (st.color) out.color = String(st.color);
        if (st.weight != null) out.font_weight = Number(st.weight) || 0;
        if (st.align) out.text_align = String(st.align);
        if (st.dir) out.direction = String(st.dir);
        if (st.lineHeight != null && !isNaN(Number(st.lineHeight))) out.line_height = Number(st.lineHeight);
        if (st.font) out.font_family = String(st.font);
        if (st.strokeColor) out.stroke_color = String(st.strokeColor);
        if (st.strokeW != null && !isNaN(Number(st.strokeW))) out.stroke_width_px = Number(st.strokeW);
        if (st.slantDeg != null && !isNaN(Number(st.slantDeg))) out.slant_deg = Number(st.slantDeg);
      }
      if (item.templateId) out.template_id = String(item.templateId);
      if (item.fineType) out.fine_type = String(item.fineType);
      if (item.type) out.bubble_type = String(item.type);
      // Styling passthrough (tek/sid schema) — app renders when present.
      var styleKeys = ["font_family", "font_size_px", "line_height", "color",
        "stroke_color", "stroke_width_px", "text_align", "direction", "bubble_shape"];
      for (var i = 0; i < styleKeys.length; i++) {
        if (out[styleKeys[i]] === undefined || out[styleKeys[i]] === null || out[styleKeys[i]] === "" || out[styleKeys[i]] === 0) {
          if (item[styleKeys[i]] !== undefined && item[styleKeys[i]] !== null) {
            out[styleKeys[i]] = item[styleKeys[i]];
          }
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

    async function fetchOverlayPages(chapterId) {
      // content.getChapterOverlay {chapterId} -> {pages:[{pageIndex,width,height,bubbles[]}]}
      // Falls back to per-chunk endpoint if the full blob is unavailable.
      try {
        if (!chapterId) return null;
        var full = null;
        try {
          full = unwrap(await fetchApi("content.getChapterOverlay", { chapterId: chapterId }, true));
        } catch (eFull) {
          full = null;
        }
        if (full && Array.isArray(full.pages) && full.pages.length) return full.pages;
        var man = null;
        try {
          man = unwrap(await fetchApi("content.getChapterOverlayManifest", { chapterId: chapterId }, true));
        } catch (eMan) {
          man = null;
        }
        var chunks = (man && man.chunks) || (man && man.manifest && man.manifest.chunks) || [];
        var version = (man && (man.overlayVersion || (man.manifest && man.manifest.overlayVersion))) || 1;
        var acc = [];
        for (var ci = 0; ci < chunks.length; ci++) {
          var idx = (chunks[ci] && chunks[ci].chunkIndex != null) ? chunks[ci].chunkIndex : ci;
          try {
            var ch = unwrap(await fetchApi("content.getChapterOverlayChunk", {
              chapterId: chapterId, overlayVersion: version, chunkIndex: idx
            }, true));
            var cps = (ch && ch.pages) || [];
            for (var pi = 0; pi < cps.length; pi++) acc.push(cps[pi]);
          } catch (eChunk) {}
        }
        return acc.length ? acc : null;
      } catch (e) {
        return null;
      }
    }

    function buildOverlayFromPages(overlayPages, imageUrls, fallbackDims) {
      var pageMap = {};
      var natW = 0, natH = 0;
      var wCount = {}, hCount = {};
      for (var i = 0; i < overlayPages.length; i++) {
        var pg = overlayPages[i] || {};
        var pIdx = (pg.pageIndex != null) ? pg.pageIndex : i;
        var pw = Number(pg.width) || 0;
        var ph = Number(pg.height) || 0;
        if (pw > 0) wCount[pw] = (wCount[pw] || 0) + 1;
        if (ph > 0) hCount[ph] = (hCount[ph] || 0) + 1;
        var list = [];
        var raw = pg.bubbles || pg.overlays || [];
        if (!Array.isArray(raw)) raw = [];
        // Per-page width normalization (proven tek/sid pattern): the app
        // scales every coordinate by displayWidth/naturalWidth.
        var s = 1;
        for (var j = 0; j < raw.length; j++) {
          var norm = normalizeOverlayItem(raw[j]);
          if (norm) list.push(norm);
        }
        pageMap[pIdx] = { list: list, w: pw, h: ph };
      }
      var mc = 0;
      for (var wk in wCount) { if (wCount[wk] > mc) { mc = wCount[wk]; natW = Number(wk); } }
      mc = 0;
      for (var hk in hCount) { if (hCount[hk] > mc) { mc = hCount[hk]; natH = Number(hk); } }
      if (!natW) natW = (fallbackDims && fallbackDims.w) || 1200;
      if (!natH) natH = (fallbackDims && fallbackDims.h) || 1200;
      // Normalize every page to the natural width so one app-side scale fits all.
      var pageOverlays = [];
      for (var p = 0; p < imageUrls.length; p++) {
        var entry = pageMap[p] || { list: [], w: natW, h: natH };
        var pw2 = entry.w || natW;
        var sc = (pw2 && pw2 !== natW) ? (natW / pw2) : 1;
        var scaled = [];
        for (var k = 0; k < entry.list.length; k++) {
          var ov = entry.list[k];
          var cp = {};
          for (var kk in ov) cp[kk] = ov[kk];
          if (sc !== 1) {
            cp.x = Number((cp.x * sc).toFixed(2));
            cp.y = Number((cp.y * sc).toFixed(2));
            cp.w = Number((cp.w * sc).toFixed(2));
            cp.h = Number((cp.h * sc).toFixed(2));
            if (cp.font_size_px) cp.font_size_px = Number((cp.font_size_px * sc).toFixed(2));
            if (cp.stroke_width_px) cp.stroke_width_px = Number((cp.stroke_width_px * sc).toFixed(2));
          }
          scaled.push(cp);
        }
        pageOverlays.push(scaled);
      }
      return {
        kind: "overlay",
        imageUrls: imageUrls,
        pageOverlays: pageOverlays,
        naturalImageWidth: natW,
        naturalImageHeight: natH
      };
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
      var chaptersHasMore = false;
      if (seriesId) {
        var chData = unwrap(await fetchApi("content.getChapters", { seriesId: seriesId, limit: 1000 }, true));
        if (chData && chData.chapters && chData.chapters.length) {
          chapters = mapChapters(chData.chapters, slug);
        }
        chaptersHasMore = !!(chData && chData.hasMore);
      }
      return {
        title: title,
        coverUrl: cover,
        description: description,
        genres: genres,
        chapters: chapters,
        originalUrl: url,
        hasMoreChapters: chaptersHasMore,
        lastFetchedPage: 1,
        contentType: "manga"
      };
    },

    async fetchMoreChapters(args) {
      try {
        // App calls with FLAT args {url, nextPage}; also accept legacy shapes.
        var prev = (args && args.previousResult) || {};
        var rawUrl = (args && args.url) || prev.originalUrl || "";
        var slug = slugFromUrl(rawUrl);
        if (!slug) {
          try {
            var rj = JSON.parse(rawUrl);
            slug = rj.seriesSlug || rj.slug || "";
          } catch (eJson) {}
        }
        if (!slug) return null;
        var nextPage = (args && args.nextPage) || ((prev.lastFetchedPage || 1) + 1);
        nextPage = parseInt(nextPage, 10) || 2;
        if (nextPage < 2) nextPage = 2;
        // No cursor paging server-side: grow the limit window (app dedupes by url).
        var limit = nextPage * 1000;
        if (limit > 5000) limit = 5000;
        var series = unwrap(await fetchApi("content.getSeriesBySlug", { slug: slug }, true));
        if (!series || !series.id) return null;
        var chData = unwrap(await fetchApi("content.getChapters", { seriesId: series.id, limit: limit }, true));
        if (!chData || !chData.chapters || !chData.chapters.length) return null;
        return {
          chapters: mapChapters(chData.chapters, slug),
          hasMoreChapters: !!chData.hasMore,
          lastFetchedPage: nextPage
        };
      } catch (e) {
        return null;
      }
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
        var chapterId = (r.data && r.data.id) || ref.id || "";
        var overlayPages = await fetchOverlayPages(chapterId);
        if (overlayPages && overlayPages.length) {
          var fb = naturalDims(r.data);
          return buildOverlayFromPages(overlayPages, r.imageUrls, fb);
        }
        return buildOverlayResult(r.data, r.imageUrls);
      }
      return { kind: "image", imageUrls: r.imageUrls };
    },

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