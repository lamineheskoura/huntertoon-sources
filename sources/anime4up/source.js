function createSource(api, config) {
  var baseUrl = ((config && config.base_url) || "https://w1.anime4up.rest").replace(/\/+$/, "");
  var configHeaders = (config && config.headers) || {};
  var userAgent =
    configHeaders["User-Agent"] ||
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
  var lastPageUrl = baseUrl + "/";

  var defaultHeaders = {
    "User-Agent": userAgent,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "ar,en-US;q=0.9,en;q=0.8",
    "Referer": baseUrl + "/",
    "Origin": baseUrl,
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "same-origin",
    "Upgrade-Insecure-Requests": "1"
  };

  var defaultGenres = [
    "أكشن", "مغامرات", "كوميدي", "دراما", "خيال", "خيال علمي",
    "رومانسي", "رعب", "غموض", "نفسي", "رياضي", "مدرسي",
    "شونين", "شوجو", "سينين", "ايسيكاي", "قوة خارقة", "شريحة من الحياة",
    "تاريخي", "عسكري", "فضاء", "ميكا", "موسيقى",
    "لعبة", "ساخر", "مصاصي دماء", "شياطين", "سحر", "ساموراي",
    "تحقيق", "بوليسي", "ايتشي", "حريم", "جوسي", "شوجو آي",
    "إثارة", "تشويق", "خارق للطبيعة", "فنون قتالية", "أطفال"
  ];
  var defaultTypes = ["TV", "Movie", "ONA", "OVA", "Special"];

  // Site taxonomy slugs use dashes, never spaces.
  function taxonomySlug(name) {
    return encodeURIComponent(cleanTitle(name).replace(/\s+/g, "-"));
  }

  function mergeHeaders(a, b) {
    var out = {};
    for (var k in a) out[k] = a[k];
    if (b) for (var x in b) out[x] = b[x];
    return out;
  }

  async function fetchHtml(url, extraHeaders, method, body) {
    lastPageUrl = url || lastPageUrl;
    var headers = mergeHeaders(defaultHeaders, extraHeaders);
    if (api.http) {
      var res = await api.http(url, { method: method || "GET", headers: headers, body: body });
      if (!res || !res.ok) throw new Error("HTTP " + (res ? res.status : 0) + " for " + url);
      return res.body || "";
    }
    if (method && method !== "GET") return "";
    var html = await api.fetchText(url, headers);
    if (!html) throw new Error("Empty response: " + url);
    return html;
  }

  // Pure-JS helpers (QuickJS-safe: var/Math/String/regex/atob only).

  function randStr(n) {
    var chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    var out = "";
    for (var i = 0; i < (n || 8); i++) {
      out += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return out;
  }

  function randAlphaNum(n) {
    var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    var out = "";
    for (var i = 0; i < (n || 10); i++) {
      out += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return out;
  }

  function budDec(bud) {
    if (!bud || bud.n <= 0) return false;
    bud.n--;
    return true;
  }

  function strToBytes(s) {
    var o = [];
    s = String(s || "");
    for (var i = 0; i < s.length; i++) o.push(s.charCodeAt(i) & 255);
    return o;
  }

  function rc4Bytes(data, key) {
    var s = [], i, j = 0, out = [];
    for (i = 0; i < 256; i++) s[i] = i;
    for (i = 0; i < 256; i++) {
      j = (j + s[i] + key[i % key.length]) & 255;
      var t = s[i]; s[i] = s[j]; s[j] = t;
    }
    i = 0; j = 0;
    for (var k = 0; k < data.length; k++) {
      i = (i + 1) & 255; j = (j + s[i]) & 255;
      var u = s[i]; s[i] = s[j]; s[j] = u;
      out.push(data[k] ^ s[(s[i] + s[j]) & 255]);
    }
    return out;
  }

  function bytesToText(b) {
    try {
      return new TextDecoder().decode(new Uint8Array(b));
    } catch (e) {
      var s = "";
      for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
      return s;
    }
  }

  function b64ToBytes(b64) {
    var clean = String(b64 || "").replace(/\s+/g, "");
    while (clean.length % 4 !== 0) clean += "=";
    var bin = "";
    try {
      bin = atob(clean);
    } catch (e) {
      return [];
    }
    return strToBytes(bin);
  }

  function rot13(s) {
    var out = "";
    s = String(s || "");
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c >= 65 && c <= 90) c = 65 + ((c - 65 + 13) % 26);
      else if (c >= 97 && c <= 122) c = 97 + ((c - 97 + 13) % 26);
      out += String.fromCharCode(c);
    }
    return out;
  }

  // VOE payload: ROT13 -> strip tokens -> base64 -> byte-3 -> reverse ->
  // base64 -> UTF-8 JSON (mirrors the app extractor, verified live).
  function voeDecode(payload) {
    try {
      var s = rot13(payload);
      var toks = ["@$", "^^", "~@", "%?", "*~", "!!", "#&"];
      for (var i = 0; i < toks.length; i++) s = s.split(toks[i]).join("");
      var b1 = b64ToBytes(s);
      if (!b1.length) return "";
      var sh = [];
      for (var j = 0; j < b1.length; j++) sh.push((b1[j] - 3) & 255);
      var rev = "";
      for (var k = sh.length - 1; k >= 0; k--) rev += String.fromCharCode(sh[k]);
      var b2 = b64ToBytes(rev);
      if (!b2.length) return "";
      return bytesToText(b2);
    } catch (e) {
      return "";
    }
  }

  // Dean Edwards packer unpack (uqload JW setup). Pure regex + base36.
  function unpackPacker(src) {
    try {
      var m = String(src || "").match(/eval\(function\(p,a,c,k,e,d\)[\s\S]*?\}\('([\s\S]*?)',(\d+),(\d+),'([\s\S]*?)'\.split\('\|'\)/);
      if (!m) return "";
      var p = m[1], a = parseInt(m[2], 10) || 36, c = parseInt(m[3], 10) || 0;
      var k = m[4].split("|");
      function enc(n) {
        var s = "";
        do {
          var d = n % a;
          s = (d > 35 ? String.fromCharCode(d + 29) : d.toString(36)) + s;
          n = Math.floor(n / a);
        } while (n > 0);
        return s || "0";
      }
      while (c--) {
        if (k[c]) {
          var re = new RegExp("\\b" + enc(c) + "\\b", "g");
          p = p.replace(re, k[c]);
        }
      }
      return p;
    } catch (e) {
      return "";
    }
  }

  var VIDEA_CONST = "xHb0ZvME5q8CBcoQi6AngerDu3FGO9fkUlwPmLVY_RTzj2hJIS4NasXWKy1td7p";

  function videaParams(xt, rnd) {
    try {
      var e = String(xt || "").split("");
      var r = ["e", "a", "g", "j", "d", "c", "h", "i", "b", "f"];
      var c = {}, i;
      for (i = 0; i < e.length; i++) {
        if (i % 8 === 0) c[r[Math.floor(i / 8) + 1]] = "";
        c[r[Math.floor(i / 8) + 1]] += e[i];
      }
      c[r[0]] = rnd;
      var d = (c.a || "") + (c.g || "") + (c.j || "") + (c.d || "");
      var u = (c.c || "") + (c.h || "") + (c.i || "") + (c.b || "");
      var mm = "";
      for (i = 0; i < d.length; i++) {
        var idx = VIDEA_CONST.indexOf(d.charAt(i));
        var at = i - (idx - 31);
        mm += (at >= 0 && at < u.length) ? u.charAt(at) : "";
      }
      r = ["f", "h", "c", "b", "i"];
      var n = {};
      for (i = 0; i < mm.length; i++) {
        if (i % 8 === 0) n[r[Math.floor(i / 8) + 1]] = "";
        n[r[Math.floor(i / 8) + 1]] += mm.charAt(i);
      }
      if (!n.h || !n.c) return null;
      return { s: rnd, t: n.h + n.c, kb: n.b || "", ki: n.i || "" };
    } catch (e2) {
      return null;
    }
  }

  function cleanTitle(s) {
    return String(s || "").replace(/\s+/g, " ").trim();
  }

  function makeAbsolute(url) {
    if (!url) return "";
    url = String(url).trim();
    if (url.indexOf("http://") === 0) return "https:" + url.substring(5);
    if (url.indexOf("https://") === 0) return url;
    if (url.indexOf("//") === 0) return "https:" + url;
    if (url.indexOf("/") === 0) return baseUrl + url;
    return baseUrl + "/" + url;
  }

  function isDefaultThumb(url) {
    return !url || url.indexOf("thumbnail-default") !== -1;
  }

  // Theme lazy-loads covers: img.imgInit[data-image] (waLoadImages copies
  // data-image -> src in the browser). Prefer data-image, fall back to src.
  async function extractCover(inner) {
    var cover = "";
    try {
      cover = await api.cssAttr(inner, "img.imgInit", "data-image") || "";
    } catch (e) {}
    if (!cover) {
      try {
        cover = await api.cssAttr(inner, "img", "data-image") || "";
      } catch (e) {}
    }
    if (!cover) {
      try {
        cover = await api.cssAttr(inner, ".anime-card-poster img", "src") || "";
      } catch (e) {}
    }
    if (!cover) {
      try {
        cover = await api.cssAttr(inner, "img", "src") || "";
      } catch (e) {}
    }
    return makeAbsolute(cover);
  }

  function parseEpisodeNumber(url) {
    var m = String(url || "").match(/الحلقة-(\d+)/);
    if (m) return m[1];
    return "0";
  }

  function qualityOf(serverName) {
    var n = String(serverName || "").toUpperCase();
    if (n.indexOf("FHD") !== -1 || n.indexOf("1080") !== -1) return "FHD";
    if (n.indexOf("HD") !== -1 || n.indexOf("720") !== -1) return "HD";
    if (n.indexOf("SD") !== -1 || n.indexOf("480") !== -1) return "SD";
    return null;
  }

  // ---- card parsers (shared card markup on home/search/list/genre) ----

  async function parseAnimeCards(html) {
    var items = await api.cssAll(html, ".anime-card-container");
    var out = [];
    var seen = {};
    for (var i = 0; i < items.length; i++) {
      var item = items[i] || {};
      var attrs = item.attrs || {};
      var inner = item.html || "";
      var href = attrs.href || "";
      if (!href) {
        try {
          href = await api.cssAttr(inner, "a.overlay", "href") || "";
        } catch (e) {
          href = "";
        }
      }
      if (!href) continue;
      var detailUrl = makeAbsolute(href);
      if (seen[detailUrl]) continue;
      seen[detailUrl] = true;
      var title = "";
      try {
        title = cleanTitle(await api.cssText(inner, ".anime-card-title")) || "";
      } catch (e) {}
      if (!title) {
        try {
          title = cleanTitle(await api.cssAttr(inner, "img", "alt")) || "";
        } catch (e) {}
      }
      if (!title) continue;
      var cover = await extractCover(inner);
      out.push({
        title: title,
        coverUrl: isDefaultThumb(cover) ? "" : cover,
        detailUrl: detailUrl,
        contentType: "anime"
      });
    }
    return out;
  }

  // Full episode list: initial #episodesList page + follow
  // .episodes-load-more[href] (/anime/<slug>/page/N/, 48/page).
  // Bounded by data-max-pages with a hard cap of 40 pages.
  async function parseAllEpisodes(html) {
    var episodes = await parseEpisodeCards(html);
    var seen = {};
    var i;
    for (i = 0; i < episodes.length; i++) seen[episodes[i].url] = true;
    var nextUrl = "";
    var maxPages = 40;
    try {
      nextUrl = await api.cssAttr(html, ".episodes-load-more", "href") || "";
    } catch (e) {}
    try {
      var maxAttr = await api.cssAttr(html, ".episodes-load-more", "data-max-pages") || "";
      var maxNum = parseInt(maxAttr, 10);
      if (!isNaN(maxNum) && maxNum > 1 && maxNum < maxPages) maxPages = maxNum;
    } catch (e) {}
    var page = 1;
    while (nextUrl && page < maxPages) {
      page++;
      var pageHtml = "";
      try {
        pageHtml = await fetchHtml(makeAbsolute(nextUrl));
      } catch (e) {
        break;
      }
      var more = await parseEpisodeCards(pageHtml);
      if (!more.length) break;
      for (var j = 0; j < more.length; j++) {
        if (!seen[more[j].url]) {
          seen[more[j].url] = true;
          episodes.push(more[j]);
        }
      }
      nextUrl = "";
      try {
        nextUrl = await api.cssAttr(pageHtml, ".episodes-load-more", "href") || "";
      } catch (e) {}
    }
    episodes.sort(function(a, b) {
      return (parseFloat(b.number) || 0) - (parseFloat(a.number) || 0);
    });
    return episodes;
  }

  // Anime page episodes: DOM list #episodesList .anime-card-themex.
  // Number from .ep_num link text, URL from overlay or .ep_num href.
  async function parseEpisodeCards(html) {
    var items = await api.cssAll(html, "#episodesList .anime-card-themex");
    if (!items.length) {
      try {
        items = await api.cssAll(html, "#episodesList .anime-card-container");
      } catch (e) {}
    }
    var out = [];
    var seen = {};
    for (var i = 0; i < items.length; i++) {
      var item = items[i] || {};
      var inner = item.html || "";
      var href = "";
      try {
        href = await api.cssAttr(inner, "a.overlay[href*='/episode/']", "href") || "";
      } catch (e) {}
      if (!href) {
        try {
          href = await api.cssAttr(inner, ".ep_num a[href*='/episode/']", "href") || "";
        } catch (e) {}
      }
      if (!href || href.indexOf("/episode/") === -1) continue;
      var episodeUrl = makeAbsolute(href);
      if (seen[episodeUrl]) continue;
      seen[episodeUrl] = true;
      var num = "";
      try {
        var epText = await api.cssText(inner, ".ep_num") || "";
        var m = epText.match(/(\d+)/);
        num = m ? m[1] : parseEpisodeNumber(episodeUrl);
      } catch (e) {
        num = parseEpisodeNumber(episodeUrl);
      }
      var cover = await extractCover(inner);
      out.push({
        number: num,
        title: "الحلقة " + num,
        url: episodeUrl,
        views: 0,
        isLocked: false,
        date: "",
        isFiller: false,
        thumbnailUrl: isDefaultThumb(cover) ? null : cover,
        durationSeconds: null,
        servers: []
      });
    }
    out.sort(function(a, b) {
      return (parseFloat(b.number) || 0) - (parseFloat(a.number) || 0);
    });
    return out;
  }

  async function parseAnimeDetails(html, url) {
    var title = "";
    try {
      title = cleanTitle(await api.cssText(html, "h1.anime-details-title")) || "";
    } catch (e) {}
    if (!title) {
      try {
        title = cleanTitle(await api.cssAttr(html, "meta[property='og:title']", "content")) || "";
      } catch (e) {}
    }
    var cover = "";
    try {
      cover = makeAbsolute(await api.cssAttr(html, ".anime-thumbnail img", "src") || "");
    } catch (e) {}
    if (!cover) {
      try {
        cover = makeAbsolute(await api.cssAttr(html, "meta[property='og:image']", "content") || "");
      } catch (e) {}
    }
    var description = "";
    try {
      description = cleanTitle(await api.cssText(html, "p.anime-story")) || "";
    } catch (e) {}
    if (!description) {
      try {
        description = cleanTitle(await api.cssAttr(html, "meta[name='description']", "content")) || "";
      } catch (e) {}
    }
    var genres = [];
    try {
      genres = (await api.cssList(html, "ul.anime-genres li a") || []).map(cleanTitle).filter(Boolean);
    } catch (e) {}

    var animeType = "", season = "", year = "", status = "";
    var episodeDurationMin = null, sourceMaterial = "";
    try {
      var rows = await api.cssAll(html, ".anime-info");
      for (var i = 0; i < rows.length; i++) {
        var text = cleanTitle((rows[i] || {}).text || "");
        if (text.indexOf("النوع") !== -1) {
          animeType = text.replace(/.*النوع\s*:?\s*/, "").trim() || animeType;
        } else if (text.indexOf("بداية العرض") !== -1 || text.indexOf("سنة") !== -1) {
          var ym = text.match(/(\d{4})/);
          year = ym ? ym[1] : "";
        } else if (text.indexOf("حالة الأنمي") !== -1 || text.indexOf("الحالة") !== -1) {
          status = text.replace(/.*الحالة\s*:?\s*/, "").trim();
        } else if (text.indexOf("مدة الحلقة") !== -1 || text.indexOf("المدة") !== -1) {
          var dm = text.match(/(\d+)/);
          episodeDurationMin = dm ? parseInt(dm[1], 10) : null;
        } else if (text.indexOf("الموسم") !== -1) {
          season = text.replace(/.*الموسم\s*:?\s*/, "").trim();
        } else if (text.indexOf("المصدر") !== -1) {
          sourceMaterial = text.replace(/.*المصدر\s*:?\s*/, "").trim();
        }
      }
    } catch (e) {}

    var trailerUrl = "";
    try {
      trailerUrl = makeAbsolute(await api.cssAttr(html, "a.anime-trailer", "href") || "");
    } catch (e) {}
    var malUrl = "";
    try {
      malUrl = makeAbsolute(await api.cssAttr(html, "a.anime-mal", "href") || "");
    } catch (e) {}

    var episodes = await parseAllEpisodes(html);

    return {
      title: title || "غير معروف",
      coverUrl: isDefaultThumb(cover) ? "" : cover,
      description: description,
      genres: genres,
      status: status,
      chapters: episodes,
      originalUrl: url,
      hasMoreChapters: false,
      lastFetchedPage: 1,
      contentType: "anime",
      animeType: animeType || null,
      season: season || null,
      year: year || null,
      episodeDurationMin: episodeDurationMin,
      sourceMaterial: sourceMaterial || null,
      trailerUrl: trailerUrl || null,
      malUrl: malUrl || null
    };
  }

  async function resolveParentAnime(episodeUrl) {
    try {
      var html = await fetchHtml(episodeUrl);
      var parent = "";
      try {
        parent = makeAbsolute(await api.cssAttr(html, ".anime-page-link a[href*='/anime/']", "href") || "");
      } catch (e) {}
      if (parent && parent.indexOf("/anime/") !== -1) return parent;
    } catch (e) {}
    return "";
  }

  // First-party S1/S2 servers: data-watch points at a same-network page
  // that embeds a live HLS master (streamUrl). Any query change 403s, so the
  // master URL is used exactly as minted (verified live 2026-09-19).
  function isS1S2(name, rawUrl) {
    var n = String(name || "").toUpperCase();
    var u = String(rawUrl || "");
    return n.indexOf("S1") !== -1 || n.indexOf("S2") !== -1 ||
      u.indexOf("Anime4up-S1") !== -1 || u.indexOf("Anime4up-S2") !== -1 ||
      u.indexOf("Anime4up-S") !== -1;
  }

  function resolveUrl(base, rel) {
    var r = String(rel || "").trim();
    if (/^https?:\/\//i.test(r)) return r;
    var b = String(base || "").split("?")[0].split("#")[0];
    var hm = b.match(/^(https?:\/\/[^\/]+)/);
    if (r.charAt(0) === "/") return hm ? (hm[1] + r) : r;
    var i = b.lastIndexOf("/");
    return b.substring(0, i + 1) + r;
  }

  function parseHlsVariants(masterUrl, body) {
    var lines = String(body || "").split("\n");
    var found = [];
    var i;
    for (i = 0; i < lines.length && found.length < 6; i++) {
      var inf = lines[i].match(/RESOLUTION=\d+x(\d+)/);
      if (inf && i + 1 < lines.length) {
        var vu = cleanTitle(lines[i + 1]);
        if (vu && vu.charAt(0) !== "#") {
          var abs = resolveUrl(masterUrl, vu);
          if (abs.indexOf("http") === 0) {
            found.push({ h: parseInt(inf[1], 10) || 0, url: abs });
          }
        }
      }
    }
    if (!found.length) {
      for (i = 0; i < lines.length && found.length < 6; i++) {
        var l = cleanTitle(lines[i]);
        if (l.charAt(0) !== "#") {
          var abs = l.indexOf("http") === 0 ? l : resolveUrl(masterUrl, l);
          if (abs.indexOf("http") === 0) found.push({ h: 0, url: abs });
        }
      }
    }
    var seen = {};
    var uniq = [];
    for (var j = 0; j < found.length; j++) {
      if (!seen[found[j].url]) {
        seen[found[j].url] = true;
        uniq.push(found[j]);
      }
    }
    uniq.sort(function (a, b) { return b.h - a.h; });
    var out = [];
    for (var k = 0; k < uniq.length; k++) {
      out.push({
        label: (uniq[k].h > 0 ? uniq[k].h + "p" : ("Q" + (k + 1))),
        url: uniq[k].url + "#.m3u8",
        height: uniq[k].h,
        isDefault: k === 0
      });
    }
    return out;
  }

  async function resolveS1S2(rawUrl, bud) {
    try {
      if (bud && !budDec(bud)) return null;
      var page = await fetchHtml(rawUrl);
      var m = page.match(/streamUrl\s*=\s*"([^"]+)"/);
      var master = m ? m[1] : "";
      if (!master || master.indexOf("http") !== 0) return null;
      if (bud && !budDec(bud)) return null;
      var body = await fetchHtml(master, { "Accept": "*/*", "Referer": rawUrl });
      if (body.indexOf("#EXTM3U") === -1) return null;
      var quals = parseHlsVariants(master, body);
      if (!quals.length) return null;
      return { master: master, qualities: quals };
    } catch (e) {
      return null;
    }
  }

  function withMp4Suffix(url) {
    var u = String(url || "");
    if (!u) return "";
    if (u.indexOf(".mp4") !== -1) return u;
    return u + "#.mp4";
  }

  // mp4upload: embed page -> player.src mp4 (1 fetch, verified 206/482MB).
  async function resolveMp4Upload(embedUrl, bud) {
    try {
      if (!budDec(bud)) return "";
      var html = await fetchHtml(embedUrl);
      var m = html.match(/https?:\/\/[a-z0-9.:]+\.mp4upload\.com[^\s"']+\/video\.mp4/);
      if (m) return m[0];
      var g = html.match(/src:\s*"([^"]+\.mp4[^"]*)"/);
      return g ? g[1] : "";
    } catch (e) {
      return "";
    }
  }

  // dood: page -> /pass_md5/ -> base + rand + token/expiry (2 fetches).
  async function resolveDood(embedUrl, bud) {
    try {
      if (!budDec(bud)) return "";
      var html = await fetchHtml(embedUrl);
      var m = html.match(/\/pass_md5\/[A-Za-z0-9\/_.\-]+/);
      if (!m) return "";
      var segs = m[0].split("/");
      var token = segs[segs.length - 1];
      if (!token) return "";
      if (!budDec(bud)) return "";
      var base = cleanTitle(await fetchHtml(resolveUrl(embedUrl, m[0]), { "Referer": embedUrl }));
      if (!base || base.indexOf("http") !== 0) return "";
      var now = 0;
      try {
        now = new Date().getTime();
      } catch (e) {}
      if (!now) return "";
      return withMp4Suffix(base + randAlphaNum(10) + "?token=" + token + "&expiry=" + now);
    } catch (e) {
      return "";
    }
  }

  // uqload: POST /dl -> packer -> jwplayer file (2 fetches, verified live).
  async function resolveUqload(embedUrl, bud) {
    try {
      var idm = String(embedUrl || "").match(/\/e\/([A-Za-z0-9]+)/);
      if (!idm || !budDec(bud)) return null;
      var hm = String(embedUrl).match(/^(https?:\/\/[^\/]+)/);
      var dlBase = hm ? hm[1] : "";
      if (dlBase.indexOf("uqload.is") !== -1) dlBase = "https://uqload.vc";
      if (!dlBase) return null;
      var post = await fetchHtml(dlBase + "/dl", {
        "Content-Type": "application/x-www-form-urlencoded",
        "Referer": embedUrl,
        "Origin": dlBase
      }, "POST", "op=embed&file_code=" + encodeURIComponent(idm[1]) + "&auto=1&referer=");
      var file = "";
      var up = unpackPacker(post);
      if (up) {
        var fm = up.match(/file\s*:\s*"([^"]+)"/);
        if (fm) file = fm[1];
      }
      if (!file || file.indexOf("http") !== 0) return null;
      var quals = [];
      if (budDec(bud)) {
        try {
          var master = await fetchHtml(file, { "Accept": "*/*", "Referer": dlBase + "/dl" });
          if (master && master.indexOf("#EXTM3U") !== -1) quals = parseHlsVariants(file, master);
        } catch (e) {}
      }
      return { url: file, qualities: quals };
    } catch (e) {
      return null;
    }
  }

  // voe: wall -> mirror domain -> application/json -> decode -> master.
  async function resolveVoe(embedUrl, bud) {
    try {
      if (!budDec(bud)) return null;
      var wall = await fetchHtml(embedUrl);
      var re = /https?:\/\/[A-Za-z0-9.\-]+\/(?:[A-Za-z0-9]+\/)?e\/[A-Za-z0-9]+/g, m;
      var mirror = "";
      while ((m = re.exec(wall)) !== null) {
        if (m[0].indexOf("voe.sx") === -1) {
          mirror = m[0];
          break;
        }
      }
      if (!mirror) return null;
      if (!budDec(bud)) return null;
      var page = await fetchHtml(mirror);
      var jm = page.match(/<script[^>]+type="application\/json"[^>]*>([\s\S]*?)<\/script>/);
      if (!jm) return null;
      var obj = null;
      try {
        obj = JSON.parse(voeDecode(cleanTitle(jm[1])));
        if (typeof obj === "string") {
          try {
            obj = JSON.parse(voeDecode(obj));
          } catch (e2) {}
        }
      } catch (e) {}
      if (!obj || !obj.source || String(obj.source).indexOf("http") !== 0) return null;
      return { url: obj.source, qualities: [] };
    } catch (e) {
      return null;
    }
  }

  // videa: player page -> xml crypto -> mp4 (verified end-to-end live).
  async function resolveVideaEmbed(embedUrl, bud) {
    try {
      if (!budDec(bud)) return "";
      var html = await fetchHtml(embedUrl);
      var xm = html.match(/var\s+_xt\s*=\s*"([^"]+)"/);
      var vm = html.match(/var\s+vcode\s*=\s*"([^"]+)"/);
      if (!xm || !vm || !budDec(bud)) return "";
      var pr = videaParams(xm[1], randStr(8));
      if (!pr) return "";
      var xmlUrl = "https://videa.hu/player/xml?v=" + encodeURIComponent(vm[1]) +
        "&_s=" + encodeURIComponent(pr.s) + "&_t=" + encodeURIComponent(pr.t);
      var res = await api.http(xmlUrl, {
        method: "GET",
        headers: mergeHeaders(defaultHeaders, {
          "Accept": "*/*",
          "Referer": "https://videa.hu/",
          "X-Requested-With": "XMLHttpRequest"
        })
      });
      if (!res || !res.ok) return "";
      var xs = "";
      try {
        var hs = res.headers || {};
        for (var k in hs) {
          if (String(k).toLowerCase() === "x-videa-xs") xs = hs[k];
        }
      } catch (e) {}
      if (!xs) return "";
      var dec = bytesToText(rc4Bytes(b64ToBytes(res.body || ""), strToBytes(pr.kb + pr.ki + pr.s + xs)));
      var expm = dec.match(/exp="(\d+)"/);
      var exp = expm ? expm[1] : "";
      var re = /<video_source\b([^>]*)>([^<]*)<\/video_source>/g, m;
      var best = "", bestH = -1, bestHash = "";
      while ((m = re.exec(dec)) !== null) {
        var attrs = m[1] || "";
        if (attrs.indexOf("video/mp4") === -1) continue;
        var src = cleanTitle(m[2]);
        if (!src) continue;
        var qm = attrs.match(/name="(\w+)"/);
        var qn = qm ? qm[1] : "";
        var h = 0;
        var hm = attrs.match(/height="(\d+)"/);
        if (hm) h = parseInt(hm[1], 10) || 0;
        if (!h) {
          var hm2 = qn.match(/(\d+)/);
          if (hm2) h = parseInt(hm2[1], 10) || 0;
        }
        var hhm = qn ? dec.match(new RegExp("<hash_value_" + qn + ">([^<]+)<")) : null;
        if (hhm && exp && h > bestH) {
          bestH = h;
          bestHash = hhm[1];
          best = src;
        }
      }
      if (!best || !bestHash) return "";
      if (best.indexOf("//") === 0) best = "https:" + best;
      else if (best.indexOf("http") !== 0) best = "https://videa.hu" + (best.charAt(0) === "/" ? "" : "/") + best;
      return withMp4Suffix(best + "?md5=" + bestHash + "&expires=" + exp);
    } catch (e) {
      return "";
    }
  }

  // vkvideo: video_ext.php -> files{mp4_N} (1 fetch, extraction verified).
  async function resolveVk(embedUrl, bud) {
    try {
      if (!budDec(bud)) return null;
      var html = await fetchHtml(embedUrl);
      var re = /mp4_(\d+)"\s*:\s*"(https:[^"]+)"/g, m;
      var cands = [];
      while ((m = re.exec(html)) !== null) {
        var u = m[2].split("\\").join("");
        if (u.indexOf("http") === 0) cands.push({ h: parseInt(m[1], 10) || 0, url: u });
      }
      if (!cands.length) return null;
      cands.sort(function (a, b) { return b.h - a.h; });
      var quals = [];
      for (var i = 0; i < cands.length && i < 6; i++) {
        quals.push({
          label: (cands[i].h > 0 ? cands[i].h + "p" : ("Q" + (i + 1))),
          url: withMp4Suffix(cands[i].url),
          height: cands[i].h,
          isDefault: i === 0
        });
      }
      return { url: withMp4Suffix(cands[0].url), qualities: quals };
    } catch (e) {
      return null;
    }
  }

  // Episode page servers: ul#episode-servers (or ul#watch-servers) with
  // li[data-watch="DIRECT-EMBED-URL"]. No obfuscation on this theme.
  async function decodeEpisodeServers(html) {
    var out = [];
    try {
      var links = await api.cssAll(html, "#episode-servers li[data-watch]");
      if (!links.length) {
        try {
          links = await api.cssAll(html, "#watch-servers li[data-watch]");
        } catch (e) {}
      }
      for (var i = 0; i < links.length; i++) {
        var item = links[i] || {};
        var attrs = item.attrs || {};
        var rawUrl = makeAbsolute(attrs["data-watch"] || "");
        if (!rawUrl) continue;
        var inner = item.html || "";
        var name = "";
        try {
          name = cleanTitle(await api.cssText(inner, ".watch-server-name")) || "";
        } catch (e) {}
        if (!name) {
          try {
            name = cleanTitle(await api.cssText(inner, "bdi")) || "";
          } catch (e) {}
        }
        if (!name) {
          try {
            name = cleanTitle(await api.cssText(inner, "a")) || ("سيرفر " + (i + 1));
          } catch (e) {
            name = "سيرفر " + (i + 1);
          }
        }
        var quality = null;
        try {
          var qText = await api.cssText(inner, ".quality") || "";
          quality = qualityOf(qText) || qualityOf(name);
        } catch (e) {
          quality = qualityOf(name);
        }
        out.push({
          idx: out.length,
          id: String(i),
          name: name,
          embedUrl: rawUrl,
          url: rawUrl,
          type: "embed",
          quality: quality,
          directUrl: "",
          qualities: []
        });
      }
      // Owner rule: list ONLY natively playable (direct) servers.
      // Dropped with zero direct proof (verified live 2026-09-21):
      // share4max (embed aggregator), rubyvidhub (deleted/expired),
      // mega/hgcloud/yonaplay/soraplay/google (unknown/unplayable targets),
      // download buckets (stream-only app). tierOf==99 never resolves.
      // Resolution budget: 14 extra fetches max + soft 12s deadline;
      // resolved-so-far is returned (all listed = direct, owner rule).
      var bud = { n: 14 };
      var t0 = 0;
      try {
        t0 = new Date().getTime();
      } catch (e) {}
      function deadlineHit() {
        try {
          if (!t0) return false;
          return (new Date().getTime() - t0) > 12000;
        } catch (e) {
          return false;
        }
      }
      function tierOf(name, url) {
        if (isS1S2(name, url)) return 0;
        var n = String(name || "").toLowerCase();
        var u = String(url || "").toLowerCase();
        if (n.indexOf("mp4upload") !== -1 || u.indexOf("mp4upload") !== -1) return 1;
        if (n.indexOf("uqload") !== -1 || u.indexOf("uqload") !== -1) return 2;
        if (n.indexOf("voe") !== -1 || u.indexOf("voe.") !== -1) return 3;
        if (n.indexOf("dood") !== -1 || u.indexOf("dood") !== -1 ||
          n.indexOf("playmogo") !== -1 || u.indexOf("playmogo") !== -1) return 4;
        if (n.indexOf("videa") !== -1 || u.indexOf("videa") !== -1) return 5;
        if (n.indexOf("vkvideo") !== -1 || u.indexOf("vkvideo") !== -1 ||
          u.indexOf("vk.com/") !== -1 || n === "vk") return 6;
        return 99;
      }
      // Resolve cheapest-proven first (deadline economics); emission below
      // stays in value order (tierOf). Display order != resolution order.
      // Cost order: mp4(1) S1S2(2+2) uqload(2) voe(2) dood(2) videa(2) vk(1).
      var costOrder = [1, 0, 2, 3, 4, 5, 6];
      var s1tried = 0;
      for (var ci = 0; ci < costOrder.length && bud.n > 0; ci++) {
        var tier = costOrder[ci];
        if (deadlineHit()) break;
        for (var s = 0; s < out.length; s++) {
          if (deadlineHit()) break;
          if (out[s].directUrl || out[s].dropped) continue;
          if (tierOf(out[s].name, out[s].embedUrl) !== tier) continue;
          try {
            if (tier === 0) {
              if (s1tried >= 2) continue;
              s1tried++;
              var res = await resolveS1S2(out[s].embedUrl, bud);
              if (res) {
                out[s].directUrl = res.master + "#.m3u8";
                out[s].type = "m3u8";
                out[s].qualities = res.qualities;
              } else {
                out[s].dropped = true;
              }
            } else if (tier === 1) {
              var mu = await resolveMp4Upload(out[s].embedUrl, bud);
              if (mu) {
                out[s].directUrl = mu;
                out[s].type = "mp4";
              } else {
                out[s].dropped = true;
              }
            } else if (tier === 2) {
              var uq = await resolveUqload(out[s].embedUrl, bud);
              if (uq) {
                out[s].directUrl = uq.url;
                out[s].type = "m3u8";
                out[s].qualities = uq.qualities;
              } else {
                out[s].dropped = true;
              }
            } else if (tier === 3) {
              var vo = await resolveVoe(out[s].embedUrl, bud);
              if (vo) {
                out[s].directUrl = vo.url;
                out[s].type = "m3u8";
                out[s].qualities = vo.qualities;
              } else {
                out[s].dropped = true;
              }
            } else if (tier === 4) {
              var dd = await resolveDood(out[s].embedUrl, bud);
              if (dd) {
                out[s].directUrl = dd;
                out[s].type = "mp4";
              } else {
                out[s].dropped = true;
              }
            } else if (tier === 5) {
              var vi = await resolveVideaEmbed(out[s].embedUrl, bud);
              if (vi) {
                out[s].directUrl = vi;
                out[s].type = "mp4";
              } else {
                out[s].dropped = true;
              }
            } else if (tier === 6) {
              var vk = await resolveVk(out[s].embedUrl, bud);
              if (vk) {
                out[s].directUrl = vk.url;
                out[s].type = "mp4";
                out[s].qualities = vk.qualities;
              } else {
                out[s].dropped = true;
              }
            }
          } catch (e) {
            out[s].dropped = true;
          }
        }
      }
      var ordered = [];
      for (var q = 0; q < out.length; q++) {
        if (!out[q].dropped && out[q].directUrl) ordered.push(out[q]);
      }
      ordered.sort(function (a, b) {
        var ra = tierOf(a.name, a.embedUrl);
        var rb = tierOf(b.name, b.embedUrl);
        if (ra !== rb) return ra - rb;
        return a.idx - b.idx;
      });
      var servers = [];
      for (var k = 0; k < ordered.length; k++) {
        var srv = {
          id: ordered[k].id,
          name: ordered[k].name,
          embedUrl: ordered[k].embedUrl,
          url: ordered[k].url,
          directUrl: ordered[k].directUrl,
          type: ordered[k].type,
          quality: ordered[k].quality
        };
        if (ordered[k].qualities && ordered[k].qualities.length) srv.qualities = ordered[k].qualities;
        servers.push(srv);
      }
      return servers;
    } catch (e) {}
    return [];
  }

  return {
    requiresCloudflare: false,

    async getHomepageManga(args) {
      try {
        var page = (args && args.page) || 1;
        if (page === 1) {
          var html = await fetchHtml(baseUrl + "/home8/");
          var cards = await parseAnimeCards(html);
          if (!cards.length) {
            cards = await parseAnimeCards(await fetchHtml(baseUrl + "/"));
          }
          return cards;
        }
        var listHtml = await fetchHtml(baseUrl + "/قائمة-الانمي/page/" + page + "/");
        return await parseAnimeCards(listHtml);
      } catch (e) {
        return [];
      }
    },

    async search(args) {
      try {
        var query = (args && args.query) || "";
        if (!query.trim()) return [];
        var page = (args && args.page) || 1;
        var url = page === 1
          ? baseUrl + "/?s=" + encodeURIComponent(query)
          : baseUrl + "/page/" + page + "/?s=" + encodeURIComponent(query);
        return await parseAnimeCards(await fetchHtml(url));
      } catch (e) {
        return [];
      }
    },

    async getMangaDetails(args) {
      var url = makeAbsolute((args && args.url) || "");
      try {
        if (url.indexOf("/episode/") !== -1) {
          var parent = await resolveParentAnime(url);
          if (parent) {
            var details = await parseAnimeDetails(await fetchHtml(parent), parent);
            details.originalUrl = parent;
            return details;
          }
          var epHtml = await fetchHtml(url);
          var epTitle = "";
          try {
            epTitle = cleanTitle(await api.cssText(epHtml, ".main-section h3")) || url;
          } catch (e) {
            epTitle = url;
          }
          return {
            title: epTitle,
            coverUrl: "",
            description: "",
            genres: [],
            status: "",
            chapters: [{
              number: parseEpisodeNumber(url),
              title: epTitle,
              url: url,
              views: 0,
              isLocked: false,
              date: "",
              isFiller: false,
              thumbnailUrl: null,
              durationSeconds: null,
              servers: []
            }],
            originalUrl: url,
            hasMoreChapters: false,
            lastFetchedPage: 1,
            contentType: "anime"
          };
        }
        return await parseAnimeDetails(await fetchHtml(url), url);
      } catch (e) {
        return {
          title: "غير معروف",
          coverUrl: "",
          description: "",
          genres: [],
          status: "",
          chapters: [],
          originalUrl: url,
          hasMoreChapters: false,
          lastFetchedPage: 1,
          contentType: "anime"
        };
      }
    },

    async getChapterPages() {
      return [];
    },

    async getChapterContent(args) {
      try {
        var url = makeAbsolute((args && args.url) || "");
        if (url.indexOf("/episode/") !== -1) {
          var servers = await this.getEpisodeServers({ url: url });
          return { kind: "video", servers: servers };
        }
        return { kind: "image", imageUrls: [] };
      } catch (e) {
        return { kind: "image", imageUrls: [] };
      }
    },

    async getEpisodeServers(args) {
      try {
        var url = makeAbsolute((args && args.url) || "");
        if (!url) return [];
        var html = await fetchHtml(url);
        return await decodeEpisodeServers(html);
      } catch (e) {
        return [];
      }
    },

    async resolveServer(args) {
      try {
        var serverUrl = makeAbsolute((args && (args.serverUrl || args.url)) || "");
        if (!serverUrl) return null;
        return {
          url: serverUrl,
          type: "embed",
          headers: {
            "User-Agent": userAgent,
            "Referer": baseUrl + "/",
            "Accept": "*/*",
            "Accept-Language": "ar,en-US;q=0.9,en;q=0.8"
          }
        };
      } catch (e) {
        return null;
      }
    },

    async getFilteredManga(args) {
      try {
        var page = (args && args.page) || 1;
        var genre = cleanTitle((args && args.genre) || "");
        var type = cleanTitle((args && args.type) || "");
        var status = cleanTitle((args && args.status) || "");
        var base = baseUrl;
        if (genre) {
          base = baseUrl + "/anime-genre/" + taxonomySlug(genre) + "/";
        } else if (type) {
          var t = type.toLowerCase();
          var slug = t.indexOf("movie") !== -1 || type.indexOf("فيلم") !== -1 ? "movie-3"
            : t.indexOf("tv") !== -1 ? "tv2"
            : t.indexOf("ova") !== -1 ? "ova"
            : t.indexOf("ona") !== -1 ? "ona"
            : t.indexOf("special") !== -1 ? "special" : "tv2";
          base = baseUrl + "/anime-type/" + slug + "/";
        } else if (status) {
          base = baseUrl + "/anime-status/" + taxonomySlug(status) + "/";
        } else {
          base = baseUrl + "/قائمة-الانمي/";
        }
        var url = page > 1 ? base.replace(/\/+$/, "") + "/page/" + page + "/" : base;
        return await parseAnimeCards(await fetchHtml(url));
      } catch (e) {
        return [];
      }
    },

    async getGenresAndTypes() {
      return { genres: defaultGenres, types: defaultTypes };
    },

    async fetchMoreChapters() {
      return null;
    },

    getImageHeaders() {
      return {
        "User-Agent": userAgent,
        "Referer": lastPageUrl || baseUrl + "/",
        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "Accept-Language": "ar,en-US;q=0.9,en;q=0.8",
        "Sec-Fetch-Dest": "image",
        "Sec-Fetch-Mode": "no-cors",
        "Sec-Fetch-Site": "cross-site"
      };
    },

    getVideoHeaders() {
      return {
        "User-Agent": userAgent,
        "Referer": baseUrl + "/",
        "Accept": "*/*",
        "Accept-Language": "ar,en-US;q=0.9,en;q=0.8",
        "Sec-Fetch-Dest": "video",
        "Sec-Fetch-Mode": "no-cors",
        "Sec-Fetch-Site": "cross-site"
      };
    },

    sanitizeCoverUrl(args) {
      return makeAbsolute((args && args.url) || "");
    }
  };
}

if (typeof module !== "undefined") module.exports = { createSource: createSource };
