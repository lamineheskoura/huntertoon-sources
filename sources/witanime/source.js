function createSource(api, config) {
  var baseUrl = ((config && config.base_url) || "https://witanime.site").replace(/\/+$/, "");
  var configHeaders = (config && config.headers) || {};
  // The app supplies a device-coherent UA in config.user_agent. The old code
  // used the hardcoded manifest UA (Chrome/124) instead; the origin rejects
  // that mismatch with 404 {"message":"Not Found."} on POST /sources.
  var userAgent =
    (config && config.user_agent) ||
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
  // NOTE 2026-10-12: the 40-genre legacy list is RETIRED — the new site has
  // no GET genre route (genre/type/status params are ignored; Livewire-only).
  // Only verified dimensions are exposed: type path (/browse vs /movies),
  // status=ongoing, year=YYYY, /seasonal, /schedule, ?search=.
  var defaultGenres = ["مسلسلات", "أفلام", "مستمر", "أنميات الموسم", "جدول الأسبوع"];
  var defaultTypes = ["anime"];

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
        // The app's cronet_http transport joins every Set-Cookie value with
        // ','. Splitting on '\n' alone kept only XSRF-TOKEN and dropped the
        // HttpOnly witanime-session, so POST /sources answered 419 and the
        // sheet showed no servers. Same split as CfCookieStore.
        parts = String(raw).split(/\n|,(?=\s*[A-Za-z0-9_-]+=)/);
      }
      var store = {};
      var i, j;
      function setCookie(name, value) {
        if (!name || name === "__proto__" || name === "constructor" || name === "prototype") return;
        value = String(value == null ? "" : value).replace(/[\r\n]/g, "");
        if (value) store[name] = value;
      }
      var existing = String(cookieJar || "").split(/;\s*/);
      for (i = 0; i < existing.length; i++) {
        var kv = existing[i].split("=");
        if (kv.length >= 2 && kv[0]) setCookie(kv[0], existing[i].substring(kv[0].length + 1));
      }
      for (i = 0; i < parts.length; i++) {
        var first = String(parts[i] || "").split(";")[0].trim();
        var eq = first.indexOf("=");
        if (eq > 0) setCookie(first.substring(0, eq).trim(), first.substring(eq + 1).trim());
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
      if (!title) {
        // Compact row cards (/search?q= Arabic results): no h3, empty alt —
        // title lives in span.block.truncate or bare inner text.
        try {
          var spans = await api.cssAll(inner, "span.block") || [];
          for (var si = 0; si < spans.length; si++) {
            var st = unescapeHtml(cleanTitle((spans[si] && spans[si].text) || ""));
            if (st && st.length > 1) {
              title = st;
              break;
            }
          }
        } catch (e) {}
      }
      if (!title) {
        var tx = unescapeHtml(cleanTitle(stripTags(inner)));
        var tl = tx.split("\n")[0] || tx;
        if (tl.length > 60) tl = tl.substring(0, 60);
        if (tl.length > 1) title = tl;
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
      if (!title) {
        // Compact row cards: title in span.block.truncate or bare text.
        var spm = inner.match(/<span[^>]*class="[^"]*block[^"]*truncate[^"]*"[^>]*>([^<]*)<\/span>/);
        if (spm) title = unescapeHtml(cleanTitle(spm[1]));
      }
      if (!title) {
        var tx = unescapeHtml(cleanTitle(stripTags(inner)));
        var tl = tx.split("\n")[0] || tx;
        if (tl.length > 60) tl = tl.substring(0, 60);
        if (tl.length > 1) title = tl;
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

  // Home /new-episodes cards: <a href=".../watch/{slug}/{n}"> with poster,
  // episode badge "الحلقة N" and a type badge (TV/ONA/فيلم). The card is an
  // episode, so the anime's detail page is /anime/{slug} (movies /movie/).
  function parseLatestCards(html) {
    var out = [];
    var seen = {};
    var re = /<a[^>]+href="([^"]*\/watch\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    var m;
    while ((m = re.exec(String(html || ""))) !== null) {
      var watchUrl = makeAbsolute(m[1] || "");
      var inner = m[2] || "";
      var sm = watchUrl.match(/\/watch\/([^/?#]+)\/\d+/);
      if (!sm) continue;
      var badge = inner.match(/bg-black\/70[^>]*>([^<]*)</);
      var typeText = badge ? cleanTitle(badge[1]) : "";
      var isMovie = typeText === "فيلم" || /^movie$/i.test(typeText);
      var detailUrl = baseUrl + (isMovie ? "/movie/" : "/anime/") + sm[1];
      if (seen[detailUrl]) continue;
      var title = "";
      var hm = inner.match(/<h3[^>]*>([\s\S]*?)<\/h3>/);
      if (hm) title = unescapeHtml(stripTags(hm[1]));
      if (!title) {
        var am = inner.match(/<img[^>]+alt="([^"]*)"/);
        if (am) title = unescapeHtml(cleanTitle(am[1]));
      }
      if (!title) continue;
      seen[detailUrl] = true;
      var cover = "";
      var cm = inner.match(/<img[^>]+src="([^"]+)"/);
      if (cm) cover = makeAbsolute(cm[1]);
      out.push({
        title: title,
        coverUrl: cover,
        detailUrl: detailUrl,
        contentType: "anime"
      });
      if (out.length > 60) break;
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
      var genreEls = await api.cssAll(html, "span.rounded-full") || [];
      for (var gi = 0; gi < genreEls.length; gi++) {
        var g = unescapeHtml(cleanTitle((genreEls[gi] && genreEls[gi].text) || ""));
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
  // token -> player label, learned from /sources and reused by resolveServer
  // (the app's bridge passes only serverId/serverUrl, not the label).
  var serverLabels = {};

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

  // ---- episode servers (re-verified 2026-11-22) ----
  // The raw watch page carries NO stream tokens (0 of 64-hex in the HTML):
  // the server list is JSON behind POST {watchUrl}/sources, which the page's
  // own JS calls with just {Accept, X-CSRF-TOKEN} and the cookies of the
  // session that rendered the page. A browser gets 200 + players; a request
  // that carries a DIFFERENT session gets 404 {"message":"Not Found."}.
  // Layout is Alpine:
  // GET {watchUrl} (cookies + csrf-token meta)
  // -> POST {watchUrl}/sources {Accept, X-CSRF-TOKEN} (no body, no extras)
  // -> {players:{FHD:[{token,label,version,lang}],...}, downloads:{...}}
  // -> POST /watch/stream-source/{token} unlocks
  // -> playback iframe = /watch/stream-gate/{token} (302 to the real player)
  // The list is returned immediately as honest `embed` entries; resolving a
  // server to a direct mp4 is deferred to resolveServer. Pre-resolving all
  // gate URLs here used 7 extra fetches + a 12s deadline and blew the app's
  // 10s server-sheet budget, so the sheet showed nothing at all.

  // The page's own fetch() sends {Accept, X-CSRF-TOKEN} and the browser adds
  // Origin + Sec-Fetch-* on top. Both shapes answer 200 in a real browser
  // (verified 2026-11-22), so the headers are kept browser-shaped; what the
  // origin actually keys on is the SESSION, not the header set.
  function apiPostHeaders(csrf, referer, origin) {
    var h = {
      "Accept": "application/json",
      "X-CSRF-TOKEN": csrf || "",
      "Origin": origin || baseUrl,
      "Sec-Fetch-Site": "same-origin",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Dest": "empty"
    };
    if (referer) h["Referer"] = referer;
    return withCookies(h);
  }

  // The app's CfCookieStore overwrites our Cookie header on witanime.site
  // with its own jar. The page's CSRF token is bound to the session that
  // rendered it, so a POST carrying a DIFFERENT session is answered with
  // {"players":{},"downloads":{}} (200, empty buckets) — proven live
  // 2026-11-23 by tampering the session cookie without reloading the page.
  // That empty manifest is what the sheet renders as "no server available".
  // A trailing-dot host is the same site to Cloudflare but a different
  // lookup key to the store, so the session we just minted travels untouched.
  function sessionHostUrl(url) {
    return String(url || "").replace(
      /^https:\/\/witanime\.site(?=[/:?#]|$)/,
      "https://witanime.site."
    );
  }

  // GET the watch page for a fresh CSRF, then read /sources. Attempts 0/1
  // run on the isolated trailing-dot host (our own session survives); the
  // canonical host is only the last resort. An EMPTY players object is a
  // session mismatch, never an episode without servers, so it retries.
  async function loadPlayers(watchUrl) {
    var sourcesUrl = String(watchUrl).replace(/[?#].*$/, "").replace(/\/+$/, "") + "/sources";
    for (var attempt = 0; attempt < 3; attempt++) {
      var isolated = attempt < 2;
      var pageUrl = isolated ? sessionHostUrl(watchUrl) : watchUrl;
      if (attempt === 1) {
        pageUrl += (pageUrl.indexOf("?") === -1 ? "?" : "&") + "_ht=" + new Date().getTime();
      }
      var origin = isolated ? "https://witanime.site." : baseUrl;
      var postUrl = isolated ? sessionHostUrl(sourcesUrl) : sourcesUrl;
      var html = "";
      try {
        html = await fetchHtml(pageUrl);
      } catch (e) {}
      var csrf = getCsrfToken(html);
      if (!csrf) continue;
      try {
        var data = await fetchJson(postUrl, apiPostHeaders(csrf, pageUrl, origin), "POST");
        if (data && data.players && Object.keys(data.players).length) return data;
      } catch (e) {}
    }
    return null;
  }

  async function decodeEpisodeServers(watchUrl) {
    var out = [];
    try {
      var data = await loadPlayers(watchUrl);
      if (!data) return out;
      var players = data.players || {};
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
          serverLabels[token] = label;
          base.push({
            token: token,
            name: ver ? (label + " " + ver) : label,
            gate: baseUrl + "/watch/stream-gate/" + token,
            bucket: bucket
          });
        }
      }
      // Quality-first: FHD/HD/SD order, site order inside each bucket.
      var order = { "4K": 0, "FHD": 1, "HD": 2, "SD": 3 };
      base.sort(function (a, b) {
        var ra = order[a.bucket] == null ? 9 : order[a.bucket];
        var rb = order[b.bucket] == null ? 9 : order[b.bucket];
        return ra - rb;
      });
      // Every player the site reports is listed, including mega/hgcloud/
      // yonaplay that we cannot turn into a direct file (they used to be
      // dropped silently). The gate URL is the honest embed; clicking the
      // server runs resolveServer, which tries the direct extraction.
      for (var r = 0; r < base.length; r++) {
        var it = base[r];
        out.push({
          id: it.token,
          name: it.name,
          embedUrl: it.gate,
          url: it.gate,
          directUrl: "",
          type: "embed",
          quality: qualityOf(it.bucket) || qualityOf(it.name) || "",
          qualities: [],
          selectedQualityIndex: 0,
          headers: { "Referer": watchUrl, "User-Agent": userAgent },
          reason: "gate_embed"
        });
      }
    } catch (e) {}
    return out;
  }

  return {
    // The site runs behind Cloudflare and mints cf_clearance for the watch
    // host; the app's GETs/POSTs must ride the CF stack.
    requiresCloudflare: true,

    async getHomepageManga(args) {
      var page = parseInt((args && args.page) || 1, 10);
      if (!page || page < 1) page = 1;
      // /browse is the full A-Z catalog ("قائمة الأنمي"), so "latest added"
      // was a permanent alphabetical list. /new-episodes?page=N is the site's
      // own latest-episodes feed (JSON {html,page,hasOlder}) behind the home
      // carousel; every card there is a freshly published episode.
      try {
        var latest = await fetchJson(
          baseUrl + "/new-episodes?page=" + page,
          { "Accept": "application/json", "Referer": baseUrl + "/" },
          "GET"
        );
        var cards = parseLatestCards((latest && latest.html) || "");
        if (cards.length) return cards;
      } catch (e) {}
      try {
        return await parseCards(await fetchHtml(page > 1 ? baseUrl + "/browse/page/" + page : baseUrl + "/browse"));
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
        var episodeUrl = makeAbsolute((args && args.episodeUrl) || "") || lastPageUrl || "";
        if (episodeUrl.indexOf("/watch/") === -1) episodeUrl = baseUrl + "/";
        var label = serverLabels[token] || "";
        try {
          if (!label) label = String((args && args.server &&
            (args.server.name || args.server.label || args.server.quality)) || "");
        } catch (e) {}
        var nl = label.toLowerCase();
        // Referer must be the host's own root, never the gate or the source
        // domain (both 403 live; host roots proven 206).
        var ref = baseUrl + "/";
        if (nl.indexOf("videa") !== -1) ref = "https://videa.hu/";
        else if (nl.indexOf("4shared") !== -1) ref = "https://www.4shared.com/";
        else if (nl.indexOf("mp4upload") !== -1) ref = "https://www.mp4upload.com/";
        else if (/(^|[\s\-_])ok($|[\s\-_])/.test(nl)) ref = "https://ok.ru/";
        else if (nl.indexOf("google") !== -1 || nl.indexOf("drive") !== -1) ref = "https://drive.google.com/";
        var headers = {
          "User-Agent": userAgent,
          "Referer": ref,
          "Accept": "*/*",
          "Accept-Language": "ar,en-US;q=0.9,en;q=0.8"
        };
        var gate = baseUrl + "/watch/stream-gate/" + token;
        // The handshake is required for the gate to answer at all; the direct
        // extraction only runs for labels we have a proven parser for (the
        // app calls this on selection with a 15s budget, not from the list).
        var canDirect = nl.indexOf("videa") !== -1 || nl.indexOf("mp4upload") !== -1 ||
          nl.indexOf("4shared") !== -1 || /(^|[\s\-_])ok($|[\s\-_])/.test(nl);
        try {
          var watchHtml = await fetchHtml(episodeUrl);
          var csrf = getCsrfToken(watchHtml);
          if (csrf) {
            await fetchJson(baseUrl + "/watch/stream-source/" + token, apiPostHeaders(csrf, episodeUrl), "POST");
            if (canDirect) {
              var bud = { n: 2 };
              var gateHtml = await fetchHtml(gate, { "Referer": episodeUrl });
              var direct = "";
              if (nl.indexOf("videa") !== -1) direct = await resolveVideaUrl(gateHtml, bud);
              if (!direct && /(^|[\s\-_])ok($|[\s\-_])/.test(nl)) direct = extractOkMp4(gateHtml);
              if (!direct) direct = extractDirectMp4(gateHtml);
              if (direct) {
                rememberMedia(direct, ref);
                return {
                  url: direct,
                  type: "mp4",
                  quality: qualityOf(label) || "",
                  headers: headers
                };
              }
            }
          }
        } catch (e) {}
        return { url: gate, type: "embed", headers: headers };
      } catch (e) {
        return null;
      }
    },

    async getFilteredManga(args) {
      try {
        var page = parseInt((args && args.page) || 1, 10);
        if (!page || page < 1) page = 1;
        var raw = String((args && (args.genre || args.type || args.status || args.kind)) || "").trim();
        var yearArg = String((args && args.year) || "").trim();
        var query = String((args && (args.query || args.q || args.search)) || "").trim();
        var low = raw.toLowerCase();
        var isMovie = low.indexOf("فيلم") !== -1 || low.indexOf("movie") !== -1;
        var isOngoing = low.indexOf("مستمر") !== -1 || low === "ongoing";
        var isSeasonal = low.indexOf("الموسم") !== -1 || low === "seasonal";
        var isSchedule = low.indexOf("جدول") !== -1 || low === "schedule";
        var ym = raw.match(/(^|\D)(19|20)\d{2}(\D|$)/) || yearArg.match(/^(19|20)\d{2}$/);
        var year = ym ? ym[0].replace(/\D/g, "") : "";
        var base, tail;
        if (query) {
          // Search results are a single list; slice per page client-side.
          var found = await parseCards(await fetchHtml(baseUrl + "/search?q=" + encodeURIComponent(query)));
          if (!found.length) found = await parseCards(await fetchHtml(baseUrl + "/browse?search=" + encodeURIComponent(query)));
          return found.slice((page - 1) * 20, page * 20);
        }
        if (isMovie) {
          base = baseUrl + "/movies";
          tail = page > 1 ? "/page/" + page : "";
          return await parseCards(await fetchHtml(base + tail));
        }
        if (isSeasonal) {
          if (page > 1) return [];
          return await parseCards(await fetchHtml(baseUrl + "/seasonal"));
        }
        if (isSchedule) {
          if (page > 1) return [];
          return await parseCards(await fetchHtml(baseUrl + "/schedule"));
        }
        // Query-string filters must use the /browse/page/N path form —
        // the ?page= form 301s and drops parameters.
        tail = page > 1 ? "/page/" + page : "";
        if (isOngoing) return await parseCards(await fetchHtml(baseUrl + "/browse" + tail + "?status=ongoing"));
        if (year) return await parseCards(await fetchHtml(baseUrl + "/browse" + tail + "?year=" + year));
        return await parseCards(await fetchHtml(baseUrl + "/browse" + tail));
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
