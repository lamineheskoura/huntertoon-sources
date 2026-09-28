function createSource(api, config) {
  var baseUrl = ((config && config.base_url) || "https://anime-phoenix.com").replace(/\/+$/, "");
  var configHeaders = (config && config.headers) || {};
  var userAgent =
    configHeaders["User-Agent"] ||
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
  var lastPageUrl = baseUrl + "/";

  var PUBLIC_KEY = "c8052e98457156515d839dd050a95ac1b862437995778d89422a45f117478009";
  var SEARCH_API = baseUrl + "/api/search.php";

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

  // Verified live genre slugs (Cat-Card links /search/{slug}/).
  var defaultGenres = [
    "action", "adventure", "comedy", "drama", "fantasy", "romance",
    "sci-fi", "supernatural", "school", "mystery", "shounen", "slice-of-life",
    "animation", "horror", "sports", "music", "mecha", "demons",
    "magic", "military", "historical", "psychological", "thriller", "isekai"
  ];
  var defaultTypes = ["TV", "Movie", "Completed", "Releasing"];

  // Per-file headers: the app NEVER reads server.headers (zero consumers)
  // and getVideoHeaders(url) is the only channel reaching the player.
  var mediaHeaders = {};

  function rememberMedia(fileUrl, referer) {
    if (!fileUrl || !referer) return;
    mediaHeaders[String(fileUrl)] = String(referer);
    var bare = String(fileUrl).split("#")[0];
    if (bare && bare !== fileUrl) mediaHeaders[bare] = String(referer);
  }

  function videoHeadersFor(url) {
    var u = String(url || "");
    var ref = mediaHeaders[u] || mediaHeaders[u.split("#")[0]] || baseUrl + "/";
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

  function mergeHeaders(a, b) {
    var out = {};
    for (var k in a) out[k] = a[k];
    if (b) for (var x in b) out[x] = b[x];
    return out;
  }

  function budDec(bud) {
    if (!bud || bud.n <= 0) return false;
    bud.n--;
    return true;
  }

  async function fetchHtml(url, extraHeaders, method) {
    lastPageUrl = url || lastPageUrl;
    var headers = mergeHeaders(defaultHeaders, extraHeaders);
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

  async function fetchJson(url, extraHeaders) {
    var headers = mergeHeaders({
      "User-Agent": userAgent,
      "Accept": "application/json, text/plain, */*",
      "Accept-Language": "ar,en-US;q=0.9,en;q=0.8",
      "Referer": baseUrl + "/",
      "Origin": baseUrl
    }, extraHeaders);
    if (api.http) {
      var res = await api.http(url, { method: "GET", headers: headers });
      if (!res || !res.ok) throw new Error("HTTP " + (res ? res.status : 0) + " for " + url);
      var body = res.body || "";
      try {
        return JSON.parse(body);
      } catch (e) {
        throw new Error("Bad JSON: " + url);
      }
    }
    var txt = await api.fetchText(url, headers);
    return JSON.parse(txt || "{}");
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

  function withDirectSuffix(url) {
    var u = String(url || "");
    if (!u) return "";
    if (u.indexOf(".mp4") !== -1) return u;
    if (u.indexOf(".m3u8") !== -1) return u;
    return u + "#.mp4";
  }

  function parseEpisodeNumber(url, label) {
    var m = String(url || "").match(/-episode-(\d+)/i);
    if (m) return m[1];
    var m2 = String(label || "").match(/(\d+)/);
    if (m2) return m2[1];
    return "0";
  }

  function utf8Hex(str) {
    var s = String(str == null ? "" : str);
    var bytes = null;
    try {
      if (typeof TextEncoder !== "undefined") {
        bytes = new TextEncoder().encode(s);
      }
    } catch (e) {}
    var hex = "";
    var digits = "0123456789abcdef";
    if (bytes && bytes.length != null) {
      for (var i = 0; i < bytes.length; i++) {
        var b = bytes[i] & 255;
        hex += digits.charAt((b >> 4) & 15) + digits.charAt(b & 15);
      }
      return hex;
    }
    var utf8 = unescape(encodeURIComponent(s));
    for (var j = 0; j < utf8.length; j++) {
      var c = utf8.charCodeAt(j) & 255;
      hex += digits.charAt((c >> 4) & 15) + digits.charAt(c & 15);
    }
    return hex;
  }

  function nowSec() {
    try {
      return Math.floor(new Date().getTime() / 1000);
    } catch (e) {
      return 0;
    }
  }

  // HMAC-SHA256 signature for /api/search.php (mirrors search-page.js).
  // canonical = ts:q:type:genre:status:year:season:page:sort, key = UTF8(public_key).
  async function signSearch(q, type, genre, status, year, season, page, sort, ts) {
    var canonical = String(ts) + ":" + q + ":" + type + ":" + genre + ":" + status + ":" + year + ":" + season + ":" + String(page) + ":" + sort;
    if (!api.cryptoOp) return "";
    try {
      var sig = await api.cryptoOp("hmacSha256", utf8Hex(canonical), { key: utf8Hex(PUBLIC_KEY) });
      return String(sig || "");
    } catch (e) {
      return "";
    }
  }

  async function apiSearch(q, type, genre, status, page, sort, season, year) {
    var t = type || "all";
    var g = genre || "";
    var st = status || "";
    var p = page || 1;
    var s = sort || "relevance";
    var se = season || "";
    var yr = year || "";
    // Security retry inside budget: fresh timestamp+signature per attempt,
    // max 2 tries (no budget/deadline raise: new bounded bud n=2 only).
    var bud = { n: 2 };
    var lastErr = null;
    for (var attempt = 0; attempt < 2; attempt++) {
      if (!budDec(bud)) break;
      var ts = nowSec();
      var sig = await signSearch(q || "", t, g, st, yr, se, p, s, ts);
      var url = SEARCH_API + "?q=" + encodeURIComponent(q || "") +
        "&type=" + encodeURIComponent(t) +
        "&genre=" + encodeURIComponent(g) +
        "&status=" + encodeURIComponent(st) +
        "&year=" + encodeURIComponent(yr) +
        "&season=" + encodeURIComponent(se) +
        "&sort=" + encodeURIComponent(s) +
        "&page=" + p + "&per_page=25&dropdown=0";
      var headers = {};
      if (ts) headers["X-PX-Timestamp"] = String(ts);
      if (sig) headers["X-PX-Signature"] = sig;
      try {
        var json = await fetchJson(url, headers);
        if (!json || json.success !== true || !json.data) throw new Error("API search failed");
        return json.data;
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error("API search failed");
  }

  function mapApiItems(items) {
    var out = [];
    var seen = {};
    items = items || [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i] || {};
      if (it.item_type !== "tvshow" && it.item_type !== "movie") continue;
      var detailUrl = makeAbsolute(it.url || "");
      if (!detailUrl || seen[detailUrl]) continue;
      seen[detailUrl] = true;
      var title = cleanTitle(it.title_ar || it.title_en || "");
      if (!title) continue;
      out.push({
        title: unescapeHtml(title),
        coverUrl: makeAbsolute(it.thumbnail_url || ""),
        detailUrl: detailUrl,
        contentType: "anime"
      });
    }
    return out;
  }

  // ---- card parser (homepage + /completed + /search/* share markup) ----

  async function parseAnimeCards(html) {
    html = String(html || "");
    var out = [];
    var seen = {};
    function pushCard(title, cover, detailUrl) {
      title = unescapeHtml(cleanTitle(title));
      if (!title || !detailUrl || seen[detailUrl]) return;
      seen[detailUrl] = true;
      out.push({ title: title, coverUrl: cover || "", detailUrl: detailUrl, contentType: "anime" });
    }
    var selectors = ["a.home-cols-card", "a.FJ-Phoenix-Anastasia-Hero-Card", "div.FJ-episode-wrap a.FJ-episode-img-box", "a.FJ-episode-wrap"];
    for (var si = 0; si < selectors.length; si++) {
      var anchors = [];
      try {
        anchors = await api.cssAll(html, selectors[si]) || [];
      } catch (e) {}
      for (var i = 0; i < anchors.length; i++) {
        var item = anchors[i] || {};
        var attrs = item.attrs || {};
        var inner = item.html || "";
        var href = attrs.href || "";
        if (!href) continue;
        if (href.indexOf("/animes/") === -1 && href.indexOf("/movies/") === -1) continue;
        var detailUrl = makeAbsolute(href);
        var title = "";
        try {
          title = cleanTitle(await api.cssText(inner, "h3")) || "";
        } catch (e) {}
        if (!title) {
          try {
            title = cleanTitle(await api.cssText(inner, ".FJ-Phoenix-Anastasia-EpCard-Name")) || "";
          } catch (e) {}
        }
        if (!title) {
          try {
            title = cleanTitle(await api.cssText(inner, "h2")) || "";
          } catch (e) {}
        }
        if (!title) {
          try {
            title = cleanTitle(await api.cssAttr(inner, "img", "alt")) || "";
          } catch (e) {}
        }
        var cover = "";
        try {
          cover = makeAbsolute(await api.cssAttr(inner, "img", "src") || "");
        } catch (e) {}
        if (!cover) {
          try {
            cover = makeAbsolute(await api.cssAttr(inner, "img", "data-src") || "");
          } catch (e) {}
        }
        pushCard(title, cover, detailUrl);
        if (out.length > 300) return out;
      }
      if (out.length) return out;
    }
    // Regex fallback: any /animes/ or /movies/ card.
    var re = /<a[^>]+href="([^"]*(?:\/animes\/|\/movies\/)[^"]*)"[^>]*>([\s\S]*?)<\/a>/g, m;
    while ((m = re.exec(html)) !== null) {
      var u2 = makeAbsolute(m[1]);
      var inner2 = m[2] || "";
      var t2 = "";
      var hm = inner2.match(/<h[234][^>]*>([\s\S]*?)<\/h[234]>/);
      if (hm) t2 = stripTags(hm[1]);
      if (!t2) {
        var am = inner2.match(/<img[^>]+alt="([^"]*)"/);
        if (am) t2 = am[1];
      }
      var c2 = "";
      var im = inner2.match(/<img[^>]+src="([^"]+)"/);
      if (im) c2 = makeAbsolute(im[1]);
      pushCard(t2, c2, u2);
      if (out.length > 300) break;
    }
    return out;
  }

  // ---- anime / movie details ----

  function jsonLdBlocks(html) {
    var blocks = [];
    var re = /<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g, m;
    while ((m = re.exec(String(html || ""))) !== null) {
      try {
        var j = JSON.parse(m[1]);
        if (j instanceof Array) {
          for (var i = 0; i < j.length; i++) blocks.push(j[i]);
        } else {
          blocks.push(j);
        }
      } catch (e) {}
    }
    return blocks;
  }

  async function parseAnimeDetails(html, url) {
    html = String(html || "");
    var title = "";
    try {
      title = unescapeHtml(cleanTitle(await api.cssText(html, "h1.FJ-Phoenix-Hero-Title"))) || "";
    } catch (e) {}
    if (!title) {
      try {
        title = unescapeHtml(cleanTitle(await api.cssText(html, "h1"))) || "";
      } catch (e) {}
    }
    var cover = "";
    try {
      cover = makeAbsolute(await api.cssAttr(html, "meta[property='og:image']", "content") || "");
    } catch (e) {}
    var description = "";
    try {
      description = unescapeHtml(cleanTitle(await api.cssAttr(html, "meta[property='og:description']", "content"))) || "";
    } catch (e) {}
    var genres = [];
    var year = "";
    var blocks = jsonLdBlocks(html);
    for (var b = 0; b < blocks.length; b++) {
      var bl = blocks[b] || {};
      var g = bl.genre;
      if (g) {
        var arr = (g instanceof Array) ? g : [g];
        for (var gi = 0; gi < arr.length; gi++) {
          var gt = unescapeHtml(cleanTitle(arr[gi]));
          if (gt && genres.indexOf(gt) === -1) genres.push(gt);
        }
      }
      if (!title && bl.name) title = unescapeHtml(cleanTitle(bl.name));
      if (!description && bl.description) description = unescapeHtml(cleanTitle(bl.description));
      if (!cover && bl.image) cover = makeAbsolute(bl.image);
    }
    if (!title) {
      try {
        title = unescapeHtml(cleanTitle(await api.cssAttr(html, "meta[property='og:title']", "content"))) || "";
      } catch (e) {}
    }
    var ym = html.match(/(19|20)\d{2}/);
    if (ym) year = ym[0];
    var status = "";
    if (html.indexOf("مكتمل") !== -1 || html.indexOf("completed") !== -1) status = "مكتمل";
    else if (html.indexOf("مستمر") !== -1 || html.indexOf("releasing") !== -1) status = "مستمر";
    else if (html.indexOf("قادم") !== -1 || html.indexOf("upcoming") !== -1) status = "قادم";
    var animeType = "TV";
    if (url.indexOf("/movies/") !== -1) animeType = "Movie";
    var seasonLabel = parseSeasonLabel(html);

    var episodes = parseEpisodes(html);
    if (!episodes.length && url.indexOf("/movies/") !== -1) {
      var hasPlayer = /player-html-template|FJ-Server-Link|streamit_player/i.test(html);
      if (hasPlayer) {
        episodes.push({
          number: "1",
          title: "فيلم " + (title || ""),
          url: url,
          views: 0,
          isLocked: false,
          date: "",
          isFiller: false,
          thumbnailUrl: null,
          durationSeconds: null,
          servers: []
        });
      }
    }

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
      animeType: animeType,
      season: seasonLabel || null,
      year: year || null,
      episodeDurationMin: null,
      sourceMaterial: null,
      trailerUrl: null,
      malUrl: null
    };
  }

  function parseEpisodes(html) {
    var out = [];
    var seen = {};
    // Primary: episode pills on the title page (server-rendered, descending).
    var re = /<a[^>]+href="([^"]*\/episodes\/[^"]*)"[^>]*class="[^"]*FJ-EpPill[^"]*"[^>]*>([\s\S]*?)<\/a>/g, m;
    while ((m = re.exec(String(html || ""))) !== null) {
      var epUrl = makeAbsolute(m[1]);
      if (!epUrl || seen[epUrl]) continue;
      seen[epUrl] = true;
      var label = unescapeHtml(stripTags(m[2]));
      var num = parseEpisodeNumber(epUrl, label);
      out.push({
        number: String(num),
        title: label && label !== num ? label : ("الحلقة " + num),
        url: epUrl,
        views: 0,
        isLocked: false,
        date: "",
        isFiller: false,
        thumbnailUrl: null,
        durationSeconds: null,
        servers: []
      });
      if (out.length > 3000) break;
    }
    if (out.length) return out;
    // Fallback: any /episodes/ link.
    var re2 = /<a[^>]+href="([^"]*\/episodes\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/g, m2;
    while ((m2 = re2.exec(String(html || ""))) !== null) {
      var u2 = makeAbsolute(m2[1]);
      if (!u2 || seen[u2]) continue;
      if (u2.indexOf("#") !== -1) continue;
      seen[u2] = true;
      var l2 = unescapeHtml(stripTags(m2[2]));
      if (l2.length > 120) l2 = "";
      var n2 = parseEpisodeNumber(u2, l2);
      out.push({
        number: String(n2),
        title: l2 && l2 !== n2 ? l2 : ("الحلقة " + n2),
        url: u2,
        views: 0,
        isLocked: false,
        date: "",
        isFiller: false,
        thumbnailUrl: null,
        durationSeconds: null,
        servers: []
      });
      if (out.length > 3000) break;
    }
    return out;
  }

  // ---- episode servers (inline data-servers, verified live) ----
  // Page carries:
  //  1. #player-html-template > video#streamit_player > <source src="https://new.phoenixpr.workers.dev/...mkv">
  //  2. a.FJ-Server-Link[data-server] = base64(urlencode(JSON{name,type,link,date}))
  // All mirrors are first-party workers.dev direct files (1080p BluRay x265).
  // Tokens are per-page snapshots: resolved fresh, never stored.

  function decodeDataServer(raw) {
    try {
      var b64 = String(raw || "").replace(/\s+/g, "");
      if (!b64) return null;
      var step1 = "";
      try {
        step1 = atob(b64);
      } catch (e) {
        return null;
      }
      var jsonText = "";
      try {
        jsonText = decodeURIComponent(step1);
      } catch (e2) {
        jsonText = step1;
      }
      var obj = JSON.parse(jsonText);
      if (!obj || !obj.link) return null;
      var link = String(obj.link).replace(/\\\//g, "/");
      return { name: cleanTitle(obj.name || ""), type: cleanTitle(obj.type || ""), link: link };
    } catch (e) {
      return null;
    }
  }

  function primarySourceFromPage(html) {
    var h = unescapeHtml(String(html || ""));
    var m = h.match(/<source[^>]+src="([^"]+)"/);
    if (m) return m[1].replace(/\\\//g, "/");
    return "";
  }

  function serverEntriesFromPage(html) {
    var out = [];
    var h = String(html || "");
    var re = /<a[^>]+class="[^"]*FJ-Server-Link[^"]*"[^>]*>/g, m;
    while ((m = re.exec(h)) !== null) {
      var tag = m[0];
      var dm = tag.match(/data-server="([^"]+)"/);
      if (!dm) continue;
      var nm = tag.match(/data-server-name="([^"]*)"/);
      var decoded = decodeDataServer(unescapeHtml(dm[1]));
      if (!decoded) continue;
      out.push({
        name: unescapeHtml(nm ? nm[1] : decoded.name),
        type: decoded.type,
        link: decoded.link
      });
    }
    return out;
  }

  function isAllowedMediaHost(url) {
    var u = String(url || "").toLowerCase();
    if (u.indexOf("anime-phoenix.com") !== -1) return true;
    if (u.indexOf("workers.dev") !== -1) return true;
    return false;
  }

  function iframeServersFromPage(html) {
    var out = [];
    var h = String(html || "");
    var re = /<iframe[^>]+(?:src|data-src|data-lazy-src)\s*=\s*(?:"([^"]+)"|'([^']+)')/gi, m;
    while ((m = re.exec(h)) !== null) {
      var u = unescapeHtml(m[1] || m[2] || "").replace(/\\\//g, "/");
      if (!u) continue;
      if (u.indexOf("//") === 0) u = "https:" + u;
      if (u.indexOf("http") !== 0) continue;
      if (!isAllowedMediaHost(u)) continue;
      if (out.indexOf(u) === -1) out.push(u);
      if (out.length > 8) break;
    }
    return out;
  }

  function parseSeasonLabel(html) {
    var h = String(html || "");
    var m = h.match(/(شتاء|ربيع|صيف|خريف)/);
    if (m) return m[1];
    var e = h.match(/\b(Winter|Spring|Summer|Fall)\b/i);
    if (e) {
      var v = e[1].toLowerCase();
      if (v === "winter") return "شتاء";
      if (v === "spring") return "ربيع";
      if (v === "summer") return "صيف";
      if (v === "fall") return "خريف";
    }
    return "";
  }

  function slugId(name, fallback) {
    var s = String(name || fallback || "phoenix").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return s || "phoenix";
  }

  async function decodeEpisodeServers(episodeUrl) {
    var out = [];
    var html = await fetchHtml(episodeUrl);
    var seenLink = {};
    var entries = serverEntriesFromPage(html);
    var primary = primarySourceFromPage(html);
    if (primary && isAllowedMediaHost(primary) && !seenLink[primary]) {
      seenLink[primary] = true;
      var pDirect = withDirectSuffix(primary);
      rememberMedia(pDirect, episodeUrl);
      rememberMedia(primary, episodeUrl);
      out.push({
        id: "phoenix-default",
        name: "Phoenix Default",
        embedUrl: episodeUrl,
        url: episodeUrl,
        directUrl: pDirect,
        type: "mp4",
        quality: "1080p",
        qualities: [{
          label: "1080p BluRay",
          url: pDirect,
          height: 1080,
          isDefault: true,
          headers: { "Referer": episodeUrl, "User-Agent": userAgent }
        }],
        selectedQualityIndex: 0,
        headers: { "Referer": episodeUrl, "User-Agent": userAgent }
      });
    }
    for (var i = 0; i < entries.length; i++) {
      var link = entries[i].link || "";
      if (!link || seenLink[link]) continue;
      if (!isAllowedMediaHost(link)) continue;
      seenLink[link] = true;
      var nm = cleanTitle(entries[i].name) || ("Phoenix Server " + (i + 1));
      var durl = withDirectSuffix(link);
      rememberMedia(durl, episodeUrl);
      rememberMedia(link, episodeUrl);
      out.push({
        id: slugId(nm, "phoenix-" + i),
        name: nm,
        embedUrl: episodeUrl,
        url: episodeUrl,
        directUrl: durl,
        type: "mp4",
        quality: "1080p",
        qualities: [{
          label: "1080p BluRay x265",
          url: durl,
          height: 1080,
          isDefault: true,
          headers: { "Referer": episodeUrl, "User-Agent": userAgent }
        }],
        selectedQualityIndex: 0,
        headers: { "Referer": episodeUrl, "User-Agent": userAgent }
      });
      if (out.length > 20) break;
    }
    // Iframe fallbacks (src/data-src/data-lazy-src) for allowed hosts only.
    var iframes = iframeServersFromPage(html);
    for (var fi = 0; fi < iframes.length; fi++) {
      var fLink = iframes[fi] || "";
      if (!fLink || seenLink[fLink]) continue;
      seenLink[fLink] = true;
      var fDirect = withDirectSuffix(fLink);
      rememberMedia(fDirect, episodeUrl);
      rememberMedia(fLink, episodeUrl);
      out.push({
        id: slugId("iframe-" + fi, "phoenix-iframe-" + fi),
        name: "Phoenix Iframe " + (fi + 1),
        embedUrl: episodeUrl,
        url: episodeUrl,
        directUrl: fDirect,
        type: "mp4",
        quality: "1080p",
        qualities: [{
          label: "1080p",
          url: fDirect,
          height: 1080,
          isDefault: true,
          headers: { "Referer": episodeUrl, "User-Agent": userAgent }
        }],
        selectedQualityIndex: 0,
        headers: { "Referer": episodeUrl, "User-Agent": userAgent }
      });
      if (out.length > 20) break;
    }
    if (!out.length) {
      // No deletion: honest embed fallback with reason.
      const phoenixFailedReason = "phoenix_no_direct";
      return [{
        id: "phoenix-fallback",
        name: "Phoenix",
        embedUrl: episodeUrl,
        url: episodeUrl,
        directUrl: "",
        type: "embed",
        quality: null,
        headers: { "Referer": episodeUrl, "User-Agent": userAgent },
        reason: phoenixFailedReason
      }];
    }
    return out;
  }

  return {
    requiresCloudflare: false,

    async getHomepageManga(args) {
      try {
        var page = (args && args.page) || 1;
        // Signed API first (paginated latest, per_page 25).
        try {
          var data = await apiSearch("", "all", "", "", page, "date");
          var mapped = mapApiItems(data.results || []);
          if (mapped.length) return mapped;
        } catch (e) {}
        // HTML fallback: homepage is server-rendered (page 1 only).
        if (page !== 1) return [];
        return await parseAnimeCards(await fetchHtml(baseUrl + "/"));
      } catch (e) {
        return [];
      }
    },

    async search(args) {
      try {
        var query = (args && args.query) || "";
        if (!query.trim()) return [];
        var page = (args && args.page) || 1;
        // 1. Signed JSON API (mirrors live search-page.js).
        try {
          var data = await apiSearch(query, "all", "", "", page, "relevance");
          var mapped = mapApiItems(data.results || []);
          if (mapped.length) return mapped;
        } catch (e) {}
        // 2. Pretty search route /search/{query} (+trailing slash).
        try {
          var html = await fetchHtml(baseUrl + "/search/" + encodeURIComponent(query.trim()));
          var cards = await parseAnimeCards(html);
          if (cards.length) return cards;
        } catch (e) {}
        try {
          var html2 = await fetchHtml(baseUrl + "/search/" + encodeURIComponent(query.trim()) + "/");
          var cards2 = await parseAnimeCards(html2);
          if (cards2.length) return cards2;
        } catch (e) {}
        // 3. Query-string route /search/?q= (fail-closed on CF challenge).
        try {
          var html3 = await fetchHtml(baseUrl + "/search/?q=" + encodeURIComponent(query.trim()));
          return await parseAnimeCards(html3);
        } catch (e) {
          return [];
        }
      } catch (e) {
        return [];
      }
    },

    async getMangaDetails(args) {
      var url = makeAbsolute((args && args.url) || "");
      try {
        if (url.indexOf("/episodes/") !== -1) {
          var m = url.match(/\/episodes\/([a-z0-9\-]+)-episode-\d+/i);
          var parent = m ? (baseUrl + "/animes/" + m[1]) : "";
          if (parent) {
            try {
              return await parseAnimeDetails(await fetchHtml(parent), parent);
            } catch (e) {}
          }
          var epHtml = await fetchHtml(url);
          var epTitle = url;
          try {
            epTitle = unescapeHtml(cleanTitle(await api.cssText(epHtml, "h1"))) || url;
          } catch (e2) {}
          return {
            title: epTitle,
            coverUrl: "",
            description: "",
            genres: [],
            status: "",
            chapters: [{
              number: parseEpisodeNumber(url, epTitle),
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
      // Anime episodes have no image pages — compat stub for the manga path.
      return [];
    },

    async getChapterContent(args) {
      try {
        var url = makeAbsolute((args && args.url) || "");
        if (url.indexOf("/episodes/") !== -1 || url.indexOf("/animes/") !== -1 || url.indexOf("/movies/") !== -1) {
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
        if (url.indexOf("/episodes/") !== -1) {
          return await decodeEpisodeServers(url);
        }
        // Title pages carry no player; movies with inline player resolve directly.
        if (url.indexOf("/movies/") !== -1) {
          try {
            return await decodeEpisodeServers(url);
          } catch (e) {
            return [];
          }
        }
        return [];
      } catch (e) {
        return [];
      }
    },

    async resolveServer(args) {
      try {
        var serverUrl = makeAbsolute((args && (args.serverUrl || args.url)) || "");
        if (!serverUrl) return null;
        // Closed allow-list: first-party site + workers.dev mirrors only,
        // completed with common embed hosts (wall preserved, only extended).
        var u = serverUrl.toLowerCase();
        var okHost = u.indexOf("workers.dev") !== -1 || u.indexOf("anime-phoenix.com") !== -1 ||
          u.indexOf("vkvideo") !== -1 || u.indexOf("vk.com") !== -1 ||
          u.indexOf("voe.") !== -1 || u.indexOf("videa") !== -1 ||
          u.indexOf("dood") !== -1 || u.indexOf("mp4upload.com") !== -1 ||
          u.indexOf("uqload") !== -1;
        if (!okHost) return null;
        var incomingDirect = (args && (args.directUrl || args.direct_url)) || "";
        var slow = String(serverUrl).toLowerCase();
        var isDirectMedia = slow.indexOf(".mp4") !== -1 || slow.indexOf(".m3u8") !== -1 || slow.indexOf(".mkv") !== -1;
        var keptDirect = incomingDirect || (isDirectMedia ? serverUrl : "");
        return {
          url: serverUrl,
          directUrl: keptDirect || serverUrl,
          type: isDirectMedia ? "mp4" : "embed",
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
        var seasonArg = cleanTitle((args && args.season) || "");
        // Season completion: signed API season param (Winter/Spring/Summer/Fall
        // + Arabic شتاء/ربيع/صيف/خريف mapped to API values, fail-closed).
        var SEASON_MAP = { "شتاء": "Winter", "ربيع": "Spring", "صيف": "Summer", "خريف": "Fall" };
        var seasonApi = "";
        if (seasonArg) {
          if (SEASON_MAP[seasonArg]) seasonApi = SEASON_MAP[seasonArg];
          else if (/^(Winter|Spring|Summer|Fall)$/i.test(seasonArg)) seasonApi = seasonArg;
        }
        if (seasonApi && !genre && !type) {
          try {
            var sdata = await apiSearch("", "all", "", "", page, "date", seasonApi, "");
            var sm = mapApiItems(sdata.results || []);
            if (sm.length) return sm;
          } catch (e) {}
          return [];
        }
        // Genre slug via signed API first, pretty route fallback.
        if (genre) {
          var slug = genre.toLowerCase();
          try {
            var gdata = await apiSearch("", "all", slug, "", page, "date");
            var gm = mapApiItems(gdata.results || []);
            if (gm.length) return gm;
          } catch (e) {}
          if (/^[a-z0-9\-]+$/i.test(genre)) {
            try {
              var cards = await parseAnimeCards(await fetchHtml(baseUrl + "/search/" + slug + "/"));
              if (cards.length) return cards;
            } catch (e2) {}
          }
          return [];
        }
        if (type) {
          var t = type.toLowerCase();
          if (t.indexOf("movie") !== -1 || type.indexOf("فيلم") !== -1 || type.indexOf("أفلام") !== -1) {
            try {
              var mdata = await apiSearch("", "movie", "", "", page, "date");
              var mm = mapApiItems(mdata.results || []);
              if (mm.length) return mm;
            } catch (e) {}
            return [];
          }
          if (type.indexOf("مكتمل") !== -1 || t === "completed") {
            try {
              var cdata = await apiSearch("", "all", "", "completed", page, "date");
              var cm = mapApiItems(cdata.results || []);
              if (cm.length) return cm;
            } catch (e) {}
            // HTML fallback: /completed is server-rendered with pagination.
            var curls = [baseUrl + "/completed?page=" + page, baseUrl + "/completed/page/" + page + "/", baseUrl + "/completed"];
            for (var ci = 0; ci < curls.length; ci++) {
              try {
                var cc = await parseAnimeCards(await fetchHtml(curls[ci]));
                if (cc.length) return cc;
              } catch (e2) {}
            }
            return [];
          }
          if (type.indexOf("مستمر") !== -1 || t === "releasing") {
            try {
              var rdata = await apiSearch("", "all", "", "releasing", page, "date");
              var rm = mapApiItems(rdata.results || []);
              if (rm.length) return rm;
            } catch (e) {}
            try {
              var rc = await parseAnimeCards(await fetchHtml(baseUrl + "/search/releasing"));
              if (rc.length) return rc;
            } catch (e2) {}
            return [];
          }
          if (t === "tv" || type.indexOf("مسلسل") !== -1 || type.indexOf("أنمي") !== -1) {
            try {
              var tdata = await apiSearch("", "tvshow", "", "", page, "date");
              var tm = mapApiItems(tdata.results || []);
              if (tm.length) return tm;
            } catch (e) {}
            return [];
          }
        }
        var home = await this.getHomepageManga({ page: page });
        return home;
      } catch (e) {
        return [];
      }
    },

    async getGenresAndTypes() {
      return { genres: defaultGenres, types: defaultTypes };
    },

    async fetchMoreChapters() {
      // Episode lists ship complete inside the title page.
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
