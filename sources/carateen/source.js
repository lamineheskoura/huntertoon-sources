function createSource(api, config) {
  var baseUrl = ((config && config.base_url) || "https://carateen.tv").replace(/\/+$/, "");
  var userAgent = (config && config.user_agent) || "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
  var headers = {
    "User-Agent": userAgent,
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "ar,en-US;q=0.9,en;q=0.8",
    "Referer": baseUrl + "/",
    "X-Requested-With": "XMLHttpRequest"
  };
  var AMP = String.fromCharCode(38);
  var API_KEY = "7annaba3l_loves_crypto_safe_key!";
  var PAGE_SIZE = 20;
  var CACHE_TTL_MS = 600000;
  var GENRES = ["أفلام", "أكشن", "أبجد", "شارع الأنمي", "زمردة", "بون بون", "مغامرات", "رياضة", "كوميدي", "سبيس باور", "علوم", "سبيستون مام", "مسلسل مدبلج", "مسلسل مترجم", "فيلم مدبلج", "فيلم مترجم", "المحقق كونان", "غيبلي", "والت ديزني", "قصص عالمية"];

  var SBOX = [
    99,124,119,123,242,107,111,197,48,1,103,43,254,215,171,118,
    202,130,201,125,250,89,71,240,173,212,162,175,156,164,114,192,
    183,253,147,38,54,63,247,204,52,165,229,241,113,216,49,21,
    4,199,35,195,24,150,5,154,7,18,128,226,235,39,178,117,
    9,131,44,26,27,110,90,160,82,59,214,179,41,227,47,132,
    83,209,0,237,32,252,177,91,106,203,190,57,74,76,88,207,
    208,239,170,251,67,77,51,133,69,249,2,127,80,60,159,168,
    81,163,64,143,146,157,56,245,188,182,218,33,16,255,243,210,
    205,12,19,236,95,151,68,23,196,167,126,61,100,93,25,115,
    96,129,79,220,34,42,144,136,70,238,184,20,222,94,11,219,
    224,50,58,10,73,6,36,92,194,211,172,98,145,149,228,121,
    231,200,55,109,141,213,78,169,108,86,244,234,101,122,174,8,
    186,120,37,46,28,166,180,198,232,221,116,31,75,189,139,138,
    112,62,181,102,72,3,246,14,97,53,87,185,134,193,29,158,
    225,248,152,17,105,217,142,148,155,30,135,233,206,85,40,223,
    140,161,137,13,191,230,66,104,65,153,45,15,176,84,187,22
  ];
  var INVSBOX = [];
  (function buildInv() {
    for (var i = 0; i < 256; i++) INVSBOX[SBOX[i]] = i;
  })();
  function gfMul(a, b) {
    var p = 0;
    for (var i = 0; i < 8; i++) {
      if (b & 1) p ^= a;
      var hi = a & 128;
      a = (a << 1) & 255;
      if (hi) a ^= 27;
      b >>= 1;
    }
    return p;
  }

  function aesKeyExpand(keyBytes) {
    var nk = 8, nb = 4, nr = 14;
    var w = [];
    var i, k;
    for (i = 0; i < nk; i++) {
      w.push((keyBytes[4 * i] << 24) | (keyBytes[4 * i + 1] << 16) | (keyBytes[4 * i + 2] << 8) | keyBytes[4 * i + 3]);
    }
    var RCON = [1, 2, 4, 8, 16, 32, 64, 128, 27, 54];
    for (k = nk; k < nb * (nr + 1); k++) {
      var temp = w[k - 1];
      if (k % nk === 0) {
        temp = ((SBOX[(temp >> 16) & 255] << 24) | (SBOX[(temp >> 8) & 255] << 16) | (SBOX[temp & 255] << 8) | SBOX[(temp >> 24) & 255]) ^ (RCON[(k / nk) - 1] << 24);
      } else if (k % nk === 4) {
        temp = (SBOX[(temp >> 24) & 255] << 24) | (SBOX[(temp >> 16) & 255] << 16) | (SBOX[(temp >> 8) & 255] << 8) | SBOX[temp & 255];
      }
      w.push((w[k - nk] ^ temp) >>> 0);
    }
    return w;
  }

  var TD0 = [], TD1 = [], TD2 = [], TD3 = [];
  (function buildTd() {
    for (var i = 0; i < 256; i++) {
      var s = INVSBOX[i];
      var e = gfMul(s, 14), n = gfMul(s, 9), d = gfMul(s, 13), b = gfMul(s, 11);
      TD0.push(((e << 24) | (n << 16) | (d << 8) | b) >>> 0);
      TD1.push(((b << 24) | (e << 16) | (n << 8) | d) >>> 0);
      TD2.push(((d << 24) | (b << 16) | (e << 8) | n) >>> 0);
      TD3.push(((n << 24) | (d << 16) | (b << 8) | e) >>> 0);
    }
  })();

  function mixWord(word) {
    var b0 = (word >>> 24) & 255, b1 = (word >>> 16) & 255, b2 = (word >>> 8) & 255, b3 = word & 255;
    return ((gfMul(b0, 14) ^ gfMul(b1, 11) ^ gfMul(b2, 13) ^ gfMul(b3, 9)) << 24 |
      (gfMul(b0, 9) ^ gfMul(b1, 14) ^ gfMul(b2, 11) ^ gfMul(b3, 13)) << 16 |
      (gfMul(b0, 13) ^ gfMul(b1, 9) ^ gfMul(b2, 14) ^ gfMul(b3, 11)) << 8 |
      (gfMul(b0, 11) ^ gfMul(b1, 13) ^ gfMul(b2, 9) ^ gfMul(b3, 14))) >>> 0;
  }

  var CACHED_W = null;
  function roundKeys() {
    if (!CACHED_W) {
      var w = aesKeyExpand(utf8Encode(API_KEY));
      for (var r = 1; r <= 13; r++) {
        for (var c = 0; c < 4; c++) w[r * 4 + c] = mixWord(w[r * 4 + c]);
      }
      CACHED_W = w;
    }
    return CACHED_W;
  }

  var HEXV = {};
  (function buildHex() {
    var d = "0123456789abcdef", i;
    for (i = 0; i < 16; i++) HEXV[d.charAt(i)] = i;
    var u = "ABCDEF";
    for (i = 0; i < 6; i++) HEXV[u.charAt(i)] = 10 + i;
  })();

  function hexPair(hex, idx) {
    var hi = HEXV[hex.charAt(idx)], lo = HEXV[hex.charAt(idx + 1)];
    if (hi === undefined || lo === undefined) throw new Error("bad hex");
    return (hi << 4) | lo;
  }

  function hexToBytes(hex) {
    var out = [];
    hex = String(hex || "").replace(/\s+/g, "");
    for (var i = 0; i + 1 < hex.length; i += 2) {
      out.push(hexPair(hex, i));
    }
    return out;
  }

  function aesDecryptBlock(block, w) {
    var s = [block[0], block[1], block[2], block[3], block[4], block[5], block[6], block[7], block[8], block[9], block[10], block[11], block[12], block[13], block[14], block[15]];
    var c, word, base;
    base = 56;
    for (c = 0; c < 4; c++) {
      word = w[base + c];
      s[4 * c] ^= (word >>> 24) & 255;
      s[4 * c + 1] ^= (word >>> 16) & 255;
      s[4 * c + 2] ^= (word >>> 8) & 255;
      s[4 * c + 3] ^= word & 255;
    }
    for (var round = 13; round >= 1; round--) {
      base = round * 4;
      var t0 = (TD0[s[0]] ^ TD1[s[13]] ^ TD2[s[10]] ^ TD3[s[7]] ^ w[base]) >>> 0;
      var t1 = (TD0[s[4]] ^ TD1[s[1]] ^ TD2[s[14]] ^ TD3[s[11]] ^ w[base + 1]) >>> 0;
      var t2 = (TD0[s[8]] ^ TD1[s[5]] ^ TD2[s[2]] ^ TD3[s[15]] ^ w[base + 2]) >>> 0;
      var t3 = (TD0[s[12]] ^ TD1[s[9]] ^ TD2[s[6]] ^ TD3[s[3]] ^ w[base + 3]) >>> 0;
      s[0] = (t0 >>> 24) & 255; s[1] = (t0 >>> 16) & 255; s[2] = (t0 >>> 8) & 255; s[3] = t0 & 255;
      s[4] = (t1 >>> 24) & 255; s[5] = (t1 >>> 16) & 255; s[6] = (t1 >>> 8) & 255; s[7] = t1 & 255;
      s[8] = (t2 >>> 24) & 255; s[9] = (t2 >>> 16) & 255; s[10] = (t2 >>> 8) & 255; s[11] = t2 & 255;
      s[12] = (t3 >>> 24) & 255; s[13] = (t3 >>> 16) & 255; s[14] = (t3 >>> 8) & 255; s[15] = t3 & 255;
    }
    var u = [];
    u[0] = INVSBOX[s[0]] ^ ((w[0] >>> 24) & 255);
    u[1] = INVSBOX[s[13]] ^ ((w[0] >>> 16) & 255);
    u[2] = INVSBOX[s[10]] ^ ((w[0] >>> 8) & 255);
    u[3] = INVSBOX[s[7]] ^ (w[0] & 255);
    u[4] = INVSBOX[s[4]] ^ ((w[1] >>> 24) & 255);
    u[5] = INVSBOX[s[1]] ^ ((w[1] >>> 16) & 255);
    u[6] = INVSBOX[s[14]] ^ ((w[1] >>> 8) & 255);
    u[7] = INVSBOX[s[11]] ^ (w[1] & 255);
    u[8] = INVSBOX[s[8]] ^ ((w[2] >>> 24) & 255);
    u[9] = INVSBOX[s[5]] ^ ((w[2] >>> 16) & 255);
    u[10] = INVSBOX[s[2]] ^ ((w[2] >>> 8) & 255);
    u[11] = INVSBOX[s[15]] ^ (w[2] & 255);
    u[12] = INVSBOX[s[12]] ^ ((w[3] >>> 24) & 255);
    u[13] = INVSBOX[s[9]] ^ ((w[3] >>> 16) & 255);
    u[14] = INVSBOX[s[6]] ^ ((w[3] >>> 8) & 255);
    u[15] = INVSBOX[s[3]] ^ (w[3] & 255);
    return u;
  }

  function utf8Encode(str) {
    var out = [];
    str = String(str);
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 128) out.push(c);
      else if (c < 2048) { out.push(192 | (c >> 6), 128 | (c & 63)); }
      else { out.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63)); }
    }
    return out;
  }

  function utf8Decode(bytes) {
    var out = "";
    for (var i = 0; i < bytes.length; i++) {
      var b = bytes[i];
      if (b < 128) out += String.fromCharCode(b);
      else if ((b & 224) === 192) {
        out += String.fromCharCode(((b & 31) << 6) | (bytes[i + 1] & 63));
        i++;
      } else if ((b & 240) === 224) {
        out += String.fromCharCode(((b & 15) << 12) | ((bytes[i + 1] & 63) << 6) | (bytes[i + 2] & 63));
        i += 2;
      } else {
        var cp = ((b & 7) << 18) | ((bytes[i + 1] & 63) << 12) | ((bytes[i + 2] & 63) << 6) | (bytes[i + 3] & 63);
        cp -= 65536;
        out += String.fromCharCode(55296 + (cp >> 10), 56320 + (cp & 1023));
        i += 3;
      }
    }
    return out;
  }

  function splitTail(bytes) {
    var n = bytes.length;
    var k = 0;
    while (k < n && k < 4 && (bytes[n - 1 - k] & 192) === 128) k++;
    var start = n - 1 - k;
    if (start < 0) return { head: bytes, tail: [] };
    var lead = bytes[start];
    if (lead < 128) return { head: bytes, tail: [] };
    var need = lead >= 240 ? 4 : lead >= 224 ? 3 : 2;
    if (k + 1 >= need) return { head: bytes, tail: [] };
    return { head: bytes.slice(0, start), tail: bytes.slice(start) };
  }

  var BLOCK_CHUNK = 2048;

  function aesCbcDecrypt(ivHex, dataHex) {
    var w = roundKeys();
    var hex = String(dataHex || "").replace(/\s+/g, "");
    var nBlocks = Math.floor(hex.length / 32);
    if (nBlocks < 1) throw new Error("empty crypto payload");
    var prev = hexToBytes(ivHex);
    if (prev.length !== 16) throw new Error("bad crypto iv");
    var parts = [];
    var carry = [];
    var blk = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    var pos = 0;
    while (pos < nBlocks) {
      var end = Math.min(pos + BLOCK_CHUNK, nBlocks);
      var bytes = carry;
      carry = [];
      for (var b = pos; b < end; b++) {
        var base = b * 32;
        for (var i = 0; i < 16; i++) blk[i] = hexPair(hex, base + i * 2);
        var dec = aesDecryptBlock(blk, w);
        for (var j = 0; j < 16; j++) bytes.push(dec[j] ^ prev[j]);
        prev = blk.slice();
      }
      pos = end;
      if (pos < nBlocks) {
        var sp = splitTail(bytes);
        bytes = sp.head;
        carry = sp.tail;
      }
      parts.push(utf8Decode(bytes));
    }
    if (carry.length) parts.push(utf8Decode(carry));
    var text = parts.join("");
    if (!text.length) throw new Error("empty crypto payload");
    var pad = text.charCodeAt(text.length - 1);
    if (pad < 1 || pad > 16) throw new Error("bad crypto padding");
    return text.slice(0, text.length - pad);
  }
  function abs(url) {
    if (!url) return "";
    url = String(url).split(AMP + "amp;").join(AMP).trim();
    if (!url || url.indexOf("data:") === 0) return "";
    if (url.indexOf("//") === 0) return "https:" + url;
    if (url.indexOf("http://") === 0) return "https://" + url.substring(7);
    if (url.indexOf("https://") === 0) return url;
    if (url.charAt(0) === "/") return baseUrl + url;
    return baseUrl + "/" + url;
  }

  function safeList(v) {
    return Array.isArray(v) ? v : [];
  }

  async function apiJson(path, method, body) {
    var url = baseUrl + path;
    var res;
    if (api.http) {
      var opts = { method: method || "GET", headers: headers };
      if (body) {
        opts.headers = {
          "User-Agent": userAgent,
          "Accept": "application/json, text/plain, */*",
          "Accept-Language": "ar,en-US;q=0.9,en;q=0.8",
          "Referer": baseUrl + "/",
          "X-Requested-With": "XMLHttpRequest",
          "Content-Type": "application/json"
        };
        opts.body = JSON.stringify(body);
      }
      res = await api.http(url, opts);
      if (!res || !res.ok) throw new Error("HTTP " + (res ? res.status : 0) + " for " + path);
      var env = JSON.parse(res.body || "{}");
      if (!env || !env.encryptedData || !env.iv) throw new Error("bad crypto envelope for " + path);
      return JSON.parse(aesCbcDecrypt(env.iv, env.encryptedData));
    }
    var txt = await api.fetchText(url, headers);
    var env2 = JSON.parse(txt || "{}");
    return JSON.parse(aesCbcDecrypt(env2.iv, env2.encryptedData));
  }

  var catalogCache = { at: 0, sp: [], tg: [] };

  async function ensureCatalogs(which) {
    var now = Date.now();
    var wantSp = which !== "tg";
    var wantTg = which !== "sp";
    var fresh = !catalogCache.at || (now - catalogCache.at) >= CACHE_TTL_MS || !catalogCache.sp.length;
    if (!fresh) {
      if ((wantSp && !catalogCache.sp.length) || (wantTg && !catalogCache.tg.length)) fresh = true;
    }
    if (!fresh) return catalogCache;
    var spList = catalogCache.sp;
    var tgList = catalogCache.tg;
    if (wantSp) {
      spList = await apiJson("/api/sp/tvshows?page=1", "GET").catch(function () { return []; });
      spList = safeList(spList);
    }
    if (wantTg) {
      tgList = await apiJson("/api/tvshows?page=1", "GET").catch(function () { return []; });
      tgList = safeList(tgList);
    }
    catalogCache = { at: now, sp: spList, tg: tgList };
    return catalogCache;
  }

  async function recentHome() {
    var eps = await apiJson("/api/sp/recentEpisodes", "GET").catch(function () { return []; });
    eps = safeList(eps);
    var out = [];
    var seen = {};
    for (var i = 0; i < eps.length; i++) {
      var e = eps[i] || {};
      var sid = e.tv_series_id;
      if (!sid || seen[sid]) continue;
      seen[sid] = true;
      out.push({
        title: String(e.name || ""),
        coverUrl: abs(e.cover_full_path || ""),
        detailUrl: baseUrl + "/watch/sp/" + sid,
        contentType: "anime"
      });
    }
    return out;
  }

  function isEnabled(s) {
    return !(s && (s.enabled === false || s.enabled === 0));
  }

  function mapSpShow(s) {
    return {
      title: String((s && s.name) || ""),
      coverUrl: abs((s && s.cover_full_path) || ""),
      detailUrl: baseUrl + "/watch/sp/" + s.id,
      contentType: "anime"
    };
  }

  function mapTgShow(s) {
    var cover = (s && s.poster_cover) || "";
    if (cover && cover.indexOf("http") !== 0) cover = baseUrl + "/assets/img/posters/" + cover.replace(/^\/+/, "");
    return {
      title: String((s && s.title) || ""),
      coverUrl: abs(cover),
      detailUrl: baseUrl + "/watch/" + s.id,
      contentType: "anime"
    };
  }

  function showTime(s) {
    var t = Date.parse((s && (s.updated_at || s.created_at)) || "");
    return isNaN(t) ? 0 : t;
  }

  function isSpPlanetGenre(genre) {
    return genre !== "أفلام" && GENRES.slice(1, 12).indexOf(genre) !== -1;
  }

  function isTgOnlyGenre(genre) {
    return GENRES.slice(12).indexOf(genre) !== -1;
  }

  async function mergedShows(which) {
    var cat = await ensureCatalogs(which || "both");
    var out = [];
    for (var i = 0; i < cat.sp.length; i++) {
      if (isEnabled(cat.sp[i])) out.push({ kind: "sp", raw: cat.sp[i], item: mapSpShow(cat.sp[i]) });
    }
    for (var j = 0; j < cat.tg.length; j++) {
      if (isEnabled(cat.tg[j])) out.push({ kind: "tg", raw: cat.tg[j], item: mapTgShow(cat.tg[j]) });
    }
    out.sort(function (a, b) { return showTime(b.raw) - showTime(a.raw); });
    return out;
  }

  function normArabic(s) {
    return String(s || "")
      .replace(/[ً-ٰٟـ]/g, "")
      .replace(/[أإآ]/g, "ا")
      .replace(/ة/g, "ه")
      .replace(/ى/g, "ي")
      .toLowerCase();
  }

  function matchGenreSp(s, genre) {
    if (genre === "أفلام") return s.is_movie === 1;
    return String(s.planet_name || "") === genre;
  }

  function matchGenreTg(s, genre) {
    var cat = String(s.category || "");
    if (genre === "المحقق كونان") return cat.indexOf("المحقق كونان") !== -1;
    if (genre === "غيبلي") return cat.indexOf("غيبلي") !== -1;
    if (genre === "والت ديزني") return cat.indexOf("والت ديزني") !== -1;
    if (genre === "قصص عالمية") return cat.indexOf("قصص عالمية") !== -1;
    if (genre === "أفلام") return cat.indexOf("فيلم") === 0;
    return cat === genre || cat.indexOf(genre) === 0;
  }

  function parseRef(url) {
    var m = String(url || "").match(/\/watch\/sp\/(\d+)(?:\/([^\/?#]+))?/);
    if (m) return { kind: "sp", showId: m[1], epSlug: m[2] || "" };
    var t = String(url || "").match(/\/watch\/(\d+)(?:\/(\d+))?/);
    if (t) return { kind: "tg", showId: t[1], epId: t[2] || "" };
    return null;
  }

  async function fetchSpServers(epSlug, pageUrl) {
    var data = await apiJson("/api/sp/episode/link", "POST", { episodeId: String(epSlug), userId: null });
    var link = abs((data && data.link) || "");
    if (!link) return [];
    var h = { "User-Agent": userAgent, "Referer": pageUrl || (baseUrl + "/") };
    return [{
      id: "sp-" + epSlug,
      name: "سيرفر كراتين",
      embedUrl: pageUrl || link,
      url: pageUrl || link,
      directUrl: link,
      type: "m3u8",
      quality: "Auto",
      qualities: [{ label: "Auto", url: link, isDefault: true, headers: h }],
      selectedQualityIndex: 0,
      headers: h
    }];
  }

  async function fetchTgServers(showId, epId, pageUrl) {
    var data = await apiJson("/api/episode?episodeId=" + encodeURIComponent(epId) + "&showId=" + encodeURIComponent(showId), "GET");
    var link = abs((data && data.streamUrl) || "");
    if (!link) return [];
    var h = { "User-Agent": userAgent, "Referer": pageUrl || (baseUrl + "/") };
    return [{
      id: "tg-" + epId,
      name: "سيرفر كراتين",
      embedUrl: pageUrl || link,
      url: pageUrl || link,
      directUrl: link,
      type: "m3u8",
      quality: "Auto",
      qualities: [{ label: "Auto", url: link, isDefault: true, headers: h }],
      selectedQualityIndex: 0,
      headers: h
    }];
  }
  return {
    requiresCloudflare: true,

    async getHomepageManga(args) {
      var page = (args && args.page) || 1;
      if (page < 1) page = 1;
      try {
        if (page === 1) return await recentHome();
        var all = await mergedShows("both");
        var recent = await recentHome().catch(function () { return []; });
        var seen = {};
        var i;
        for (i = 0; i < recent.length; i++) seen[recent[i].detailUrl] = true;
        var rest = [];
        for (i = 0; i < all.length; i++) {
          if (!seen[all[i].item.detailUrl]) rest.push(all[i].item);
        }
        var start = (page - 2) * PAGE_SIZE;
        return rest.slice(start, start + PAGE_SIZE);
      } catch (e) {
        return [];
      }
    },

    async search(args) {
      var q = normArabic(((args && args.query) || "").trim());
      if (!q) return [];
      try {
        var all = await mergedShows();
        var out = [];
        for (var i = 0; i < all.length && out.length < 30; i++) {
          var e = all[i];
          var hay = normArabic(e.item.title + " " + (e.raw.tags || "") + " " + (e.raw.description || ""));
          if (hay.indexOf(q) !== -1) out.push(e.item);
        }
        return out;
      } catch (e) {
        return [];
      }
    },

    async getFilteredManga(args) {
      var genre = ((args && args.genre) || "").trim();
      var page = (args && args.page) || 1;
      if (page < 1) page = 1;
      if (!genre) return [];
      try {
        var which = isSpPlanetGenre(genre) ? "sp" : (isTgOnlyGenre(genre) ? "tg" : "both");
        var all = await mergedShows(which);
        var out = [];
        for (var i = 0; i < all.length; i++) {
          var e = all[i];
          var ok = e.kind === "sp" ? matchGenreSp(e.raw, genre) : matchGenreTg(e.raw, genre);
          if (ok) out.push(e.item);
        }
        return out.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
      } catch (e) {
        return [];
      }
    },

    async getMangaDetails(args) {
      var url = abs((args && args.url) || "");
      var ref = parseRef(url);
      if (!ref) throw new Error("bad episode url");
      var detailUrl = ref.kind === "sp"
        ? baseUrl + "/watch/sp/" + ref.showId
        : baseUrl + "/watch/" + ref.showId;

      if (ref.kind === "sp") {
        var sp = await Promise.all([
          apiJson("/api/sp/tvshow?id=" + encodeURIComponent(ref.showId), "GET"),
          apiJson("/api/sp/episodes?id=" + encodeURIComponent(ref.showId), "GET").catch(function () { return []; })
        ]);
        var show = sp[0] || {};
        var eps = safeList(sp[1]);
        var chapters = [];
        for (var i = 0; i < eps.length; i++) {
          var e = eps[i] || {};
          var num = parseInt(e.number, 10) || 0;
          chapters.push({
            number: num,
            title: String(e.pref || ("الحلقة " + num)),
            views: e.watch_count || 0,
            url: baseUrl + "/watch/sp/" + ref.showId + "/" + (e.slug || e.id),
            isLocked: false,
            date: "",
            thumbnailUrl: abs(e.cover || e.cover_full_path || ""),
            durationSeconds: e.ep_duration || e.duration || 0,
            servers: []
          });
        }
        chapters.sort(function (a, b) { return b.number - a.number; });
        var genres = [];
        var seen = {};
        var tags = String(show.tags || "").split(",");
        for (var t = 0; t < tags.length; t++) {
          var g = tags[t].trim();
          if (g && g.length > 1 && !seen[g]) { seen[g] = true; genres.push(g); }
        }
        if (show.planet_name) genres.unshift(show.planet_name);
        return {
          title: String(show.name || ""),
          coverUrl: abs(show.cover_full_path || ""),
          description: String(show.pref || ""),
          genres: genres.slice(0, 12),
          status: show.is_completed === 1 ? "مكتملة" : "مستمرة",
          year: "",
          chapters: chapters,
          originalUrl: detailUrl,
          hasMoreChapters: false,
          lastFetchedPage: 1,
          contentType: "anime"
        };
      }

      var tg = await Promise.all([
        apiJson("/api/tvshow?id=" + encodeURIComponent(ref.showId), "GET"),
        apiJson("/api/episodes?id=" + encodeURIComponent(ref.showId), "GET").catch(function () { return []; })
      ]);
      var tshow = tg[0] || {};
      var teps = safeList(tg[1]);
      var tchap = [];
      for (var j = 0; j < teps.length; j++) {
        var te = teps[j] || {};
        var order = parseInt(te.order_id, 10);
        var tnum = isNaN(order) ? (j + 1) : (order + 1);
        var thumb = te.thumbnail || "";
        if (thumb && thumb.indexOf("http") !== 0) thumb = baseUrl + "/assets/img/thumbnails/" + String(thumb).replace(/^\/+/, "");
        tchap.push({
          number: tnum,
          title: String(te.title || ("الحلقة " + tnum)),
          views: 0,
          url: baseUrl + "/watch/" + ref.showId + "/" + te.id,
          isLocked: false,
          date: "",
          thumbnailUrl: abs(thumb),
          durationSeconds: te.duration || 0,
          servers: []
        });
      }
      tchap.sort(function (a, b) { return b.number - a.number; });
      var tcover = tshow.poster_cover || "";
      if (tcover && tcover.indexOf("http") !== 0) tcover = baseUrl + "/assets/img/posters/" + String(tcover).replace(/^\/+/, "");
      var tgenres = [];
      if (tshow.category) tgenres.push(String(tshow.category));
      return {
        title: String(tshow.title || ""),
        coverUrl: abs(tcover),
        description: String(tshow.description || ""),
        genres: tgenres,
        status: String(tshow.category || "").indexOf("غير مكتمل") !== -1 ? "مستمرة" : "مكتملة",
        year: String(tshow.release_year || ""),
        chapters: tchap,
        originalUrl: detailUrl,
        hasMoreChapters: false,
        lastFetchedPage: 1,
        contentType: "anime"
      };
    },

    async fetchMoreChapters(args) {
      return null;
    },

    async getChapterPages(args) {
      return [];
    },

    async getEpisodeServers(args) {
      var url = abs((args && args.url) || "");
      var ref = parseRef(url);
      if (!ref) return [];
      try {
        if (ref.kind === "sp") {
          if (!ref.epSlug) return [];
          return await fetchSpServers(ref.epSlug, url);
        }
        if (!ref.epId) return [];
        return await fetchTgServers(ref.showId, ref.epId, url);
      } catch (e) {
        return [];
      }
    },

    async getChapterContent(args) {
      var url = abs((args && args.url) || "");
      var ref = parseRef(url);
      if (!ref) return { kind: "video", servers: [] };
      try {
        var servers = [];
        if (ref.kind === "sp") {
          if (ref.epSlug) servers = await fetchSpServers(ref.epSlug, url);
        } else if (ref.epId) {
          servers = await fetchTgServers(ref.showId, ref.epId, url);
        }
        return { kind: "video", servers: servers };
      } catch (e) {
        return { kind: "video", servers: [] };
      }
    },

    async resolveServer(args) {
      var serverUrl = abs((args && (args.serverUrl || args.url)) || "");
      if (!serverUrl || serverUrl.indexOf("pegasus.") === -1) return null;
      if (serverUrl.indexOf(".m3u8") === -1) {
        return { url: serverUrl, type: "embed", headers: { "User-Agent": userAgent, "Referer": baseUrl + "/" } };
      }
      return {
        url: serverUrl,
        directUrl: serverUrl,
        type: "m3u8",
        headers: { "User-Agent": userAgent, "Referer": baseUrl + "/" }
      };
    },

    async getGenresAndTypes() {
      return { genres: GENRES, types: ["anime"] };
    },

    getVideoHeaders(args) {
      return {
        "User-Agent": userAgent,
        "Referer": baseUrl + "/",
        "Accept": "*/*",
        "Accept-Language": "ar,en-US;q=0.9,en;q=0.8"
      };
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

if (typeof module !== "undefined" && module.exports) {
  module.exports = { createSource };
}
