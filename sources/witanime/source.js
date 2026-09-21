function createSource(api, config) {
  var baseUrl = ((config && config.base_url) || "https://witanime.site").replace(/\/+$/, "");
  var configHeaders = (config && config.headers) || {};
  var userAgent =
    configHeaders["User-Agent"] ||
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
  var lastPageUrl = baseUrl + "/";

  // Minimal cookie jar: the Laravel backend gates POST /watch/.../sources
  // behind session cookies (XSRF-TOKEN + witanime-session) + X-CSRF-TOKEN.
  // GET without cookies -> POST returns 419; direct GET of sources -> 404.
  var cookieJar = "";

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

  // Anime-Online-Theme filter vocab (verified live on /قائمة-الانمي/).
  var defaultGenres = [
    "أكشن", "مغامرات", "كوميدي", "دراما", "خيال", "خيال علمي",
    "رومانسي", "رعب", "غموض", "نفسي", "رياضي", "مدرسي",
    "شونين", "شوجو", "سينين", "ايسيكاي", "قوة خارقة", "شريحة من الحياة",
    "تاريخي", "عسكري", "فضاء", "ميكان", "موسيقى",
    "لعبة", "ساخر", "مصاصي دماء", "شياطين", "سحر", "ساموراي",
    "تحقيق", "بوليسي", "ايتشي", "حريم", "جوسي", "شوجو آي",
    "إثارة", "تشويق", "خارق للطبيعة", "فنون قتالية", "أطفال"
  ];
  var defaultTypes = ["TV", "Movie", "ONA", "OVA", "Special"];

  function mergeHeaders(a, b) {
    var out = {};
    for (var k in a) out[k] = a[k];
    if (b) for (var x in b) out[x] = b[x];
    return out;
  }

  function rememberCookies(res) {
    try {
      var headers = (res && res.headers) || {};
      var raw = headers["set-cookie"] || headers["Set-Cookie"] || headers["SET-COOKIE"] || "";
      if (!raw) {
        for (var k in headers) {
          if (String(k).toLowerCase() === "set-cookie") {
            raw = headers[k];
            break;
          }
        }
      }
      var parts = [];
      if (raw instanceof Array) {
        parts = raw;
      } else if (raw) {
        parts = String(raw).split(/\n/);
      }
      var store = {};
      var i, j;
      var existing = String(cookieJar || "").split(/;\s*/);
      for (i = 0; i < existing.length; i++) {
        var kv = existing[i].split("=");
        if (kv.length >= 2 && kv[0]) store[kv[0]] = existing[i].substring(kv[0].length + 1);
      }
      for (i = 0; i < parts.length; i++) {
        var first = String(parts[i] || "").split(";")[0].trim();
        var eq = first.indexOf("=");
        if (eq > 0) store[first.substring(0, eq).trim()] = first.substring(eq + 1).trim();
      }
      var out = [];
      for (j in store) {
        if (store[j]) out.push(j + "=" + store[j]);
      }
      cookieJar = out.join("; ");
    } catch (e) {}
  }

  function withCookies(headers) {
    var out = mergeHeaders({}, headers);
    if (cookieJar) out["Cookie"] = cookieJar;
    return out;
  }

  async function fetchHtml(url, extraHeaders, method, body) {
    lastPageUrl = url || lastPageUrl;
    var headers = withCookies(mergeHeaders(defaultHeaders, extraHeaders));
    if (api.http) {
      var res = await api.http(url, { method: method || "GET", headers: headers, body: body });
      if (!res || !res.ok) throw new Error("HTTP " + (res ? res.status : 0) + " for " + url);
      rememberCookies(res);
      return res.body || "";
    }
    if (method && method !== "GET") return "";
    var html = await api.fetchText(url, headers);
    if (!html) throw new Error("Empty response: " + url);
    return html;
  }

  async function fetchJson(url, extraHeaders, method, body) {
    var headers = withCookies(mergeHeaders({
      "User-Agent": userAgent,
      "Accept": "application/json",
      "Accept-Language": "ar,en-US;q=0.9,en;q=0.8",
      "Referer": lastPageUrl || (baseUrl + "/")
    }, extraHeaders));
    if (!api.http) throw new Error("No http bridge for " + url);
    var res = await api.http(url, { method: method || "GET", headers: headers, body: body });
    rememberCookies(res);
    if (!res || !res.ok) throw new Error("HTTP " + (res ? res.status : 0) + " for " + url);
    try {
      return JSON.parse(res.body || "{}");
    } catch (e) {
      throw new Error("Bad JSON for " + url);
    }
  }

  function cleanTitle(s) {
    return String(s || "").replace(/\s+/g, " ").trim();
  }

  function stripTags(s) {
    return cleanTitle(String(s || "").replace(/<[^>]*>/g, " "));
  }

  function unescapeHtml(s) {
    return String(s || "")
      .replace(/&quot;/g, "\"")
      .replace(/&#39;/g, "'")
      .replace(/&#x27;/g, "'")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");
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

  function parseEpisodeNumber(url) {
    var m = String(url || "").match(/\/watch\/[^/?#]+\/(\d+)/);
    if (m) return m[1];
    var m2 = String(url || "").match(/الحلقة-(\d+)/);
    if (m2) return m2[1];
    return "0";
  }

  function qualityOf(serverName) {
    var n = String(serverName || "").toUpperCase();
    if (n.indexOf("4K") !== -1) return "4K";
    if (n.indexOf("FHD") !== -1 || n.indexOf("1080") !== -1) return "FHD";
    if (n.indexOf("HD") !== -1 || n.indexOf("720") !== -1) return "HD";
    if (n.indexOf("SD") !== -1 || n.indexOf("480") !== -1) return "SD";
    return null;
  }

  function getCsrfToken(html) {
    var m = String(html || "").match(/<meta[^>]+name="csrf-token"[^>]+content="([^"]+)"/);
    if (m) return m[1];
    var m2 = String(html || "").match(/<meta[^>]+content="([^"]+)"[^>]+name="csrf-token"/);
    return (m2 && m2[1]) || "";
  }

  // ---- card parser (browse / movies / search HTML) ----
  // Card: <a class="group block w-full cursor-pointer" href="/anime/{slug}|/movie/{slug}">
  //         <img src="...posters..." alt="..."> ... <h3>Title</h3>

  async function parseCards(html) {
    var anchors = [];
    try {
      anchors = anchors.concat(await api.cssAll(html, "a[href*='/anime/']") || []);
    } catch (e) {}
    try {
      anchors = anchors.concat(await api.cssAll(html, "a[href*='/movie/']") || []);
    } catch (e) {}
    if (!anchors.length) return parseCardsRegex(html);
    var out = [];
    var seen = {};
    for (var i = 0; i < anchors.length; i++) {
      var item = anchors[i] || {};
      var attrs = item.attrs || {};
      var inner = item.html || "";
      var href = attrs.href || "";
      if (!href) continue;
      if (href.indexOf("/anime/") === -1 && href.indexOf("/movie/") === -1) continue;
      if (href.indexOf("/watch/") !== -1) continue;
      var detailUrl = makeAbsolute(href);
      if (seen[detailUrl]) continue;
      seen[detailUrl] = true;
      if (inner.indexOf("<h3") === -1 && inner.indexOf("<img") === -1) continue;
      var title = "";
      try {
        title = unescapeHtml(cleanTitle(await api.cssText(inner, "h3"))) || "";
      } catch (e) {}
      if (!title) {
        try {
          title = unescapeHtml(cleanTitle(await api.cssAttr(inner, "img", "alt"))) || "";
        } catch (e) {}
      }
      if (!title) continue;
      var cover = "";
      try {
        cover = makeAbsolute(await api.cssAttr(inner, "img", "src") || "");
      } catch (e) {}
      if (!cover) {
        try {
          cover = makeAbsolute(await api.cssAttr(inner, "img", "data-src") || "");
        } catch (e) {}
      }
      out.push({
        title: title,
        coverUrl: cover,
        detailUrl: detailUrl,
        contentType: "anime"
      });
    }
    if (!out.length) return parseCardsRegex(html);
    return out;
  }

  function parseCardsRegex(html) {
    var out = [];
    var seen = {};
    var re = /<a[^>]+href="([^"]*(?:\/anime\/|\/movie\/)[^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    var m;
    while ((m = re.exec(String(html || ""))) !== null) {
      var href = m[1] || "";
      var inner = m[2] || "";
      if (href.indexOf("/watch/") !== -1) continue;
      var detailUrl = makeAbsolute(href);
      if (seen[detailUrl]) continue;
      if (inner.indexOf("<h3") === -1 && inner.indexOf("<img") === -1) continue;
      seen[detailUrl] = true;
      var title = "";
      var hm = inner.match(/<h3[^>]*>([\s\S]*?)<\/h3>/);
      if (hm) title = unescapeHtml(stripTags(hm[1]));
      if (!title) {
        var am = inner.match(/<img[^>]+alt="([^"]*)"/);
        if (am) title = unescapeHtml(cleanTitle(am[1]));
      }
      if (!title) continue;
      var cover = "";
      var sm = inner.match(/<img[^>]+src="([^"]+)"/);
      if (sm) cover = makeAbsolute(sm[1]);
      if (!cover) {
        var dm = inner.match(/<img[^>]+data-src="([^"]+)"/);
        if (dm) cover = makeAbsolute(dm[1]);
      }
      out.push({
        title: title,
        coverUrl: cover,
        detailUrl: detailUrl,
        contentType: "anime"
      });
      if (out.length > 300) break;
    }
    return out;
  }

  // ---- anime / movie details ----
  // h1 title, p.mb-6.leading-relaxed story, span.rounded-full.border genres,
  // div.mb-6.grid info rows (label span.text-neutral-400 + value p.text-white),
  // episodes a[href*=/watch/] "الحلقة N".

  async function parseDetails(html, url) {
    html = String(html || "");
    var title = "";
    try {
      title = unescapeHtml(stripTags(await api.cssText(html, "h1"))) || "";
    } catch (e) {}
    if (!title) {
      var hm = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
      if (hm) title = unescapeHtml(stripTags(hm[1]));
    }
    if (!title) {
      try {
        title = unescapeHtml(cleanTitle(await api.cssAttr(html, "meta[property='og:title']", "content"))) || "";
      } catch (e) {}
    }

    var cover = "";
    try {
      cover = makeAbsolute(await api.cssAttr(html, "meta[property='og:image']", "content") || "");
    } catch (e) {}
    if (!cover) {
      var pm = html.match(/<img[^>]+src="(https:\/\/images\.witanime\.site\/posters\/[^"]+)"/);
      if (pm) cover = pm[1];
    }

    var description = "";
    var sm = html.match(/<p[^>]*class="[^"]*leading-relaxed[^"]*"[^>]*>([\s\S]*?)<\/p>/);
    if (sm) description = unescapeHtml(stripTags(sm[1]));
    if (description.length < 60) {
      var dm = html.match(/<meta[^>]+name="description"[^>]+content="([^"]+)"/);
      if (!dm) dm = html.match(/<meta[^>]+content="([^"]+)"[^>]+name="description"/);
      if (dm && dm[1] && dm[1].length > description.length) description = unescapeHtml(cleanTitle(dm[1]));
    }

    var genres = [];
    try {
      var genreSpans = await api.cssList(html, "span.rounded-full") || [];
      for (var gi = 0; gi < genreSpans.length; gi++) {
        var g = unescapeHtml(cleanTitle(genreSpans[gi]));
        if (g && genres.indexOf(g) === -1) genres.push(g);
      }
    } catch (e) {}
    if (!genres.length) {
      var gre = /<span[^>]*class="[^"]*rounded-full[^"]*"[^>]*>([^<]*)<\/span>/g;
      var gm;
      while ((gm = gre.exec(html)) !== null) {
        var gt = unescapeHtml(cleanTitle(gm[1]));
        if (gt && genres.indexOf(gt) === -1) genres.push(gt);
      }
    }

    var status = "", year = "", animeType = "", season = "", sourceMaterial = "";
    var episodeDurationMin = null;
    var ire = /<span[^>]*class="[^"]*text-neutral-400[^"]*"[^>]*>([^<]*)<\/span>\s*<p[^>]*>([\s\S]*?)<\/p>/g;
    var im;
    while ((im = ire.exec(html)) !== null) {
      var label = cleanTitle(im[1]);
      var value = unescapeHtml(stripTags(im[2]));
      if (!value) continue;
      if (label.indexOf("الحالة") !== -1 || label.indexOf("حالة") !== -1) {
        status = value;
      } else if (label.indexOf("النوع") !== -1) {
        animeType = value;
      } else if (label.indexOf("الموسم") !== -1) {
        season = value;
      } else if (label.indexOf("السنة") !== -1 || label.indexOf("سنة") !== -1) {
        var ym = value.match(/(\d{4})/);
        year = ym ? ym[1] : value;
      } else if (label.indexOf("المدة") !== -1 || label.indexOf("مدة") !== -1) {
        var dm = value.match(/(\d+)/);
        episodeDurationMin = dm ? parseInt(dm[1], 10) : null;
      } else if (label.indexOf("المصدر") !== -1) {
        sourceMaterial = value;
      }
    }

    var trailerUrl = "";
    try {
      trailerUrl = makeAbsolute(await api.cssAttr(html, "a[href*='youtube']", "href") || "");
    } catch (e) {}

    // Type badge on the hero (TV / فيلم / OVA / ONA / Special ...).
    if (!animeType) {
      var bm = html.match(/<div[^>]*class="[^"]*rounded-md[^"]*bg-white[^"]*"[^>]*>([^<]*)<\/div>/);
      if (bm) {
        var cand = unescapeHtml(cleanTitle(bm[1]));
        var known = ["TV", "Movie", "OVA", "ONA", "Special", "فيلم"];
        for (var bi = 0; bi < known.length; bi++) {
          if (cand === known[bi] || cand.toLowerCase() === known[bi].toLowerCase()) {
            animeType = known[bi] === "فيلم" ? "Movie" : known[bi];
            break;
          }
        }
      }
    }
    if (!animeType && url.indexOf("/movie/") !== -1) animeType = "Movie";

    var episodes = parseEpisodes(html, title, url.indexOf("/movie/") !== -1);

    return {
      title: title || "غير معروف",
      coverUrl: cover,
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
      malUrl: null
    };
  }

  function parseEpisodes(html, title, isMoviePage) {
    var out = [];
    var seen = {};
    var re = /<a[^>]+href="([^"]*\/watch\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    var m;
    while ((m = re.exec(String(html || ""))) !== null) {
      var href = m[1] || "";
      var epUrl = makeAbsolute(href);
      if (!epUrl || seen[epUrl]) continue;
      seen[epUrl] = true;
      var label = unescapeHtml(stripTags(m[2]));
      var nm = label.match(/الحلقة\s*(\d+)/) || epUrl.match(/\/watch\/[^/?#]+\/(\d+)/);
      var num = nm ? nm[1] : parseEpisodeNumber(epUrl);
      out.push({
        number: String(num),
        title: isMoviePage ? ("فيلم " + (title || "")) : ("الحلقة " + num),
        url: epUrl,
        views: 0,
        isLocked: false,
        date: "",
        isFiller: false,
        thumbnailUrl: null,
        durationSeconds: null,
        servers: []
      });
      if (out.length > 2000) break;
    }
    out.sort(function (a, b) {
      return (parseFloat(b.number) || 0) - (parseFloat(a.number) || 0);
    });
    return out;
  }

  function parentAnimeUrls(episodeUrl) {
    var m = String(episodeUrl || "").match(/\/watch\/([^/?#]+)\/\d+/);
    if (!m) return [];
    return [baseUrl + "/anime/" + m[1], baseUrl + "/movie/" + m[1]];
  }

  function streamToken(serverUrl) {
    var m = String(serverUrl || "").match(/([a-f0-9]{64})/);
    return (m && m[1]) || "";
  }

  // Per-file headers: the app NEVER reads server.headers (zero consumers)
  // and getVideoHeaders(url) is the only channel reaching the player.
  // Hosts like 4shared/mp4upload/videa reject source-domain Referer, so
  // every resolved file remembers the page that serves it.
  var mediaHeaders = {};

  function rememberMedia(fileUrl, referer) {
    if (!fileUrl || !referer) return;
    mediaHeaders[String(fileUrl)] = String(referer);
    var bare = String(fileUrl).split("#")[0];
    if (bare && bare !== fileUrl) mediaHeaders[bare] = String(referer);
  }

  function embedRefererFor(url) {
    var u = String(url || "").toLowerCase();
    if (u.indexOf("mp4upload.com") !== -1) return "https://www.mp4upload.com/";
    if (u.indexOf("uqload.") !== -1) return "https://uqload.vc/";
    if (u.indexOf("videa.hu") !== -1) return "https://videa.hu/";
    if (u.indexOf("4shared.com") !== -1) return "https://www.4shared.com/";
    if (u.indexOf("vkvideo.ru") !== -1 || u.indexOf("okcdn.ru") !== -1) return "https://vkvideo.ru/";
    return "";
  }

  function videoHeadersFor(url) {
    var u = String(url || "");
    var ref = mediaHeaders[u] || mediaHeaders[u.split("#")[0]] || embedRefererFor(u) || baseUrl + "/";
    return {
      "User-Agent": userAgent,
      "Referer": ref,
      "Accept": "*/*",
      "Accept-Language": "ar,en-US;q=0.9,en;q=0.8",
      "Sec-Fetch-Dest": "video",
      "Sec-Fetch-Mode": "no-cors",
      "Sec-Fetch-Site": "cross-site"
    };
  }

  // Pure-JS crypto/text helpers (QuickJS-safe: var/Math/String/regex only).

  function randStr(n) {
    var chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    var out = "";
    for (var i = 0; i < (n || 8); i++) {
      out += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return out;
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

  function budDec(bud) {
    if (!bud || bud.n <= 0) return false;
    bud.n--;
    return true;
  }

  // Videa player crypto (reverse-engineered from the live player bundle,
  // verified end-to-end 2026-09-21: params -> xml 200 -> RC4 -> video_src).
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

  // playerHtml: videa player page body (gate follows to it). Returns direct
  // mp4 (video/mp4 sources only) or "". Needs raw headers (X-Videa-XS).
  async function resolveVideaUrl(playerHtml, bud) {
    try {
      var html = String(playerHtml || "");
      var xm = html.match(/var\s+_xt\s*=\s*"([^"]+)"/);
      var vm = html.match(/var\s+vcode\s*=\s*"([^"]+)"/);
      if (!xm || !vm || !budDec(bud)) return "";
      var pr = videaParams(xm[1], randStr(8));
      if (!pr) return "";
      var xmlUrl = "https://videa.hu/player/xml?v=" + encodeURIComponent(vm[1]) +
        "&_s=" + encodeURIComponent(pr.s) + "&_t=" + encodeURIComponent(pr.t);
      var res = await api.http(xmlUrl, {
        method: "GET",
        headers: withCookies({
          "User-Agent": userAgent,
          "Accept": "*/*",
          "Referer": "https://videa.hu/",
          "X-Requested-With": "XMLHttpRequest"
        })
      });
      rememberCookies(res);
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
        if (!src || src.indexOf("http") !== 0 && src.indexOf("//") !== 0) continue;
        var qm = attrs.match(/name="(\w+)"/);
        var qn = qm ? qm[1] : "";
        var hm = attrs.match(/height="(\d+)"/);
        var h = hm ? parseInt(hm[1], 10) : 0;
        var hm2 = qn.match(/(\d+)/);
        if (!h && hm2) h = parseInt(hm2[1], 10);
        var hhm = dec.match(new RegExp("<hash_value_" + qn + ">([^<]+)<"));
        if (hhm && exp && h > bestH) {
          bestH = h;
          bestHash = hhm[1];
          best = src;
        }
      }
      if (!best || !bestHash) return "";
      if (best.indexOf("//") === 0) best = "https:" + best;
      else if (best.indexOf("http") !== 0) best = "https://videa.hu" + (best.charAt(0) === "/" ? "" : "/") + best;
      return withMediaSuffix(best + "?md5=" + bestHash + "&expires=" + exp, ".mp4");
    } catch (e) {
      return "";
    }
  }

  function extractOkMp4(body) {
    var html = String(body || "");
    var pats = [
      /"url1080"\s*:\s*"(https:[^"]+?\.mp4[^"]*)"/,
      /"url720"\s*:\s*"(https:[^"]+?\.mp4[^"]*)"/,
      /"url480"\s*:\s*"(https:[^"]+?\.mp4[^"]*)"/,
      /(https?:\/\/[^"'\s<>]+\.mp4[^"'\s<>]*)/
    ];
    for (var i = 0; i < pats.length; i++) {
      var m = html.match(pats[i]);
      if (m) return (m[1] || m[0]).replace(/\\\//g, "/");
    }
    return "";
  }

  // App native playback requires a .mp4/.m3u8 suffix (extract case 1).
  // '#' fragments are never sent to the server (verified 206), so they
  // only satisfy the suffix check without changing the request.
  function withMediaSuffix(url, suffix) {
    var u = String(url || "");
    if (!u) return "";
    if (u.indexOf(suffix) !== -1) return u;
    return u + "#" + suffix;
  }

  function extractDirectMp4(body) {
    var html = String(body || "");
    var m = html.match(/https?:\/\/dc\d+\.4shared\.com\/[^"'\s<>]+/);
    if (m) return withMediaSuffix(m[0], ".mp4");
    var p = html.match(/player\.src\(\{\s*[^}]*src:\s*"([^"]+)"/) || html.match(/src:\s*"([^"]+\.mp4[^"]*)"/);
    if (p) return withMediaSuffix(p[1], ".mp4");
    var g = html.match(/https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*/);
    if (g) return g[0];
    return "";
  }

  // ---- episode servers (Laravel CSRF chain, verified live) ----
  // GET {watchUrl} (cookies + csrf-token meta)
  // -> POST {watchUrl}/sources (X-CSRF-TOKEN + Cookie + Referer)
  // -> {players:{FHD:[{token,label,version,lang}],...}, downloads:{...}}
  // playback url = /watch/stream-gate/{token} (verified in watchPlayer bundle).

  async function decodeEpisodeServers(watchUrl) {
    var out = [];
    try {
      var html = await fetchHtml(watchUrl);
      var csrf = getCsrfToken(html);
      if (!csrf) return [];
      var sourcesUrl = String(watchUrl).replace(/\/+$/, "") + "/sources";
      var data;
      try {
        data = await fetchJson(sourcesUrl, {
          "X-CSRF-TOKEN": csrf,
          "X-Requested-With": "XMLHttpRequest",
          "Referer": watchUrl,
          "Origin": baseUrl
        }, "POST", "");
      } catch (e) {
        return [];
      }
      var players = (data && data.players) || {};
      var base = [];
      var bucket;
      for (bucket in players) {
        var list = players[bucket] || [];
        for (var i = 0; i < list.length; i++) {
          var entry = list[i] || {};
          var token = entry.token || "";
          if (!/^[a-f0-9]{64}$/.test(token)) continue;
          var label = cleanTitle(entry.label || "") || ("سيرفر " + (base.length + 1));
          var ver = cleanTitle(entry.version || "");
          var name = ver ? (label + " " + ver) : label;
          base.push({
            token: token,
            label: label,
            name: name,
            gate: baseUrl + "/watch/stream-gate/" + token,
            bucket: bucket
          });
        }
      }
      // Owner rule: only natively playable (direct mp4) servers are listed.
      // Dropped with zero direct proof (verified live 2026-09-21): mega
      // (key never leaves browser), hgcloud (dynamic crypto), yonaplay /
      // soraplay / google (gate targets unknown), workupload / wtsrv /
      // wahmi / mediafire / gofile (download buckets, stream-only app).
      // ok is attempted (flashvars) and dropped on failure.
      var DROP_LABELS = ["mega", "hgcloud", "yonaplay", "soraplay", "google",
        "workupload", "wtsrv", "wahmi", "mediafire", "gofile"];
      function dropLabel(label) {
        var n = String(label || "").toLowerCase();
        for (var i = 0; i < DROP_LABELS.length; i++) {
          if (n.indexOf(DROP_LABELS[i]) !== -1) return true;
        }
        return false;
      }
      function isOkLabel(label) {
        return /(^|[\s\-_])ok($|[\s\-_])/i.test(String(label || ""));
      }
      function isMp4Capable(label) {
        var n = String(label || "").toLowerCase();
        return n.indexOf("4shared") !== -1 || n.indexOf("mp4upload") !== -1;
      }
      // Resolution budget: watch+POST above, max 7 extra fetches here.
      // Soft 12s deadline keeps slow networks responsive:
      // resolved-so-far is returned, the rest is dropped (owner rule).
      var bud = { n: 7 };
      var t0 = 0;
      try {
        t0 = new Date().getTime();
      } catch (e0) {}
      for (var r = 0; r < base.length; r++) {
        var it = base[r];
        if (dropLabel(it.label)) continue;
        if (t0) {
          var nowMs = 0;
          try {
            nowMs = new Date().getTime();
          } catch (e1) {}
          if (nowMs && nowMs - t0 > 12000) break;
        }
        var nl = String(it.label || "").toLowerCase();
        var durl = "";
        try {
          if (nl.indexOf("videa") !== -1) {
            if (bud.n >= 2) {
              var ph = await fetchHtml(it.gate, { "Referer": watchUrl });
              bud.n--;
              durl = await resolveVideaUrl(ph, bud);
            }
          } else if (isMp4Capable(it.label)) {
            if (bud.n >= 1) {
              var tg = await fetchHtml(it.gate, { "Referer": watchUrl });
              bud.n--;
              durl = extractDirectMp4(tg);
            }
          } else if (isOkLabel(it.label)) {
            if (bud.n >= 1) {
              var og = await fetchHtml(it.gate, { "Referer": watchUrl });
              bud.n--;
              durl = extractOkMp4(og);
            }
          } else {
            continue;
          }
        } catch (e) {}
        if (!durl) continue;
        // Referer must be same-host, never the gate or source domain
        // (both 403 live; root referers proven 206).
        var nl2 = String(it.label || "").toLowerCase();
        var ref = it.gate;
        if (nl2.indexOf("videa") !== -1) ref = "https://videa.hu/";
        else if (nl2.indexOf("4shared") !== -1) ref = "https://www.4shared.com/";
        else if (nl2.indexOf("mp4upload") !== -1) ref = "https://www.mp4upload.com/";
        else if (isOkLabel(it.label)) ref = "https://ok.ru/";
        rememberMedia(durl, ref);
        out.push({
          id: it.token,
          name: it.name,
          embedUrl: it.gate,
          url: it.gate,
          directUrl: durl,
          type: "mp4",
          quality: qualityOf(it.bucket) || qualityOf(it.name),
          headers: { "Referer": ref, "User-Agent": userAgent }
        });
      }
    } catch (e) {}
    return out;
  }

  return {
    requiresCloudflare: false,

    async getHomepageManga(args) {
      try {
        var page = (args && args.page) || 1;
        var url = page > 1 ? baseUrl + "/browse/page/" + page : baseUrl + "/browse";
        return await parseCards(await fetchHtml(url));
      } catch (e) {
        return [];
      }
    },

    async search(args) {
      try {
        var query = (args && args.query) || "";
        if (!query.trim()) return [];
        // Suggest API first (verified live). NOTE: no X-Requested-With here —
        // the endpoint answers 404 when that header is present.
        try {
          var data = await fetchJson(
            baseUrl + "/search/suggest?q=" + encodeURIComponent(query),
            { "Referer": baseUrl + "/" },
            "GET"
          );
          var results = (data && data.results) || [];
          var out = [];
          var seen = {};
          for (var i = 0; i < results.length; i++) {
            var r = results[i] || {};
            var url = makeAbsolute(r.url || "");
            if (!url || seen[url]) continue;
            seen[url] = true;
            var title = unescapeHtml(cleanTitle(r.title || ""));
            if (!title) continue;
            out.push({
              title: title,
              coverUrl: makeAbsolute(r.poster || ""),
              detailUrl: url,
              contentType: "anime"
            });
          }
          if (out.length) return out;
        } catch (e) {}
        // Fallbacks: /search?q= HTML, then /browse?search= HTML.
        try {
          var cards = await parseCards(await fetchHtml(baseUrl + "/search?q=" + encodeURIComponent(query)));
          if (cards.length) return cards;
        } catch (e) {}
        return await parseCards(await fetchHtml(baseUrl + "/browse?search=" + encodeURIComponent(query)));
      } catch (e) {
        return [];
      }
    },

    async getMangaDetails(args) {
      var url = makeAbsolute((args && args.url) || "");
      try {
        if (url.indexOf("/watch/") !== -1) {
          var parents = parentAnimeUrls(url);
          for (var pi = 0; pi < parents.length; pi++) {
            try {
              var details = await parseDetails(await fetchHtml(parents[pi]), parents[pi]);
              if (details.chapters && details.chapters.length) {
                details.originalUrl = parents[pi];
                return details;
              }
            } catch (e) {}
          }
          var epHtml = await fetchHtml(url);
          var epTitle = "";
          try {
            epTitle = unescapeHtml(stripTags(await api.cssText(epHtml, "h1"))) || url;
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
              title: "الحلقة " + parseEpisodeNumber(url),
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
        return await parseDetails(await fetchHtml(url), url);
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
      // Anime episodes have no image pages — compat stub for the manga path.
      return [];
    },

    async getChapterContent(args) {
      try {
        var url = makeAbsolute((args && args.url) || "");
        if (url.indexOf("/watch/") !== -1) {
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
        return await decodeEpisodeServers(url);
      } catch (e) {
        return [];
      }
    },

    async resolveServer(args) {
      try {
        var serverUrl = makeAbsolute((args && (args.serverUrl || args.url)) || "");
        if (!serverUrl) return null;
        var token = streamToken(serverUrl);
        if (!token) {
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
        }
        // Verify the token resolves (same chain the player uses).
        try {
          var csrfPage = makeAbsolute((args && args.episodeUrl) || "");
          if (csrfPage.indexOf("/watch/") === -1) csrfPage = baseUrl + "/";
          var watchHtml = await fetchHtml(csrfPage);
          var csrf = getCsrfToken(watchHtml);
          if (csrf) {
            await fetchJson(baseUrl + "/watch/stream-source/" + token, {
              "X-CSRF-TOKEN": csrf,
              "X-Requested-With": "XMLHttpRequest",
              "Referer": csrfPage,
              "Origin": baseUrl
            }, "POST", "");
          }
        } catch (e) {}
        return {
          url: baseUrl + "/watch/stream-gate/" + token,
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
        var type = cleanTitle((args && args.type) || "");
        // Genre/status have no GET routes on the new site (Livewire only) —
        // downgrade to the browse list instead of returning nothing.
        var isMovie = type.indexOf("فيلم") !== -1 || type.toLowerCase().indexOf("movie") !== -1;
        var base = isMovie ? baseUrl + "/movies" : baseUrl + "/browse";
        var url = page > 1 ? base + "/page/" + page : base;
        return await parseCards(await fetchHtml(url));
      } catch (e) {
        return [];
      }
    },

    async getGenresAndTypes() {
      return { genres: defaultGenres, types: defaultTypes };
    },

    async fetchMoreChapters() {
      // Episode lists ship complete inside the anime page.
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

    getVideoHeaders(args) {
      return videoHeadersFor(args && args.url);
    },

    sanitizeCoverUrl(args) {
      return makeAbsolute((args && args.url) || "");
    }
  };
}

if (typeof module !== "undefined") module.exports = { createSource: createSource };
