function createSource(api, config) {
  var baseUrl = ((config && config.base_url) || "https://mangasid.com").replace(/\/+$/, "");
  var apiBase = "https://api.mangasid.com";
  var selectors = (config && config.selectors) || {};
  var other = (config && config.other) || {};
  var userAgent = (config && config.user_agent) || "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
  var overlayKeyHex = "ff453871399fe268588a0936b45376022d85ed0fd1292001d5102f6a30291dc1";
  // Proof salt baked into the CURRENT site viewer (ChapterImageViewer):
  // proof = SHA256(salt|token|chapterId). Rotated 2026-10 (old
  // 69e44f7f... stopped unlocking); extracted live from the mangasid
  // viewer bundle (same value as mangatek, but verify each site).
  var unlockProofSalt = "cc9544a33ccbc953b9e7546c9b134524f3c3a06e81d392f0";
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

  // The runtime exposes aesGcmDecrypt (current) and legacy decryptAesGcm;
  // both resolve the decrypted overlay object (or null). Prefer current.
  async function aesDecrypt(blob, keyHex) {
    try {
      if (!blob || !keyHex) return null;
      if (api.aesGcmDecrypt) return await api.aesGcmDecrypt(blob, keyHex);
      if (api.decryptAesGcm) return await api.decryptAesGcm(blob, keyHex);
    } catch (e) {}
    return null;
  }

  async function decryptOverlayBlob(blob) {
    // Use the Dart bridge for AES-GCM decryption (crypto.subtle is not available in flutter_js)
    return await aesDecrypt(blob, overlayKeyHex);
  }

  // ── Portable KDF (verbatim from kdfport_kdf_port.js: kdfUnwrapBytes + aesGcmDecryptPure + deps) ──
  var __SBOX = [99,124,119,123,242,107,111,197,48,1,103,43,254,215,171,118,202,130,201,125,250,89,71,240,173,212,162,175,156,164,114,192,183,253,147,38,54,63,247,204,52,165,229,241,113,216,49,21,4,199,35,195,24,150,5,154,7,18,128,226,235,39,178,117,9,131,44,26,27,110,90,160,82,59,214,179,41,227,47,132,83,209,0,237,32,252,177,91,106,203,190,57,74,76,88,207,208,239,170,251,67,77,51,133,69,249,2,127,80,60,159,168,81,163,64,143,146,157,56,245,188,182,218,33,16,255,243,210,205,12,19,236,95,151,68,23,196,167,126,61,100,93,25,115,96,129,79,220,34,42,144,136,70,238,184,20,222,94,11,219,224,50,58,10,73,6,36,92,194,211,172,98,145,149,228,121,231,200,55,109,141,213,78,169,108,86,244,234,101,122,174,8,186,120,37,46,28,166,180,198,232,221,116,31,75,189,139,138,112,62,181,102,72,3,246,14,97,53,87,185,134,193,29,158,225,248,152,17,105,217,142,148,155,30,135,233,206,85,40,223,140,161,137,13,191,230,66,104,65,153,45,15,176,84,187,22];
  function __rotr32(x, n) { return ((x >>> n) | (x << (32 - n))) >>> 0; }
  function sha256Bytes(data) {
    var K = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
    var H0 = 0x6a09e667, H1 = 0xbb67ae85, H2 = 0x3c6ef372, H3 = 0xa54ff53a, H4 = 0x510e527f, H5 = 0x9b05688c, H6 = 0x1f83d9ab, H7 = 0x5be0cd19;
    var l = data.length;
    var bitLen = l * 8;
    var newLen = (((l + 9 + 63) >> 6) << 6);
    var msg = new Uint8Array(newLen);
    var i;
    for (i = 0; i < l; i++) msg[i] = data[i] & 255;
    msg[l] = 128;
    var hi = Math.floor(bitLen / 4294967296);
    var lo = bitLen >>> 0;
    msg[newLen - 8] = (hi >>> 24) & 255;
    msg[newLen - 7] = (hi >>> 16) & 255;
    msg[newLen - 6] = (hi >>> 8) & 255;
    msg[newLen - 5] = hi & 255;
    msg[newLen - 4] = (lo >>> 24) & 255;
    msg[newLen - 3] = (lo >>> 16) & 255;
    msg[newLen - 2] = (lo >>> 8) & 255;
    msg[newLen - 1] = lo & 255;
    var w = new Uint32Array(64);
    var off, t, tt, k;
    var a, b, c, d, e, f, g, h;
    var S0, S1, ch, maj, t1, t2;
    for (off = 0; off < newLen; off += 64) {
      for (t = 0; t < 16; t++) w[t] = ((msg[off + t * 4] << 24) | (msg[off + t * 4 + 1] << 16) | (msg[off + t * 4 + 2] << 8) | msg[off + t * 4 + 3]) >>> 0;
      for (tt = 16; tt < 64; tt++) {
        S0 = (__rotr32(w[tt - 15], 7) ^ __rotr32(w[tt - 15], 18) ^ (w[tt - 15] >>> 3)) >>> 0;
        S1 = (__rotr32(w[tt - 2], 17) ^ __rotr32(w[tt - 2], 19) ^ (w[tt - 2] >>> 10)) >>> 0;
        w[tt] = (w[tt - 16] + S0 + w[tt - 7] + S1) >>> 0;
      }
      a = H0; b = H1; c = H2; d = H3; e = H4; f = H5; g = H6; h = H7;
      for (k = 0; k < 64; k++) {
        S1 = (__rotr32(e, 6) ^ __rotr32(e, 11) ^ __rotr32(e, 25)) >>> 0;
        ch = ((e & f) ^ ((~e) & g)) >>> 0;
        t1 = (h + S1 + ch + K[k] + w[k]) >>> 0;
        S0 = (__rotr32(a, 2) ^ __rotr32(a, 13) ^ __rotr32(a, 22)) >>> 0;
        maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
        t2 = (S0 + maj) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      H0 = (H0 + a) >>> 0; H1 = (H1 + b) >>> 0; H2 = (H2 + c) >>> 0; H3 = (H3 + d) >>> 0;
      H4 = (H4 + e) >>> 0; H5 = (H5 + f) >>> 0; H6 = (H6 + g) >>> 0; H7 = (H7 + h) >>> 0;
    }
    var out = new Uint8Array(32);
    out[0] = (H0 >>> 24) & 255; out[1] = (H0 >>> 16) & 255; out[2] = (H0 >>> 8) & 255; out[3] = H0 & 255;
    out[4] = (H1 >>> 24) & 255; out[5] = (H1 >>> 16) & 255; out[6] = (H1 >>> 8) & 255; out[7] = H1 & 255;
    out[8] = (H2 >>> 24) & 255; out[9] = (H2 >>> 16) & 255; out[10] = (H2 >>> 8) & 255; out[11] = H2 & 255;
    out[12] = (H3 >>> 24) & 255; out[13] = (H3 >>> 16) & 255; out[14] = (H3 >>> 8) & 255; out[15] = H3 & 255;
    out[16] = (H4 >>> 24) & 255; out[17] = (H4 >>> 16) & 255; out[18] = (H4 >>> 8) & 255; out[19] = H4 & 255;
    out[20] = (H5 >>> 24) & 255; out[21] = (H5 >>> 16) & 255; out[22] = (H5 >>> 8) & 255; out[23] = H5 & 255;
    out[24] = (H6 >>> 24) & 255; out[25] = (H6 >>> 16) & 255; out[26] = (H6 >>> 8) & 255; out[27] = H6 & 255;
    out[28] = (H7 >>> 24) & 255; out[29] = (H7 >>> 16) & 255; out[30] = (H7 >>> 8) & 255; out[31] = H7 & 255;
    return out;
  }
  function __strToBytes(s) {
    var n = s.length;
    var out = new Uint8Array(n);
    for (var i = 0; i < n; i++) out[i] = s.charCodeAt(i) & 255;
    return out;
  }
  function __decStr(n) {
    if (n === 0) return "0";
    var s = "";
    n = Math.floor(n);
    while (n > 0) { s = String.fromCharCode(48 + (n % 10)) + s; n = Math.floor(n / 10); }
    return s;
  }
  function __concat2(a, b) {
    var out = new Uint8Array(a.length + b.length);
    var i;
    for (i = 0; i < a.length; i++) out[i] = a[i];
    for (i = 0; i < b.length; i++) out[a.length + i] = b[i];
    return out;
  }
  function __concatN(parts, n) {
    var total = 0, i, j, o;
    for (i = 0; i < n; i++) total += parts[i].length;
    var out = new Uint8Array(total);
    o = 0;
    for (i = 0; i < n; i++) { for (j = 0; j < parts[i].length; j++) out[o++] = parts[i][j]; }
    return out;
  }
  function __isB64(b) {
    if (b >= 48 && b <= 57) return true;
    if (b >= 65 && b <= 90) return true;
    if (b >= 97 && b <= 122) return true;
    if (b === 43 || b === 47 || b === 61 || b === 45 || b === 95) return true;
    return false;
  }
  function __isDigit(b) { return b >= 48 && b <= 57; }
  function __b64Val(ch) {
    if (ch >= 65 && ch <= 90) return ch - 65;
    if (ch >= 97 && ch <= 122) return ch - 97 + 26;
    if (ch >= 48 && ch <= 57) return ch - 48 + 52;
    if (ch === 43 || ch === 45) return 62;
    if (ch === 47 || ch === 95) return 63;
    return -1;
  }
  function __b64ToBytes(txt) {
    var n = txt.length;
    var vals = [];
    var i, v;
    for (i = 0; i < n; i++) {
      var ch = txt[i];
      if (ch === 61) break;
      v = __b64Val(ch);
      if (v < 0) return null;
      vals.push(v);
    }
    var outLen = Math.floor(vals.length * 6 / 8);
    var out = new Uint8Array(outLen);
    var bits = 0, bitsN = 0, o = 0;
    for (i = 0; i < vals.length; i++) {
      bits = (bits << 6) | vals[i];
      bitsN += 6;
      if (bitsN >= 8) {
        bitsN -= 8;
        if (o < outLen) out[o++] = (bits >> bitsN) & 255;
        bits = bits & ((1 << bitsN) - 1);
      }
    }
    return out;
  }
  function __bytesToAscii(b) {
    var s = "";
    for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i] & 255);
    return s;
  }
  function __decryptE(N0, KS, wStrBytes, eSlice) {
    var elen = eSlice.length;
    var eAfter = new Uint8Array(elen);
    var i;
    for (i = 0; i < elen; i++) eAfter[i] = eSlice[i];
    var pipe = new Uint8Array(1); pipe[0] = 124;
    var vb = new Uint8Array(1); vb[0] = 118;
    var nBlocks = Math.floor((elen + 31) / 32);
    var blk, j, lim, base;
    for (blk = 0; blk < nBlocks; blk++) {
      var ctrBytes = __strToBytes(__decStr(blk));
      var p0 = __concat2(N0, pipe);
      var p1 = __concat2(p0, vb);
      var p2 = __concat2(p1, wStrBytes);
      var p3 = __concat2(p2, pipe);
      var p4 = __concat2(p3, KS);
      var p5 = __concat2(p4, pipe);
      var inp = __concat2(p5, ctrBytes);
      var ks = sha256Bytes(inp);
      base = blk * 32;
      lim = 32;
      if (base + lim > elen) lim = elen - base;
      for (j = 0; j < lim; j++) eAfter[base + j] = (eAfter[base + j] ^ ks[j]) & 255;
    }
    return eAfter;
  }
  function kdfUnwrapBytes(asmBytes, w, optTokLen, optCidLen) {
    if (!(asmBytes instanceof Uint8Array)) throw new Error("asmBytes must be Uint8Array");
    if (w !== 3) throw new Error("only w==3 supported, got " + w);
    var M = asmBytes.length;
    if (M < 48 + 32 + 1 + 1 + 32) throw new Error("asm too short");
    var N0 = asmBytes.slice(0, 48);
    var KS = asmBytes.slice(48, 80);
    var wStrBytes = __strToBytes(__decStr(w));
    var c0 = -1, elen = -1, eAfter = null, H0 = -1, H1 = -1;
    var hasExplicit = (typeof optTokLen === "number" && typeof optCidLen === "number");
    if (hasExplicit) {
      if (optTokLen < 1 || optCidLen < 1) throw new Error("bad explicit lens");
      c0 = 80 + optTokLen + optCidLen;
      if (c0 > M) throw new Error("explicit c0 beyond M");
      elen = M - c0;
      var eSlice0 = asmBytes.slice(c0, M);
      eAfter = __decryptE(N0, KS, wStrBytes, eSlice0);
      H0 = eAfter[0] * 256 + eAfter[1];
      H1 = eAfter[2] * 256 + eAfter[3];
    } else {
      var guess = -1, k;
      for (k = 80; k < M; k++) { if (!__isB64(asmBytes[k])) { guess = k; break; } }
      if (guess < 0) throw new Error("cannot locate e (no non-b64)");
      var lo = guess - 16;
      if (lo < 82) lo = 82;
      var found = false;
      for (c0 = guess; c0 >= lo; c0--) {
        elen = M - c0;
        if (elen < 32) continue;
        var eSlice = asmBytes.slice(c0, M);
        var trial = __decryptE(N0, KS, wStrBytes, eSlice);
        var tH0 = trial[0] * 256 + trial[1];
        var tH1 = trial[2] * 256 + trial[3];
        if (tH0 === 16 && tH1 === 12) { eAfter = trial; H0 = tH0; H1 = tH1; found = true; break; }
      }
      if (!found) throw new Error("header check failed (no c0 with 0010000c)");
      elen = M - c0;
    }
    if (H0 !== 16 || H1 !== 12) throw new Error("unexpected header H0=" + H0 + " H1=" + H1);
    var i0 = elen - (H0 + 4 + H1);
    if (i0 <= 0) throw new Error("bad i0=" + i0);
    var tag = eAfter.slice(4, 4 + H0);
    var ct = eAfter.slice(4 + H0, 4 + H0 + i0);
    var iv = eAfter.slice(4 + H0 + i0, 4 + H0 + i0 + H1);
    var tokLen = -1, cidLen = -1, TOK = null, CID = null;
    if (hasExplicit) {
      tokLen = optTokLen; cidLen = optCidLen;
      TOK = asmBytes.slice(80, 80 + tokLen);
      CID = asmBytes.slice(80 + tokLen, c0);
    } else {
      var tokCidLen = c0 - 80;
      var bestTok = -1, bestCid = -1;
      var cidTry;
      for (cidTry = 1; cidTry <= 10; cidTry++) {
        if (cidTry > tokCidLen - 1) break;
        var tLen = tokCidLen - cidTry;
        var cStart = 80 + tLen;
        var okD = true, q;
        for (q = cStart; q < c0; q++) { if (!__isDigit(asmBytes[q])) { okD = false; break; } }
        if (!okD) continue;
        var okB = true;
        for (q = 80; q < cStart; q++) { if (!__isB64(asmBytes[q])) { okB = false; break; } }
        if (!okB) continue;
        if ((tLen % 4) !== 0) continue;
        var tokBytes = asmBytes.slice(80, cStart);
        var cidBytes = asmBytes.slice(cStart, c0);
        var dec = __b64ToBytes(tokBytes);
        if (dec === null) continue;
        var decStr = __bytesToAscii(dec);
        var cidStr = __bytesToAscii(cidBytes);
        if (decStr.length > cidStr.length && decStr.slice(0, cidStr.length) === cidStr && decStr.charCodeAt(cidStr.length) === 124) {
          bestTok = tLen; bestCid = cidTry; break;
        }
      }
      if (bestTok < 0) {
        for (cidTry = 1; cidTry <= 10; cidTry++) {
          if (cidTry > tokCidLen - 1) break;
          var tLen2 = tokCidLen - cidTry;
          var cS2 = 80 + tLen2;
          var okD2 = true, qq;
          for (qq = cS2; qq < c0; qq++) { if (!__isDigit(asmBytes[qq])) { okD2 = false; break; } }
          if (!okD2) continue;
          var okB2 = true;
          for (qq = 80; qq < cS2; qq++) { if (!__isB64(asmBytes[qq])) { okB2 = false; break; } }
          if (!okB2) continue;
          if ((tLen2 % 4) !== 0) continue;
          bestTok = tLen2; bestCid = cidTry; break;
        }
      }
      if (bestTok < 0) throw new Error("cannot split TOK/CID (tokCidLen=" + tokCidLen + ")");
      tokLen = bestTok; cidLen = bestCid;
      TOK = asmBytes.slice(80, 80 + tokLen);
      CID = asmBytes.slice(80 + tokLen, c0);
    }
    var a0 = __concat2(N0, new Uint8Array([124]));
    var a1 = __concat2(a0, new Uint8Array([118]));
    var a2 = __concat2(a1, wStrBytes);
    var a3 = __concat2(a2, new Uint8Array([124]));
    var a4 = __concat2(a3, KS);
    var a5 = __concat2(a4, new Uint8Array([124]));
    var a6 = __concat2(a5, TOK);
    var a7 = __concat2(a6, new Uint8Array([124]));
    var inp2 = __concat2(a7, CID);
    var key = sha256Bytes(inp2);
    return { iv: iv, key: key, ct: ct, tag: tag, d: H1, q: H0, i0: i0 };
  }
  function __xtime(a) { return ((a << 1) ^ ((a & 128) ? 27 : 0)) & 255; }
  function __mul2(a) { return __xtime(a); }
  function __mul3(a) { return (__xtime(a) ^ a) & 255; }
  function __aesKeyExpand256(keyBytes) {
    var w = [];
    var i, k;
    for (i = 0; i < 8; i++) w.push(((keyBytes[i * 4] << 24) | (keyBytes[i * 4 + 1] << 16) | (keyBytes[i * 4 + 2] << 8) | keyBytes[i * 4 + 3]) >>> 0);
    var RCON = [1, 2, 4, 8, 16, 32, 64, 128, 27, 54];
    for (k = 8; k < 60; k++) {
      var temp = w[k - 1];
      if ((k % 8) === 0) {
        temp = (((__SBOX[(temp >>> 16) & 255] << 24) | (__SBOX[(temp >>> 8) & 255] << 16) | (__SBOX[temp & 255] << 8) | __SBOX[(temp >>> 24) & 255]) ^ (RCON[Math.floor(k / 8) - 1] << 24)) >>> 0;
      } else {
        if ((k % 8) === 4) temp = ((__SBOX[(temp >>> 24) & 255] << 24) | (__SBOX[(temp >>> 16) & 255] << 16) | (__SBOX[(temp >>> 8) & 255] << 8) | __SBOX[temp & 255]) >>> 0;
      }
      w.push((w[k - 8] ^ temp) >>> 0);
    }
    return w;
  }
  function __aesEncryptBlock(block16, w) {
    var s = [], i, c, round, col, cc, k, kk, ccc;
    for (i = 0; i < 16; i++) s.push(block16[i] & 255);
    for (c = 0; c < 4; c++) {
      var wd = w[c];
      s[c * 4] ^= (wd >>> 24) & 255; s[c * 4 + 1] ^= (wd >>> 16) & 255; s[c * 4 + 2] ^= (wd >>> 8) & 255; s[c * 4 + 3] ^= wd & 255;
    }
    for (round = 1; round < 14; round++) {
      for (k = 0; k < 16; k++) s[k] = __SBOX[s[k]];
      var t = [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0];
      t[0] = s[0]; t[4] = s[4]; t[8] = s[8]; t[12] = s[12];
      t[1] = s[5]; t[5] = s[9]; t[9] = s[13]; t[13] = s[1];
      t[2] = s[10]; t[6] = s[14]; t[10] = s[2]; t[14] = s[6];
      t[3] = s[15]; t[7] = s[3]; t[11] = s[7]; t[15] = s[11];
      s = t;
      for (col = 0; col < 4; col++) {
        var a0 = s[col * 4], a1 = s[col * 4 + 1], a2 = s[col * 4 + 2], a3 = s[col * 4 + 3];
        s[col * 4] = (__mul2(a0) ^ __mul3(a1) ^ a2 ^ a3) & 255;
        s[col * 4 + 1] = (a0 ^ __mul2(a1) ^ __mul3(a2) ^ a3) & 255;
        s[col * 4 + 2] = (a0 ^ a1 ^ __mul2(a2) ^ __mul3(a3)) & 255;
        s[col * 4 + 3] = (__mul3(a0) ^ a1 ^ a2 ^ __mul2(a3)) & 255;
      }
      var base = round * 4;
      for (cc = 0; cc < 4; cc++) {
        var ww = w[base + cc];
        s[cc * 4] ^= (ww >>> 24) & 255; s[cc * 4 + 1] ^= (ww >>> 16) & 255; s[cc * 4 + 2] ^= (ww >>> 8) & 255; s[cc * 4 + 3] ^= ww & 255;
      }
    }
    for (kk = 0; kk < 16; kk++) s[kk] = __SBOX[s[kk]];
    var tt = [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0];
    tt[0] = s[0]; tt[4] = s[4]; tt[8] = s[8]; tt[12] = s[12];
    tt[1] = s[5]; tt[5] = s[9]; tt[9] = s[13]; tt[13] = s[1];
    tt[2] = s[10]; tt[6] = s[14]; tt[10] = s[2]; tt[14] = s[6];
    tt[3] = s[15]; tt[7] = s[3]; tt[11] = s[7]; tt[15] = s[11];
    s = tt;
    var fb = 56;
    for (ccc = 0; ccc < 4; ccc++) {
      var www = w[fb + ccc];
      s[ccc * 4] ^= (www >>> 24) & 255; s[ccc * 4 + 1] ^= (www >>> 16) & 255; s[ccc * 4 + 2] ^= (www >>> 8) & 255; s[ccc * 4 + 3] ^= www & 255;
    }
    return s;
  }
  function __ghashMul(X, Y) {
    var Z = new Uint8Array(16);
    var V = new Uint8Array(16);
    var i, b, j, k;
    for (i = 0; i < 16; i++) V[i] = Y[i];
    for (b = 0; b < 128; b++) {
      var xb = X[b >> 3];
      var bit = (xb >> (7 - (b & 7))) & 1;
      if (bit === 1) { for (j = 0; j < 16; j++) Z[j] ^= V[j]; }
      var lsb = V[15] & 1;
      for (k = 15; k > 0; k--) V[k] = ((V[k] >>> 1) | (V[k - 1] << 7)) & 255;
      V[0] = (V[0] >>> 1) & 255;
      if (lsb === 1) V[0] ^= 225;
    }
    return Z;
  }
  function __ghash(H, aad, ct) {
    var X = new Uint8Array(16);
    var off, i, lim;
    function procBlk(blk) {
      var q;
      for (q = 0; q < 16; q++) X[q] ^= blk[q];
      X = __ghashMul(X, H);
    }
    for (off = 0; off < aad.length; off += 16) {
      var b1 = new Uint8Array(16);
      lim = 16;
      if (off + lim > aad.length) lim = aad.length - off;
      for (i = 0; i < lim; i++) b1[i] = aad[off + i];
      procBlk(b1);
    }
    for (off = 0; off < ct.length; off += 16) {
      var b2 = new Uint8Array(16);
      lim = 16;
      if (off + lim > ct.length) lim = ct.length - off;
      for (i = 0; i < lim; i++) b2[i] = ct[off + i];
      procBlk(b2);
    }
    var aBits = aad.length * 8, cBits = ct.length * 8;
    var aHi = Math.floor(aBits / 4294967296), aLo = aBits >>> 0;
    var cHi = Math.floor(cBits / 4294967296), cLo = cBits >>> 0;
    var lb = new Uint8Array(16);
    lb[0] = (aHi >>> 24) & 255; lb[1] = (aHi >>> 16) & 255; lb[2] = (aHi >>> 8) & 255; lb[3] = aHi & 255;
    lb[4] = (aLo >>> 24) & 255; lb[5] = (aLo >>> 16) & 255; lb[6] = (aLo >>> 8) & 255; lb[7] = aLo & 255;
    lb[8] = (cHi >>> 24) & 255; lb[9] = (cHi >>> 16) & 255; lb[10] = (cHi >>> 8) & 255; lb[11] = cHi & 255;
    lb[12] = (cLo >>> 24) & 255; lb[13] = (cLo >>> 16) & 255; lb[14] = (cLo >>> 8) & 255; lb[15] = cLo & 255;
    procBlk(lb);
    return X;
  }
  function __inc32(b16) {
    var out = new Uint8Array(16);
    var i;
    for (i = 0; i < 16; i++) out[i] = b16[i];
    var c = ((out[12] << 24) | (out[13] << 16) | (out[14] << 8) | out[15]) >>> 0;
    c = (c + 1) >>> 0;
    out[12] = (c >>> 24) & 255; out[13] = (c >>> 16) & 255; out[14] = (c >>> 8) & 255; out[15] = c & 255;
    return out;
  }
  function aesGcmDecryptPure(key, iv, ct, tag) {
    if (!(key instanceof Uint8Array) || key.length !== 32) throw new Error("bad key len");
    if (!(iv instanceof Uint8Array) || iv.length !== 12) throw new Error("bad iv len");
    if (!(ct instanceof Uint8Array)) throw new Error("bad ct");
    if (!(tag instanceof Uint8Array) || tag.length !== 16) throw new Error("bad tag len");
    var w = __aesKeyExpand256(key);
    var Harr = __aesEncryptBlock(new Uint8Array(16), w);
    var H = new Uint8Array(16);
    var i, off, j, k, t;
    for (i = 0; i < 16; i++) H[i] = Harr[i] & 255;
    var J0 = new Uint8Array(16);
    for (i = 0; i < 12; i++) J0[i] = iv[i];
    J0[12] = 0; J0[13] = 0; J0[14] = 0; J0[15] = 1;
    var pt = new Uint8Array(ct.length);
    var ctr = __inc32(J0);
    for (off = 0; off < ct.length; off += 16) {
      var ks = __aesEncryptBlock(ctr, w);
      var lim = 16;
      if (off + lim > ct.length) lim = ct.length - off;
      for (j = 0; j < lim; j++) pt[off + j] = (ct[off + j] ^ ks[j]) & 255;
      ctr = __inc32(ctr);
    }
    var S = __ghash(H, new Uint8Array(0), ct);
    var EJ0arr = __aesEncryptBlock(J0, w);
    var EJ0 = new Uint8Array(16);
    for (k = 0; k < 16; k++) EJ0[k] = EJ0arr[k] & 255;
    var calc = new Uint8Array(16);
    for (k = 0; k < 16; k++) calc[k] = (S[k] ^ EJ0[k]) & 255;
    var ok = 1;
    for (t = 0; t < 16; t++) { if (calc[t] !== tag[t]) ok = 0; }
    if (ok !== 1) { var e = new Error("GCM tag mismatch"); e.code = "TAG_MISMATCH"; throw e; }
    return pt;
  }
  function __utf8DecodeBytes(b) {
    var s = "", i = 0, c, c2, c3, c4, cp;
    while (i < b.length) {
      c = b[i];
      if (c < 128) { s += String.fromCharCode(c); i++; }
      else {
        if ((c & 224) === 192) { c2 = b[i + 1]; s += String.fromCharCode(((c & 31) << 6) | (c2 & 63)); i += 2; }
        else {
          if ((c & 240) === 224) { c2 = b[i + 1]; c3 = b[i + 2]; s += String.fromCharCode(((c & 15) << 12) | ((c2 & 63) << 6) | (c3 & 63)); i += 3; }
          else { c2 = b[i + 1]; c3 = b[i + 2]; c4 = b[i + 3]; cp = ((c & 7) << 18) | ((c2 & 63) << 12) | ((c3 & 63) << 6) | (c4 & 63); cp -= 65536; s += String.fromCharCode(55296 + (cp >> 10), 56320 + (cp & 1023)); i += 4; }
        }
      }
    }
    return s;
  }
  // ── Overlay KDF helpers (NEW shape ev==3, QuickJS-clean, fail-closed) ──
  var overlayN0 = "2435eb747e78f582e781909ebbfc14826e4f3954b4268850";
  function ovMakeEsid() {
    var chars = "0123456789abcdef";
    var out = "";
    try {
      for (var i = 0; i < 8; i++) {
        var r = Math.floor(Math.random() * 4294967296);
        if (r < 0) r = 0 - r;
        for (var j = 0; j < 8; j++) {
          out += chars.charAt((r >> (j * 4)) & 15);
        }
      }
    } catch (e) {}
    while (out.length < 64) out += "0";
    return out.substring(0, 64);
  }
  function ovAsciiToBytes(s) {
    s = String(s || "");
    var out = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 255;
    return out;
  }
  function ovConcat2(a, b) {
    var out = new Uint8Array(a.length + b.length);
    var i;
    for (i = 0; i < a.length; i++) out[i] = a[i];
    for (i = 0; i < b.length; i++) out[a.length + i] = b[i];
    return out;
  }
  function ovB64ToBytes(b64) {
    try {
      var s = String(b64 || "").replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
      var vals = [];
      var i, v;
      for (i = 0; i < s.length; i++) {
        var ch = s.charCodeAt(i);
        if (ch === 61) break;
        if (ch === 43) v = 62;
        else if (ch === 47) v = 63;
        else if (ch >= 65 && ch <= 90) v = ch - 65;
        else if (ch >= 97 && ch <= 122) v = ch - 97 + 26;
        else if (ch >= 48 && ch <= 57) v = ch - 48 + 52;
        else return null;
        vals.push(v);
      }
      var outLen = Math.floor(vals.length * 6 / 8);
      var out = new Uint8Array(outLen);
      var bits = 0, bitsN = 0, o = 0;
      for (i = 0; i < vals.length; i++) {
        bits = (bits << 6) | vals[i];
        bitsN += 6;
        if (bitsN >= 8) {
          bitsN -= 8;
          if (o < outLen) out[o++] = (bits >> bitsN) & 255;
          bits = bits & ((1 << bitsN) - 1);
        }
      }
      return out;
    } catch (e) { return null; }
  }
  function ovDecryptNew(overlayB64, ksHex, token, chapterId) {
    try {
      if (!overlayB64 || !ksHex || !token || !chapterId) return null;
      var blob = ovB64ToBytes(overlayB64);
      if (!blob || blob.length < 2) return null;
      var w = blob[0];
      var e = blob.slice(1);
      var n0b = ovAsciiToBytes(overlayN0);
      var ksb = ovAsciiToBytes(String(ksHex));
      var tokb = ovAsciiToBytes(String(token));
      var cidb = ovAsciiToBytes(String(chapterId));
      var asm1 = ovConcat2(n0b, ksb);
      var asm2 = ovConcat2(asm1, tokb);
      var asm3 = ovConcat2(asm2, cidb);
      var asm = ovConcat2(asm3, e);
      var unw = null;
      try { unw = kdfUnwrapBytes(asm, w); } catch (eKdf) { return null; }
      if (!unw) return null;
      var pt = null;
      try { pt = aesGcmDecryptPure(unw.key, unw.iv, unw.ct, unw.tag); } catch (eAes) { return null; }
      if (!pt) return null;
      var jsonStr = "";
      try { jsonStr = decodeUtf8(pt); } catch (eDec) { return null; }
      if (!jsonStr) return null;
      var obj = null;
      try { obj = JSON.parse(jsonStr); } catch (eJson) { return null; }
      if (!obj || !Array.isArray(obj.pages)) return null;
      return obj;
    } catch (eOuter) { return null; }
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

  // ────────────────── Overlay unlock (challenge scheme) ──────────────────
  // Overlay chapters ship an EMPTY overlayBlob in SSR props + unlockToken.
  // The CURRENT site viewer unlocks in two steps:
  //  1. POST {chapterId, token, proof} (proof = SHA256(salt|token|chapterId))
  //     → either {overlay, key} directly, or {needs_challenge, nonce,
  //     pow_bits?, turnstile_required?}.
  //  2. If challenged: solve hashcash PoW (SHA256(nonce:counter_base36)
  //     with >= pow_bits leading zero bits) unless turnstile is required
  //     (unsolvable here → images), then POST {chapterId, nonce, pow,
  //     turnstileToken, token, proof} → {overlay, key}.
  // The blob is decrypted with the server-provided key. Everything
  // fail-closed: any miss → null → plain images.
  function countLeadingZeroBits(hexStr) {
    var bits = 0;
    var h = String(hexStr || "").toLowerCase();
    for (var i = 0; i + 1 < h.length; i += 2) {
      var b = parseInt(h.substr(i, 2), 16);
      if (isNaN(b)) return bits;
      if (b === 0) { bits += 8; continue; }
      var m = 128;
      while (m > 0 && (b & m) === 0) { bits++; m >>= 1; }
      return bits;
    }
    return bits;
  }

  function solvePow(prefix, bits) {
    var target = Number(bits) || 0;
    if (!prefix || target <= 0) return "";
    var deadline = 0;
    try { deadline = new Date().getTime() + 9000; } catch (e) {}
    for (var n = 0; n < 250000; n++) {
      if (deadline) {
        try { if (new Date().getTime() > deadline) return ""; } catch (e2) {}
      }
      var cand = n.toString(36);
      var digest = "";
      try { digest = sha256HexAscii(prefix + ":" + cand); } catch (e3) { return ""; }
      if (countLeadingZeroBits(digest) >= target) return cand;
    }
    return "";
  }

  async function postUnlock(payload) {
    var res = await api.http(apiBase + "/api/reader/unlock", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json, text/plain, */*",
        "Referer": baseUrl + "/",
        "Origin": baseUrl
      },
      body: JSON.stringify(payload)
    });
    if (!res || !res.ok) return null;
    try {
      var data = JSON.parse(res.body || "{}");
      if (!data || data.success === false) return null;
      return data;
    } catch (eJson) { return null; }
  }

  async function claimOverlay(data, token, chapterId) {
    try {
      if (!data) return null;
      if (data.overlay && data.ks) {
        try {
          var ev = data.ev;
          if (ev === undefined || ev === null || Number(ev) === 3) {
            var newData = ovDecryptNew(data.overlay, data.ks, token, chapterId);
            if (newData) {
              var off = data.overlay_page_offset;
              if (off === undefined || off === null) off = data.overlayPageOffset;
              return { overlayData: newData, pageOffset: Number(off || 0) };
            }
          }
        } catch (eNew) {}
      }
      if (data.overlay && data.key) {
        var overlayData = await aesDecrypt(data.overlay, data.key);
        if (!overlayData) return null;
        var off2 = data.overlay_page_offset;
        if (off2 === undefined || off2 === null) off2 = data.overlayPageOffset;
        return { overlayData: overlayData, pageOffset: Number(off2 || 0) };
      }
    } catch (e) {}
    return null;
  }

  async function unlockOverlayContent(chapterId, unlockToken) {
    try {
      if (!chapterId || !unlockToken || !api.http) return null;
      var cidNum = Number(chapterId);
      var proof = sha256HexAscii(unlockProofSalt + "|" + unlockToken + "|" + chapterId);
      var step1 = await postUnlock({
        chapterId: cidNum || chapterId,
        token: unlockToken,
        proof: proof,
        esid: ovMakeEsid()
      });
      if (!step1) return null;
      var direct = await claimOverlay(step1, unlockToken, chapterId);
      if (direct) return direct;
      // Challenge round: PoW solvable, Turnstile is not.
      if (!step1.needs_challenge) return null;
      if (step1.turnstile_required || step1.turnstileRequired) return null;
      var powBits = Number(step1.pow_bits || step1.powBits || 0);
      var nonce = step1.nonce || "";
      var pow = "";
      if (powBits > 0) {
        if (!nonce) return null;
        pow = solvePow(String(nonce), powBits);
        if (!pow) return null;
      }
      var step2payload = {
        chapterId: cidNum || chapterId,
        token: unlockToken,
        proof: proof,
        esid: ovMakeEsid()
      };
      if (nonce) step2payload.nonce = nonce;
      if (pow) step2payload.pow = pow;
      var step2 = await postUnlock(step2payload);
      if (!step2) return null;
      return await claimOverlay(step2, unlockToken, chapterId);
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
      var tm0 = props ? props.textMode : null;
      if (tm0 === undefined || tm0 === null) tm0 = props ? props.text_mode : null;
      if (props && String(tm0 || "") === "overlay" && imageUrls.length) {
        try {
          var overlayData = null;
          var pageOffset = Number(props.overlayPageOffset || props.overlay_page_offset || 0);
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
