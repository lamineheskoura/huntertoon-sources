function createSource(api, config) {
  var baseUrl = (config && config.base_url) || "https://realmnovel.com";
  var apiUrl = baseUrl + "/api";
  // Gate facts verified live: any Referer header => 403, non-Dart UA => 403,
  // and X-Sig must be HMAC-SHA256(hex) over "METHOD\nPATH(no query)\nTS\nNONCE\nDEVICE_ID".
  var userAgent = "Dart/3.9 (dart:io)";
  var HMAC_KEY_HEX = "61626338633034653235336232363134303435356666653565313066623161386335386363313161306165666461316530363862646562373764653766613231";
  var ATTEST_PUB = "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEg0NTPT3n6AzL1YWFp5XQwYBE47KdSw40SDg9cs6wx53lRgOT3s1qPY4Z8l2sP874t+Dxm4wixvgw3YStrTon/g==";
  var AL = "0123456789abcdefghijklmnopqrstuvwxyz";

  var session = { id: "", token: "", att: "" };
  var bootP = null;

  function b36(n) {
    var s = "";
    do { s = AL.charAt(n % 36) + s; n = Math.floor(n / 36); } while (n > 0);
    return s;
  }
  function randHex(n) {
    var s = "";
    for (var i = 0; i < n; i++) s += "0123456789abcdef"[Math.floor(Math.random() * 16)];
    return s;
  }
  function rand36(n) {
    var s = "";
    for (var i = 0; i < n; i++) s += AL.charAt(Math.floor(Math.random() * 36));
    return s;
  }
  function h2b(c) { return (c < 16 ? "0" : "") + c.toString(16); }
  function utf8Hex(str) {
    var out = "";
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 0x80) out += h2b(c);
      else if (c < 0x800) out += h2b(0xc0 | (c >> 6)) + h2b(0x80 | (c & 63));
      else if (c >= 0xd800 && c <= 0xdbff) {
        var c2 = str.charCodeAt(++i);
        var cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
        out += h2b(0xf0 | (cp >> 18)) + h2b(0x80 | ((cp >> 12) & 63)) + h2b(0x80 | ((cp >> 6) & 63)) + h2b(0x80 | (cp & 63));
      } else out += h2b(0xe0 | (c >> 12)) + h2b(0x80 | ((c >> 6) & 63)) + h2b(0x80 | (c & 63));
    }
    return out;
  }
  function safeJson(text) {
    try { return JSON.parse(text || "{}"); } catch (e) { return {}; }
  }
  function plainHeaders() {
    var h = {
      "User-Agent": userAgent,
      "Accept": "application/json, text/plain, */*",
      "Referer": "",
      "X-Device-ID": session.id
    };
    if (session.token) h["Authorization"] = "Bearer " + session.token;
    return h;
  }
  function post(path, payload) {
    var headers = plainHeaders();
    headers["Content-Type"] = "application/json";
    return api.http(apiUrl + path, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(payload),
      transport: "light"
    }).then(function (res) { return safeJson(res && res.body); });
  }
  async function register() {
    var u = "ht" + randHex(8);
    var d = await post("/auth/register", {
      username: u,
      email: u + "@mailinator.com",
      password: "T3st!" + randHex(16)
    });
    if (!d.token) throw new Error("register failed");
    return d.token;
  }
  async function attest() {
    var n = await post("/device/attest/nonce", {});
    var d = await post("/device/attest", {
      nonce: n.nonce || "",
      token: null,
      error: "NO_PROJECT",
      platform: "android",
      pub: ATTEST_PUB
    });
    if (!d.ok || !d.attToken) throw new Error("attest failed");
    return d.attToken;
  }
  function bootstrap(forceAtt) {
    if (!forceAtt && session.token && session.att) return Promise.resolve();
    if (!bootP) {
      bootP = (async function () {
        if (!session.id) session.id = "ins_" + b36(Date.now()) + "_" + rand36(16);
        if (!session.token) session.token = await register();
        if (!session.att || forceAtt) session.att = await attest();
      })().then(function (v) { bootP = null; return v; }, function (e) { bootP = null; throw e; });
    }
    return bootP;
  }
  async function signedHeaders(method, path) {
    var ts = String(Math.floor(Date.now() / 1000));
    var nonce = randHex(12);
    var canon = method + "\n" + "/api" + path.split("?")[0] + "\n" + ts + "\n" + nonce + "\n" + session.id;
    var sig = await api.cryptoOp("hmacSha256", utf8Hex(canon), { key: HMAC_KEY_HEX });
    var h = plainHeaders();
    h["X-Ts"] = ts;
    h["X-Nonce"] = nonce;
    h["X-Sig"] = sig;
    h["X-Att"] = session.att;
    return h;
  }

  var defaultGenres = [];
  var catSlugs = {};
  var defaultTypes = ["manga", "manhwa", "manhua"];

  function makeAbsolute(url) {
    if (!url) return "";
    if (url.indexOf("http") === 0) return url;
    if (url.indexOf("//") === 0) return "https:" + url;
    return baseUrl + url;
  }

  function makeCdnUrl(url) {
    if (!url) return "";
    var u = String(url).trim();
    if (!u) return "";
    if (u.indexOf("http") === 0) {
      // ØªØ±Ù‚ÙŠØ© http Ø¥Ù„Ù‰ https (Ù…Ø«Ù„ Ø¨Ù‚ÙŠØ© Ø§Ù„Ù…ØµØ§Ø¯Ø±).
      if (u.indexOf("http://") === 0) return "https://" + u.substring(7);
      return u;
    }
    // P0-4: Ù…Ø¹Ø§Ù„Ø¬Ø© // (ÙƒØ§Ù†Øª ØªÙØ¶Ø§Ø¹Ù Ø§Ù„Ù‡ÙˆØ³Øª) ÙˆØ§Ù„Ù…Ø³Ø§Ø± Ø¨Ù„Ø§ / Ø¨Ø§Ø¯Ø¦Ø©.
    if (u.indexOf("//") === 0) return "https:" + u;
    if (u.charAt(0) !== "/") u = "/" + u;
    return "https://cdn.realmnovel.com" + u;
  }

  function extractNumber(str) {
    var m = String(str || "").match(/(\d+(?:\.\d+)?)/);
    return m ? m[1] : "0";
  }

  function validImage(src) {
    src = makeAbsolute(src);
    if (!src || src.indexOf("data:image") === 0) return "";
    return src;
  }

  function strip(s) {
    return String(s || "")
      .replace(/<br\s*\/?\s*>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, "\"")
      .replace(/&#39;/g, "'")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  async function apiGet(path, retried) {
    await bootstrap(false);
    var res = await api.http(apiUrl + path, {
      method: "GET",
      headers: await signedHeaders("GET", path),
      transport: "light"
    });
    if (res && res.status === 428 && !retried) {
      await bootstrap(true);
      return apiGet(path, true);
    }
    if (res && (res.status === 401 || res.status === 426) && !retried) {
      session.token = "";
      session.att = "";
      return apiGet(path, true);
    }
    if (!res || !res.ok) throw new Error("HTTP " + (res ? res.status : 0) + " for " + apiUrl + path);
    return JSON.parse(res.body || "{}");
  }

  function toManga(item) {
    var cover = item.cover || item.coverThumb || "";
    return {
      title: item.arabicTitle || item.englishTitle || "",
      detailUrl: baseUrl + "/manga/" + (item.slug || item._id || ""),
      coverUrl: makeCdnUrl(cover),
      contentType: "manga"
    };
  }

  return {
    requiresCloudflare: false,

    async getHomepageManga(args) {
      try {
        var page = (args && args.page) || 1;
        var data = await apiGet("/manga?page=" + page + "&limit=20");
        var items = data.items || [];
        return items.map(toManga);
      } catch (e) {
        return [];
      }
    },

    async search(args) {
      try {
        var query = (args && args.query) || "";
        if (!query.trim()) return [];
        var data = await apiGet("/manga?search=" + encodeURIComponent(query) + "&limit=20");
        var items = data.items || [];
        return items.map(toManga);
      } catch (e) {
        return [];
      }
    },

    async getFilteredManga(args) {
      try {
        var page = (args && args.page) || 1;
        var params = ["page=" + page, "limit=20"];
        var genre = args && args.genre ? String(args.genre) : "";
        var slug = "";
        if (genre) {
          if (!Object.keys(catSlugs).length) await this.getGenresAndTypes();
          slug = catSlugs[genre.toLowerCase()] || catSlugs[genre] || "";
          if (slug) params.push("category=" + encodeURIComponent(slug));
        }
        if (args && args.status) {
          params.push("status=" + encodeURIComponent(args.status));
        }
        var data = await apiGet("/manga?" + params.join("&"));
        var items = data.items || [];
        if (genre) {
          var g = genre.toLowerCase();
          items = items.filter(function (it) {
            var cats = (it && it.categories) || [];
            for (var i = 0; i < cats.length; i++) {
              var nm = String((cats[i] && cats[i].name) || "").toLowerCase();
              var sl = String((cats[i] && cats[i].slug) || "").toLowerCase();
              if (nm && (nm === g || nm.indexOf(g) !== -1 || g.indexOf(nm) !== -1)) return true;
              if (sl && sl === g) return true;
              if (slug && sl && sl === slug.toLowerCase()) return true;
            }
            return false;
          });
        }
        return items.map(toManga);
      } catch (e) {
        return [];
      }
    },

    async getGenresAndTypes() {
      try {
        var data = await apiGet("/categories");
        var items = data.items || [];
        defaultGenres = items.map(function (c) { return c.name || ""; }).filter(Boolean);
        catSlugs = {};
        items.forEach(function (c) {
          if (!c || !c.slug) return;
          if (c.name) catSlugs[String(c.name).toLowerCase()] = c.slug;
          catSlugs[String(c.slug)] = c.slug;
        });
      } catch (e) {}
      return { genres: defaultGenres, types: defaultTypes };
    },

    async getMangaDetails(args) {
      var slug = "";
      var rawUrl = (args && args.url) || "";
      var m = rawUrl.match(/\/manga\/([^/?#]+)/);
      if (m) slug = m[1];

      var data = await apiGet("/manga/" + slug);
      var manga = data.manga || data;
      if (!manga || !manga._id) throw new Error("Manga not found: " + slug);

      var title = manga.arabicTitle || manga.englishTitle || "Ø¨Ø¯ÙˆÙ† Ø¹Ù†ÙˆØ§Ù†";
      var coverRaw = manga.cover || manga.coverThumb || "";
      var cover = makeCdnUrl(coverRaw);
      var desc = manga.description || "";
      var genres = (manga.categories || []).map(function (c) { return c.name || ""; }).filter(Boolean);
      var status = manga.status || "ongoing";

      var chData = await apiGet("/manga/" + slug + "/chapters?limit=200&page=1");
      var allItems = chData.items || [];
      var total = chData.total || 0;
      var limit = chData.limit || 200;
      var totalPages = Math.ceil(total / limit);
      for (var p = 2; p <= totalPages; p++) {
        var more = await apiGet("/manga/" + slug + "/chapters?limit=200&page=" + p);
        var moreItems = more.items || [];
        allItems = allItems.concat(moreItems);
      }
      var chapters = allItems.map(function (c) {
        return {
          number: extractNumber(c.number),
          title: c.title || c.number || "",
          views: 0,
          url: baseUrl + "/chapters/" + c._id,
          isLocked: false,
          date: (c.createdAt || "").split("T")[0]
        };
      });

      return {
        title: title,
        coverUrl: cover,
        description: strip(desc),
        genres: genres,
        chapters: chapters,
        originalUrl: rawUrl || (baseUrl + "/manga/" + slug),
        hasMoreChapters: false,
        lastFetchedPage: 1,
        contentType: "manga"
      };
    },

    async getChapterPages(args) {
      var content = await this.getChapterContent(args);
      if (content.kind === "image") return content.imageUrls || [];
      if (content.kind === "overlay") return content.imageUrls || [];
      return [];
    },

    async getChapterContent(args) {
      var rawUrl = (args && args.url) || "";
      var m = rawUrl.match(/\/chapters\/([^/?#]+)/);
      var chapterId = m ? m[1] : "";

      var data = await apiGet("/chapters/" + chapterId);
      var chapter = data.chapter || data;
      if (!chapter || !chapter.pages) {
        return { kind: "image", imageUrls: [] };
      }

      var pages = chapter.pages || [];
      // The page list and the per-page sizes come from the SAME array, so
      // the aspect ratios stay parallel to the image list.
      var urls = [];
      var aspects = [];
      for (var pi = 0; pi < pages.length; pi++) {
        var u = validImage(pages[pi].image || pages[pi].url || "");
        if (!u) continue;
        urls.push(u);
        var pw = Number(pages[pi].width) || 0;
        var ph = Number(pages[pi].height) || 0;
        aspects.push(pw > 0 && ph > 0 ? pw / ph : 0);
      }
      // The app commits every page's extent on its FIRST paint: the ratios
      // are only sent when EVERY page has a size.
      var imageAspects = (aspects.length === urls.length && urls.length) ? aspects : null;
      if (imageAspects) {
        for (var ai = 0; ai < imageAspects.length; ai++) {
          if (!(imageAspects[ai] > 0)) { imageAspects = null; break; }
        }
      }

      var hasOverlay = pages.some(function (p) { return p.hasOverlay === true; });

      if (!hasOverlay) {
        var plain = { kind: "image", imageUrls: urls };
        if (imageAspects) plain.imageAspects = imageAspects;
        return plain;
      }

      var pageOverlays = pages.map(function (p, idx) {
        var bubbles = p.bubbles || [];
        var overlays = bubbles.map(function (b) {
          var box = b.box || [0, 0, 0, 0];
          // boxNorm = resolution-independent [nx, ny, nw, nh] (0-1). Prefer it in
          // the app renderer over pixel box (immune to per-page size variance).
          var norm = b.boxNorm || null;
          return {
            id: b.id || "",
            text: b.text || "",
            english: b.english || "",
            x: box[0] || 0,
            y: box[1] || 0,
            w: box[2] || 0,
            h: box[3] || 0,
            nx: norm ? (Number(norm[0]) || 0) : 0,
            ny: norm ? (Number(norm[1]) || 0) : 0,
            nw: norm ? (Number(norm[2]) || 0) : 0,
            nh: norm ? (Number(norm[3]) || 0) : 0,
            hasNorm: !!norm,
            angle: 0
          };
        });
        return overlays;
      });

      var naturalImageWidth = 0;
      var naturalImageHeight = 0;
      for (var i = 0; i < pages.length; i++) {
        var pw = Number(pages[i].width) || 0;
        var ph = Number(pages[i].height) || 0;
        if (pw > naturalImageWidth) naturalImageWidth = pw;
        if (ph > naturalImageHeight) naturalImageHeight = ph;
      }

      var overlayOut = {
        kind: "overlay",
        imageUrls: urls,
        pageOverlays: pageOverlays,
        naturalImageWidth: naturalImageWidth,
        naturalImageHeight: naturalImageHeight
      };
      if (imageAspects) overlayOut.imageAspects = imageAspects;
      return overlayOut;
    },

    async fetchMoreChapters(args) {
      try {
        // Accept BOTH flat {url,nextPage} (app contract) and legacy {previousResult}.
        var prev = (args && args.previousResult) || {};
        var rawUrl = (args && args.url) || prev.originalUrl || "";
        var m = rawUrl.match(/\/manga\/([^/?#]+)/);
        var slug = m ? m[1] : "";
        if (!slug) return null;

        var nextPage = (args && args.nextPage) || ((prev.lastFetchedPage || 1) + 1);
        nextPage = parseInt(nextPage, 10) || 2;
        if (nextPage < 2) nextPage = 2;
        if (nextPage > 100) return null;
        var chData = await apiGet("/manga/" + slug + "/chapters?limit=200&page=" + nextPage);
        var chItems = chData.items || [];
        if (chItems.length === 0) return null;

        var chapters = chItems.map(function (c) {
          return {
            number: extractNumber(c.number),
            title: c.title || c.number || "",
            views: 0,
            url: baseUrl + "/chapters/" + c._id,
            isLocked: false,
            date: (c.createdAt || "").split("T")[0]
          };
        });

        var total = chData.total || 0;
        var limit = chData.limit || 200;
        var hasMore = (typeof chData.hasMore !== "undefined")
          ? !!chData.hasMore
          : (total ? (nextPage * limit < total) : (chItems.length === limit));
        return {
          chapters: chapters,
          hasMoreChapters: hasMore,
          lastFetchedPage: nextPage
        };
      } catch (e) {
        return null;
      }
    },

    getImageHeaders(args) {
      return {
        "User-Agent": userAgent,
        Referer: baseUrl + "/",
        Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8"
      };
    },

    sanitizeCoverUrl(args) {
      return makeCdnUrl((args && args.url) || "") || ((args && args.url) || "");
    }
  };
}

if (typeof module !== "undefined") module.exports = { createSource: createSource };
