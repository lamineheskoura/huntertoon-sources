function createSource(api, config) {
  var baseUrl = ((config && config.base_url) || "https://anslayer.com/anime/public").replace(/\/+$/, "");
  var siteUrl = "https://anslayer.com";
  var configHeaders = (config && config.headers) || {};
  var userAgent =
    configHeaders["User-Agent"] ||
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
  var lastPageUrl = baseUrl + "/";
  var CLIENT_ID = "android-app2";
  var CLIENT_SECRET = "7befba6263cc14c90d2f1d6da2c5cf9b251bfbbd";
  var LIST_LIMIT = 20;
  var ALT_API = "https://a-reslayer.com/la/public/api/f";

  var defaultHeaders = {
    "User-Agent": userAgent,
    "Accept": "application/json",
    "Accept-Language": "ar,en-US;q=0.9,en;q=0.8",
    "Referer": siteUrl + "/",
    "Origin": siteUrl,
    "Client-Id": CLIENT_ID,
    "Client-Secret": CLIENT_SECRET
  };

  // Site taxonomy for display only (getGenresAndTypes). NOTE: the list
  // endpoint honors anime_type/anime_status/anime_season but IGNORES any
  // genre key (verified live: identical sets), so genre falls back below.
  var GENRE_IDS = {
    "اثارة": "36", "اطفال": "14", "اكشن": "1", "العاب": "11", "ايتشي": "9",
    "ايسيكاي": "39", "بوليسي": "34", "تاريخي": "12", "جنون": "5", "جوسي": "38",
    "حريم": "30", "خارق للطبيعة": "32", "خيال": "10", "خيال علمي": "23",
    "دراما": "8", "رعب": "13", "رومانسي": "21", "رياضي": "27", "ساموراي": "20",
    "سحر": "15", "سيارات": "3", "سينين": "37", "شريحة من الحياة": "31",
    "شوجو": "24", "شونين": "25", "شياطين": "6", "عسكري": "33", "غموض": "7",
    "فضاء": "26", "فنون قتالية": "16", "قوى خارقة": "28", "كوميدي": "4",
    "محاكاة ساخرة": "19", "مدرسي": "22", "مصاص دماء": "29", "مغامرات": "2",
    "موسيقى": "18", "ميكا": "17", "نفسي": "35"
  };
  var genreMap = null;

  var TYPE_OK = ["TV", "ONA", "OVA", "Movie", "Music", "Special"];
  var STATUS_OK = ["Currently Airing", "Finished Airing", "Not Yet Aired"];
  var SEASON_OK = ["Winter", "Spring", "Summer", "Fall"];
  var STATUS_AR = { "مستمر": "Currently Airing", "مكتمل": "Finished Airing", "قادم": "Not Yet Aired" };
  var SEASON_AR = { "شتاء": "Winter", "ربيع": "Spring", "صيف": "Summer", "خريف": "Fall" };
  var TYPE_AR = { "فيلم": "Movie" };

  async function loadGenreMap() {
    if (genreMap) return genreMap;
    try {
      var data = await apiGet("/animes/get-anime-dropdowns");
      var gd = (data && data.response && data.response.anime_genres && data.response.anime_genres.data) || [];
      if (gd.length) {
        var m = {};
        for (var i = 0; i < gd.length; i++) {
          var on = cleanTitle(gd[i].option || "");
          var ov = cleanTitle(String(gd[i].value != null ? gd[i].value : ""));
          if (on && ov) m[on] = ov;
        }
        if (Object.keys(m).length) genreMap = m;
      }
    } catch (e) {}
    if (!genreMap) genreMap = GENRE_IDS;
    return genreMap;
  }

  function siteGenres() {
    var out = [];
    var src = genreMap || GENRE_IDS;
    for (var k in src) out.push(k);
    return out;
  }

  // Per-file headers: the app NEVER reads server.headers (zero consumers)
  // and getVideoHeaders(url) is the only channel reaching the player.
  var mediaHeaders = {};

  function rememberMedia(fileUrl, referer) {
    if (!fileUrl || !referer) return;
    mediaHeaders[String(fileUrl)] = String(referer);
    var bare = String(fileUrl).split("#")[0];
    if (bare && bare !== fileUrl) mediaHeaders[bare] = String(referer);
  }

  function embedRefererFor(url) {
    var u = String(url || "").toLowerCase();
    if (u.indexOf("mediafire.com") !== -1) return "https://www.mediafire.com/";
    if (u.indexOf("mixdrop") !== -1) return "https://mixdrop.co/";
    if (u.indexOf("streamtape") !== -1) return "https://streamtape.com/";
    if (u.indexOf("ok.ru") !== -1) return "https://ok.ru/";
    if (u.indexOf("drive.google") !== -1) return "https://drive.google.com/";
    return "";
  }

  function videoHeadersFor(url) {
    var u = String(url || "");
    var ref = mediaHeaders[u] || mediaHeaders[u.split("#")[0]] || embedRefererFor(u) || siteUrl + "/";
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

  async function apiGet(path) {
    var url = baseUrl + path;
    lastPageUrl = url;
    var res = await api.http(url, { method: "GET", headers: mergeHeaders(defaultHeaders, {}) });
    if (!res || !res.ok) throw new Error("HTTP " + (res ? res.status : 0) + " for " + url);
    try {
      return JSON.parse(res.body || "{}");
    } catch (e) {
      throw new Error("Bad JSON for " + url);
    }
  }

  async function apiPost(path, inner) {
    var url = baseUrl + path;
    lastPageUrl = url;
    var headers = mergeHeaders(defaultHeaders, { "Content-Type": "application/json" });
    var res = await api.http(url, {
      method: "POST",
      headers: headers,
      body: JSON.stringify({ json: JSON.stringify(inner) })
    });
    if (!res || !res.ok) throw new Error("HTTP " + (res ? res.status : 0) + " for " + url);
    try {
      return JSON.parse(res.body || "{}");
    } catch (e) {
      throw new Error("Bad JSON for " + url);
    }
  }

  // Proven-working client identity for provider pages (matches the
  // reference implementation; some hosts reject other identities).
  var FIREFOX_MOBILE = "Mozilla/5.0 (Android 14; Mobile; rv:124.0) Gecko/124.0 Firefox/124.0";

  async function fetchText(url, referer, ua) {
    lastPageUrl = url || lastPageUrl;
    var headers = {
      "User-Agent": ua || userAgent,
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "ar,en-US;q=0.9,en;q=0.8",
      "Referer": referer || siteUrl + "/"
    };
    var res = await api.http(url, { method: "GET", headers: headers });
    if (!res || !res.ok) throw new Error("HTTP " + (res ? res.status : 0) + " for " + url);
    return res.body || "";
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

  function resolveUrl(base, rel) {
    var r = String(rel || "").trim();
    if (/^https?:\/\//i.test(r)) return r;
    if (r.indexOf("//") === 0) return "https:" + r;
    var b = String(base || "").split("?")[0].split("#")[0];
    var hm = b.match(/^(https?:\/\/[^\/]+)/);
    if (r.charAt(0) === "/") return hm ? (hm[1] + r) : r;
    var i = b.lastIndexOf("/");
    return b.substring(0, i + 1) + r;
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
    if (url.indexOf("/") === 0) return siteUrl + url;
    return siteUrl + "/" + url;
  }

  function withMp4Suffix(url) {
    var u = String(url || "");
    if (!u) return "";
    if (u.indexOf(".mp4") !== -1) return u;
    return u + "#.mp4";
  }

  function budDec(bud) {
    if (!bud || bud.n <= 0) return false;
    bud.n--;
    return true;
  }

  function qualityOf(name) {
    var n = String(name || "").toUpperCase();
    if (n.indexOf("1080") !== -1) return "FHD";
    if (n.indexOf("720") !== -1) return "HD";
    if (n.indexOf("480") !== -1) return "SD";
    return null;
  }

  function listUrl(listType, page, extra) {
    var q = {
      list_type: listType,
      limit: LIST_LIMIT,
      offset: ((page || 1) - 1) * LIST_LIMIT
    };
    if (extra) {
      for (var k in extra) q[k] = extra[k];
    }
    return baseUrl + "/animes/get-published-animes?json=" + encodeURIComponent(JSON.stringify(q));
  }

  function toCard(item) {
    if (!item || !item.anime_id) return null;
    var title = cleanTitle(item.anime_name || "");
    if (!title) return null;
    return {
      title: title,
      coverUrl: makeAbsolute(item.anime_cover_image_url || ""),
      detailUrl: siteUrl + "/anime/" + item.anime_id,
      contentType: "anime"
    };
  }

  // Browse pagination: the API ignores limit/offset/page (always the same
  // 25). Page 1 = alphabetical list, page 2 = latest updates (25 distinct
  // items, 0 overlap verified live), page 3+ = [] so infinite scroll stops
  // instead of repeating. Per-list seen-guards (browse/search/filter are
  // independent; a shared map would corrupt one list with another).
  var seenBrowse = {};
  var seenSearch = {};
  var seenFilter = {};

  // HEAD-probe: file pages can masquerade as mp4 (URL contains .mp4 but
  // serves HTML). Accept 2xx with non-HTML content-type; 405/501 (no HEAD
  // support) falls back to trust; anything else drops. 1 cheap fetch.
  async function probeMedia(url, referer) {
    try {
      var res = await api.http(url, {
        method: "HEAD",
        headers: {
          "User-Agent": userAgent,
          "Accept": "*/*",
          "Referer": referer || siteUrl + "/"
        }
      });
      if (!res) return false;
      if (res.status === 405 || res.status === 501) return true;
      if (!res.ok) return false;
      var ct = "";
      try {
        var hs = res.headers || {};
        for (var k in hs) {
          if (String(k).toLowerCase() === "content-type") ct = hs[k];
        }
      } catch (e) {}
      ct = String(ct).toLowerCase();
      if (ct.indexOf("text/html") !== -1) return false;
      if (ct.indexOf("application/json") !== -1) return false;
      return true;
    } catch (e) {
      return false;
    }
  }

  function guardCards(cards, seen) {
    var out = [];
    for (var i = 0; i < cards.length; i++) {
      if (!seen[cards[i].detailUrl]) {
        seen[cards[i].detailUrl] = true;
        out.push(cards[i]);
      }
    }
    return out;
  }

  async function browsePage(page) {
    page = page || 1;
    if (page > 2) return [];
    if (page <= 1) seenBrowse = {};
    var type = page > 1 ? "latest_updated_episode_new" : "anime_list";
    var extra = type === "latest_updated_episode_new" ? { order: "latest_first" } : null;
    return await parseList(listUrl(type, 1, extra), page, seenBrowse);
  }

  async function parseList(url, page, seen) {
    var data = await apiGet(url.substring(baseUrl.length));
    var items = (data && data.response && data.response.data) || [];
    return guardCards(items.map(toCard).filter(Boolean), seen || {});
  }

  function animeIdFromUrl(url) {
    var m = String(url || "").match(/\/anime\/(\d+)/);
    return m ? m[1] : "";
  }

  function parseEpisodeRef(url) {
    var m = String(url || "").match(/\/anime\/(\d+)\/episode\/(\d+)/);
    if (!m) return null;
    var em = String(url || "").match(/[?&]eid=([0-9]+)/);
    return { aid: m[1], num: m[2], eid: em ? em[1] : "" };
  }

  function genresOf(d) {
    var g = d ? d.anime_genres : "";
    var out = [];
    if (!g) return out;
    var arr = (g instanceof Array) ? g : String(g).split(",");
    for (var i = 0; i < arr.length; i++) {
      var t = cleanTitle(arr[i]);
      if (t && out.indexOf(t) === -1) out.push(t);
    }
    return out;
  }

  async function fetchEpisodes(aid) {
    // limit:1 + episode_ids:[0] still returns the FULL list live (verified).
    var data = await apiPost("/episodes/get-episodes-new", {
      anime_id: parseInt(aid, 10) || aid,
      episode_ids: [0],
      limit: 1
    });
    var items = (data && data.response && data.response.data) || [];
    return items;
  }

  function episodeToChapter(aid, ep) {
    var num = String(ep.episode_number != null ? ep.episode_number : "0");
    var eid = ep.episode_id != null ? String(ep.episode_id) : "";
    return {
      number: num,
      title: "الحلقة " + num,
      url: siteUrl + "/anime/" + aid + "/episode/" + num + (eid ? "?eid=" + eid : ""),
      views: 0,
      isLocked: false,
      date: "",
      isFiller: false,
      thumbnailUrl: null,
      durationSeconds: null,
      servers: []
    };
  }

  // ---- direct resolvers (native playback only, fail-closed) ----

  // mediafire: kDownloadUrl/download host first, then page anchors,
  // then get_info API + premium page (verified live pattern).
  // Anchors must exclude the file page itself (mediafire file URLs often
  // end with /filename.mp4 and would self-match as "direct").
  // Final URL is HEAD-probed (pages can masquerade as mp4 in URL).
  async function resolveMediafire(pageUrl, bud) {
    try {
      if (!budDec(bud)) return "";
      var html = await fetchText(pageUrl, "https://www.mediafire.com/", FIREFOX_MOBILE);
      var m = html.match(/kDownloadUrl\s*=\s*"([^"]+)"/);
      var direct = m ? m[1] : "";
      if (!direct) {
        var g = html.match(/https?:\/\/download\d*\.mediafire\.com[^"'\s<>]+/);
        if (g) direct = g[0];
      }
      if (!direct) {
        var am = html.match(/<a\b[^>]+href="([^"]+)"[^>]*>(?:[^<]*download[^<]*)?</i);
        if (am) {
          var ah = am[1];
          if (ah.indexOf(".mp4") !== -1 && ah.indexOf("http") === 0 &&
            ah.indexOf("/file/") === -1 && ah !== pageUrl) direct = ah;
        }
      }
      if (!direct) {
        var km = String(pageUrl).match(/\/file\/([A-Za-z0-9]+)/);
        if (km && budDec(bud)) {
          try {
            var apiBody = await fetchText("https://www.mediafire.com/api/file/get_info.php?quick_key=" +
              encodeURIComponent(km[1]) + "&response_format=json", pageUrl, FIREFOX_MOBILE);
            var jo = null;
            try {
              jo = JSON.parse(apiBody);
            } catch (e) {}
            var nd = jo && jo.response && jo.response.file_info && jo.response.file_info.links &&
              jo.response.file_info.links.normal_download;
            if (nd) {
              var prem = await fetchText(nd, pageUrl, FIREFOX_MOBILE);
              var pm = prem.match(/kDownloadUrl\s*=\s*"([^"]+)"/) ||
                prem.match(/https?:\/\/download\d*\.mediafire\.com[^"'\s<>]+/);
              if (pm) direct = pm[1] || pm[0];
            }
          } catch (e) {}
        }
      }
      if (!direct || direct.indexOf("http") !== 0) return "";
      direct = withMp4Suffix(direct);
      if (!budDec(bud)) return direct;
      return (await probeMedia(direct, pageUrl)) ? direct : "";
    } catch (e) {
      return "";
    }
  }

  // Dean Edwards packer unpack (mixdrop Wise). Pure regex + base36.
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

  // mixdrop: /e/ page -> Wise unpack -> mp4.
  async function resolveMixdrop(embedUrl, bud) {
    try {
      if (!budDec(bud)) return "";
      var html = await fetchText(embedUrl, embedUrl);
      var up = unpackPacker(html);
      if (!up) return "";
      var m = up.match(/(https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*)/);
      if (m) return m[1];
      var g = html.match(/(https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*)/);
      return g ? g[1] : "";
    } catch (e) {
      return "";
    }
  }

  // streamtape: node text must contain /get_video? (else invalid token),
  // else evaluate ONLY string-concat/substring ops (never page JS).
  function applyJsTransforms(value, calls) {
    var res = String(value || "");
    var re = /\.(substring|substr|slice)\(\s*(-?\d+)(?:\s*,\s*(-?\d+))?\s*\)/gi, m;
    while ((m = re.exec(calls)) !== null) {
      var op = m[1].toLowerCase();
      var a = parseInt(m[2], 10) || 0;
      var b = (m[3] === undefined || m[3] === "") ? null : (parseInt(m[3], 10) || 0);
      if (op === "substring") {
        var s1 = Math.max(0, Math.min(a, res.length));
        var e1 = b === null ? res.length : Math.max(0, Math.min(b, res.length));
        res = res.substring(Math.min(s1, e1), Math.max(s1, e1));
      } else if (op === "substr") {
        var st = a < 0 ? Math.max(0, res.length + a) : Math.min(a, res.length);
        var en = b === null ? res.length : Math.min(st + Math.max(0, b), res.length);
        res = res.substring(st, en);
      } else if (op === "slice") {
        var s2 = a < 0 ? Math.max(0, res.length + a) : Math.min(a, res.length);
        var r2 = b === null ? res.length : (b < 0 ? Math.max(0, res.length + b) : Math.min(b, res.length));
        res = (r2 < s2) ? "" : res.substring(s2, r2);
      }
    }
    return res;
  }

  function evalConcat(expr) {
    var out = "";
    var re = /(["'])((?:\\.|(?!\1).)*)\1((?:\s*\)*\s*\.\s*(?:substring|substr|slice)\s*\([^)]*\))*)/g, m;
    while ((m = re.exec(expr)) !== null) {
      var part = m[2].replace(/\\\//g, "/").replace(/\\u0026/gi, "&")
        .replace(/\\"/g, "\"").replace(/\\'/g, "'");
      out += applyJsTransforms(part, m[3] || "");
    }
    return out;
  }

  function ensureStreamtapeUrl(url) {
    var u = String(url || "");
    if (!u) return "";
    if (/[?&]stream=/i.test(u)) return u;
    return u + (u.indexOf("?") !== -1 ? "&" : "?") + "stream=1";
  }

  // NOTE: node text like "/streamtape.com/get_video?.." is a
  // protocol-relative URL missing one slash -> repair to https://, it is
  // NOT a site-relative path (verified live: naive resolve doubles host).
  function fixSingleSlash(u) {
    var m = String(u || "").match(/^\/([^\/][^\/]*\.[^\/]+\/.*)$/);
    if (m) return "https:/" + u;
    return u;
  }

  function streamtapeMirrors(embedUrl) {
    var out = [embedUrl];
    var u = String(embedUrl || "");
    // Player variant /v/ is the proven pattern; try it alongside /e/.
    if (u.indexOf("/e/") !== -1) out.push(u.replace("/e/", "/v/"));
    if (u.indexOf("streamtape.to/") !== -1) {
      out.push(u.replace("streamtape.to/", "streamtape.com/"));
    } else if (u.indexOf("streamtape.com/") !== -1) {
      out.push(u.replace("streamtape.com/", "streamtape.to/"));
    }
    return out;
  }

  async function resolveStreamtape(embedUrl, bud) {
    try {
      var pages = streamtapeMirrors(embedUrl);
      for (var pi = 0; pi < pages.length; pi++) {
        if (!budDec(bud)) return "";
        var html = "";
        try {
          html = await fetchText(pages[pi], pages[pi], FIREFOX_MOBILE);
        } catch (e) {
          continue;
        }
        var got = extractStreamtapeDirect(html, pages[pi]);
        if (got) return got;
      }
      return "";
    } catch (e) {
      return "";
    }
  }

  function extractStreamtapeDirect(html, base) {
    try {
    var dec = String(html).replace(/\\\//g, "/");
    // 1. direct node text (must contain /get_video? or token is invalid).
    var nm = dec.match(/id=["'](?:captchalink|ideoooolink|norobotlink)["'][^>]*>([^<]*\/get_video\?[^<]*)</i);
    if (nm) return ensureStreamtapeUrl(resolveUrl(base, fixSingleSlash(cleanTitle(nm[1]))));
      // 2. script assembly, captchalink first.
      var re = /document\.getElementById\(\s*(["'])(captchalink|ideoooolink|norobotlink)\1\s*\)\.innerHTML\s*=\s*([^;]+);/gi, m;
      var cands = [];
      while ((m = re.exec(dec)) !== null) cands.push({ id: m[2].toLowerCase(), expr: m[3] });
      cands.sort(function (a, b) {
        var w = function (x) { return x.id === "captchalink" ? 0 : (x.id === "ideoooolink" ? 1 : 2); };
        return w(a) - w(b);
      });
      for (var ci = 0; ci < cands.length; ci++) {
        var val = fixSingleSlash(evalConcat(cands[ci].expr));
        if (val && val.indexOf("/get_video?") !== -1) {
          return ensureStreamtapeUrl(resolveUrl(base, val));
        }
      }
      // 3. robotlink fragment + generic fallbacks.
      var r = dec.match(/(?:robotlink|norobotlink)[^=]{0,100}=\s*["']([^"']+)["']/i);
      if (r && r[1].indexOf("/get_video?") !== -1) {
        return ensureStreamtapeUrl(resolveUrl(base, fixSingleSlash(r[1])));
      }
      var g = dec.match(/(https?:\/\/[^\s"'<>]*streamtape[^\s"'<>]*\/get_video\?[^\s"'<>]+)/i);
      if (g) return ensureStreamtapeUrl(g[1]);
      return "";
    } catch (e) {
      return "";
    }
  }

  // ok.ru: [data-options] JSON -> flashvars.metadata/videos[]/hlsManifest.
  // Structure mirrors the proven reference implementation.
  function okRuEmbedUrl(value) {
    var m = String(value || "").match(/\/(?:video|videoembed)\/(\d+)/i);
    return m ? ("https://ok.ru/videoembed/" + m[1]) : "";
  }

  function okRuQuality(name) {
    var n = String(name || "").toLowerCase();
    if (n === "mobile") return "144p";
    if (n === "lowest") return "240p";
    if (n === "low") return "360p";
    if (n === "sd") return "480p";
    if (n === "hd") return "720p";
    if (n === "full") return "1080p";
    if (n === "quad") return "1440p";
    if (n === "ultra") return "2160p";
    return "";
  }

  async function resolveOk(embedUrl, bud) {
    try {
      var page = okRuEmbedUrl(embedUrl) || embedUrl;
      if (!budDec(bud)) return null;
      var html = await fetchText(page, siteUrl + "/", FIREFOX_MOBILE);
      var re = /<[^>]+data-options\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>/g, m;
      var found = {};
      var order = [];
      while ((m = re.exec(html)) !== null) {
        var raw = unescapeHtml(m[1] || m[2] || "");
        var obj = null;
        try {
          obj = JSON.parse(raw);
        } catch (e) {}
        if (!obj) continue;
        var meta = null;
        try {
          var fv = obj.flashvars;
          var mstr = (fv && fv.metadata) || obj.metadata;
          if (typeof mstr === "string") {
            try {
              meta = JSON.parse(mstr);
            } catch (e2) {}
          } else if (mstr) {
            meta = mstr;
          }
        } catch (e) {}
        if (!meta) continue;
        var singles = ["hlsManifestUrl", "hlsMasterPlaylistUrl", "manifestUrl"];
        for (var s = 0; s < singles.length; s++) {
          var su = cleanTitle(meta[singles[s]] || "");
          if (su && !found[su]) {
            found[su] = true;
            order.push({ url: su, q: "" });
          }
        }
        var mov = meta.movie;
        var vids = meta.videos || (mov && mov.videos) || [];
        for (var v = 0; v < (vids instanceof Array ? vids.length : 0); v++) {
          var vu = cleanTitle(vids[v].url || "");
          if (!vu) continue;
          var vl = vu.toLowerCase();
          if (vl.indexOf("http://") !== 0 && vl.indexOf("https://") !== 0 && vu.indexOf("//") !== 0) continue;
          if (vl.indexOf("youtube.com/") !== -1 || vl.indexOf("youtu.be/") !== -1) continue;
          if (vu.indexOf("//") === 0) vu = "https:" + vu;
          if (!found[vu]) {
            found[vu] = true;
            order.push({ url: vu, q: okRuQuality(vids[v].name || "") });
          }
        }
        if (mov) {
          var mu = [mov.hlsManifestUrl, mov.hlsMasterPlaylistUrl, mov.manifestUrl];
          for (var mi = 0; mi < mu.length; mi++) {
            var muu = cleanTitle(mu[mi] || "");
            if (muu && !found[muu]) {
              found[muu] = true;
              order.push({ url: muu, q: "" });
            }
          }
        }
      }
      if (!order.length) {
        // m.ok.ru fallback: data-video JSON -> videoSrc -> redirect mp4.
        var idm = String(page).match(/\/(\d+)(?:[?#]|$)/);
        if (idm && budDec(bud)) {
          try {
            var mob = await fetchText("https://m.ok.ru/video/" + idm[1], page, FIREFOX_MOBILE);
            var dm = mob.match(/data-video\s*=\s*"([^"]+)"/) || mob.match(/data-video\s*=\s*'([^']+)'/);
            if (dm) {
              var dobj = null;
              try {
                dobj = JSON.parse(unescapeHtml(dm[1]));
              } catch (e) {}
              var vsrc = dobj && (dobj.videoSrc || dobj.video_src);
              if (vsrc) {
                var vhead = null;
                try {
                  vhead = await api.http(vsrc, {
                    method: "HEAD",
                    headers: { "User-Agent": FIREFOX_MOBILE, "Referer": page, "Accept": "*/*" }
                  });
                } catch (e) {}
                var vfin = (vhead && vhead.headers) || {};
                var vloc = "";
                for (var vk in vfin) {
                  if (String(vk).toLowerCase() === "location") vloc = vfin[vk];
                }
                if (vloc) order.push({ url: vloc, q: "" });
                else if (vsrc.toLowerCase().indexOf(".mp4") !== -1) {
                  order.push({ url: vsrc, q: "" });
                }
              }
            }
          } catch (e) {}
        }
      }
      if (!order.length) return null;
      var quals = [];
      for (var q = 0; q < order.length; q++) {
        var h = 0;
        var qm = String(order[q].q || "").match(/(\d+)/);
        if (qm) h = parseInt(qm[1], 10) || 0;
        quals.push({ label: order[q].q || ("Q" + (q + 1)), url: order[q].url, height: h });
      }
      quals.sort(function (a, b) { return b.height - a.height; });
      var hasM3u8 = false;
      for (var qi = 0; qi < quals.length; qi++) {
        if (quals[qi].url.toLowerCase().indexOf(".m3u8") !== -1) hasM3u8 = true;
      }
      var out = [];
      for (qi = 0; qi < quals.length; qi++) {
        out.push({ label: quals[qi].label, url: quals[qi].url, height: quals[qi].height, isDefault: qi === 0,
          headers: { "Referer": page, "User-Agent": FIREFOX_MOBILE } });
        rememberMedia(quals[qi].url, page);
      }
      return { type: hasM3u8 ? "m3u8" : "mp4", qualities: out };
    } catch (e) {
      return null;
    }
  }

  // drive: passthrough only when the share link is alive (many are
  // deleted: "Page Not Found"). 1 cheap GET, fail-closed.
  async function driveAlive(url, bud) {
    try {
      if (!budDec(bud)) return false;
      var html = await fetchText(url, "https://drive.google.com/");
      if (!html || html.length < 2000) return false;
      if (html.indexOf("Page Not Found") !== -1) return false;
      if (html.indexOf("no longer available") !== -1) return false;
      if (html.indexOf("cannot be found") !== -1) return false;
      // Positive marker required: live file pages embed viewer/download refs.
      if (html.indexOf("/file/d/") === -1 && html.indexOf("downloadUrl") === -1 &&
        html.indexOf("viewerng") === -1) return false;
      return true;
    } catch (e) {
      return false;
    }
  }

  var DROP_HOSTS = ["vidlox", "fembed", "uptostream", "jawcloud", "streamvid",
    "streamhub", "highstream", "tune.pk", "krakenfiles", "pixeldrain"];

  function dropHost(url) {
    var u = String(url || "").toLowerCase();
    for (var i = 0; i < DROP_HOSTS.length; i++) {
      if (u.indexOf(DROP_HOSTS[i]) !== -1) return true;
    }
    return false;
  }

  function isDrive(url) {
    return String(url || "").toLowerCase().indexOf("drive.google") !== -1;
  }

  function isFilemoon(url) {
    return String(url || "").toLowerCase().indexOf("filemoon") !== -1;
  }

  // muilt: entry URL in 3 encodings first (raw, %5C, slash) like the
  // reference client, then mirror (superset) + official fallback.
  // Saves fetches on slow networks (12s bridge timeouts).
  async function fetchMuiltLinks(n, bud, entryUrl) {
    var seen = {};
    var out = [];
    // NOTE: official mirror lives on siteUrl (/la/...), NOT under baseUrl
    // (/anime/public/la/... 404s). ALT_API is the a-reslayer mirror.
    var cands = [];
    if (entryUrl) {
      cands.push(entryUrl);
      if (entryUrl.indexOf("\\") !== -1) {
        cands.push(entryUrl.split("\\").join("%5C"));
        cands.push(entryUrl.split("\\").join("/"));
      }
    }
    cands.push(ALT_API + "?n=" + encodeURIComponent(n));
    cands.push(siteUrl + "/la/public/api/f2?n=" + encodeURIComponent(n));
    var urls = [];
    for (var c = 0; c < cands.length; c++) {
      if (!seen[cands[c]]) {
        seen[cands[c]] = true;
        urls.push(cands[c]);
      }
    }
    seen = {};
    for (var i = 0; i < urls.length; i++) {
      try {
        if (bud && !budDec(bud)) break;
        var res = await api.http(urls[i], {
          method: "GET",
          headers: {
            "User-Agent": userAgent,
            "Accept": "application/json",
            "Referer": siteUrl + "/"
          }
        });
        if (!res || !res.ok) continue;
        var arr = null;
        try {
          arr = JSON.parse(res.body || "[]");
        } catch (e) {}
        if (!(arr instanceof Array)) continue;
        for (var j = 0; j < arr.length; j++) {
          // Normalize: some entries escape slashes (mediafire\/?h8...) which
          // 404s verbatim; real file otherwise.
          var u = makeAbsolute(String(arr[j] || "").replace(/\\/g, "/"));
          if (u && !seen[u]) {
            seen[u] = true;
            out.push(u);
          }
        }
        if (out.length) break;
      } catch (e) {}
    }
    return out;
  }

  function serverNameFor(url) {
    var u = String(url || "").toLowerCase();
    if (u.indexOf("mediafire") !== -1) return "mediafire";
    if (u.indexOf("mixdrop") !== -1) return "mixdrop";
    if (u.indexOf("streamtape") !== -1) return "streamtape";
    if (u.indexOf("ok.ru") !== -1) return "ok";
    if (u.indexOf("drive.google") !== -1) return "drive";
    if (u.indexOf("voe") !== -1) return "voe";
    if (u.indexOf("videa") !== -1) return "videa";
    if (u.indexOf("dood") !== -1) return "dood";
    if (u.indexOf("mp4upload") !== -1) return "mp4upload";
    if (u.indexOf("uqload") !== -1) return "uqload";
    if (u.indexOf("vkvideo") !== -1 || u.indexOf("vk.com") !== -1) return "vk";
    return "سيرفر";
  }

  async function decodeEpisodeServers(aid, num, eid) {
    var out = [];
    try {
      var eps = await fetchEpisodes(aid);
      var ep = null;
      if (eid) {
        for (var e = 0; e < eps.length; e++) {
          if (String(eps[e].episode_id) === String(eid)) {
            ep = eps[e];
            break;
          }
        }
      }
      if (!ep) {
        for (var i = 0; i < eps.length; i++) {
          if (String(eps[i].episode_number) === String(num)) {
            ep = eps[i];
            break;
          }
        }
      }
      if (!ep) return [];
      var muiltN = "";
      var muiltEntry = "";
      var urls = ep.episode_urls || [];
      for (var u = 0; u < urls.length; u++) {
        var nm = (urls[u] && urls[u].episode_server_name) || "";
        if (nm === "muilt" && urls[u].episode_url) {
          if (!muiltEntry) muiltEntry = String(urls[u].episode_url);
          var mm = String(urls[u].episode_url).match(/[?&]n=([^&]+)/);
          if (mm && !muiltN) muiltN = decodeURIComponent(mm[1]);
        }
      }
      if (!muiltN) return [];
      // Resolution budget max 14 fetches + soft 12s deadline.
      var bud = { n: 14 };
      var t0 = 0;
      try {
        t0 = new Date().getTime();
      } catch (e0) {}
      function deadlineHit() {
        try {
          if (!t0) return false;
          return (new Date().getTime() - t0) > 12000;
        } catch (e) {
          return false;
        }
      }
      var links = await fetchMuiltLinks(muiltN, bud, muiltEntry);
      // Cost order: drive liveness-check is free-ish (no media fetch).
      // Then mediafire (proven pattern) before lander-prone mixdrop.
      function linkRank(u) {
        var lb = serverNameFor(u);
        if (isDrive(u)) return 0;
        if (lb === "mediafire") return 1;
        if (lb === "mixdrop") return 2;
        if (lb === "streamtape") return 3;
        return 4;
      }
      var first = [];
      var mid = [];
      for (var o = 0; o < links.length; o++) {
        if (isDrive(links[o])) first.push(links[o]);
        else mid.push(links[o]);
      }
      mid.sort(function (a, b) { return linkRank(a) - linkRank(b); });
      links = first.concat(mid);
      var idx = 0;
      for (var l = 0; l < links.length; l++) {
        if (deadlineHit()) break;
        var link = links[l];
        if (dropHost(link)) continue;
        var durl = "";
        var stype = "mp4";
        var label = serverNameFor(link);
        try {
          if (isDrive(link)) {
            // Drive is resolved natively by the app extractor: passthrough
            // only when alive (many shares are deleted).
            if (await driveAlive(link, bud)) {
              out.push({
                id: "drive-" + idx,
                name: "drive",
                embedUrl: link,
                url: link,
                type: "embed",
                quality: null,
                headers: { "Referer": "https://drive.google.com/", "User-Agent": userAgent }
              });
              idx++;
            }
            continue;
          } else if (isFilemoon(link)) {
            // Filemoon is resolved natively by the app extractor
            // (packer + jwplayer): passthrough like drive.
            out.push({
              id: "filemoon-" + idx,
              name: "filemoon",
              embedUrl: link,
              url: link,
              type: "embed",
              quality: null,
              headers: { "Referer": link, "User-Agent": FIREFOX_MOBILE }
            });
            idx++;
            continue;
          } else if (label === "vk") {
            // Vk is resolved natively by the app extractor: passthrough
            // like drive/filemoon (no resolve here).
            const vkReason = "vk_passthrough";
            out.push({
              id: "vk-" + idx,
              name: "vk",
              embedUrl: link,
              url: link,
              type: "embed",
              quality: null,
              headers: { "Referer": link, "User-Agent": FIREFOX_MOBILE },
              reason: vkReason
            });
            idx++;
            continue;
          } else if (label === "mediafire") {
            durl = await resolveMediafire(link, bud);
          } else if (label === "mixdrop") {
            durl = await resolveMixdrop(link, bud);
          } else if (label === "streamtape") {
            durl = await resolveStreamtape(link, bud);
          } else if (label === "ok") {
            var okr = await resolveOk(link, bud);
            if (okr && okr.qualities && okr.qualities.length) {
              var qh = [];
              for (var qi = 0; qi < okr.qualities.length; qi++) {
                qh.push({
                  label: okr.qualities[qi].label,
                  url: okr.qualities[qi].url,
                  height: okr.qualities[qi].height,
                  isDefault: qi === 0,
                  headers: okr.qualities[qi].headers || { "Referer": link, "User-Agent": FIREFOX_MOBILE }
                });
                rememberMedia(okr.qualities[qi].url, link);
              }
              out.push({
                id: "sl-" + idx,
                name: label,
                embedUrl: link,
                url: link,
                type: okr.type,
                quality: qh[0].label,
                qualities: qh,
                selectedQualityIndex: 0,
                headers: { "Referer": link, "User-Agent": FIREFOX_MOBILE }
              });
              idx++;
              continue;
            }
            // Honest fallback: resolve failed -> keep live embed, no fake direct.
            const okReason = "ok_resolve_failed";
            out.push({
              id: "ok-" + idx,
              name: label,
              embedUrl: link,
              url: link,
              type: "embed",
              quality: null,
              headers: { "Referer": link, "User-Agent": FIREFOX_MOBILE },
              reason: okReason
            });
            idx++;
            continue;
          } else {
            continue;
          }
        } catch (e) {}
        if (!durl) continue;
        // Final gate: HEAD-probe kills file-pages masquerading as mp4.
        // No budget left -> trust the pattern (previous behavior).
        if (budDec(bud)) {
          var okProbe = false;
          try {
            okProbe = await probeMedia(durl, link);
          } catch (e) {}
          if (!okProbe) continue;
        }
        rememberMedia(durl, link);
        out.push({
          id: "sl-" + idx,
          name: label,
          embedUrl: link,
          url: link,
          directUrl: durl,
          type: "mp4",
          quality: qualityOf(label),
          headers: { "Referer": link, "User-Agent": userAgent }
        });
        idx++;
      }
    } catch (e) {}
    return out;
  }

  return {
    requiresCloudflare: false,

    async getHomepageManga(args) {
      try {
        var page = (args && args.page) || 1;
        return await browsePage(page);
      } catch (e) {
        return [];
      }
    },

    async search(args) {
      try {
        var query = (args && args.query) || "";
        if (!query.trim()) return [];
        var page = (args && args.page) || 1;
        if (page <= 1) seenSearch = {};
        return await parseList(listUrl("filter", page, { anime_name: query }), page, seenSearch);
      } catch (e) {
        return [];
      }
    },

    async getMangaDetails(args) {
      var url = makeAbsolute((args && args.url) || "");
      var aid = animeIdFromUrl(url);
      if (!aid) throw new Error("Bad anime URL: " + url);
      var data = await apiGet("/anime/get-anime-details?anime_id=" + encodeURIComponent(aid) +
        "&fetch_episodes=Yes&more_info=Yes");
      var d = (data && data.response) || {};
      if (!d.anime_id) throw new Error("Anime not found: " + aid);
      var eps = await fetchEpisodes(aid);
      var chapters = [];
      var seen = {};
      for (var i = 0; i < eps.length; i++) {
        var ch = episodeToChapter(aid, eps[i]);
        if (!seen[ch.url]) {
          seen[ch.url] = true;
          chapters.push(ch);
        }
      }
      chapters.sort(function (a, b) {
        return (parseFloat(b.number) || 0) - (parseFloat(a.number) || 0);
      });
      var cover = d.anime_cover_image_full_url || d.anime_cover_image_url || "";
      return {
        title: cleanTitle(d.anime_name || "") || "غير معروف",
        coverUrl: makeAbsolute(cover),
        description: cleanTitle(d.anime_description || ""),
        genres: genresOf(d),
        status: cleanTitle(d.anime_status || ""),
        chapters: chapters,
        originalUrl: url,
        hasMoreChapters: false,
        lastFetchedPage: 1,
        contentType: "anime",
        animeType: cleanTitle(d.anime_type || "") || null,
        season: cleanTitle(d.anime_season || "") || null,
        year: cleanTitle(d.anime_release_year ? String(d.anime_release_year) : "") || null,
        episodeDurationMin: null,
        sourceMaterial: null,
        trailerUrl: makeAbsolute(d.anime_trailer_url || "") || null,
        malUrl: null
      };
    },

    async getChapterPages() {
      return [];
    },

    async getChapterContent(args) {
      try {
        var url = makeAbsolute((args && args.url) || "");
        var ref = parseEpisodeRef(url);
        if (ref) {
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
        var ref = parseEpisodeRef(url);
        if (!ref) return [];
        return await decodeEpisodeServers(ref.aid, ref.num, ref.eid);
      } catch (e) {
        return [];
      }
    },

    async resolveServer(args) {
      try {
        var serverUrl = makeAbsolute((args && (args.serverUrl || args.url)) || "");
        if (!serverUrl) return null;
        // Same allow-list as getEpisodeServers: drive/filemoon passthrough
        // or direct media only. Anything else -> null (no fake embeds).
        if (dropHost(serverUrl)) return null;
        var u = serverUrl.toLowerCase();
        var okHost = u.indexOf("drive.google") !== -1 || u.indexOf("filemoon") !== -1 ||
          u.indexOf("mediafire.com") !== -1 || u.indexOf("mixdrop") !== -1 ||
          u.indexOf("streamtape") !== -1 || u.indexOf("ok.ru") !== -1;
        if (!okHost) return null;
        return {
          url: serverUrl,
          type: "embed",
          headers: {
            "User-Agent": userAgent,
            "Referer": siteUrl + "/",
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
        // Real filters (verified live): exact-case type, status, season.
        // Genre has NO working key (verified identical sets) -> browse.
        // Year is ignored server-side. Each filter is one 25-item page;
        // page 2+ returns [] so scroll stops honestly.
        var page = (args && args.page) || 1;
        if (page > 1) return [];
        if (page <= 1) seenFilter = {};
        var q = { list_type: "filter", limit: LIST_LIMIT, offset: 0 };
        var type = cleanTitle((args && args.type) || "");
        var status = cleanTitle((args && args.status) || "");
        var season = cleanTitle((args && args.season) || "");
        if (type) {
          var tv = "";
          for (var ti = 0; ti < TYPE_OK.length; ti++) {
            if (type === TYPE_OK[ti]) {
              tv = type;
              break;
            }
          }
          if (!tv && TYPE_AR[type]) tv = TYPE_AR[type];
          if (tv) q.anime_type = tv;
        }
        if (status) {
          var sv = STATUS_AR[status] || "";
          if (!sv) {
            for (var si = 0; si < STATUS_OK.length; si++) {
              if (status === STATUS_OK[si]) {
                sv = status;
                break;
              }
            }
          }
          if (sv) q.anime_status = sv;
        }
        if (season) {
          var sn = SEASON_AR[season] || "";
          if (!sn) {
            for (var ni = 0; ni < SEASON_OK.length; ni++) {
              if (season === SEASON_OK[ni]) {
                sn = season;
                break;
              }
            }
          }
          if (sn) q.anime_season = sn;
        }
        var hasFilter = q.anime_type || q.anime_status || q.anime_season;
        if (!hasFilter) return await browsePage(page);
        return await parseList(listUrl("filter", 1, q), page, seenFilter);
      } catch (e) {
        return [];
      }
    },

    async getGenresAndTypes() {
      try {
        await loadGenreMap();
        var t = ["TV", "Movie", "ONA", "OVA", "Special", "Music"];
        return { genres: siteGenres(), types: t };
      } catch (e) {
        return { genres: siteGenres(), types: ["TV", "Movie", "ONA", "OVA", "Special", "Music"] };
      }
    },

    async fetchMoreChapters() {
      // Episode lists ship complete inside get-episodes-new.
      return null;
    },

    getImageHeaders() {
      return {
        "User-Agent": userAgent,
        "Referer": lastPageUrl || siteUrl + "/",
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
