function createSource(api, config) {
  var baseUrl = ((config && config.base_url) || "https://mangasid.com").replace(/\/+$/, "");
  var apiBase = "https://api.mangasid.com";
  var selectors = (config && config.selectors) || {};
  var other = (config && config.other) || {};
  var userAgent = (config && config.user_agent) || "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
  var overlayKeyHex = "ff453871399fe268588a0936b45376022d85ed0fd1292001d5102f6a30291dc1";
  var lastChapterUrl = baseUrl + "/";

  var defaultHeaders = mergeHeaders({
    "User-Agent": userAgent,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "ar,en-US;q=0.9,en;q=0.8",
    "Referer": baseUrl + "/",
    "Origin": baseUrl,
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "same-origin",
    "Upgrade-Insecure-Requests": "1"
  }, (config && config.headers) || {});

  var defaultGenres = [
    "أكشن", "مغامرة", "كوميدي", "خيال", "دراما", "رومانسي", "شوجو", "شونين", "إثارة", "رعب", "فنون قتال", "مأساة"
  ];
  var defaultTypes = ["manga", "manhwa", "manhua", "comic"];

  function mergeHeaders(a, b) {
    var out = {};
    for (var k in a) out[k] = a[k];
    for (var x in b) out[x] = b[x];
    return out;
  }

  function sel(key, fallback) {
    return selectors[key] || fallback;
  }

  function otherValue(key, fallback) {
    return other[key] || fallback;
  }

  async function fetchHtml(url, extraHeaders, method) {
    var headers = mergeHeaders(defaultHeaders, extraHeaders || {});
    if (api.http) {
      var res = await api.http(url, { method: method || "GET", headers: headers });
      if (!res || !res.ok) throw new Error("HTTP " + (res ? res.status : 0) + " for " + url);
      return res.body || "";
    }
    if (method && method !== "GET") return "";
    var html = await api.fetchText(url, headers);
    if (!html) throw new Error("Empty response: " + url);
    return html;
  }

  function htmlDecode(value) {
    return String(value || "")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, "\"")
      .replace(/&#34;/g, "\"")
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/\\\//g, "/")
      .trim();
  }

  function makeAbsolute(url) {
    url = htmlDecode(url);
    if (!url) return "";
    if (url.indexOf("http://") === 0) return "https://" + url.substring(7);
    if (url.indexOf("https://") === 0) return url;
    if (url.indexOf("//") === 0) return "https:" + url;
    if (url.indexOf("/api/") === 0) return apiBase + url;
    if (url.charAt(0) === "/") return baseUrl + url;
    return baseUrl + "/" + url;
  }

  function extractHref(item) {
    var attrs = item.attrs || {};
    if (attrs.href) return attrs.href;
    var html = item.html || "";
    var a = html.match(/<a[^>]+href\s*=\s*["']([^"']+)["']/i);
    return a ? htmlDecode(a[1]) : "";
  }

  function extractImageFromAttrs(attrs) {
    var url = (attrs && (attrs.src || attrs["data-src"] || attrs["data-lazy-src"] || attrs["data-original"])) || "";
    if (!url || String(url).indexOf("data:image/") === 0) return "";
    return makeAbsolute(url);
  }

  function isValidImageUrl(url) {
    if (!url) return false;
    var lower = url.toLowerCase();
    if (lower.indexOf("data:image") === 0) return false;
    if (lower.indexOf(".svg") !== -1) return false;
    if (lower.indexOf("logo") !== -1 || lower.indexOf("avatar") !== -1 || lower.indexOf("icon") !== -1) return false;
    if (lower.indexOf("trap") !== -1) return false;
    return lower.indexOf(".jpg") !== -1 || lower.indexOf(".jpeg") !== -1 || lower.indexOf(".png") !== -1 || lower.indexOf(".webp") !== -1 || lower.indexOf("/api/") !== -1;
  }

  function processImageUrl(url) {
    var absolute = makeAbsolute(url);
    return isValidImageUrl(absolute) ? absolute : "";
  }

  function stripHtml(text) {
    return htmlDecode(String(text || "").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
  }

  function extractNumber(value, title) {
    var text = String(value || "") + " " + String(title || "");
    var m = text.match(/(?:chapter|ch|الفصل|فصل)[\s_.-]*(\d+(?:\.\d+)?)/i) || text.match(/(\d+(?:\.\d+)?)/);
    return m ? m[1] : "0";
  }

  async function toMangaList(html, listSel, opts) {
    opts = opts || {};
    var items = await api.cssAll(html, listSel);
    var results = [];
    var seen = {};
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var itemHtml = item.html || "";
      var href = extractHref(item);
      if (!href && itemHtml) href = await api.cssAttr(itemHtml, opts.urlSel || "a", "href");
      var detailUrl = makeAbsolute(href || "");
      if (!detailUrl || detailUrl.indexOf("/manga/") === -1 || seen[detailUrl]) continue;
      seen[detailUrl] = true;

      var imgSel = opts.coverSel || "img";
      var cover = await api.cssAttr(itemHtml, imgSel, "src");
      if (!cover) cover = await api.cssAttr(itemHtml, imgSel, "data-src");
      if (!cover) cover = await api.cssAttr(itemHtml, imgSel, "data-lazy-src");
      if (!cover && item.attrs) cover = item.attrs.src || item.attrs["data-src"] || "";
      cover = processImageUrl(cover);

      var title = await api.cssText(itemHtml, opts.titleSel || "h3, .manga-title, .tt, a[dir='auto']");
      if (!title) title = await api.cssAttr(itemHtml, "img", "alt");
      if (!title) title = await api.cssAttr(itemHtml, "img", "title");
      if (!title) title = item.text || "";
      title = stripHtml(title);
      if (!title) continue;
      results.push({ title: title, detailUrl: detailUrl, coverUrl: cover, contentType: "manga" });
    }
    return results;
  }

  function parseAstroValue(value) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      var out = {};
      for (var k in value) out[k] = parseAstroValue(value[k]);
      return out;
    }
    if (Array.isArray(value) && value.length) {
      var type = value[0];
      var data = value.length > 1 ? value[1] : null;
      if (type === 0) return parseAstroValue(data);
      if (type === 1 && Array.isArray(data)) return data.map(parseAstroValue);
      return value.map(parseAstroValue);
    }
    return value;
  }

  function extractAstroProps(html, needle) {
    var regex = /<astro-island\b[^>]*\sprops=(['"])([\s\S]*?)\1[^>]*>/gi;
    var match;
    while ((match = regex.exec(html)) !== null) {
      var propsText = htmlDecode(match[2]);
      if (needle && propsText.indexOf(needle) === -1) continue;
      try {
        return parseAstroValue(JSON.parse(propsText));
      } catch (e) {}
    }
    return null;
  }

  function extractImageUrlsFromProps(props) {
    var raw = props && props.imageUrls;
    if (!Array.isArray(raw)) return [];
    var urls = [];
    var seen = {};
    for (var i = 0; i < raw.length; i++) {
      var item = raw[i];
      var src = "";
      if (typeof item === "string") src = item;
      if (item && typeof item === "object") {
        if (item.isTrap === true || item.trap === true) continue;
        src = item.url || item.src || "";
      }
      var url = processImageUrl(src);
      if (url && !seen[url]) {
        seen[url] = true;
        urls.push(url);
      }
    }
    return urls;
  }

  function hexToBytes(hex) {
    hex = String(hex || "").replace(/\s+/g, "");
    if (!hex || hex.length % 2) throw new Error("Invalid hex length");
    var out = new Uint8Array(hex.length / 2);
    for (var i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
  }

  function joinBytes(a, b) {
    var out = new Uint8Array(a.length + b.length);
    out.set(a, 0);
    out.set(b, a.length);
    return out;
  }

  function decodeUtf8(bytes) {
    if (typeof TextDecoder !== "undefined") return new TextDecoder("utf-8").decode(bytes);
    var s = "";
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return decodeURIComponent(escape(s));
  }

  async function decryptOverlayBlob(blob) {
    // Use the Dart bridge for AES-GCM decryption (crypto.subtle is not available in flutter_js)
    if (api.decryptAesGcm) {
      return await api.decryptAesGcm(blob, overlayKeyHex);
    }
    return null;
  }

  function normalizeOverlayItem(item) {
    var out = {};
    for (var k in item) out[k] = item[k];
    if (out.rotate !== undefined && out.angle === undefined) {
      out.angle = out.rotate;
    }
    if (out.text === undefined || out.text === null) out.text = "";
    out.x = Number(out.x) || 0;
    out.y = Number(out.y) || 0;
    out.w = Number(out.w) || 0;
    out.h = Number(out.h) || 0;
    return out;
  }

  function buildOverlayContent(imageUrls, overlayData, overlayPageOffset) {
    var pages = (overlayData && Array.isArray(overlayData.pages)) ? overlayData.pages : [];
    var pageMap = {};
    for (var i = 0; i < pages.length; i++) {
      var page = pages[i] || {};
      var pageNum = page.page_number || page.pageNumber || 0;
      var rawOverlays = Array.isArray(page.overlays) ? page.overlays : [];
      var normalizedOverlays = [];
      for (var j = 0; j < rawOverlays.length; j++) {
        var ov = rawOverlays[j];
        if (ov && typeof ov === "object") {
          normalizedOverlays.push(normalizeOverlayItem(ov));
        }
      }
      pageMap[pageNum] = normalizedOverlays;
    }
    var pageOverlays = [];
    var offset = Number(overlayPageOffset) || 0;
    for (var p = 0; p < imageUrls.length; p++) {
      var overlayPageIdx = p - offset + 1;
      var overlays = pageMap[overlayPageIdx];
      if (!overlays && offset > 0) {
        overlays = pageMap[p + offset];
      }
      pageOverlays.push(overlays || []);
    }
    var first = pages[0] || {};
    return {
      kind: "overlay",
      imageUrls: imageUrls,
      pageOverlays: pageOverlays,
      naturalImageWidth: overlayData.natural_image_width || overlayData.naturalImageWidth || first.image_width || first.imageWidth || first.natural_image_width || first.naturalImageWidth || 800,
      naturalImageHeight: overlayData.natural_image_height || overlayData.naturalImageHeight || first.image_height || first.imageHeight || first.natural_image_height || first.naturalImageHeight || 1200
    };
  }

  async function extractChapters(html, mangaData) {
    var chapters = [];
    if (mangaData) {
      var raw = mangaData.MangaChapters || mangaData.chapters || [];
      var slug = mangaData.slug || "";
      for (var i = 0; i < raw.length; i++) {
        var chapter = raw[i] || {};
        var number = String(chapter.chapter_number || chapter.number || extractNumber(chapter.slug, chapter.title));
        if (!number || number === "0") continue;
        chapters.push({
          number: number,
          title: String(chapter.title || "") || "فصل " + number,
          views: 0,
          url: makeAbsolute("/reader/" + slug + "/" + number),
          isLocked: chapter.access === false || (chapter.price != null && Number(chapter.price) > 0),
          date: String(chapter.created_at || chapter.createdAt || "").split("T")[0]
        });
      }
    }
    if (!chapters.length) {
      var listSel = sel("chapter_list", "a[href*='/reader/'], a[href*='/chapter/'], .chapter-item, #chapterlist li, .eplister li");
      var items = await api.cssAll(html, listSel);
      var seen = {};
      for (var c = 0; c < items.length; c++) {
        var item = items[c];
        var href = extractHref(item);
        var chapterUrl = makeAbsolute(href || "");
        if (!chapterUrl || seen[chapterUrl]) continue;
        seen[chapterUrl] = true;
        var text = item.text || "";
        chapters.push({ number: extractNumber(chapterUrl, text), title: stripHtml(text), views: 0, url: chapterUrl, isLocked: /locked|paywall|fa-lock/.test(item.html || ""), date: "" });
      }
    }
    chapters.sort(function (a, b) { return (parseFloat(b.number) || 0) - (parseFloat(a.number) || 0); });
    return chapters;
  }

  async function extractPagesWithFallback(html) {
    var urls = [];
    var seen = {};
    function add(raw) {
      var url = processImageUrl(raw);
      if (url && !seen[url]) {
        seen[url] = true;
        urls.push(url);
      }
    }
    var props = extractAstroProps(html, "imageUrls");
    var propUrls = extractImageUrlsFromProps(props || {});
    for (var p = 0; p < propUrls.length; p++) add(propUrls[p]);
    if (urls.length) return urls;

    var strategies = String(otherValue("reader_fallback_strategy", "selector,noscript,regex,ts_reader")).split(",");
    for (var s = 0; s < strategies.length && !urls.length; s++) {
      var strategy = strategies[s].trim();
      if (strategy === "selector") {
        var chain = sel("chapter_page_image", "#readerarea img, .reading-content img, .page-break img").split(",");
        for (var ci = 0; ci < chain.length; ci++) {
          var images = await api.cssAll(html, chain[ci].trim());
          images.sort(function (a, b) { return (parseInt((a.attrs || {})["data-index"] || "999999", 10) || 999999) - (parseInt((b.attrs || {})["data-index"] || "999999", 10) || 999999); });
          for (var ii = 0; ii < images.length; ii++) add(extractImageFromAttrs(images[ii].attrs || {}));
          if (urls.length) break;
        }
      }
      if (strategy === "noscript" && !urls.length) {
        var container = await api.cssHtml(html, sel("chapter_reader_container", ".reader-area, #readerarea, .reading-content"));
        var n = (container || "").match(/<noscript[^>]*>([\s\S]*?)<\/noscript>/i);
        var noscript = n ? n[1] : "";
        var nr = /<img[^>]+(?:data-src|data-lazy-src|src)\s*=\s*["']([^"']+)["']/gi;
        var nm;
        while ((nm = nr.exec(noscript)) !== null) add(nm[1]);
      }
      if (strategy === "regex" && !urls.length) {
        var re = /<img[^>]+(?:data-src|data-lazy-src|src)\s*=\s*["']([^"']+\.(?:webp|jpg|jpeg|png)(?:\?[^"']*)?)["']/gi;
        var m;
        while ((m = re.exec(html)) !== null) add(m[1]);
      }
      if (strategy === "ts_reader" && !urls.length) {
        var ts = html.match(/ts_reader\.(?:run|init)\s*\(\s*({[\s\S]*?})\s*\)/);
        if (ts) {
          try {
            var data = JSON.parse(ts[1]);
            var list = (data.sources && data.sources[0] && data.sources[0].images) || data.images || [];
            for (var ti = 0; ti < list.length; ti++) add(String(list[ti]));
          } catch (e) {}
        }
      }
    }
    return urls;
  }

  return {
    requiresCloudflare: false,

    async getHomepageManga(args) {
      try {
        var page = (args && args.page) || 1;
        var html = await fetchHtml(baseUrl + "/manga-list" + (page > 1 ? "?page=" + page : ""));
        return await toMangaList(html, sel("homepage_list", ".manga-card"), {
          titleSel: "h3, .manga-title, .tt, a[dir='auto']",
          coverSel: "img",
          urlSel: "a[href*='/manga/']"
        });
      } catch (e) { return []; }
    },

    async search(args) {
      try {
        var query = (args && args.query) || "";
        if (!query.trim()) return [];
        var page = (args && args.page) || 1;
        var url = baseUrl + "/manga-list?search=" + encodeURIComponent(query) + (page > 1 ? "&page=" + page : "");
        var html = await fetchHtml(url);
        return await toMangaList(html, sel("search_list", ".manga-card, a[href^='/manga/'], .listupd .bs"), {
          titleSel: sel("search_title", "h3, .manga-title, .tt, a[dir='auto']"),
          coverSel: sel("search_cover", "img"),
          urlSel: sel("search_url", "a")
        });
      } catch (e) { return []; }
    },

    async getFilteredManga(args) {
      try {
        var page = (args && args.page) || 1;
        var genre = (args && args.genre) || "";
        var url = baseUrl + "/manga-list";
        var params = [];
        if (genre) params.push("genre=" + encodeURIComponent(String(genre).toLowerCase().replace(/ /g, "-")));
        if (args && args.type) params.push("type=" + encodeURIComponent(args.type));
        if (page > 1) params.push("page=" + page);
        if (params.length) url += "?" + params.join("&");
        var html = await fetchHtml(url);
        return await toMangaList(html, sel("filter_list", "a[href^='/manga/'], .manga-card, .listupd .bs"), {
          titleSel: sel("filter_title", "h3, .manga-title, .tt"),
          coverSel: sel("filter_cover", "img"),
          urlSel: sel("filter_url", "a")
        });
      } catch (e) { return []; }
    },

    async getMangaDetails(args) {
      var url = makeAbsolute((args && args.url) || "");
      var html = await fetchHtml(url);
      var props = extractAstroProps(html, "manga");
      var mangaData = props && props.manga;
      var title = (mangaData && mangaData.title) || await api.cssText(html, sel("manga_title", "h1, .manga-title, .entry-title")) || await api.cssAttr(html, "meta[property='og:title']", "content") || "بدون عنوان";
      var cover = (mangaData && mangaData.cover_image) || await api.cssAttr(html, sel("manga_cover", ".manga-cover img, .thumb img"), "src") || await api.cssAttr(html, sel("manga_cover", ".manga-cover img, .thumb img"), "data-src") || await api.cssAttr(html, "meta[property='og:image']", "content") || "";
      var description = (mangaData && mangaData.description) || await api.cssText(html, sel("manga_description", ".manga-description, .entry-content p, .entry-content")) || "";
      var genres = [];
      var rawTags = mangaData && (mangaData.Tags || mangaData.tags || mangaData.genres);
      if (Array.isArray(rawTags)) {
        for (var i = 0; i < rawTags.length; i++) genres.push(String((rawTags[i] && rawTags[i].name) || rawTags[i] || "").trim());
      } else {
        genres = await api.cssList(html, sel("manga_genres", ".genre-link, .mgen a, .genres a"));
      }
      return {
        title: stripHtml(title),
        coverUrl: processImageUrl(cover),
        description: stripHtml(description).replace("متابعة قراءة", "").trim(),
        genres: genres.map(function (g) { return String(g).trim(); }).filter(function (g) { return !!g; }),
        chapters: await extractChapters(html, mangaData),
        originalUrl: url,
        hasMoreChapters: false,
        lastFetchedPage: 1,
        contentType: "manga"
      };
    },

    async getChapterPages(args) {
      var chapterUrl = makeAbsolute((args && args.url) || "");
      lastChapterUrl = chapterUrl;
      return await extractPagesWithFallback(await fetchHtml(chapterUrl));
    },

    async getChapterContent(args) {
      var chapterUrl = makeAbsolute((args && args.url) || "");
      lastChapterUrl = chapterUrl;
      var html = await fetchHtml(chapterUrl);
      var props = extractAstroProps(html, "imageUrls");
      var imageUrls = extractImageUrlsFromProps(props || {});
      if (!imageUrls.length) imageUrls = await extractPagesWithFallback(html);
      if (props && String(props.textMode || "") === "overlay" && props.overlayBlob && imageUrls.length) {
        // Overlay blobs are AES-GCM encrypted. The JS runtime currently exposes
        // no Dart crypto bridge, so overlay output is only possible when
        // WebCrypto's crypto.subtle is available; otherwise image mode is kept.
        try {
          var overlayData = await decryptOverlayBlob(props.overlayBlob);
          if (overlayData) return buildOverlayContent(imageUrls, overlayData, Number(props.overlayPageOffset || 0));
        } catch (e) {}
      }
      return { kind: "image", imageUrls: imageUrls };
    },

    async fetchMoreChapters() { return null; },

    async getGenresAndTypes() { return { genres: defaultGenres, types: defaultTypes }; },

    getImageHeaders() {
      return {
        "User-Agent": userAgent,
        "Referer": lastChapterUrl || baseUrl + "/",
        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "Accept-Language": "ar,en-US;q=0.9,en;q=0.8",
        "Sec-Fetch-Dest": "image",
        "Sec-Fetch-Mode": "no-cors",
        "Sec-Fetch-Site": "cross-site"
      };
    },

    sanitizeCoverUrl(args) { return processImageUrl((args && args.url) || "") || ((args && args.url) || ""); }
  };
}

if (typeof module !== "undefined") module.exports = { createSource: createSource };
