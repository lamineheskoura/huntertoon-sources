function createSource(api, config) {
  var baseUrl = ((config && config.base_url) || "https://det.animerco.org").replace(/\/+$/, "");
  var configHeaders = (config && config.headers) || {};
  // NOTE: site sits behind a Cloudflare UA gate (curl/python/empty UA = 403
  // "Attention Required" on EVERY path; full Chrome UA = 200). Never send a
  // bot UA from this source.
  var userAgent =
    configHeaders["User-Agent"] ||
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";
  var lastPageUrl = baseUrl + "/";

  var defaultHeaders = {
    "User-Agent": userAgent,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "ar,en-US;q=0.9,en;q=0.8",
    "Referer": baseUrl + "/",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "same-origin"
  };

  var ajaxHeaders = {
    "User-Agent": userAgent,
    "Accept": "application/json, text/javascript, */*; q=0.01",
    "Accept-Language": "ar,en-US;q=0.9,en;q=0.8",
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    "X-Requested-With": "XMLHttpRequest"
  };

  // Verified live genre slugs (/genre/{slug}/). Full taxonomy = 53 slugs;
  // these 24 are the high-coverage core.
  var defaultGenres = [
    "action", "adventure", "comedy", "drama", "fantasy", "romance",
    "horror", "mystery", "psychological", "sports", "school", "supernatural",
    "magic", "mecha", "shounen", "shoujo", "seinen", "slice-of-life",
    "demons", "military", "historical", "thriller", "isekai", "martial-arts"
  ];
  var defaultTypes = ["TV", "Movie"];

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

  async function fetchHtml(url, extraHeaders, method, body) {
    // Only first-party pages feed getImageHeaders(); embed/CDN fetches
    // must not pollute the image Referer.
    if (url && String(url).indexOf(baseUrl) === 0) lastPageUrl = url;
    var headers = mergeHeaders(defaultHeaders, extraHeaders);
    if (api.http) {
      var res = await api.http(url, { method: method || "GET", headers: headers, body: body });
      if (!res || !res.ok) throw new Error("HTTP " + (res ? res.status : 0) + " for " + url);
      return res.body || "";
    }
    if ((method && method !== "GET") || body) return "";
    var html = await api.fetchText(url, headers);
    if (!html) throw new Error("Empty response: " + url);
    return html;
  }

  async function postAjax(params) {
    var body = "action=player_ajax" +
      "&security=" + encodeURIComponent(params.security || "") +
      "&post=" + encodeURIComponent(params.post || "") +
      "&nume=" + encodeURIComponent(params.nume || "") +
      "&type=" + encodeURIComponent(params.stype || "tv");
    var headers = mergeHeaders(ajaxHeaders, { "Referer": params.referer || baseUrl + "/" });
    if (api.http) {
      var res = await api.http(baseUrl + "/wp-admin/admin-ajax.php", { method: "POST", headers: headers, body: body });
      if (!res || !res.ok) throw new Error("HTTP " + (res ? res.status : 0) + " for player_ajax");
      try {
        return JSON.parse(res.body || "{}");
      } catch (e) {
        throw new Error("Bad player_ajax JSON");
      }
    }
    throw new Error("POST unsupported by runtime");
  }

  function cleanTitle(s) {
    return String(s || "").replace(/\s+/g, " ").trim();
  }

  function stripTags(s) {
    return cleanTitle(String(s || "").replace(/<[^>]*>/g, " "));
  }

  function unescapeHtml(s) {
    var out = String(s || "").replace(/&#(\d+);/g, function (mm, code) {
      try {
        return String.fromCharCode(parseInt(code, 10));
      } catch (e) {
        return mm;
      }
    });
    return out
      .replace(/&quot;/g, "\"")
      .replace(/&#39;/g, "'")
      .replace(/&#x27;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&");
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
    if (u.indexOf(".mkv") !== -1) return u;
    return u + "#.mp4";
  }

  function parseEpisodeNumber(url, label) {
    var m = String(url || "").match(/-(\d+)(?:-والاخيرة)?\/?(?:[?#]|$)/);
    if (m) return m[1];
    var m2 = String(label || "").match(/(\d+)/);
    if (m2) return m2[1];
    return "0";
  }

  function slugId(name, fallback) {
    var s = String(name || fallback || "animerco").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return s || "animerco";
  }

  // ---- card parser (lists / genre / search share .anime-card markup) ----
  // Covers live on <a class="image lazyactive" data-src="..."> (NO <img>).

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
    var anchors = [];
    try {
      anchors = await api.cssAll(html, "a.image.lazyactive") || [];
    } catch (e) {}
    if (anchors.length) {
      for (var i = 0; i < anchors.length; i++) {
        var item = anchors[i] || {};
        var attrs = item.attrs || {};
        var href = attrs.href || "";
        if (!href) continue;
        if (href.indexOf("/animes/") === -1 && href.indexOf("/movies/") === -1 && href.indexOf("/seasons/") === -1) continue;
        var detailUrl = makeAbsolute(href);
        var title = cleanTitle(attrs.title || "");
        if (!title) {
          try {
            title = cleanTitle(await api.cssText(item.html || "", "h3")) || "";
          } catch (e2) {}
        }
        var cover = makeAbsolute(attrs["data-src"] || attrs.src || "");
        pushCard(title, cover, detailUrl);
        if (out.length > 300) return out;
      }
      if (out.length) return out;
    }
    // Regex fallback over the same lazyactive anchors.
    var re = /<a[^>]+href=(["'])([^"']+)\1[^>]*class=(["'])[^"']*image lazyactive[^"']*\3[^>]*>/g, m;
    while ((m = re.exec(html)) !== null) {
      var tag = m[0];
      var href2 = m[2] || "";
      if (!href2) continue;
      if (href2.indexOf("/animes/") === -1 && href2.indexOf("/movies/") === -1 && href2.indexOf("/seasons/") === -1) continue;
      var tm = tag.match(/title=(["'])([^"']*)\1/);
      var dm = tag.match(/data-src=(["'])([^"']*)\1/);
      var sm = tag.match(/\ssrc=(["'])([^"']*)\1/);
      pushCard(tm ? tm[2] : "", makeAbsolute(dm ? dm[2] : (sm ? sm[2] : "")), makeAbsolute(href2));
      if (out.length > 300) break;
    }
    return out;
  }

  function metaContent(html, prop) {
    var re = new RegExp("<meta[^>]+property=[\"']" + prop + "[\"'][^>]*>", "i");
    var m = String(html || "").match(re);
    if (!m) return "";
    var c = m[0].match(/content="([^"]*)"/) || m[0].match(/content='([^']*)'/);
    return c ? c[1] : "";
  }

  function parseGenres(html) {
    var genres = [];
    var re = /<a[^>]+href=(["'])[^"']*\/genre\/([a-z0-9\-]+)\/\1[^>]*>([\s\S]*?)<\/a>/g, m;
    while ((m = re.exec(String(html || ""))) !== null) {
      var g = unescapeHtml(cleanTitle(m[3]));
      if (g && genres.indexOf(g) === -1) genres.push(g);
      if (genres.length > 30) break;
    }
    return genres;
  }

  function parseMediaInfo(html, label) {
    var re = new RegExp(label + "[^<]*<[^>]*>([^<]*)<", "i");
    var m = String(html || "").match(re);
    return m ? unescapeHtml(cleanTitle(m[1])) : "";
  }

  // ---- episodes (season pages: ul.episodes-lists li[data-number]) ----

  function parseEpisodes(html) {
    var out = [];
    var seen = {};
    var re = /<li[^>]+data-number=['"](\d+)['"][^>]*>([\s\S]*?)<\/li>/g, m;
    while ((m = re.exec(String(html || ""))) !== null) {
      var num = m[1];
      var inner = m[2] || "";
      var um = inner.match(/href=(["'])([^"']*\/episodes\/[^"']*)\1/);
      if (!um) continue;
      var epUrl = makeAbsolute(um[2]);
      if (!epUrl || seen[epUrl]) continue;
      seen[epUrl] = true;
      out.push({
        number: String(num),
        title: "الحلقة " + num,
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
    return out;
  }

  function parseSeasons(html) {
    var out = [];
    var seen = {};
    var re = /<a[^>]+href=(["'])([^"']*\/seasons\/[^"']*)\1[^>]*>/g, m;
    while ((m = re.exec(String(html || ""))) !== null) {
      var u = makeAbsolute(m[2]);
      if (!u || seen[u]) continue;
      seen[u] = true;
      out.push(u);
      if (out.length > 12) break;
    }
    return out;
  }

  async function parseAnimeDetails(html, url) {
    html = String(html || "");
    var title = "";
    try {
      title = unescapeHtml(cleanTitle(await api.cssText(html, "h1"))) || "";
    } catch (e) {}
    if (!title) {
      var tm = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
      if (tm) title = unescapeHtml(stripTags(tm[1]));
    }
    if (!title) title = unescapeHtml(cleanTitle(metaContent(html, "og:title")));
    var cover = makeAbsolute(metaContent(html, "og:image"));
    if (!cover) {
      try {
        cover = makeAbsolute(await api.cssAttr(html, ".anime-card .image", "data-src") || "");
      } catch (e2) {}
    }
    var description = unescapeHtml(cleanTitle(metaContent(html, "og:description")));
    if (!description) {
      var dm = html.match(/<div[^>]+class=(["'])[^"']*media-story[^"']*\1[^>]*>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/i);
      if (dm) description = unescapeHtml(stripTags(dm[2]));
    }
    var genres = parseGenres(html);
    var animeType = parseMediaInfo(html, "النوع:") || (url.indexOf("/movies/") !== -1 ? "Movie" : "TV");
    var year = "";
    var ym = html.match(/\/release\/((?:19|20)\d{2})\//);
    if (ym) year = ym[1];
    else {
      var ym2 = html.match(/(?:بداية العرض|aired)[\s\S]{0,60}?((?:19|20)\d{2})/i);
      if (ym2) year = ym2[1];
    }
    var status = "";
    if (html.indexOf("يعرض الأن") !== -1) status = "مستمر";
    else if (html.indexOf("مكتمل") !== -1) status = "مكتمل";

    var episodes = [];
    if (url.indexOf("/movies/") !== -1) {
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
    } else if (url.indexOf("/seasons/") !== -1) {
      episodes = parseEpisodes(html);
    } else {
      // /animes/ hub: no episodes inline — follow season page(s).
      var seasons = parseSeasons(html);
      for (var s = 0; s < seasons.length && s < 6; s++) {
        try {
          var sh = await fetchHtml(seasons[s]);
          var seps = parseEpisodes(sh);
          for (var e = 0; e < seps.length; e++) {
            var dup = false;
            for (var d = 0; d < episodes.length; d++) {
              if (episodes[d].url === seps[e].url) { dup = true; break; }
            }
            if (!dup) episodes.push(seps[e]);
            if (episodes.length > 3000) break;
          }
        } catch (e2) {}
        if (episodes.length) break;
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
      animeType: animeType || null,
      season: null,
      year: year || null,
      episodeDurationMin: null,
      sourceMaterial: null,
      trailerUrl: null,
      malUrl: null
    };
  }

  // ---- episode servers (player_ajax -> jwplayer -> host extractors) ----
  // Watch pages carry NO media inline: ul.server-list a.option
  // [data-post][data-nume][data-type] + label span.server.
  // Chain: POST admin-ajax.php {action:player_ajax,security,post,nume,type}
  // -> {embed_url: /jwplayer/?pnonce&exp&sig} -> <iframe src=REAL-EMBED>
  // -> host extractors (videas/mp4upload/yourupload/vidmoly) or honest
  // embed passthrough. Tokens are short-lived: resolved fresh, never stored.

  var DEEP_HOSTS = ["videas", "mp4upload", "yourupload", "vidmoly"];

  function serverOptionsFromPage(html) {
    var out = [];
    var re = /<a[^>]+class=(["'])[^"']*\boption\b[^"']*\1[^>]*>([\s\S]*?)<\/a>/g, m;
    while ((m = re.exec(String(html || ""))) !== null) {
      var tag = m[0];
      var inner = m[2] || "";
      function attr(nm) {
        var am = tag.match(new RegExp(nm + "=['\"]([^'\"]*)['\"]"));
        return am ? am[1] : "";
      }
      var post = attr("data-post");
      var nume = attr("data-nume");
      var stype = attr("data-type") || "tv";
      if (!post || !nume) continue;
      var label = "";
      var lm = inner.match(/<span[^>]+class=(["'])[^"']*server[^"']*\1[^>]*>([\s\S]*?)<\/span>/i);
      if (lm) label = unescapeHtml(stripTags(lm[2]));
      if (!label) label = "server-" + nume;
      out.push({ post: post, nume: nume, stype: stype, label: cleanTitle(label) });
      if (out.length > 20) break;
    }
    return out;
  }

  function securityNonce(html) {
    var m = String(html || "").match(/"security"\s*:\s*"([a-f0-9]+)"/i);
    if (m) return m[1];
    var m2 = String(html || "").match(/data-nonce=['"]([a-f0-9]+)['"]/i);
    if (m2) return m2[1];
    return "";
  }

  function jwplayerLinks(html) {
    var out = [];
    var re = /\/jwplayer\/\?[^"'\s<>]+/g, m;
    while ((m = re.exec(String(html || ""))) !== null) {
      out.push(unescapeHtml(m[0]).replace(/&amp;/g, "&"));
    }
    return out;
  }

  function iframeSrc(html) {
    var m = String(html || "").match(/<iframe[^>]+src=(["'])([^"']+)\1/i);
    if (m) return unescapeHtml(m[2]).replace(/\\\//g, "/");
    return "";
  }

  function hostOf(url) {
    var m = String(url || "").toLowerCase().match(/^https?:\/\/([^\/:]+)/);
    return m ? m[1] : "";
  }

  function needsDeep(label, embedUrl) {
    var h = hostOf(embedUrl);
    var l = String(label || "").toLowerCase();
    for (var i = 0; i < DEEP_HOSTS.length; i++) {
      if (h.indexOf(DEEP_HOSTS[i]) !== -1 || l === DEEP_HOSTS[i]) return true;
    }
    return false;
  }

  function extractDirect(embedUrl, embedHtml) {
    var h = String(embedHtml || "");
    var u = String(embedUrl || "");
    // videas: embed JSON .medias[0].src (tokenless HLS master).
    if (u.indexOf("videas") !== -1) {
      var vm = h.match(/"src"\s*:\s*"([^"]*?\.m3u8[^"]*)"/i);
      if (vm) return { url: vm[1].replace(/\\\//g, "/"), stream: "m3u8" };
      var vs = h.match(/'src'\s*:\s*'([^']*?\.m3u8[^']*)'/i);
      if (vs) return { url: vs[1].replace(/\\\//g, "/"), stream: "m3u8" };
      var vm2 = h.match(/(https?:\/\/cdn\.videas\.fr\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/i);
      if (vm2) return { url: vm2[1].replace(/\\\//g, "/"), stream: "m3u8" };
      var vm3 = h.match(/<source[^>]+src=(["'])(https?[^"']+)\1/i);
      if (vm3) return { url: vm3[2].replace(/\\\//g, "/"), stream: "m3u8" };
      return null;
    }
    // mp4upload: player.src({..., src: "https://...mp4"}), Referer-locked.
    if (u.indexOf("mp4upload") !== -1) {
      var mm = h.match(/src["']?\s*[:=]\s*["'](https?:[^"'<>]+\.mp4[^"'<>]*)["']/i);
      if (mm) return { url: mm[1].replace(/\\\//g, "/"), stream: "mp4" };
      return null;
    }
    // yourupload: og:video or jwplayer file: "...mp4" (dated token + 302).
    if (u.indexOf("yourupload") !== -1) {
      var ym = h.match(/<meta[^>]+property=["']og:video["'][^>]*content=(["'])([^"']+)\1/i);
      if (ym) return { url: ym[2].replace(/\\\//g, "/"), stream: "mp4" };
      var ym2 = h.match(/\bfile\s*:\s*(["'])([^"']+\.mp4[^"']*)\1/i);
      if (ym2) return { url: ym2[2].replace(/\\\//g, "/"), stream: "mp4" };
      return null;
    }
    // vidmoly: sources: [{file: "...m3u8?..."}] (12h token).
    if (u.indexOf("vidmoly") !== -1) {
      var dm = h.match(/\bfile\s*:\s*(["'])([^"']+)\1/i);
      if (dm) {
        var du = dm[2].replace(/\\\//g, "/");
        return { url: du, stream: du.indexOf(".m3u8") !== -1 ? "m3u8" : "mp4" };
      }
      return null;
    }
    return null;
  }

  function budgetExpired(bud, t0, limitMs) {
    if (bud.n <= 0) return true;
    if (!t0) return false;
    try {
      return (new Date().getTime() - t0) > limitMs;
    } catch (e) {
      return false;
    }
  }

  async function decodeEpisodeServers(pageUrl) {
    var out = [];
    var html = await fetchHtml(pageUrl);
    var sec = securityNonce(html);
    var options = serverOptionsFromPage(html);
    if (!options.length) return [];
    var bud = { n: 60 };
    var t0 = 0;
    try {
      t0 = new Date().getTime();
    } catch (e0) {}
    for (var i = 0; i < options.length; i++) {
      if (budgetExpired(bud, t0, 20000)) break;
      var opt = options[i];
      var embedPage = "";
      try {
        bud.n--;
        var pj = await postAjax({ security: sec, post: opt.post, nume: opt.nume, stype: opt.stype, referer: pageUrl });
        var embedUrl = (pj && pj.embed_url) || "";
        if (!embedUrl) continue;
        embedUrl = makeAbsolute(unescapeHtml(String(embedUrl)));
        var jw = jwplayerLinks(embedUrl).length ? embedUrl : "";
        if (!jw) {
          // embed_url may already be the real embed (dtshcode path).
          jw = embedUrl;
        }
        bud.n--;
        var jwh = await fetchHtml(jw, { "Referer": pageUrl });
        var real = iframeSrc(jwh);
        if (!real) continue;
        real = makeAbsolute(real);
        embedPage = real;
      } catch (e) {
        continue;
      }
      var entry = {
        id: slugId(opt.label, "srv-" + opt.nume),
        name: opt.label,
        embedUrl: pageUrl,
        url: embedPage,
        directUrl: "",
        type: "embed",
        quality: null,
        headers: { "Referer": pageUrl, "User-Agent": userAgent }
      };
      if (needsDeep(opt.label, embedPage) && !budgetExpired(bud, t0, 20000)) {
        try {
          bud.n--;
          var ehtml = await fetchHtml(embedPage, { "Referer": pageUrl });
          var found = extractDirect(embedPage, ehtml);
          if (found && found.url) {
            var durl = withDirectSuffix(found.url);
            rememberMedia(durl, embedPage);
            rememberMedia(found.url, embedPage);
            entry.directUrl = durl;
            entry.type = found.stream === "m3u8" ? "m3u8" : "mp4";
            entry.quality = "1080p";
            entry.qualities = [{
              label: "1080p",
              url: durl,
              height: 1080,
              isDefault: true,
              headers: { "Referer": embedPage, "User-Agent": userAgent }
            }];
            entry.selectedQualityIndex = 0;
          } else {
            entry.reason = "unresolved_passthrough";
          }
        } catch (e2) {
          entry.reason = "unresolved_passthrough";
        }
      } else if (!needsDeep(opt.label, embedPage)) {
        entry.reason = "unresolved_passthrough";
      } else {
        entry.reason = "unresolved_passthrough";
      }
      out.push(entry);
      if (out.length > 20) break;
    }
    return out;
  }

  return {
    requiresCloudflare: false,

    async getHomepageManga(args) {
      try {
        var page = (args && args.page) || 1;
        var url = page <= 1 ? (baseUrl + "/animes/") : (baseUrl + "/animes/page/" + page + "/");
        return await parseAnimeCards(await fetchHtml(url));
      } catch (e) {
        return [];
      }
    },

    async search(args) {
      try {
        var query = (args && args.query) || "";
        if (!query.trim()) return [];
        var q = encodeURIComponent(query.trim());
        // Canonical pretty route first (og:url canonicalizes here).
        try {
          var cards = await parseAnimeCards(await fetchHtml(baseUrl + "/search/" + q + "/"));
          if (cards.length) return cards;
        } catch (e) {}
        // Plain WP search fallback (?s=, fail-closed on challenge).
        try {
          return await parseAnimeCards(await fetchHtml(baseUrl + "/?s=" + q));
        } catch (e2) {
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
          // Episode URL: try to climb to its season page via nav link.
          var epHtml = await fetchHtml(url);
          var sm = epHtml.match(/<a[^>]+href=(["'])([^"']*\/seasons\/[^"']*)\1/);
          if (sm) {
            try {
              return await parseAnimeDetails(await fetchHtml(makeAbsolute(sm[2])), makeAbsolute(sm[2]));
            } catch (e) {}
          }
          var epTitle = url;
          try {
            epTitle = unescapeHtml(cleanTitle(await api.cssText(epHtml, "h1"))) || url;
          } catch (e2) {}
          return {
            title: epTitle,
            coverUrl: makeAbsolute(metaContent(epHtml, "og:image")),
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
        if (url.indexOf("/episodes/") !== -1 || url.indexOf("/movies/") !== -1) {
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
        if (url.indexOf("/episodes/") !== -1 || url.indexOf("/movies/") !== -1) {
          return await decodeEpisodeServers(url);
        }
        // Season pages carry no player; resolve via first episode is the
        // caller's job — fail closed here.
        return [];
      } catch (e) {
        return [];
      }
    },

    async resolveServer(args) {
      try {
        var serverUrl = makeAbsolute((args && (args.serverUrl || args.url)) || "");
        if (!serverUrl) return null;
        // Closed allow-list: first-party site + observed embed/CDN hosts.
        var u = serverUrl.toLowerCase();
        var okHost =
          u.indexOf("det.animerco.org") !== -1 ||
          u.indexOf("videas.fr") !== -1 ||
          u.indexOf("megamax.me") !== -1 ||
          u.indexOf("vkvideo.ru") !== -1 ||
          u.indexOf("vk.com") !== -1 ||
          u.indexOf("ok.ru") !== -1 ||
          u.indexOf("videa.hu") !== -1 ||
          u.indexOf("mega.nz") !== -1 ||
          u.indexOf("yourupload.com") !== -1 ||
          u.indexOf("vidcache.net") !== -1 ||
          u.indexOf("sibnet.ru") !== -1 ||
          u.indexOf("vidmoly.biz") !== -1 ||
          u.indexOf("vmpx.online") !== -1 ||
          u.indexOf("4meplayer.com") !== -1 ||
          u.indexOf("uqload.vc") !== -1 ||
          u.indexOf("mp4upload.com") !== -1;
        if (!okHost) return null;
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
        var path = page <= 1 ? "" : ("/page/" + page + "/");
        if (genre && /^[a-z0-9\-]+$/i.test(genre)) {
          var slug = genre.toLowerCase();
          try {
            return await parseAnimeCards(await fetchHtml(baseUrl + "/genre/" + slug + path));
          } catch (e) {
            return [];
          }
        }
        if (type) {
          var t = type.toLowerCase();
          if (t.indexOf("movie") !== -1 || type.indexOf("فيلم") !== -1 || type.indexOf("أفلام") !== -1) {
            try {
              return await parseAnimeCards(await fetchHtml(baseUrl + "/movies" + path));
            } catch (e2) {
              return [];
            }
          }
          // TV and anything else fall through to the anime archive.
        }
        try {
          return await parseAnimeCards(await fetchHtml(baseUrl + "/animes" + path));
        } catch (e3) {
          return [];
        }
      } catch (e) {
        return [];
      }
    },

    async getGenresAndTypes() {
      return { genres: defaultGenres, types: defaultTypes };
    },

    async fetchMoreChapters() {
      // Episode lists ship complete inside the season page.
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
