function createSource(api, config) {
  var baseUrl = ((config && config.base_url) || "http://xgtimayfsa.com").replace(/\/+$/, "");
  var apiRoot = baseUrl + "/AnimeRoomXGetter/API/";
  var userAgent = (config && config.user_agent) || "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
  // Basic auth extracted from the official Go Anime v1.3 APK
  // (com.jobradhm.pro.goanime / utils.BasicAuthInterceptor):
  // user "animepicwasseemmmm", pass "M^@^3JuqYpYJX3/q<?Fd'Fk}&z]~Q".
  var AUTH = "Basic YW5pbWVwaWN3YXNzZWVtbW1tOk1eQF4zSnVxWXBZSlgzL3E8P0ZkJ0ZrfSZ6XX5R";
  var apiHeaders = {
    "User-Agent": "okhttp/4.9.3",
    "Accept": "application/json",
    "Content-Type": "application/json",
    "Authorization": AUTH
  };

  function abs(url) {
    url = String(url || "").replace(/&amp;/g, "&").trim();
    if (!url) return "";
    if (url.indexOf("//") === 0) return "https:" + url;
    if (url.indexOf("https://") === 0) return url;
    if (url.indexOf("http://") === 0) {
      if (url.indexOf("xgtimayfsa.com") !== -1) return url;
      return "https://" + url.substring(7);
    }
    return "";
  }

  function safeList(v) {
    return Array.isArray(v) ? v : [];
  }

  function cleanJson(txt) {
    txt = String(txt || "");
    var i = txt.search(/[{[]/);
    if (i > 0) txt = txt.substring(i);
    return JSON.parse(txt);
  }

  function decodeEnt(s) {
    s = String(s == null ? "" : s);
    s = s.split("&amp;").join("&").split("&quot;").join('"').split("&#39;").join("'").split("&lt;").join("<").split("&gt;").join(">");
    s = s.replace(/&#(\d+);/g, function (m, d) { return String.fromCharCode(parseInt(d, 10)); });
    return s.trim();
  }

  function normArabic(s) {
    return decodeEnt(s)
      .replace(/[ً-ٰٟـ]/g, "")
      .replace(/[أإآ]/g, "ا")
      .replace(/ة/g, "ه")
      .replace(/ى/g, "ي")
      .toLowerCase();
  }

  function formEncode(fields) {
    var parts = [];
    for (var k in fields) {
      if (!Object.prototype.hasOwnProperty.call(fields, k)) continue;
      parts.push(encodeURIComponent(k) + "=" + encodeURIComponent(String(fields[k])));
    }
    return parts.join("&");
  }

  async function apiGet(path) {
    var url = apiRoot + path;
    if (api.http) {
      var res = await api.http(url, { method: "GET", headers: apiHeaders });
      if (!res || !res.ok) throw new Error("HTTP " + (res ? res.status : 0) + " for " + path);
      return cleanJson(res.body || "null");
    }
    var txt = await api.fetchText(url, apiHeaders);
    return cleanJson(txt || "null");
  }

  async function apiPost(path, fields) {
    var url = apiRoot + path;
    var body = formEncode(fields || {});
    var headers = {
      "User-Agent": "okhttp/4.9.3",
      "Accept": "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization": AUTH
    };
    if (!api.http) throw new Error("POST transport unavailable");
    var res = await api.http(url, { method: "POST", headers: headers, body: body });
    if (!res || !res.ok) throw new Error("HTTP " + (res ? res.status : 0) + " for " + path);
    return cleanJson(res.body || "null");
  }

  function enc(s) {
    return encodeURIComponent(String(s == null ? "" : s));
  }

  function cartoonItem(c) {
    c = c || {};
    var title = decodeEnt(c.title);
    var thumb = abs(c.thumb);
    return {
      title: title,
      coverUrl: thumb,
      detailUrl: "goanime:cartoon:" + c.id + ":" + enc(title) + ":" + enc(thumb),
      contentType: "anime"
    };
  }

  function movieItem(m) {
    m = m || {};
    var title = decodeEnt(m.name);
    var thumb = abs(m.thumb);
    return {
      title: title,
      coverUrl: thumb,
      detailUrl: "goanime:movie:" + m.id + ":" + enc(title) + ":" + enc(thumb),
      contentType: "anime"
    };
  }

  function slotList(o) {
    return [o.video, o.video1, o.video2, o.video3, o.video4, o.video5].map(function (v) { return String(v || ""); });
  }

  function flagList(o) {
    return [o.xgetter, o.xgetter1, o.xgetter2, o.xgetter3, o.xgetter4, o.xgetter5].map(function (v) { return v === 1 || v === "1" ? 1 : 0; });
  }

  function epUrl(o, extra) {
    var payload = {
      i: o.id || 0,
      t: decodeEnt(o.title || ""),
      th: abs(o.thumb || ""),
      p: o.playlist_id || 0,
      v: slotList(o),
      x: flagList(o)
    };
    if (extra) {
      for (var k in extra) {
        if (!Object.prototype.hasOwnProperty.call(extra, k)) continue;
        if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
        payload[k] = extra[k];
      }
    }
    return "goanime:ep:" + enc(JSON.stringify(payload));
  }

  function parseEpUrl(url) {
    var m = String(url || "").match(/^goanime:ep:(.+)$/);
    if (!m) return null;
    try {
      return JSON.parse(decodeURIComponent(m[1]));
    } catch (e) {
      return null;
    }
  }

  function epNumber(title, fallback) {
    var m = String(title || "").match(/(\d+)/);
    if (m) return parseInt(m[1], 10);
    return fallback || 0;
  }

  function hostName(u) {
    var s = String(u || "").toLowerCase();
    if (s.indexOf("photos.google.com") !== -1) return "Google Photos";
    if (s.indexOf("lh3.googleusercontent.com") !== -1 || s.indexOf("video-downloads.googleusercontent.com") !== -1) return "Google";
    if (s.indexOf("bittube") !== -1) return "BitTube";
    if (s.indexOf("uptostream") !== -1 || s.indexOf("uptobox") !== -1) return "UptoStream";
    if (s.indexOf("mp4upload") !== -1) return "Mp4Upload";
    if (s.indexOf("fembed") !== -1 || s.indexOf("vcdn") !== -1) return "FEmbed";
    if (s.indexOf("dailymotion") !== -1) return "Dailymotion";
    if (s.indexOf("facebook") !== -1 || s.indexOf("fbcdn") !== -1) return "Facebook";
    if (s.indexOf("ok.ru") !== -1) return "OK";
    if (s.indexOf("vk.com") !== -1 || s.indexOf("vk.") !== -1) return "VK";
    if (s.indexOf("twitter") !== -1) return "Twitter";
    if (s.indexOf("mediafire") !== -1) return "MediaFire";
    if (s.indexOf("solidfiles") !== -1) return "SolidFiles";
    if (s.indexOf("vidoza") !== -1) return "Vidoza";
    if (s.indexOf("fansubs") !== -1) return "FanSubs";
    if (s.indexOf("streamtape") !== -1) return "StreamTape";
    if (s.indexOf("sendvid") !== -1) return "SendVid";
    if (s.indexOf("filerio") !== -1 || s.indexOf("filerio") !== -1) return "FileRIO";
    return "";
  }

  function needsExtract(u) {
    var s = String(u || "").toLowerCase();
    if (s.indexOf("photos.google.com/share") !== -1) return true;
    if (s.indexOf("uptostream.com/iframe") !== -1 || s.indexOf("uptostream.com/") !== -1) return true;
    if (s.indexOf("mp4upload.com/embed-") !== -1) return true;
    if (s.indexOf("fembed.com") !== -1) return true;
    if (s.indexOf("dailymotion.com/embed") !== -1) return true;
    if (s.indexOf("facebook.com/video.php") !== -1) return true;
    return false;
  }

  function serversFromPayload(ep) {
    var out = [];
    var seen = {};
    var v = Array.isArray(ep.v) ? ep.v : [];
    for (var i = 0; i < v.length; i++) {
      var u = abs(v[i]);
      if (!u) continue;
      var key = u.toLowerCase();
      if (seen[key]) continue;
      seen[key] = true;
      var hn = hostName(u) || ("سيرفر " + (out.length + 1));
      var h = { "User-Agent": userAgent, "Referer": baseUrl + "/" };
      out.push({
        id: "go-" + (ep.i || 0) + "-" + out.length,
        name: hn,
        embedUrl: u,
        url: u,
        directUrl: needsExtract(u) ? "" : u,
        type: needsExtract(u) ? "embed" : "mp4",
        quality: "Auto",
        qualities: [],
        selectedQualityIndex: 0,
        headers: h,
        _slot: u
      });
    }
    return out;
  }

  // Eager extraction: the app never calls resolveServer in its watch flow —
  // it plays getChapterContent servers as-is (type mp4/m3u8 => in-app player,
  // else its own extractor which does NOT know Google Photos). So photos
  // share links must be resolved here into direct mp4 servers.
  async function serversForEpisode(ep) {
    var base = serversFromPayload(ep);
    var out = [];
    for (var i = 0; i < base.length; i++) {
      var s = base[i];
      if (!needsExtract(s._slot)) {
        var h0 = s.headers;
        var du = mediaUrl(s.directUrl);
        s.directUrl = du;
        s.qualities = [{ label: "Auto", url: du, isDefault: true, headers: h0 }];
        delete s._slot;
        out.push(s);
        continue;
      }
      var key = s._slot.toLowerCase();
      var quals = gqGet(key);
      if (quals === undefined) {
        quals = null;
        if (key.indexOf("photos.google.com/share") !== -1) {
          for (var att = 0; att < 3 && !quals; att++) {
            try {
              var html = await fetchText(s._slot, { "User-Agent": userAgent, "Accept": "text/html,*/*" });
              var q = gphotosExtract(html);
              if (q && q.length) quals = q;
            } catch (e) { /* retry */ }
          }
        }
        gqSet(key, quals);
      }
      if (quals && quals.length) {
        s.directUrl = quals[0].url;
        s.type = "mp4";
        s.quality = quals[0].label;
        s.qualities = quals;
        s.selectedQualityIndex = 0;
      }
      delete s._slot;
      out.push(s);
    }
    return out;
  }

  // Session cache: share URL -> extracted qualities. Module state persists
  // across invokes (same pattern as catalog caches), so reopening an
  // episode / preloading next / switching servers never re-fetches 1MB+.
  var gqCache = {};
  var gqKeys = [];
  function gqGet(k) {
    return Object.prototype.hasOwnProperty.call(gqCache, k) ? gqCache[k] : undefined;
  }
  function gqSet(k, v) {
    if (!Object.prototype.hasOwnProperty.call(gqCache, k)) {
      gqKeys.push(k);
      if (gqKeys.length > 30) {
        var old = gqKeys.shift();
        delete gqCache[old];
      }
    }
    gqCache[k] = v;
  }

  // Google video URLs are extensionless opaque IDs. The app's verifier,
  // extractor and WebView gate ALL key off a literal .mp4/.m3u8 in the URL
  // string (kDirectMediaExt, step-1 endsWith check, isHtmlEmbed). A "#.mp4"
  // fragment flips every one of those to the direct-media path while never
  // reaching the wire (fragments are stripped by HTTP clients).
  function mediaUrl(u) {
    u = String(u || "");
    if (!u) return u;
    var s = u.toLowerCase();
    var isGoogle = s.indexOf("googleusercontent.com") !== -1 || s.indexOf("photos.google.com") !== -1;
    if (!isGoogle) return u;
    if (/\.(mp4|m3u8|mpd)(\?|#|$)/.test(s)) return u;
    return u + "#.mp4";
  }

  // Google Photos share-page extraction (mirrors GPhotosUtils from the APK):
  // cleanString -> "Original" (video-downloads) else best itag (37>22>18>36).
  function gphotosExtract(html) {
    var clean = String(html || "").replace(/%(?![0-9a-fA-F]{2})/g, "%25");
    try {
      clean = decodeURIComponent(clean);
    } catch (e) { /* keep raw */ }
    // No Referer on google video hosts (official-app-like: bare player fetch).
    var h = {};
    var quals = [];
    var om = clean.match(/https:\/\/video-downloads(.*?)"/s);
    if (om) quals.push({ label: "Original", url: mediaUrl(om[0].replace(/"$/, "")), isDefault: false, headers: h });
    var labels = { "37": "1080p", "22": "720p", "18": "360p", "36": "180p" };
    var order = ["37", "22", "18", "36"];
    var seen = {};
    var re = /https:\/\/(.*?)=m(22|18|37|36)/g;
    var m;
    while ((m = re.exec(clean))) {
      var itag = m[2];
      if (seen[itag]) continue;
      seen[itag] = true;
      quals.push({ label: labels[itag], url: mediaUrl(m[0]), isDefault: false, headers: h });
    }
    quals.sort(function (a, b) {
      var rank = function (l) {
        if (l === "Original") return 0;
        var idx = -1;
        for (var i = 0; i < order.length; i++) {
          if (labels[order[i]] === l) idx = i;
        }
        return idx === -1 ? 99 : idx + 1;
      };
      return rank(a.label) - rank(b.label);
    });
    if (!quals.length) return null;
    quals[0].isDefault = true;
    return quals;
  }

  async function fetchText(url, headers) {
    if (api.http) {
      var res = await api.http(url, { method: "GET", headers: headers });
      if (!res || !res.ok) throw new Error("HTTP " + (res ? res.status : 0));
      return res.body || "";
    }
    return await api.fetchText(url, headers);
  }

  async function resolveDirect(u) {
    u = abs(u);
    if (!u) return null;
    if (needsExtract(u)) {
      if (u.toLowerCase().indexOf("photos.google.com/share") !== -1) {
        var quals = null;
        for (var att = 0; att < 3 && !quals; att++) {
          try {
            var html = await fetchText(u, { "User-Agent": userAgent, "Accept": "text/html,*/*" });
            var q = gphotosExtract(html);
            if (q && q.length) quals = q;
          } catch (e) { /* retry */ }
        }
        if (!quals || !quals.length) return null;
        var best = quals[0];
        return {
          url: best.url,
          directUrl: best.url,
          type: "mp4",
          quality: best.label,
          qualities: quals,
          selectedQualityIndex: 0,
          headers: { "User-Agent": userAgent, "Referer": "https://photos.google.com/" }
        };
      }
      return null;
    }
    var h = { "User-Agent": userAgent, "Referer": baseUrl + "/" };
    var du = mediaUrl(u);
    return {
      url: du,
      directUrl: du,
      type: "mp4",
      quality: "Auto",
      qualities: [{ label: "Auto", url: du, isDefault: true, headers: h }],
      selectedQualityIndex: 0,
      headers: h
    };
  }

  async function cartoonChapters(cartoonId) {
    var pls = [];
    try {
      pls = safeList(await apiPost("playlist/read.php", { cartoon_id: cartoonId }));
    } catch (e) {
      pls = [];
    }
    var chapters = [];
    var seenIds = {};
    var multi = pls.length > 1;
    for (var pi = 0; pi < pls.length; pi++) {
      var pl = pls[pi] || {};
      var plId = pl.id;
      if (!plId) continue;
      var plTitle = decodeEnt(pl.title);
      // NOTE: episode/readPaging.php ignores `page` (p1==p2==p3) — one fetch
      // per playlist returns everything; looping pages duplicates episodes.
      var eps = [];
      try {
        eps = safeList(await apiPost("episode/readPaging.php", { playlist_id: plId, page: 1 }));
      } catch (e) {
        eps = [];
      }
      for (var i = 0; i < eps.length; i++) {
        var e = eps[i] || {};
        var eid = parseInt(e.id, 10) || 0;
        if (eid && seenIds[eid]) continue;
        if (eid) seenIds[eid] = true;
        var t = decodeEnt(e.title) || ("الحلقة " + (e.id || ""));
        chapters.push({
          number: epNumber(t, eid),
          title: multi && plTitle ? (plTitle + " - " + t) : t,
          views: 0,
          url: epUrl(e),
          isLocked: false,
          date: "",
          thumbnailUrl: abs(e.thumb),
          durationSeconds: 0,
          servers: []
        });
      }
    }
    chapters.sort(function (a, b) { return b.number - a.number; });
    return chapters;
  }

  return {
    requiresCloudflare: false,

    async getHomepageManga(args) {
      var page = parseInt((args && args.page) || 1, 10);
      if (!page || page < 1) page = 1;
      try {
        var list = safeList(await apiGet("cartoon/readPaging.php?page=" + page));
        return list.map(cartoonItem);
      } catch (e) {
        return [];
      }
    },

    async search(args) {
      var q = normArabic(((args && (args.query || args.q)) || "").trim());
      if (!q) return [];
      try {
        var both = await Promise.all([
          apiGet("cartoon/search.php?search=").catch(function () { return []; }),
          apiGet("movie/search.php?search=").catch(function () { return []; })
        ]);
        var out = [];
        var cs = safeList(both[0]);
        for (var i = 0; i < cs.length && out.length < 30; i++) {
          if (normArabic(cs[i].title).indexOf(q) !== -1) out.push(cartoonItem(cs[i]));
        }
        var ms = safeList(both[1]);
        for (var j = 0; j < ms.length && out.length < 30; j++) {
          if (normArabic(ms[j].name).indexOf(q) !== -1) out.push(movieItem(ms[j]));
        }
        return out;
      } catch (e) {
        return [];
      }
    },

    async getFilteredManga(args) {
      var g = String((args && (args.genre || args.type)) || "").trim();
      var page = parseInt((args && args.page) || 1, 10);
      if (!page || page < 1) page = 1;
      if (!g) return [];
      try {
        if (g === "أفلام") {
          return safeList(await apiGet("movie/readPaging.php?page=" + page)).map(movieItem);
        }
        if (g === "الأحدث") {
          return safeList(await apiGet("cartoon/readPagingByType.php?type=8&page=" + page)).map(cartoonItem);
        }
        return safeList(await apiGet("cartoon/readPaging.php?page=" + page)).map(cartoonItem);
      } catch (e) {
        return [];
      }
    },

    async getMangaDetails(args) {
      var url = String((args && args.url) || "");
      var m = url.match(/^goanime:(cartoon|movie):(\d+):([^:]*):([^:]*)$/);
      if (!m) throw new Error("bad goanime url");
      var kind = m[1];
      var id = parseInt(m[2], 10);
      var title = "";
      var thumb = "";
      try {
        title = decodeURIComponent(m[3] || "");
        thumb = decodeURIComponent(m[4] || "");
      } catch (e) {
        title = "";
        thumb = "";
      }
      try {
      if (kind === "movie") {
        var found = null;
        try {
          var all = safeList(await apiGet("movie/search.php?search="));
          for (var i = 0; i < all.length; i++) {
            if (parseInt(all[i].id, 10) === id) { found = all[i]; break; }
          }
        } catch (e) {
          found = null;
        }
        var mv = found || { id: id, name: title, thumb: thumb };
        var genres = [];
        if (mv.category && String(mv.category).trim()) genres.push(decodeEnt(mv.category));
        var ch = [{
          number: 1,
          title: "الفيلم",
          views: 0,
          url: epUrl(mv, { t: "الفيلم" }),
          isLocked: false,
          date: "",
          thumbnailUrl: abs(mv.thumb),
          durationSeconds: 0,
          servers: []
        }];
        return {
          title: decodeEnt(mv.name) || title,
          coverUrl: abs(mv.thumb) || thumb,
          description: decodeEnt(mv.story),
          genres: genres,
          status: String(mv.status || ""),
          year: String(mv.view_date || ""),
          chapters: ch,
          originalUrl: url,
          hasMoreChapters: false,
          lastFetchedPage: 1,
          contentType: "anime"
        };
      }
      var info = {};
      try {
        info = (await apiPost("information/readOne.php", { cartoon_id: id })) || {};
      } catch (e) {
        info = {};
      }
      if (Array.isArray(info)) info = {};
      var genres = [];
      if (info.category && String(info.category).trim()) genres.push(decodeEnt(info.category));
      var chapters = await cartoonChapters(id);
      return {
        title: title,
        coverUrl: thumb,
        description: decodeEnt(info.story),
        genres: genres,
        status: String(info.status || ""),
        year: String(info.view_date || ""),
        chapters: chapters,
        originalUrl: url,
        hasMoreChapters: false,
        lastFetchedPage: 1,
        contentType: "anime"
      };
      } catch (e) {
        return {
          title: title,
          coverUrl: thumb,
          description: "",
          genres: [],
          status: "",
          year: "",
          chapters: [],
          originalUrl: url,
          hasMoreChapters: false,
          lastFetchedPage: 1,
          contentType: "anime"
        };
      }
    },

    async fetchMoreChapters(args) {
      return null;
    },

    async getChapterPages(args) {
      return [];
    },

    async getEpisodeServers(args) {
      var url = String((args && args.url) || "");
      var ep = parseEpUrl(url);
      if (!ep) return [];
      try {
        return await serversForEpisode(ep);
      } catch (e) {
        return [];
      }
    },

    async getChapterContent(args) {
      var url = String((args && args.url) || "");
      var ep = parseEpUrl(url);
      if (!ep) return { kind: "video", servers: [] };
      try {
        return { kind: "video", servers: await serversForEpisode(ep) };
      } catch (e) {
        return { kind: "video", servers: [] };
      }
    },

    async resolveServer(args) {
      var u = abs((args && (args.serverUrl || args.url || args.directUrl)) || "");
      if (!u) return null;
      try {
        return await resolveDirect(u);
      } catch (e) {
        return null;
      }
    },

    async getGenresAndTypes() {
      return { genres: ["مسلسلات", "الأحدث", "أفلام"], types: ["anime"] };
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
