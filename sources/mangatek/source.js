function createSource(api, config) {
  var baseUrl = ((config && config.base_url) || "https://mangatek.com").replace(/\/+$/, "");
  var configHeaders = (config && config.headers) || {};
  var userAgent =
    configHeaders["User-Agent"] ||
    (config && config.user_agent) ||
    "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
  var overlayKeyHex = "ff453871399fe268588a0936b45376022d85ed0fd1292001d5102f6a30291dc1";
  var lastChapterUrl = baseUrl + "/";

  var defaultHeaders = mergeHeaders(
    {
      "User-Agent": userAgent,
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
      "Accept-Language": "ar,en-US;q=0.9,en;q=0.8",
      Referer: baseUrl + "/",
      Origin: baseUrl,
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "same-origin",
      "Upgrade-Insecure-Requests": "1"
    },
    configHeaders
  );

  function mergeHeaders(a, b) {
    var out = {};
    for (var k in a) out[k] = a[k];
    if (b) for (var x in b) out[x] = b[x];
    return out;
  }

  async function fetchHtml(url, method) {
    var headers = defaultHeaders;
    if (api.http) {
      var res = await api.http(url, {
        method: method || "GET",
        headers: headers
      });
      if (!res || !res.ok)
        throw new Error("HTTP " + (res ? res.status : 0) + " for " + url);
      return res.body || "";
    }
    if (method && method !== "GET") return "";
    var html = await api.fetchText(url, headers);
    if (!html) throw new Error("Empty response: " + url);
    return html;
  }

  // ────────────────── HTML entity decode ──────────────────
  function htmlDecode(value) {
    return String(value || "")
      .replace(/&/g, "&")
      .replace(/"/g, '"')
      .replace(/&#34;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/'/g, "'")
      .replace(/</g, "<")
      .replace(/>/g, ">")
      .replace(/&#x27;/g, "'")
      .replace(/\\\//g, "/")
      .trim();
  }

  // ────────────────── URL helpers (match Dart _makeAbsoluteUrl) ──────────────────
  function abs(url) {
    if (!url) return "";
    url = htmlDecode(url);
    if (url.indexOf("http://") === 0) return "https://" + url.substring(7);
    if (url.indexOf("https://") === 0) return url;
    if (url.indexOf("//") === 0) return "https:" + url;
    if (url.charAt(0) === "/") return baseUrl + url;
    return baseUrl + "/" + url;
  }

  // ────────────────── Image extraction helpers (match Dart _extractImageUrl) ──────────────────
  function extractImageUrlFromAttrs(attrs) {
    if (!attrs) return "";
    var url = String(attrs["data-src"] || "").trim();
    if (!url || url.indexOf("data:image/") === 0) {
      url = String(attrs["data-lazy-src"] || "").trim();
    }
    if (!url || url.indexOf("data:image/") === 0) {
      url = String(attrs.src || "").trim();
    }
    if (url.indexOf("data:image/") === 0) return "";
    return url;
  }

  // Process image URL (match Dart _processImageUrl)
  function processImageUrl(src) {
    if (!src) return "";
    var lower = String(src).toLowerCase();
    if (lower.endsWith(".svg")) return "";
    if (lower.endsWith(".gif") && lower.indexOf("icon") !== -1) return "";
    if (lower.indexOf("data:") === 0 && lower.indexOf("data:image") !== 0) return "";
    if (lower.indexOf("http") === 0 || lower.indexOf("//") === 0 || lower.charAt(0) === "/") {
      return abs(src);
    }
    return "";
  }

  function strip(s) {
    return htmlDecode(String(s || "").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
  }

  // ────────────────── Astro devalue parser (match Dart _parseAstroProp) ──────────────────
  function parseAstroProp(prop) {
    if (prop !== null && typeof prop === "object" && !Array.isArray(prop)) {
      var obj = {};
      for (var k in prop) obj[k] = parseAstroProp(prop[k]);
      return obj;
    }
    if (Array.isArray(prop) && prop.length > 0) {
      var type = prop[0];
      var value = prop.length > 1 ? prop[1] : null;
      if (type === 0) {
        // Object or primitive
        if (value !== null && typeof value === "object" && !Array.isArray(value)) {
          var obj2 = {};
          for (var k2 in value) obj2[k2] = parseAstroProp(value[k2]);
          return obj2;
        }
        return value;
      } else if (type === 1) {
        // Array
        if (Array.isArray(value)) {
          return value.map(parseAstroProp);
        }
        return [];
      }
    }
    return prop;
  }

  // Extract astro-island props from raw HTML by needle search
  function extractAstroProps(html, needle) {
    var regex = /<astro-island\b[^>]*\sprops=(['"])([\s\S]*?)\1[^>]*>/gi;
    var match;
    while ((match = regex.exec(html)) !== null) {
      var rawProps = match[2];
      var decoded = htmlDecode(rawProps);
      // JSON parse issue: htmlDecode may produce string with both raw and
      // escaped slashes. Handle gracefully.
      if (needle && decoded.indexOf(needle) === -1) continue;
      try {
        var parsed = JSON.parse(decoded);
        return parseAstroProp(parsed);
      } catch (e) {
        // Try once more with stricter entity cleanup
        try {
          var clean = decoded
            .replace(/\\u002F/gi, "/")
            .replace(/\\u0026/gi, "&")
            .replace(/\\u003C/gi, "<")
            .replace(/\\u003E/gi, ">");
          return parseAstroProp(JSON.parse(clean));
        } catch (e2) {}
      }
    }
    return null;
  }

  // ────────────────── Image URL extraction from props (match Dart _extractImageUrlsFromProps) ──────────────────
  function extractImageUrlsFromProps(props) {
    var raw = props && props.imageUrls;
    if (!Array.isArray(raw)) return [];
    var out = [];
    var seen = {};
    for (var i = 0; i < raw.length; i++) {
      var item = raw[i];
      var src = "";
      if (typeof item === "string") src = item;
      else if (item && typeof item === "object") {
        if (item.isTrap === true) continue;
        src = item.url || item.src || "";
      }
      var url = processImageUrl(src);
      if (url && !seen[url]) {
        seen[url] = true;
        out.push(url);
      }
    }
    return out;
  }

  // ────────────────── Overlay decryption (uses Dart bridge) ──────────────────
  async function decryptOverlayBlob(blob) {
    if (api.decryptAesGcm) {
      return await api.decryptAesGcm(blob, overlayKeyHex);
    }
    return null;
  }

  function buildOverlayContent(imageUrls, overlayData, overlayPageOffset) {
    var pages =
      overlayData && Array.isArray(overlayData.pages) ? overlayData.pages : [];
    var pageMap = {};
    for (var i = 0; i < pages.length; i++) {
      var page = pages[i] || {};
      var pageNum =
        page.page_number || page.pageNumber || page.pageNumber || 0;
      pageMap[pageNum] = Array.isArray(page.overlays) ? page.overlays : [];
    }
    var pageOverlays = [];
    for (var p = 0; p < imageUrls.length; p++) {
      pageOverlays.push(pageMap[p - overlayPageOffset + 1] || []);
    }
    var first = (pages.length && pages[0]) || {};
    return {
      kind: "overlay",
      imageUrls: imageUrls,
      pageOverlays: pageOverlays,
      naturalImageWidth:
        overlayData.natural_image_width ||
        overlayData.naturalImageWidth ||
        first.image_width ||
        first.imageWidth ||
        800,
      naturalImageHeight:
        overlayData.natural_image_height ||
        overlayData.naturalImageHeight ||
        first.image_height ||
        first.imageHeight ||
        1200
    };
  }

  // ────────────────── Homepage list cards (match Dart getHomepageManga) ──────────────────
  async function listCards(html) {
    var items = await api.cssAll(html, ".chapter-card");
    var out = [];
    var seen = {};
    for (var i = 0; i < items.length; i++) {
      var item = items[i] || {};
      var itemHtml = item.html || "";
      // Find a[href^="/manga/"]
      var href = await api.cssAttr(itemHtml, 'a[href^="/manga/"]', "href");
      if (!href && item.attrs && item.attrs.href && String(item.attrs.href).indexOf("/manga/") !== -1) {
        href = item.attrs.href;
      }
      if (!href) continue;
      var detailUrl = abs(href);
      if (!detailUrl || seen[detailUrl]) continue;
      seen[detailUrl] = true;

      // Cover — find img
      var cover = "";
      var imgAttrs = null;
      var imgHtml = await api.cssHtml(itemHtml, "img");
      if (imgHtml) {
        var imgTagMatch = imgHtml.match(/<img[^>]*>/i);
        if (imgTagMatch) {
          var attrs = {};
          var attrRegex = /(\w[\w-]*)\s*=\s*["']([^"']*)["']/gi;
          var am;
          while ((am = attrRegex.exec(imgTagMatch[0])) !== null) {
            attrs[am[1].toLowerCase()] = am[2];
          }
          var raw = extractImageUrlFromAttrs(attrs);
          cover = processImageUrl(raw);
        }
      }

      // Title — h4.chapter-title first, then img alt/title fallback
      var title = await api.cssText(itemHtml, "h4.chapter-title");
      if (title) title = title.trim();
      if (!title) {
        var imgAlt = await api.cssAttr(itemHtml, "img", "alt");
        var imgTitle = await api.cssAttr(itemHtml, "img", "title");
        title = (imgAlt || imgTitle || "").trim();
      }
      if (!title) continue;

      out.push({
        title: strip(title),
        coverUrl: cover,
        detailUrl: detailUrl,
        contentType: "manga"
      });
    }
    return out;
  }

  // ────────────────── Search/filter list (match Dart search / getFilteredManga) ──────────────────
  async function listSearchCards(html) {
    var items = await api.cssAll(html, 'a[href^="/manga/"], .manga-card, .listupd .bs');
    var out = [];
    var seen = {};
    for (var i = 0; i < items.length; i++) {
      var item = items[i] || {};
      var itemHtml = item.html || "";

      // Extract href — check element.attrs first, then inner <a>
      var href = "";
      if (item.attrs && item.attrs.href && String(item.attrs.href).indexOf("/manga/") !== -1) {
        href = item.attrs.href;
      } else {
        href = await api.cssAttr(itemHtml, "a", "href");
        if (!href && itemHtml) {
          var m = itemHtml.match(/<a[^>]+href\s*=\s*["']([^"']+)["']/i);
          if (m) href = htmlDecode(m[1]);
        }
      }
      if (!href) continue;
      var detailUrl = abs(href);
      if (!detailUrl || detailUrl.indexOf("/manga/") === -1 || seen[detailUrl]) continue;
      seen[detailUrl] = true;

      // Cover
      var cover = "";
      var imgRaw = await api.cssAttr(itemHtml, "img", "data-src");
      if (!imgRaw) imgRaw = await api.cssAttr(itemHtml, "img", "data-lazy-src");
      if (!imgRaw) imgRaw = await api.cssAttr(itemHtml, "img", "src");
      cover = processImageUrl(imgRaw);

      // Title — h3, .manga-title, .tt first, then img alt/title
      var title = await api.cssText(itemHtml, "h3, .manga-title, .tt");
      if (title) title = title.trim();
      if (!title) {
        var alt = await api.cssAttr(itemHtml, "img", "alt");
        var titleAttr = await api.cssAttr(itemHtml, "img", "title");
        if (alt) title = alt.trim();
        else if (titleAttr) title = titleAttr.trim();
      }
      if (!title) title = (item.text || "").trim();
      if (!title) continue;

      out.push({
        title: strip(title),
        coverUrl: cover,
        detailUrl: detailUrl,
        contentType: "manga"
      });
    }
    return out;
  }

  // ────────────────── Chapters from astro-island manga data (match Dart getMangaDetails) ──────────────────
  function extractChaptersFromMangaData(mangaData) {
    var chapters = [];
    var slug = mangaData.slug || "";
    var rawList = mangaData.MangaChapters || mangaData.chapters || [];
    if (!Array.isArray(rawList)) return [];

    for (var i = 0; i < rawList.length; i++) {
      var c = rawList[i] || {};
      var num = String(c.chapter_number || c.number || "");
      if (!num || num === "0") continue;
      var title = String(c.title || "") || "فصل " + num;
      var rawDate = String(c.created_at || c.createdAt || "");
      var date = rawDate;
      // Try to format date as YYYY-MM-DD
      var dateMatch = date.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (dateMatch) date = dateMatch[1] + "-" + dateMatch[2] + "-" + dateMatch[3];

      var isLocked = c.access === false || (c.price != null && Number(c.price) > 0);

      var url = slug && num ? abs("/reader/" + slug + "/" + num) : "";

      chapters.push({
        number: num,
        title: title,
        url: url,
        views: 0,
        isLocked: isLocked,
        date: date
      });
    }

    chapters.sort(function (a, b) {
      return (parseFloat(b.number) || 0) - (parseFloat(a.number) || 0);
    });
    return chapters;
  }

  // ────────────────── Chapters from HTML fallback (match Dart _parseChapters) ──────────────────
  async function extractChaptersFromHtml(html) {
    var listSel =
      'a[href*="/reader/"], a[href*="/chapter/"], .chapter-item, #chapterlist li, .eplister li';
    var items = await api.cssAll(html, listSel);
    var out = [];
    var seen = {};
    for (var i = 0; i < items.length; i++) {
      var item = items[i] || {};
      var itemHtml = item.html || "";

      var href = "";
      if (item.attrs && item.attrs.href) href = item.attrs.href;
      else href = (await api.cssAttr(itemHtml, "a", "href")) || "";
      if (!href && itemHtml) {
        var m = itemHtml.match(/<a[^>]+href\s*=\s*["']([^"']+)["']/i);
        if (m) href = htmlDecode(m[1]);
      }

      var url = abs(href || "");
      if (!url || seen[url]) continue;
      seen[url] = true;

      // Extract chapter number
      var num = "";
      if (item.attrs) num = item.attrs["data-num"] || "";
      if (!num) {
        var combined = (url + " " + (item.text || ""));
        var m2 = combined.match(/(?:فصل|chapter|ch)[\s_.-]*(\d+(?:\.\d+)?)/i);
        if (m2) num = m2[1];
        else {
          var m3 = combined.match(/(\d+(?:\.\d+)?)/);
          num = m3 ? m3[1] : "0";
        }
      }

      // Date
      var date = await api.cssText(itemHtml, ".chapter-date, .chapterdate") || "";

      // Locked
      var itemHtmlLower = (itemHtml || "").toLowerCase();
      var isLocked = /locked|paywall|fa-lock/.test(itemHtmlLower);

      out.push({
        number: num,
        title: "",
        url: url,
        views: 0,
        isLocked: isLocked,
        date: (date || "").trim()
      });
    }

    out.sort(function (a, b) {
      return (parseFloat(b.number) || 0) - (parseFloat(a.number) || 0);
    });
    return out;
  }

  // ────────────────── Chapter content extraction (match Dart getChapterContent) ──────────────────
  async function extractChapterImages(html) {
    // Strategy 1: Astro-island with imageUrls
    var props = extractAstroProps(html, "imageUrls");
    if (props) {
      var imageUrls = extractImageUrlsFromProps(props);
      if (imageUrls.length) {
        var textMode = String(props.textMode || "");
        var overlayBlob = props.overlayBlob;
        var overlayPageOffset = Number(props.overlayPageOffset || 0);

        if (textMode === "overlay" && overlayBlob) {
          try {
            var overlayData = await decryptOverlayBlob(overlayBlob);
            if (overlayData) {
              return buildOverlayContent(
                imageUrls,
                overlayData,
                overlayPageOffset
              );
            }
          } catch (e) {}
        }

        return { kind: "image", imageUrls: imageUrls };
      }
    }

    // Strategy 2: selector fallbacks (selector → noscript → regex → ts_reader)
    var strategies = ["selector", "noscript", "regex", "ts_reader"];
    for (var s = 0; s < strategies.length; s++) {
      var strategy = strategies[s];
      var urls = [];

      if (strategy === "selector") {
        var selectors = [
          "#readerarea img",
          ".reader-area img",
          ".chapter-image",
          ".reading-content img",
          ".page-break img"
        ];
        for (var ci = 0; ci < selectors.length && !urls.length; ci++) {
          var nodes = await api.cssAll(html, selectors[ci]);
          // Sort by data-index attribute when present
          nodes.sort(function (a, b) {
            var ai = parseInt(((a.attrs || {})["data-index"]) || "999999", 10);
            var bi = parseInt(((b.attrs || {})["data-index"]) || "999999", 10);
            return (ai || 999999) - (bi || 999999);
          });
          for (var ni = 0; ni < nodes.length; ni++) {
            var raw = extractImageUrlFromAttrs(nodes[ni].attrs || {});
            var processed = processImageUrl(raw);
            if (processed && urls.indexOf(processed) === -1) urls.push(processed);
          }
        }
      }

      if (strategy === "noscript" && !urls.length) {
        var container =
          (await api.cssHtml(html, "#readerarea")) ||
          (await api.cssHtml(html, ".reader-area")) ||
          (await api.cssHtml(html, ".reading-content")) ||
          "";
        var nsMatch = container.match(/<noscript[^>]*>([\s\S]*?)<\/noscript>/i);
        if (nsMatch) {
          var nsRe = /<img[^>]+(?:data-src|data-lazy-src|src)\s*=\s*["']([^"']+)["']/gi;
          var nsM;
          while ((nsM = nsRe.exec(nsMatch[1])) !== null) {
            var processedNs = processImageUrl(nsM[1]);
            if (processedNs && urls.indexOf(processedNs) === -1)
              urls.push(processedNs);
          }
        }
      }

      if (strategy === "regex" && !urls.length) {
        var containerHtml =
          (await api.cssHtml(html, "#readerarea")) ||
          (await api.cssHtml(html, ".reader-area")) ||
          (await api.cssHtml(html, ".reading-content")) ||
          "";
        if (!containerHtml) containerHtml = html;
        var re = /<img[^>]+(?:data-src|data-lazy-src|src)\s*=\s*["']([^"']+\.(?:webp|jpg|jpeg|png)(?:\?[^"']*)?)["']/gi;
        var rm;
        while ((rm = re.exec(containerHtml)) !== null) {
          var processedR = processImageUrl(rm[1]);
          if (processedR && urls.indexOf(processedR) === -1)
            urls.push(processedR);
        }
      }

      if (strategy === "ts_reader" && !urls.length) {
        var tsMatch = html.match(/ts_reader\.(?:run|init)\s*\(\s*({[\s\S]*?})\s*\)/);
        if (tsMatch) {
          try {
            var tsData = JSON.parse(tsMatch[1]);
            var images =
              (tsData.sources &&
                tsData.sources[0] &&
                tsData.sources[0].images) ||
              tsData.images ||
              [];
            for (var ti = 0; ti < images.length; ti++) {
              var processedTs = processImageUrl(String(images[ti]));
              if (processedTs && urls.indexOf(processedTs) === -1)
                urls.push(processedTs);
            }
          } catch (e) {}
        }
      }

      if (urls.length) return { kind: "image", imageUrls: urls };
    }

    return { kind: "image", imageUrls: [] };
  }

  var defaultGenres = [
    "أكشن",
    "مغامرة",
    "كوميدي",
    "خيال",
    "دراما",
    "رومانسي",
    "شوجو",
    "شونين",
    "إثارة",
    "رعب",
    "فنون قتال",
    "مأساة"
  ];
  var defaultTypes = ["manga", "manhwa", "manhua", "comic"];

  return {
    requiresCloudflare: false,

    // ────────────────── Homepage ──────────────────
    async getHomepageManga(args) {
      try {
        var page = (args && args.page) || 1;
        var url =
          page === 1
            ? baseUrl + "/latest"
            : baseUrl + "/latest?page=" + page;
        return await listCards(await fetchHtml(url));
      } catch (e) {
        return [];
      }
    },

    // ────────────────── Search ──────────────────
    async search(args) {
      try {
        var query = (args && args.query) || "";
        if (!query.trim()) return [];
        var page = (args && args.page) || 1;
        var encoded = encodeURIComponent(query);
        var url =
          page === 1
            ? baseUrl + "/manga-list?search=" + encoded
            : baseUrl + "/manga-list?search=" + encoded + "&page=" + page;
        return await listSearchCards(await fetchHtml(url));
      } catch (e) {
        return [];
      }
    },

    // ────────────────── Filter ──────────────────
    async getFilteredManga(args) {
      try {
        var page = (args && args.page) || 1;
        var genre = (args && args.genre) || "";
        var type = (args && args.type) || "";
        var url = baseUrl + "/manga-list";
        var params = [];
        if (genre) {
          var genreSlug = String(genre)
            .toLowerCase()
            .replace(/ /g, "-");
          params.push("genre=" + encodeURIComponent(genreSlug));
        }
        if (type) params.push("type=" + encodeURIComponent(type));
        if (page > 1) params.push("page=" + page);
        if (params.length) url += "?" + params.join("&");
        return await listSearchCards(await fetchHtml(url));
      } catch (e) {
        return [];
      }
    },

    // ────────────────── Details ──────────────────
    async getMangaDetails(args) {
      var url = abs((args && args.url) || "");
      var html = await fetchHtml(url);

      // Try astro-island parsing first
      var props = extractAstroProps(html, "manga");
      var mangaData = props && props.manga;

      if (mangaData) {
        var title = String(mangaData.title || "") || "بدون عنوان";
        var description = String(mangaData.description || "");
        var cover = processImageUrl(mangaData.cover_image || "");

        var genres = [];
        var tags = mangaData.Tags || mangaData.tags || mangaData.genres;
        if (Array.isArray(tags)) {
          for (var i = 0; i < tags.length; i++) {
            var t = tags[i];
            var name = "";
            if (typeof t === "string") name = t;
            else if (t && typeof t === "object") name = String(t.name || "");
            if (name) genres.push(name.trim());
          }
        }

        var chapters = extractChaptersFromMangaData(mangaData);

        return {
          title: strip(title),
          coverUrl: cover,
          description: strip(description).replace("متابعة قراءة", "").trim(),
          genres: genres,
          chapters: chapters,
          originalUrl: url,
          hasMoreChapters: false,
          lastFetchedPage: 1,
          contentType: "manga"
        };
      }

      // Fallback to HTML parsing (match Dart _getMangaDetailsFromHtml)
      var titleFallback =
        (await api.cssText(html, "h1, .manga-title, .entry-title")) ||
        (await api.cssAttr(html, "meta[property='og:title']", "content")) ||
        "بدون عنوان";

      var coverFallback =
        (await api.cssAttr(html, ".manga-cover img", "src")) ||
        (await api.cssAttr(html, ".manga-cover img", "data-src")) ||
        (await api.cssAttr(html, ".thumb img", "src")) ||
        (await api.cssAttr(html, ".thumb img", "data-src")) ||
        (await api.cssAttr(html, "meta[property='og:image']", "content")) ||
        "";
      coverFallback = processImageUrl(coverFallback);

      var descFallback =
        (await api.cssText(html, ".manga-description, .entry-content p, .entry-content")) || "";
      descFallback = strip(descFallback).replace("متابعة قراءة", "").trim();

      var genresFallback = await api.cssList(html, ".genre-link, .mgen a, .genres a");
      genresFallback = (genresFallback || []).map(strip).filter(Boolean);

      var chaptersFallback = await extractChaptersFromHtml(html);

      return {
        title: strip(titleFallback),
        coverUrl: coverFallback,
        description: descFallback,
        genres: genresFallback,
        chapters: chaptersFallback,
        originalUrl: url,
        hasMoreChapters: false,
        lastFetchedPage: 1,
        contentType: "manga"
      };
    },

    // ────────────────── Chapter content ──────────────────
    async getChapterPages(args) {
      var url = abs((args && args.url) || "");
      lastChapterUrl = url;
      var html = await fetchHtml(url);
      var result = await extractChapterImages(html);
      return result.imageUrls || [];
    },

    async getChapterContent(args) {
      var url = abs((args && args.url) || "");
      lastChapterUrl = url;
      var html = await fetchHtml(url);
      return await extractChapterImages(html);
    },

    // ────────────────── Misc ──────────────────
    async fetchMoreChapters() {
      return null;
    },

    async getGenresAndTypes() {
      return { genres: defaultGenres, types: defaultTypes };
    },

    getImageHeaders(args) {
      return {
        "User-Agent": userAgent,
        Referer: lastChapterUrl || baseUrl + "/",
        Accept:
          "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "Accept-Language": "ar,en-US;q=0.9,en;q=0.8",
        "Sec-Fetch-Dest": "image",
        "Sec-Fetch-Mode": "no-cors",
        "Sec-Fetch-Site": "cross-site"
      };
    },

    sanitizeCoverUrl(args) {
      return processImageUrl((args && args.url) || "") || ((args && args.url) || "");
    }
  };
}

if (typeof module !== "undefined") module.exports = { createSource: createSource };
