function createSource(api, config) {
  var baseUrl = ((config && config.base_url) || "https://realmnovel.com").replace(/\/+$/, "");
  var configHeaders = (config && config.headers) || {};
  var userAgent =
    configHeaders["User-Agent"] ||
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
  var lastPageUrl = baseUrl + "/";

  // v2.0.0: realmnovel.com repurposed from manga JSON API to an Arabic
  // text-novel website. /api/manga*|/api/chapters* are denied at origin
  // nginx (403 for every UA/auth/device/version) while /_more, /novel/*,
  // /img/novel/* and /api/categories stay live. This source follows the
  // live novel mechanisms. Chapters are TEXT (no images, no overlays).

  var defaultGenres = [
    "اكشن", "خيال", "رعب", "رومانسي", "دراما", "كوميدي",
    "غموض", "نفسي", "مغامرات", "تاريخي", "حريم", "فنون قتال"
  ];
  var defaultTypes = ["novel"];

  var defaultHeaders = {
    "User-Agent": userAgent,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "ar,en-US;q=0.9,en;q=0.8",
    "Referer": baseUrl + "/",
    "Origin": baseUrl,
    "Upgrade-Insecure-Requests": "1"
  };

  var jsonHeaders = {
    "User-Agent": userAgent,
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "ar,en-US;q=0.9,en;q=0.8",
    "Referer": baseUrl + "/",
    "Origin": baseUrl
  };

  function mergeHeaders(a, b) {
    var out = {};
    for (var k in a) out[k] = a[k];
    if (b) for (var x in b) out[x] = b[x];
    return out;
  }

  async function fetchText(url, headers, method) {
    lastPageUrl = url || lastPageUrl;
    var h = mergeHeaders(defaultHeaders, headers);
    if (api.http) {
      var res = await api.http(url, { method: method || "GET", headers: h });
      if (!res || !res.ok) throw new Error("HTTP " + (res ? res.status : 0) + " for " + url);
      return res.body || "";
    }
    if (method && method !== "GET") return "";
    var t = await api.fetchText(url, h);
    if (!t) throw new Error("Empty response: " + url);
    return t;
  }

  async function fetchJson(url) {
    lastPageUrl = url || lastPageUrl;
    if (api.http) {
      var res = await api.http(url, { method: "GET", headers: jsonHeaders });
      if (!res || !res.ok) throw new Error("HTTP " + (res ? res.status : 0) + " for " + url);
      try {
        return JSON.parse(res.body || "{}");
      } catch (e) {
        throw new Error("Bad JSON: " + url);
      }
    }
    var t = await api.fetchText(url, jsonHeaders);
    return JSON.parse(t || "{}");
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

  function novelIdFromUrl(url) {
    var m = String(url || "").match(/\/novel\/([a-f0-9]{16,40})/i);
    return m ? m[1] : "";
  }

  function mapDoc(d) {
    d = d || {};
    var id = cleanTitle(d.id || "");
    if (!id) return null;
    var title = unescapeHtml(cleanTitle(d.title || d.titleEn || ""));
    if (!title) return null;
    return {
      title: title,
      coverUrl: baseUrl + "/img/novel/" + id + ".jpg",
      detailUrl: baseUrl + "/novel/" + id,
      contentType: "novel"
    };
  }

  function mapDocs(docs) {
    var out = [];
    var seen = {};
    docs = docs || [];
    for (var i = 0; i < docs.length; i++) {
      var c = mapDoc(docs[i]);
      if (!c || seen[c.detailUrl]) continue;
      seen[c.detailUrl] = true;
      out.push(c);
      if (out.length > 300) break;
    }
    return out;
  }

  function metaContent(html, key, attr) {
    var re = new RegExp("<meta[^>]+" + key + "=(['\"])" + attr + "\\1[^>]*>", "i");
    var m = String(html || "").match(re);
    if (!m) return "";
    var c = m[0].match(/content=(["'])([\s\S]*?)\1/i);
    return c ? c[2] : "";
  }

  function parseNovelTags(html) {
    var tags = [];
    var re = /<a[^>]+href=(["'])(?:[^"']*\/\?tag=|[^"']*\/tag\/)([^"']+)\1[^>]*>([\s\S]*?)<\/a>/g, m;
    while ((m = re.exec(String(html || ""))) !== null) {
      var t = unescapeHtml(cleanTitle(m[3]));
      if (t && tags.indexOf(t) === -1) tags.push(t);
      if (tags.length > 30) break;
    }
    return tags;
  }

  function parseChapterRows(html, novelId) {
    var out = [];
    var seen = {};
    var re = /<a[^>]*chapter-row[^>]*href=(["'])([^"']+)\1[^>]*>([\s\S]*?)<\/a>/g, m;
    while ((m = re.exec(String(html || ""))) !== null) {
      var u = makeAbsolute(m[2]);
      if (!u || seen[u]) continue;
      seen[u] = true;
      var nm = u.match(/\/chapter\/(\d+)/);
      var num = nm ? nm[1] : "0";
      var inner = m[3] || "";
      var locked = inner.indexOf("🔒") !== -1 || /fa-lock|مقفل|مدفوع/.test(inner);
      out.push({
        number: String(num),
        title: "الفصل " + num,
        url: u,
        views: 0,
        isLocked: locked,
        date: "",
        isFiller: false,
        thumbnailUrl: null,
        durationSeconds: null,
        servers: []
      });
      if (out.length > 8000) break;
    }
    return out;
  }

  function parseSearchCards(html) {
    var out = [];
    var seen = {};
    var re = /<a[^>]+class=(["'])g3card\1[^>]+href=(["'])(\/novel\/[a-f0-9]+)\2[^>]*>([\s\S]*?)<\/a>/g, m;
    while ((m = re.exec(String(html || ""))) !== null) {
      var detailUrl = makeAbsolute(m[3]);
      if (!detailUrl || seen[detailUrl]) continue;
      seen[detailUrl] = true;
      var inner = m[4] || "";
      var title = "";
      var tm = inner.match(/<div[^>]+class=(["'])g3title\1[^>]*>([\s\S]*?)<\/div>/i);
      if (tm) title = unescapeHtml(stripTags(tm[2]));
      if (!title) {
        var am = inner.match(/<img[^>]+alt=(["'])([\s\S]*?)\1/i);
        if (am) title = unescapeHtml(stripTags(am[2]));
      }
      if (!title) continue;
      var cover = "";
      var im = inner.match(/<img[^>]+src=(["'])([^"']+)\1/i);
      if (im) cover = makeAbsolute(im[2]);
      if (!cover) {
        var idm = detailUrl.match(/\/novel\/([a-f0-9]+)/i);
        if (idm) cover = baseUrl + "/img/novel/" + idm[1] + ".jpg";
      }
      out.push({ title: title, coverUrl: cover, detailUrl: detailUrl, contentType: "novel" });
      if (out.length > 300) break;
    }
    return out;
  }

  function novelTotal(html) {
    var m = String(html || "").match(/data-chapters=(["'])(\d+)\1/i);
    if (m) return parseInt(m[2], 10) || 0;
    var m2 = String(html || "").match(/chapters["']?\s*:\s*(\d+)/i);
    if (m2) return parseInt(m2[1], 10) || 0;
    return 0;
  }

  function synthChapters(novelId, total) {
    var out = [];
    for (var n = 1; n <= total && out.length < 8000; n++) {
      out.push({
        number: String(n),
        title: "الفصل " + n,
        url: baseUrl + "/novel/" + novelId + "/chapter/" + n,
        views: 0,
        isLocked: false,
        date: "",
        isFiller: false,
        thumbnailUrl: null,
        durationSeconds: null,
        servers: []
      });
    }
    out.sort(function (a, b) { return (parseFloat(b.number) || 0) - (parseFloat(a.number) || 0); });
    return out;
  }

  function chapterText(html) {
    var m = String(html || "").match(/<div[^>]+class=(["'])[^"']*chapter-content[^"']*\1[^>]*>([\s\S]*?)<\/div>/i);
    if (!m) return "";
    var inner = m[2];
    inner = inner.replace(/<script[\s\S]*?<\/script>/gi, " ");
    inner = inner.replace(/<style[\s\S]*?<\/style>/gi, " ");
    inner = inner.replace(/<\/p\s*>/gi, "\n\n");
    inner = inner.replace(/<br\s*\/?>/gi, "\n");
    return unescapeHtml(stripTags(inner)).replace(/\n{3,}/g, "\n\n").trim();
  }

  return {
    requiresCloudflare: false,

    async getHomepageManga(args) {
      try {
        var page = (args && args.page) || 1;
        var data = await fetchJson(baseUrl + "/_more?page=" + page);
        return mapDocs(data.docs || data.items || []);
      } catch (e) {
        return [];
      }
    },

    async search(args) {
      try {
        var query = (args && args.query) || "";
        if (!query.trim()) return [];
        var page = (args && args.page) || 1;
        var data = await fetchJson(baseUrl + "/_more?page=" + page + "&q=" + encodeURIComponent(query.trim()));
        var out = mapDocs(data.docs || data.items || []);
        if (out.length) return out;
        // Fallback: server-rendered search page (same result set).
        var html = await fetchText(baseUrl + "/?q=" + encodeURIComponent(query.trim()));
        return parseSearchCards(html);
      } catch (e) {
        return [];
      }
    },

    async getMangaDetails(args) {
      var url = makeAbsolute((args && args.url) || "");
      try {
        var id = novelIdFromUrl(url);
        if (!id) throw new Error("Unknown novel id: " + url);
        var durl = baseUrl + "/novel/" + id;
        var html = await fetchText(durl);
        var title = "";
        try {
          title = unescapeHtml(cleanTitle(await api.cssText(html, "h1"))) || "";
        } catch (e) {}
        if (!title) {
          var hm = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
          if (hm) title = unescapeHtml(stripTags(hm[1]));
        }
        if (!title) title = unescapeHtml(cleanTitle(metaContent(html, "property", "og:title")));
        var cover = makeAbsolute(metaContent(html, "property", "og:image"));
        if (!cover) cover = baseUrl + "/img/novel/" + id + ".jpg";
        var description = unescapeHtml(cleanTitle(metaContent(html, "name", "description")));
        var genres = parseNovelTags(html);
        var status = "";
        if (html.indexOf("مستمرة") !== -1) status = "مستمرة";
        else if (html.indexOf("مكتملة") !== -1 || html.indexOf("مكتمل") !== -1) status = "مكتملة";
        var rows = parseChapterRows(html, id);
        var total = novelTotal(html);
        var episodes = rows;
        if (total > rows.length) {
          // Full-range synthesis (rows sample first+last; newest may be
          // paywalled) with lock flags overlaid from parsed rows.
          episodes = synthChapters(id, total);
          var lockedByNum = {};
          for (var r = 0; r < rows.length; r++) {
            if (rows[r].isLocked) lockedByNum[rows[r].number] = true;
          }
          for (var k = 0; k < episodes.length; k++) {
            if (lockedByNum[episodes[k].number]) episodes[k].isLocked = true;
          }
        } else if (!rows.length && total > 0) episodes = synthChapters(id, total);
        episodes.sort(function (a, b) { return (parseFloat(b.number) || 0) - (parseFloat(a.number) || 0); });
        return {
          title: title || "غير معروف",
          coverUrl: cover,
          description: description,
          genres: genres,
          status: status,
          chapters: episodes,
          originalUrl: durl,
          hasMoreChapters: false,
          lastFetchedPage: 1,
          contentType: "novel"
        };
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
          contentType: "novel"
        };
      }
    },

    async getChapterPages() {
      // Text novels have no image pages — compat stub for the manga path.
      return [];
    },

    async getChapterContent(args) {
      try {
        var url = makeAbsolute((args && args.url) || "");
        var html = await fetchText(url);
        var text = chapterText(html);
        var title = "";
        try {
          title = unescapeHtml(cleanTitle(await api.cssText(html, "h1"))) || "";
        } catch (e) {}
        if (!text) return { kind: "text", textContent: "", chapterTitle: title };
        return { kind: "text", textContent: text, chapterTitle: title, imageUrls: [] };
      } catch (e) {
        return { kind: "text", textContent: "", chapterTitle: "" };
      }
    },

    async getFilteredManga(args) {
      try {
        var page = (args && args.page) || 1;
        var genre = cleanTitle((args && args.genre) || "");
        if (genre) {
          var data = await fetchJson(baseUrl + "/_more?page=" + page + "&tag=" + encodeURIComponent(genre));
          return mapDocs(data.docs || data.items || []);
        }
        var home = await this.getHomepageManga({ page: page });
        return home;
      } catch (e) {
        return [];
      }
    },

    async getGenresAndTypes() {
      try {
        var data = await fetchJson(baseUrl + "/api/categories");
        var items = data.items || data.docs || [];
        var genres = [];
        for (var i = 0; i < items.length; i++) {
          var nm = unescapeHtml(cleanTitle(items[i] && items[i].name));
          if (nm && genres.indexOf(nm) === -1) genres.push(nm);
        }
        if (genres.length) return { genres: genres, types: defaultTypes };
      } catch (e) {}
      return { genres: defaultGenres, types: defaultTypes };
    },

    async fetchMoreChapters() {
      // Chapter lists ship complete (rows + full-range synthesis).
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
        "Sec-Fetch-Site": "same-origin"
      };
    },

    sanitizeCoverUrl(args) {
      return makeAbsolute((args && args.url) || "");
    }
  };
}

if (typeof module !== "undefined") module.exports = { createSource: createSource };
