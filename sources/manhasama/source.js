function createSource(api, config) {
  var baseUrl = (config && config.base_url) || "https://realmnovel.com";
  var apiUrl = baseUrl + "/api";
  // Gate facts verified live against realmnovel.com (Nov 2026): the CONTENT
  // routes (/manga, /manga/:slug, /manga/:slug/chapters, /chapters/:id) need
  // THREE layers at once, otherwise the server answers 428
  // {"attest":true,"code":"verify"}:
  //  1. nginx: X-Sig (HMAC-SHA256 hex over
  //     "METHOD\n/api{PATH-no-query}\nTS\nNONCE\nDEVICE_ID"), a Dart UA and an
  //     "ins_*" device id. A wrong signature answers 401 {"sigError":"badsig"},
  //     a non-Dart UA answers nginx 403.
  //  2. X-Att: an attToken minted by POST /device/attest FOR THAT device id.
  //     Tier N (no Play Integrity) is enough.
  //  3. Authorization: the account JWT from POST /auth/login.
  //     The attToken alone or the JWT alone still answers 428.
  //  - POST /device/attest must NOT carry "pub": the server then stamps p/pl
  //    claims into the token and rejects it with 428 again. {"nonce":n} is
  //    enough and needs an account (without a JWT it answers need_login).
  //  - The gate-free surface still answers: /categories, /links/feed,
  //    /links/manga/:id, /comments/manga/:id, /mylist/chapters-meta/:id,
  //    /app-config, /app-features. /links/feed carries the catalogue (titles,
  //    signed covers, slug, chapter count) and is the fallback list when no
  //    account is configured.
  //  - X-App-Build must be >= minBuild (/device/hello reports minBuild:8),
  //    otherwise gated chapters answer 426 {"code":"update"}.
  //  - config.auth_identifier + config.auth_password (or config.auth_token)
  //    log in, then this source mints the attToken itself.
  //    config.att_token (+ optional config.att_device_id) injects a token
  //    taken from the official app instead.
  var userAgent = "Dart/3.9 (dart:io)";
  var APP_BUILD = "120";
  var HMAC_KEY_HEX = "61626338633034653235336232363134303435356666653565313066623161386335386363313161306165666461316530363862646562373764653766613231";
  var AL = "0123456789abcdefghijklmnopqrstuvwxyz";
  // Every chapter whose number starts with a multiple of 3 is ad-gated
  // (3, 3-1, 3-2 ... 6, 9 ...). Verified on 3 titles x 24 chapters each.
  var AD_LOCK_EVERY = 3;
  var injectedAtt = (config && (config.att_token || config.attToken)) || "";
  var injectedDev = (config && (config.att_device_id || config.attDeviceId)) || "";

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
      "X-Device-ID": session.id,
      "X-App-Build": APP_BUILD,
      "X-Platform": "android"
    };
    if (session.token) h["Authorization"] = "Bearer " + session.token;
    return h;
  }
  async function post(path, payload) {
    var headers = await signedHeaders("POST", path);
    headers["Content-Type"] = "application/json";
    return api.http(apiUrl + path, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(payload),
      transport: "light"
    }).then(function (res) { return safeJson(res && res.body); });
  }
  // Account login. The API accepts {identifier, password} where identifier is
  // the e-mail OR the username, and answers {token, user}. Only an account
  // that owns points can open ad-gated chapters, so this is the one path that
  // can actually unlock them; without credentials the source stays a guest.
  async function login() {
    var id = (config && (config.auth_identifier || config.authIdentifier)) || "";
    var pw = (config && (config.auth_password || config.authPassword)) || "";
    var fixed = (config && (config.auth_token || config.authToken)) || "";
    if (fixed) return fixed;
    if (!id || !pw) return "";
    var d;
    try {
      d = await post("/auth/login", { identifier: id, password: pw });
    } catch (e) {
      // A failed login must never break the guest read path.
      return "";
    }
    return d.token || "";
  }
  async function attest() {
    try {
      var n = await post("/device/attest/nonce", {});
      // Only the nonce: adding "pub" makes the server stamp p/pl claims into
      // the token, and the gate then rejects that token with 428.
      var d = await post("/device/attest", { nonce: n.nonce || "" });
      // Without an account the server answers need_login; requests still
      // succeed on the gate-free routes, so an empty token is not fatal.
      return d.attToken || "";
    } catch (e) {
      return "";
    }
  }
  function bootstrap(forceAtt) {
    if (injectedAtt) {
      session.att = injectedAtt;
      if (injectedDev) session.id = injectedDev;
    } else if (forceAtt) {
      if (!bootP) {
        bootP = (async function () {
          session.att = await attest();
        })().then(function (v) { bootP = null; return v; }, function (e) { bootP = null; throw e; });
      }
      return bootP;
    }
    if (!session.id) session.id = "ins_" + b36(Date.now()) + "_" + rand36(16);
    if (!session.token && !session.loginTried) {
      session.loginTried = true;
      if (!bootP) {
        bootP = login().then(function (t) {
          session.token = t || "";
        }).then(function (v) { bootP = null; return v; }, function (e) { bootP = null; throw e; });
      }
      return bootP;
    }
    return Promise.resolve();
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
    if (session.att) h["X-Att"] = session.att;
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
      // ترقية http إلى https (مثل بقية المصادر).
      if (u.indexOf("http://") === 0) return "https://" + u.substring(7);
      return u;
    }
    // P0-4: معالجة // (كانت تفسد المضيف) والمسار بلا / بادئة.
    if (u.indexOf("//") === 0) return "https:" + u;
    if (u.charAt(0) !== "/") u = "/" + u;
    return "https://cdn.realmnovel.com" + u;
  }

  function extractNumber(str) {
    var m = String(str || "").match(/(\d+(?:\.\d+)?)/);
    return m ? m[1] : "0";
  }

  function uuid() {
    var h = randHex(32);
    return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
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
      // A dead/expired account token: log in again once. Guests get 401 on
      // account-only routes (/me/*) and must not retry forever.
      session.token = "";
      session.att = "";
      session.loginTried = false;
      return apiGet(path, true);
    }
    if (!res || !res.ok) {
      var err = new Error("HTTP " + (res ? res.status : 0) + " for " + apiUrl + path);
      err.status = res ? res.status : 0;
      throw err;
    }
    return JSON.parse(res.body || "{}");
  }

  // Gate-free catalogue: /links/feed returns the manga metadata (title,
  // signed cover, slug, chapter count) without the Play Integrity gate.
  async function feedManga(page) {
    var data = await apiGet("/links/feed?page=" + (page || 1));
    var items = data.items || [];
    var out = [];
    for (var i = 0; i < items.length; i++) {
      var m = items[i] && items[i].manga;
      if (m && m._id) out.push(m);
    }
    return out;
  }

  // Catalogue-only details for the gate-free path: metadata from the feed plus
  // the chapter numbers of /mylist/chapters-meta (no chapter ids, no pages).
  async function fallbackDetails(slug, rawUrl) {
    var found = null;
    for (var p = 1; p <= 5 && !found; p++) {
      var list;
      try {
        list = await feedManga(p);
      } catch (e) {
        break;
      }
      if (!list.length) break;
      for (var i = 0; i < list.length; i++) {
        if (list[i].slug === slug || list[i]._id === slug) {
          found = list[i];
          break;
        }
      }
    }
    if (!found) throw new Error("Manga not found: " + slug);

    var chapters = [];
    try {
      var meta = await apiGet("/mylist/chapters-meta/" + found._id);
      var nums = meta.nums || [];
      for (var n = 0; n < nums.length; n++) {
        chapters.push({
          number: String(nums[n]),
          title: String(nums[n]),
          views: 0,
          url: baseUrl + "/manga/" + (found.slug || found._id),
          isLocked: true,
          date: ""
        });
      }
    } catch (e) {}

    return {
      title: found.arabicTitle || found.englishTitle || "",
      coverUrl: makeCdnUrl(found.cover || found.coverThumb || ""),
      description: "",
      genres: [],
      chapters: chapters,
      originalUrl: rawUrl || (baseUrl + "/manga/" + slug),
      hasMoreChapters: false,
      lastFetchedPage: 1,
      contentType: "manga"
    };
  }

  // Ad-gated chapters are withheld by the server (adLocked:true, pages:[]).
  // The only server-side way to open one is paying points:
  // /me/chapter-unlock/cost gives the price (6) and /me/chapter-unlock/spend
  // pays it. Points arrive only from watched ads (verified by Google), so this
  // works for an account that already holds them.
  async function unlockAdChapter(chapterId) {
    try {
      if (!session.token) return false;
      var cost = await apiGet("/me/chapter-unlock/cost");
      var need = Number(cost.costPerChapter) || 0;
      if (!need) return false;
      var bal = await apiGet("/me/points");
      if ((Number(bal.points) || 0) < need) return false;
      var spent = await post("/me/chapter-unlock/spend", { chapterId: chapterId, spendId: uuid() });
      return !!(spent && spent.ok);
    } catch (e) {
      return false;
    }
  }

  // Points the signed-in account holds, minus the price of one chapter.
  // null = unknown (no account / request failed).
  async function unlockablePoints() {
    try {
      if (!session.token) return 0;
      var cost = await apiGet("/me/chapter-unlock/cost");
      var need = Number(cost.costPerChapter) || 0;
      var bal = await apiGet("/me/points");
      var have = Number(bal.points) || 0;
      return need && have >= need ? have : 0;
    } catch (e) {
      return 0;
    }
  }

  function isAdGated(number) {
    var m = String(number || "").match(/\d+/);
    if (!m) return false;
    return (parseInt(m[0], 10) % AD_LOCK_EVERY) === 0;
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
      var page = (args && args.page) || 1;
      try {
        var data = await apiGet("/manga?page=" + page + "&limit=20");
        return (data.items || []).map(toManga);
      } catch (e) {
        if (!e || e.status !== 428) return [];
      }
      try {
        return (await feedManga(page)).map(toManga);
      } catch (e2) {
        return [];
      }
    },

    async search(args) {
      var query = (args && args.query) || "";
      if (!query.trim()) return [];
      try {
        var data = await apiGet("/manga?search=" + encodeURIComponent(query) + "&limit=20");
        return (data.items || []).map(toManga);
      } catch (e) {
        if (!e || e.status !== 428) return [];
      }
      var q = query.trim().toLowerCase();
      var found = [];
      var seen = {};
      for (var p = 1; p <= 5 && found.length < 20; p++) {
        var list;
        try {
          list = await feedManga(p);
        } catch (e2) {
          break;
        }
        if (!list.length) break;
        for (var i = 0; i < list.length; i++) {
          var m = list[i];
          if (seen[m._id]) continue;
          var hay = ((m.arabicTitle || "") + " " + (m.englishTitle || "") + " " + (m.slug || "")).toLowerCase();
          if (hay.indexOf(q) !== -1) {
            seen[m._id] = 1;
            found.push(m);
          }
        }
      }
      return found.map(toManga);
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

      var data = null;
      try {
        data = await apiGet("/manga/" + slug);
      } catch (e) {
        if (!e || e.status !== 428) throw e;
      }
      if (!data) return fallbackDetails(slug, rawUrl);
      var manga = data.manga || data;
      if (!manga || !manga._id) throw new Error("Manga not found: " + slug);

      var title = manga.arabicTitle || manga.englishTitle || "بدون عنوان";
      var coverRaw = manga.cover || manga.coverThumb || "";
      var cover = makeCdnUrl(coverRaw);
      var desc = manga.description || "";
      var genres = (manga.categories || []).map(function (c) { return c.name || ""; }).filter(Boolean);
      var status = manga.status || "ongoing";

      var chData = await apiGet("/manga/" + slug + "/chapters?limit=200&page=1");
      var allItems = chData.items || [];
      var unlockable = await unlockablePoints();
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
          // Keep the raw label ("3", "3-1"): extractNumber() collapses them
          // and the list then shows the same number twice.
          number: c.number != null ? String(c.number) : extractNumber(c.number),
          title: c.title || c.number || "",
          views: 0,
          url: baseUrl + "/chapters/" + c._id,
          // The app blocks a locked chapter and points the reader at the
          // original site. Only advertise it as locked while the account
          // cannot pay for it - otherwise the reader must be allowed in so
          // the source can spend the points and serve the pages.
          isLocked: isAdGated(c.number) && !unlockable,
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
      if (!chapterId) return { kind: "image", imageUrls: [] };

      var data = await apiGet("/chapters/" + chapterId);
      var chapter = data.chapter || data;
      if (chapter && chapter.adLocked === true) {
        if (await unlockAdChapter(chapterId)) {
          data = await apiGet("/chapters/" + chapterId);
          chapter = data.chapter || data;
        }
      }
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
        var unlockable = await unlockablePoints();

        var chapters = chItems.map(function (c) {
          return {
            number: c.number != null ? String(c.number) : extractNumber(c.number),
            title: c.title || c.number || "",
            views: 0,
            url: baseUrl + "/chapters/" + c._id,
            isLocked: isAdGated(c.number) && !unlockable,
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
