function createSource(api, config) {
  var baseUrl = ((config && config.base_url) || "https://mangasid.com").replace(/\/+$/, "");
  var apiBase = "https://api.mangasid.com";
  var selectors = (config && config.selectors) || {};
  var other = (config && config.other) || {};
  var userAgent = (config && config.user_agent) || "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
  var overlayKeyHex = "ff453871399fe268588a0936b45376022d85ed0fd1292001d5102f6a30291dc1";
  // Proof salt baked into the site viewer (ChapterImageViewer): proof = SHA256(salt|token|chapterId)
  var unlockProofSalt = "322c4e08571941fa05abf1a6a2b45c9a9bf7bcc94af61b66";
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
    for (var i = 0; i < raw.length; i++) {
      var item = raw[i];
      var src = "";
      if (typeof item === "string") src = item;
      if (item && typeof item === "object") {
        if (item.isTrap === true || item.trap === true) continue;
        src = item.url || item.src || "";
      }
      var url = processImageUrl(src);
      if (url) urls.push(url);
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

  // ────────────────── SHA-256 (ASCII) → hex, pure JS (no WebCrypto in QuickJS) ──
  function sha256HexAscii(ascii) {
    var K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
      0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
      0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
      0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
      0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
      0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
    var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var i, j;
    var bytes = [];
    for (i = 0; i < ascii.length; i++) bytes.push(ascii.charCodeAt(i) & 0xff);
    var bitLen = bytes.length * 8;
    bytes.push(0x80);
    while ((bytes.length % 64) !== 56) bytes.push(0);
    for (i = 7; i >= 0; i--) bytes.push((bitLen / Math.pow(2, i * 8)) & 0xff);
    var w = new Array(64);
    for (i = 0; i < bytes.length; i += 64) {
      for (j = 0; j < 16; j++) {
        w[j] = (bytes[i + j * 4] * 0x1000000) + (bytes[i + j * 4 + 1] << 16) + (bytes[i + j * 4 + 2] << 8) + bytes[i + j * 4 + 3];
      }
      for (j = 16; j < 64; j++) {
        var s0 = (((w[j - 15] >>> 7) | (w[j - 15] << 25)) ^ ((w[j - 15] >>> 18) | (w[j - 15] << 14)) ^ (w[j - 15] >>> 3)) >>> 0;
        var s1 = (((w[j - 2] >>> 17) | (w[j - 2] << 15)) ^ ((w[j - 2] >>> 19) | (w[j - 2] << 13)) ^ (w[j - 2] >>> 10)) >>> 0;
        w[j] = (w[j - 16] + s0 + w[j - 7] + s1) >>> 0;
      }
      var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (j = 0; j < 64; j++) {
        var S1 = (((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))) >>> 0;
        var ch = ((e & f) ^ (~e & g)) >>> 0;
        var t1 = (h + S1 + ch + K[j] + w[j]) >>> 0;
        var S0 = (((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))) >>> 0;
        var maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
        var t2 = (S0 + maj) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
      H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
    }
    var out = "";
    for (i = 0; i < 8; i++) {
      var x = H[i] >>> 0;
      out += ("00000000" + x.toString(16)).slice(-8);
    }
    return out;
  }

  // ────────────────── Overlay unlock (new scheme) ──────────────────
  // New overlay chapters ship an EMPTY overlayBlob in SSR props + overlay_via_unlock.
  // The site viewer unlocks text via POST {chapterId, token, proof} to /api/reader/unlock
  // (proof = SHA256(salt|token|chapterId)), then decrypts the returned blob with the
  // server-provided key. needs_challenge (PoW/Turnstile) is not solvable here → images.
  async function unlockOverlayContent(chapterId, unlockToken) {
    try {
      if (!chapterId || !unlockToken || !api.http) return null;
      var cidNum = Number(chapterId);
      var proof = sha256HexAscii(unlockProofSalt + "|" + unlockToken + "|" + chapterId);
      var payload = JSON.stringify({
        chapterId: cidNum || chapterId,
        token: unlockToken,
        proof: proof
      });
      var res = await api.http(apiBase + "/api/reader/unlock", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json, text/plain, */*",
          "Referer": baseUrl + "/",
          "Origin": baseUrl
        },
        body: payload
      });
      if (!res || !res.ok) return null;
      var data;
      try { data = JSON.parse(res.body || "{}"); } catch (eJson) { return null; }
      if (!data || data.success !== true) return null;
      if (data.needs_challenge) return null;
      if (!data.overlay || !data.key) return null;
      if (!api.decryptAesGcm) return null;
      var overlayData = await api.decryptAesGcm(data.overlay, data.key);
      if (!overlayData) return null;
      return { overlayData: overlayData, pageOffset: Number(data.overlay_page_offset || 0) };
    } catch (e) {
      return null;
    }
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
    out.angle = Number(out.angle) || 0;
    return out;
  }

  function buildOverlayContent(imageUrls, overlayData, overlayPageOffset) {
    var pages = (overlayData && Array.isArray(overlayData.pages)) ? overlayData.pages : [];
    var pageMap = {};
    var widthCounts = {};
    var heightCounts = {};
    for (var ii = 0; ii < pages.length; ii++) {
      var pg = pages[ii] || {};
      if (pg.image_width) widthCounts[pg.image_width] = (widthCounts[pg.image_width] || 0) + 1;
      if (pg.image_height) heightCounts[pg.image_height] = (heightCounts[pg.image_height] || 0) + 1;
    }
    var naturalW = 0, maxCount = 0;
    for (var w in widthCounts) { if (widthCounts[w] > maxCount) { maxCount = widthCounts[w]; naturalW = Number(w); } }
    var naturalH = 0; maxCount = 0;
    for (var hh in heightCounts) { if (heightCounts[hh] > maxCount) { maxCount = heightCounts[hh]; naturalH = Number(hh); } }
    var firstPg = pages[0] || {};
    if (!naturalW) naturalW = overlayData.natural_image_width || overlayData.naturalImageWidth || firstPg.image_width || firstPg.imageWidth || 800;
    if (!naturalH) naturalH = overlayData.natural_image_height || overlayData.naturalImageHeight || firstPg.image_height || firstPg.imageHeight || 1200;

    for (var i = 0; i < pages.length; i++) {
      var page = pages[i] || {};
      var pageNum = page.page_number || page.pageNumber || 0;
      var rawOverlays = Array.isArray(page.overlays) ? page.overlays : [];
      var normalizedOverlays = [];
      var pageW = Number(page.image_width || page.imageWidth || naturalW) || naturalW;
      var s = pageW !== naturalW ? naturalW / pageW : 1;
      for (var j = 0; j < rawOverlays.length; j++) {
        var ov = rawOverlays[j];
        if (ov && typeof ov === "object") {
          var norm = normalizeOverlayItem(ov);
          norm.x = Number((norm.x * s).toFixed(2));
          norm.y = Number((norm.y * s).toFixed(2));
          norm.w = Number((norm.w * s).toFixed(2));
          norm.h = Number((norm.h * s).toFixed(2));
          normalizedOverlays.push(norm);
        }
      }
      pageMap[pageNum] = normalizedOverlays;
    }
    var pageOverlays = [];
    var offset = Number(overlayPageOffset) || 0;
    for (var p = 0; p < imageUrls.length; p++) {
      pageOverlays.push(pageMap[p - offset + 1] || []);
    }
    return {
      kind: "overlay",
      imageUrls: imageUrls,
      pageOverlays: pageOverlays,
      naturalImageWidth: naturalW,
      naturalImageHeight: naturalH
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
      if (props && String(props.textMode || "") === "overlay" && imageUrls.length) {
        try {
          var overlayData = null;
          var pageOffset = Number(props.overlayPageOffset || 0);
          // Legacy path: blob embedded in SSR props (fixed key)
          if (props.overlayBlob) {
            try { overlayData = await decryptOverlayBlob(props.overlayBlob); } catch (eLegacy) {}
          }
          // New path: overlay_via_unlock — fetch blob from reader/unlock API
          if (!overlayData) {
            try {
              var unlocked = await unlockOverlayContent(props.chapterId, props.unlockToken);
              if (unlocked) {
                overlayData = unlocked.overlayData;
                pageOffset = unlocked.pageOffset;
              }
            } catch (eUnlock) {}
          }
          if (overlayData) return buildOverlayContent(imageUrls, overlayData, pageOffset);
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
