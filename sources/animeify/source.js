function createSource(api, config) {
  // Animeify — clean-roomed from Animeify v3.2.0 APK (Xamarin, app DLL "AQ").
  // API: POST form to https://animeify.net/animeify/apis_v4/<path> with
  // UserId=0 (guest), Language, Token=8cnY80AZSbUCmR26Vku1VUUY4 (static,
  // from AQ.Constants). No login, no crypto, no per-endpoint headers.
  // Endpoints (UploadValuesAsync form POST, from CIL):
  // home/load_home.php {Broadcast,Premiered}
  // anime/load_anime_list_v2.php {FilterType,FilterData,Type,From}
  // anime/load_anime_list.php {FilterType,FilterData,Type=FINDMORE,From} (search)
  // anime/load_anime_details.php {AnimeId,AnimeRelationId}
  // episodes/load_episodes.php {AnimeID}
  // anime/load_servers.php {UserId,AnimeId,Episode,AnimeType}
  // NOTE: server ignores FilterType/FilterData/Type on v2 (verified live);
  // only Search (via v1 FINDMORE) filters server-side. Genre/type filters
  // below are honest client-side filters over catalog pages.
  var API = "https://animeify.net/animeify/apis_v4/";
  var THUMB = "https://animeify.net/animeify/files/thumbnails/";
  var TOKEN = "8cnY80AZSbUCmR26Vku1VUUY4";
  var UA = "okhttp/4.10.0";
  var MF_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/83.0.4103.97 Safari/537.36";
  var GDRIVE_KEY = "AIzaSyBzyqZekacyx5t_MGh_A-8-iz2tEeIzqwE";

  function sstr(v) { return String(v == null ? "" : v); }
  function safeList(v) { return Array.isArray(v) ? v : []; }
  function enc(s) { return encodeURIComponent(sstr(s)); }
  function decodeEnt(s) {
    s = sstr(s);
    s = s.split("&amp;").join("&").split("&quot;").join('"').split("&#39;").join("'").split("&lt;").join("<").split("&gt;").join(">");
    s = s.replace(/&#(\d+);/g, function (m, d) { return String.fromCharCode(parseInt(d, 10)); });
    return s.trim();
  }
  function absUrl(u) {
    u = sstr(u).replace(/&amp;/g, "&").trim();
    if (!u) return "";
    if (u.indexOf("//") === 0) return "https:" + u;
    if (u.indexOf("https://") === 0 || u.indexOf("http://") === 0) return u;
    if (u.charAt(0) === "/") return "https://animeify.net" + u;
    return THUMB + u;
  }
  function titleOf(a) {
    a = a || {};
    return decodeEnt(a.EN_Title || a.AR_Title || a.JP_Title || a.Synonyms || "");
  }
  function thumbOf(a) {
    a = a || {};
    return absUrl(a.Thumbnail || a.Poster || "");
  }

  function formEncode(fields) {
    var parts = [];
    for (var k in fields) {
      if (Object.prototype.hasOwnProperty.call(fields, k)) parts.push(enc(k) + "=" + enc(fields[k]));
    }
    return parts.join("&");
  }
  async function apiPost(path, fields) {
    var f = { UserId: "0", Language: "ar", Token: TOKEN };
    if (fields) for (var k in fields) {
      if (Object.prototype.hasOwnProperty.call(fields, k)) f[k] = fields[k];
    }
    var headers = { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" };
    if (!api.http) throw new Error("POST transport unavailable");
    var res = await api.http(API + path, { method: "POST", headers: headers, body: formEncode(f) });
    if (!res || !res.ok) throw new Error("HTTP " + (res ? res.status : 0) + " " + path);
    var txt = (res.body != null) ? String(res.body) : "";
    var i = txt.search(/[{[]/);
    if (i > 0) txt = txt.substring(i);
    return JSON.parse(txt || "null");
  }
  async function fetchText(url, headers) {
    if (api.fetchText) return await api.fetchText(url, headers || { "User-Agent": MF_UA });
    if (!api.http) throw new Error("no transport");
    var res = await api.http(url, { method: "GET", headers: headers || { "User-Agent": MF_UA } });
    if (!res || !res.ok) throw new Error("HTTP " + (res ? res.status : 0));
    return (res.body != null) ? String(res.body) : "";
  }

  // ── session caches (module state persists across invokes) ──
  var frCache = {}, frKeys = [];
  function frGet(k) { return Object.prototype.hasOwnProperty.call(frCache, k) ? frCache[k] : undefined; }
  function frSet(k, v) {
    if (!Object.prototype.hasOwnProperty.call(frCache, k)) {
      frKeys.push(k);
      if (frKeys.length > 30) { var old = frKeys.shift(); delete frCache[old]; }
    }
    frCache[k] = v;
  }
  // FrDownload (AQ.Helpers.CustomizedDownloader): mediafire page -> https://download... (regex + HtmlDecode)
  async function frExtract(pageUrl) {
    var hit = frGet(pageUrl);
    if (hit !== undefined) return hit;
    var direct = null;
    try {
      var html = await fetchText(pageUrl, { "User-Agent": MF_UA, "Accept": "text/html,*/*" });
      var m = String(html || "").match(/https:\/\/download[^\s"']+/);
      if (m) direct = decodeEnt(m[0]);
    } catch (e) { direct = null; }
    frSet(pageUrl, direct);
    return direct;
  }
  // SFDownload: solidfiles page -> "streamUrl":"http://...
  async function sfExtract(pageUrl) {
    var hit = frGet(pageUrl);
    if (hit !== undefined) return hit;
    var direct = null;
    try {
      var html = String(await fetchText(pageUrl, { "User-Agent": MF_UA, "Accept": "text/html,*/*" }) || "");
      var ix = html.indexOf('"streamUrl":"http:');
      if (ix !== -1) {
        var rest = html.substring(ix + 13);
        if (rest.charAt(0) === '"') rest = rest.substring(1);
        var q = rest.indexOf('"');
        if (q > 7) direct = rest.substring(0, q);
      }
    } catch (e) { direct = null; }
    frSet(pageUrl, direct);
    return direct;
  }

  function animeItem(a) {
    a = a || {};
    var aid = sstr(a.AnimeId || a.Id || "");
    if (!aid) return null;
    var title = titleOf(a);
    if (!title) return null;
    return {
      title: title,
      coverUrl: thumbOf(a),
      detailUrl: "animeify:anime:" + aid + ":" + sstr(a.RelationId || "") + ":" + enc(title) + ":" + enc(thumbOf(a)) + ":" + enc(sstr(a.Genres || "")) + ":" + enc(sstr(a.Status || "")) + ":" + enc(sstr(a.Aired || a.Premiered || "")),
      contentType: "anime"
    };
  }
  function parseDetailUrl(url) {
    var m = String(url || "").match(/^animeify:anime:([^:]+):([^:]*):([^:]*):([^:]*):([^:]*):([^:]*):([^:]*)$/);
    if (!m) return null;
    var title = "", thumb = "", genres = "", status = "", year = "";
    try { title = decodeURIComponent(m[3] || ""); } catch (e) {}
    try { thumb = decodeURIComponent(m[4] || ""); } catch (e) {}
    try { genres = decodeURIComponent(m[5] || ""); } catch (e) {}
    try { status = decodeURIComponent(m[6] || ""); } catch (e) {}
    try { year = decodeURIComponent(m[7] || ""); } catch (e) {}
    return { aid: m[1], rel: m[2], title: title, thumb: thumb, genres: genres, status: status, year: year };
  }
  function parseEpUrl(url) {
    var m = String(url || "").match(/^animeify:ep:([^:]+):([^:]+):([^:]*):([^:]*)$/);
    if (!m) return null;
    var title = "";
    try { title = decodeURIComponent(m[4] || ""); } catch (e) {}
    return { aid: m[1], epno: m[2], atype: m[3], title: title };
  }
  function epUrl(aid, epno, atype, title) {
    return "animeify:ep:" + aid + ":" + epno + ":" + enc(atype) + ":" + enc(title);
  }
  function isDirectMedia(u) {
    return /\.(mp4|m3u8)([?#]|$)/i.test(sstr(u));
  }
  function fhEmbed(host, id) {
    // host embed templates (from AQ.Sdks.*WebVideoView.setVideoId)
    if (host === "ok") return "https://ok.ru/videoembed/" + id;
    if (host === "ma") return "https://mega.nz/embed/" + String(id).split("!").join("#");
    if (host === "lb") return "https://filelions.online/v/" + id;
    if (host === "sv") return "https://sendvid.com/embed/" + id;
    if (host === "fd") return "https://vanfem.com/v/" + id;
    return "";
  }
  function pushSrv(out, seen, id, name, url, type, headers, qualityLabel) {
    if (!url) return;
    var key = String(url).toLowerCase();
    if (seen[key]) return;
    seen[key] = true;
    var h = headers || { "User-Agent": UA, "Referer": "https://animeify.net/" };
    var q = [{ label: qualityLabel || name || "Auto", url: url, isDefault: true, headers: h }];
    out.push({
      id: "af-" + id,
      name: name,
      embedUrl: url,
      url: url,
      directUrl: type === "mp4" ? url : url,
      type: type,
      quality: qualityLabel || name || "Auto",
      qualities: q,
      selectedQualityIndex: 0,
      headers: h
    });
  }
  function serversFromEpisode(ep) {
    // ep = load_servers CurrentEpisode (or load_episodes item): per-host link fields.
    var out = [], seen = {};
    ep = ep || {};
    function valid(v) { v = sstr(v).trim(); return v.length >= 3 ? v : ""; }
    var H = { "User-Agent": UA, "Referer": "https://animeify.net/" };
    // Google Drive: direct mp4 via drive API (PlayFromGD)
    var gd = valid(ep.GDLink);
    if (gd) pushSrv(out, seen, "gd", "Google Drive", "https://www.googleapis.com/drive/v3/files/" + enc(gd) + "?key=" + GDRIVE_KEY + "&alt=media", "mp4", H, "HD");
    // FileLions / SendVid / OK / Mega / VanFem embeds (+ LowQ/FhdQ qualities)
    var hosts = [
      ["lb", "FileLions", ep.LBLink, ep.LBLowQ, ep.LBFhdQ],
      ["sv", "SendVid", ep.SVLink, ep.SVLowQ, null],
      ["ok", "OK", ep.OKLink, null, null],
      ["ma", "Mega", ep.MALink, null, null],
      ["fd", "VanFem", ep.FDLink, null, null]
    ];
    for (var i = 0; i < hosts.length; i++) {
      var hk = hosts[i][0], hn = hosts[i][1];
      var base = valid(hosts[i][2]);
      if (!base) continue;
      var url = fhEmbed(hk, base);
      if (!url) continue;
      var key = url.toLowerCase();
      if (seen[key]) continue;
      seen[key] = true;
      var quals = [{ label: "HD", url: url, isDefault: true, headers: H }];
      var lq = valid(hosts[i][3]), fq = valid(hosts[i][4]);
      if (lq) quals.unshift({ label: "SD", url: fhEmbed(hk, lq), isDefault: false, headers: H });
      if (fq) quals.push({ label: "FHD", url: fhEmbed(hk, fq), isDefault: false, headers: H });
      out.push({
        id: "af-" + hk, name: hn, embedUrl: url, url: url, directUrl: url,
        type: "embed", quality: "HD", qualities: quals, selectedQualityIndex: lq ? 1 : 0, headers: H
      });
    }
    // MediaFire (FR + LowQ/FhdQ) and SolidFiles (SF): direct mp4 preferred, page fallback.
    // Resolved eagerly by caller (needs async); placeholders carry raw ids here.
    var fr = valid(ep.FRLink);
    if (fr) {
      var fquals = [];
      var flq = valid(ep.FRLowQ), ffq = valid(ep.FRFhdQ);
      if (flq) fquals.push({ label: "SD", mid: flq, url: "", isDefault: false, headers: H });
      fquals.push({ label: "HD", mid: fr, url: "", isDefault: true, headers: H });
      if (ffq) fquals.push({ label: "FHD", mid: ffq, url: "", isDefault: false, headers: H });
      out.push({ id: "af-fr", name: "MediaFire", embedUrl: "", url: "", directUrl: "", type: "embed", quality: "HD", qualities: fquals, selectedQualityIndex: flq ? 1 : 0, headers: H, _fr: true });
    }
    var sf = valid(ep.SFLink);
    if (sf) {
      out.push({ id: "af-sf", name: "SolidFiles", embedUrl: "", url: "", directUrl: "", type: "embed", quality: "HD", qualities: [{ label: "HD", mid: sf, url: "", isDefault: true, headers: H }], selectedQualityIndex: 0, headers: H, _sf: true });
    }
    return out;
  }
  async function resolveFrSf(servers) {
    // Eager extraction (app plays servers as-is): mediafire/solidfiles pages -> direct mp4.
    for (var i = 0; i < servers.length; i++) {
      var s = servers[i];
      if (s._fr) {
        var done = false;
        for (var q = 0; q < s.qualities.length; q++) {
          var mid = s.qualities[q].mid;
          if (!mid) continue;
          var page = "https://www.mediafire.com/file/" + mid;
          var direct = await frExtract(page);
          if (direct && isDirectMedia(direct)) {
            s.qualities[q].url = direct;
            if (s.qualities[q].isDefault) {
              s.url = direct; s.embedUrl = direct; s.directUrl = direct; s.type = "mp4"; done = true;
            }
          } else if (!s.qualities[q].url) {
            s.qualities[q].url = page;
          }
        }
        if (!done) {
          var best = null;
          for (var b = 0; b < s.qualities.length; b++) {
            if (s.qualities[b].isDefault) best = s.qualities[b].url;
          }
          s.url = best || s.qualities[0].url; s.embedUrl = s.url; s.directUrl = s.url;
        }
        delete s._fr;
        for (var c = 0; c < s.qualities.length; c++) delete s.qualities[c].mid;
      } else if (s._sf) {
        var smid = s.qualities[0].mid;
        var spage = "http://www.solidfiles.com/v/" + smid;
        var sdirect = await sfExtract(spage);
        if (sdirect && isDirectMedia(sdirect)) {
          s.qualities[0].url = sdirect;
          s.url = sdirect; s.embedUrl = sdirect; s.directUrl = sdirect; s.type = "mp4";
        } else {
          s.qualities[0].url = spage;
          s.url = spage; s.embedUrl = spage; s.directUrl = spage;
        }
        delete s._sf;
        delete s.qualities[0].mid;
      }
    }
    return servers;
  }

  var GENRES = ["أكشن", "مغامرات", "كوميديا", "دراما", "فانتازيا", "رومانسية", "خيال علمي", "رعب", "غموض", "نفسي", "رياضة", "مدرسي", "شريحة من الحياة", "موسيقى", "تاريخي", "حربي", "خارق للطبيعة", "إثارة", "Action", "Adventure", "Comedy", "Drama", "Fantasy", "Romance", "Sci-Fi", "Horror", "Mystery", "Sports", "School", "Slice of Life", "Music", "Supernatural", "Thriller"];
  function matchGenre(itemGenres, g) {
    var gl = sstr(g).toLowerCase();
    var ar2en = { "أكشن": "action", "مغامرات": "adventure", "كوميديا": "comedy", "دراما": "drama", "فانتازيا": "fantasy", "رومانسية": "romance", "خيال علمي": "sci-fi", "رعب": "horror", "غموض": "mystery", "نفسي": "psychological", "رياضة": "sports", "مدرسي": "school", "شريحة من الحياة": "slice of life", "موسيقى": "music", "تاريخي": "historical", "حربي": "military", "خارق للطبيعة": "supernatural", "إثارة": "thriller" };
    if (ar2en[gl]) gl = ar2en[gl];
    var ig = sstr(itemGenres).toLowerCase();
    return ig.indexOf(gl) !== -1;
  }

  return {
    async getHomepageManga(args) {
      try {
        var home = await apiPost("home/load_home.php", { Broadcast: "SATURDAY", Premiered: "CurrentSeason" });
        var out = [], seen = {};
        var leps = safeList(home && home.LatestEpisodes);
        for (var i = 0; i < leps.length; i++) {
          var it = animeItem(leps[i] && leps[i].Anime);
          if (!it || seen[it.detailUrl]) continue;
          seen[it.detailUrl] = true;
          out.push(it);
        }
        try {
          var cat = safeList(await apiPost("anime/load_anime_list_v2.php", { FilterType: "", FilterData: "", Type: "", From: "0" }));
          for (var j = 0; j < cat.length; j++) {
            var it2 = animeItem(cat[j]);
            if (!it2 || seen[it2.detailUrl]) continue;
            seen[it2.detailUrl] = true;
            out.push(it2);
          }
        } catch (e) {}
        return out;
      } catch (e) {
        return [];
      }
    },

    async search(args) {
      var q = sstr((args && (args.query || args.q)) || "").trim();
      if (!q) return [];
      try {
        var rows = safeList(await apiPost("anime/load_anime_list.php", { FilterType: "Search", FilterData: q, Type: "FINDMORE", From: "0" }));
        var out = [], seen = {};
        for (var i = 0; i < rows.length && out.length < 40; i++) {
          var it = animeItem(rows[i]);
          if (!it || seen[it.detailUrl]) continue;
          seen[it.detailUrl] = true;
          out.push(it);
        }
        return out;
      } catch (e) {
        return [];
      }
    },

    async getFilteredManga(args) {
      var g = sstr((args && (args.genre || args.type)) || "").trim();
      if (!g) return [];
      try {
        // Server ignores v2 filters (verified live) -> honest client-side
        // filtering over catalog pages by the model's Genres field.
        var out = [], seen = {};
        var froms = ["0", "20", "40"];
        for (var p = 0; p < froms.length && out.length < 60; p++) {
          var rows = safeList(await apiPost("anime/load_anime_list_v2.php", { FilterType: "", FilterData: "", Type: "", From: froms[p] }));
          if (!rows.length) break;
          for (var i = 0; i < rows.length; i++) {
            if (!matchGenre(rows[i].Genres, g)) continue;
            var it = animeItem(rows[i]);
            if (!it || seen[it.detailUrl]) continue;
            seen[it.detailUrl] = true;
            out.push(it);
            if (out.length >= 60) break;
          }
        }
        return out;
      } catch (e) {
        return [];
      }
    },

    async getMangaDetails(args) {
      var url = sstr((args && args.url) || "");
      var d = parseDetailUrl(url);
      if (!d) throw new Error("bad animeify url");
      var fallback = {
        title: d.title, coverUrl: d.thumb, description: "", genres: [],
        status: "", year: "", chapters: [], originalUrl: url,
        hasMoreChapters: false, lastFetchedPage: 1, contentType: "anime"
      };
      try {
        var det = await apiPost("anime/load_anime_details.php", { AnimeId: d.aid, AnimeRelationId: d.rel || "" });
        det = det || {};
        var eps = safeList(await apiPost("episodes/load_episodes.php", { AnimeID: d.aid }));
        var genres = [];
        var gs = sstr(d.genres).split(",");
        for (var gi = 0; gi < gs.length; gi++) {
          var g1 = decodeEnt(gs[gi]).trim();
          if (g1) genres.push(g1);
        }
        var flat = [];
        for (var i = 0; i < eps.length; i++) {
          var ep = eps[i] || {};
          var eno = parseFloat(ep.Episode || "0");
          if (!eno || eno < 0) eno = i + 1;
          flat.push({ eno: eno, raw: sstr(ep.Episode !== undefined ? ep.Episode : eno), title: "الحلقة " + ep.Episode });
        }
        flat.sort(function (a, b) { return b.eno - a.eno; });
        var chapters = [];
        for (var x = 0; x < flat.length; x++) {
          chapters.push({
            number: flat[x].eno,
            title: flat[x].title,
            views: 0,
            url: epUrl(d.aid, flat[x].raw, "", flat[x].title),
            isLocked: false,
            date: ""
          });
        }
        return {
          title: d.title,
          coverUrl: d.thumb,
            description: decodeEnt(det.Plot || ""),
            genres: genres,
            status: decodeEnt(d.status),
            year: sstr(d.year),
          chapters: chapters,
          originalUrl: url, hasMoreChapters: false, lastFetchedPage: 1, contentType: "anime"
        };
      } catch (e) {
        return fallback;
      }
    },

    async fetchMoreChapters(args) {
      return null;
    },

    async getChapterPages(args) {
      return [];
    },

    async getEpisodeServers(args) {
      var url = sstr((args && args.url) || "");
      var ep = parseEpUrl(url);
      if (!ep) return [];
      try {
        var j = await apiPost("anime/load_servers.php", { UserId: "0", AnimeId: ep.aid, Episode: ep.epno, AnimeType: ep.atype || "" });
        j = j || {};
        var cur = j.CurrentEpisode || null;
        if (!cur) return [];
        return await resolveFrSf(serversFromEpisode(cur));
      } catch (e) {
        return [];
      }
    },

    async getChapterContent(args) {
      var url = sstr((args && args.url) || "");
      var ep = parseEpUrl(url);
      if (!ep) return { kind: "video", servers: [] };
      try {
        var j = await apiPost("anime/load_servers.php", { UserId: "0", AnimeId: ep.aid, Episode: ep.epno, AnimeType: ep.atype || "" });
        j = j || {};
        var cur = j.CurrentEpisode || null;
        if (!cur) return { kind: "video", servers: [] };
        return { kind: "video", servers: await resolveFrSf(serversFromEpisode(cur)) };
      } catch (e) {
        return { kind: "video", servers: [] };
      }
    },

    async resolveServer(args) {
      var u = sstr((args && (args.serverUrl || args.url || args.directUrl)) || "").trim();
      if (!u) return null;
      return { url: u, directUrl: u };
    },

    async getGenresAndTypes() {
      return { genres: GENRES, types: ["anime"] };
    },

    getVideoHeaders(args) {
      return {
        "User-Agent": UA,
        "Referer": "https://animeify.net/",
        "Accept": "*/*",
        "Accept-Language": "ar,en-US;q=0.9,en;q=0.8"
      };
    },

    getImageHeaders(args) {
      return {
        "User-Agent": UA,
        "Referer": "https://animeify.net/",
        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "Accept-Language": "ar,en-US;q=0.9,en;q=0.8"
      };
    },

    sanitizeCoverUrl(args) {
      return absUrl((args && args.url) || "");
    }
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { createSource };
}
