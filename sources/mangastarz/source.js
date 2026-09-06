function createSource(api, config) {
  var baseUrl = (config && config.base_url) || "https://starzmanga.com";
  var selectors = (config && config.selectors) || {};
  var userAgent = (config && config.user_agent) || "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";

  var defaultHeaders = {
    "User-Agent": userAgent,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "ar,en-US;q=0.9,en;q=0.8",
    "Referer": baseUrl + "/",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "same-origin",
    "Upgrade-Insecure-Requests": "1"
  };

  var lastChapterUrl = baseUrl + "/";
  var defaultGenres = [
    "أكشن", "مغامرة", "خيال", "فنتازيا", "دراما", "رومانسي", "كوميدي", "شونين",
    "رعب", "خارق للطبيعة", "نفسي", "غموض", "حياة مدرسية", "رياضة", "تاريخي", "شريحة من الحياة"
  ];
  var defaultTypes = ["مانجا", "مانهوا", "مانهوا صيني"];

  function sel(key, fallback) {
    return selectors[key] || fallback;
  }

  async function fetchHtml(url, extraHeaders, method, postBody) {
    var headers = {};
    for (var k in defaultHeaders) headers[k] = defaultHeaders[k];
    if (extraHeaders) for (var x in extraHeaders) headers[x] = extraHeaders[x];

    if (method === "POST") {
      headers["X-Requested-With"] = "XMLHttpRequest";
      headers["Content-Type"] = "application/x-www-form-urlencoded; charset=UTF-8";
      headers["Accept"] = "*/*";
    }

    // 1. Primary: Fast direct HTTP via api.http
    if (api.http) {
      var reqOpts = { method: method || "GET", headers: headers };
      if (postBody !== undefined && postBody !== null) reqOpts.body = postBody;
      try {
        var res = await api.http(url, reqOpts);
        if (res && res.ok && res.body && res.body.length > 200) return res.body;
      } catch (eHttp) {}
    }

    // 2. Secondary fallback: Headless WebView solver (fast 10s timeout)
    if (typeof api.browser === "function" && (!method || method === "GET")) {
      try {
        var rendered = await api.browser(url, {
          waitForSelector: ".page-item-detail, .post-title, .wp-manga-chapter",
          timeoutSeconds: 10
        });
        if (rendered && rendered.length > 500) return rendered;
      } catch (eBrowser) {}
    }

    // 3. Tertiary fallback: direct fetchText
    if (method && method !== "GET") return "";
    try {
      var html = await api.fetchText(url, headers);
      if (html && html.length > 100) return html;
    } catch (eFetch) {}

    return "";
  }

  function makeAbsolute(url) {
    if (!url) return "";
    url = String(url).trim();
    if (url.indexOf("http://") === 0) return "https:" + url.substring(5);
    if (url.indexOf("https://") === 0) return url;
    if (url.indexOf("//") === 0) return "https:" + url;
    if (url.indexOf("/") === 0) return baseUrl.replace(/\/$/, "") + url;
    return baseUrl.replace(/\/$/, "") + "/" + url;
  }

  function cleanTitle(title) {
    return String(title || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  }

  function extractNumber(url, title) {
    var path = String(url || "");
    var segments = path.split("?")[0].replace(/\/$/, "").split("/");
    var last = segments.length ? segments[segments.length - 1] : "";
    var exact = last.match(/^(\d+(?:\.\d+)?)$/);
    if (exact) return exact[1];
    var t = String(title || "");
    var match = t.match(/(?:chapter|ch|الفصل|فصل)[\s_.-]*(\d+(?:\.\d+)?)/i) || t.match(/(\d+(?:\.\d+)?)/);
    return match ? match[1] : "0";
  }

  function parseMangaListFast(html) {
    if (!html) return [];
    var results = [];
    var seen = {};

    var itemRe = /<div[^>]*class="[^"]*page-item-detail[^"]*"[^>]*>([\s\S]*?)(?=<div[^>]*class="[^"]*page-item-detail[^"]*"|$)/gi;
    var m;
    while ((m = itemRe.exec(html)) !== null) {
      var block = m[1];

      // Title
      var postM = block.match(/<div[^>]*class="[^"]*post-title[^"]*"[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i);
      var thumbM = block.match(/<div[^>]*class="[^"]*item-thumb[^"]*"[^>]*>[\s\S]*?<a[^>]*title="([^"]*)"/i);

      var title = "";
      if (postM && postM[1] && postM[1].trim()) {
        title = cleanTitle(postM[1]);
      } else if (thumbM && thumbM[1] && thumbM[1].trim()) {
        title = cleanTitle(thumbM[1]);
      }

      // Href
      var hrefM = block.match(/<div[^>]*class="[^"]*item-thumb[^"]*"[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"/i) ||
                  block.match(/<div[^>]*class="[^"]*post-title[^"]*"[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"/i) ||
                  block.match(/<a[^>]+href="([^"]*\/manga\/[^"]+)"/i);
      var href = hrefM ? hrefM[1].trim() : "";
      var detailUrl = makeAbsolute(href);

      if (!title || !detailUrl || seen[detailUrl] || detailUrl.indexOf("/feed/") !== -1) continue;
      seen[detailUrl] = true;

      // Cover
      var coverM = block.match(/<img[^>]+(?:data-src|data-lazy-src|src)="([^"]+)"/i);
      var cover = coverM ? coverM[1].trim() : "";
      if (cover.indexOf("data:image") === 0) cover = "";

      results.push({
        title: title,
        detailUrl: detailUrl,
        coverUrl: cover ? makeAbsolute(cover) : "",
        contentType: "manga"
      });
    }

    return results;
  }

  function parseMangaDetailsFast(html, url) {
    var title = "";
    var titleM = html.match(/<div[^>]*class="[^"]*post-title[^"]*"[^>]*>[\s\S]*?<h1[^>]*>([\s\S]*?)<\/h1>/i) ||
                 html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]+)"/i);
    if (titleM) title = cleanTitle(titleM[1]);

    var cover = "";
    var coverM = html.match(/<div[^>]*class="[^"]*summary_image[^"]*"[^>]*>[\s\S]*?<img[^>]+(?:data-src|data-lazy-src|src)="([^"]+)"/i) ||
                 html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]+)"/i);
    if (coverM) cover = makeAbsolute(coverM[1]);

    var desc = "";
    var descM = html.match(/<div[^>]*class="[^"]*(?:description-summary|summary__content|manga-excerpt)[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    if (descM) desc = cleanTitle(descM[1]).replace(/متابعة قراءة/g, "").trim();

    var genres = [];
    var genresBlock = html.match(/<div[^>]*class="[^"]*genres-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    if (genresBlock) {
      var gRe = /<a[^>]*>([^<]+)<\/a>/gi;
      var gm;
      while ((gm = gRe.exec(genresBlock[1])) !== null) {
        var g = cleanTitle(gm[1]);
        if (g && genres.indexOf(g) === -1) genres.push(g);
      }
    }

    return {
      title: title || "بدون عنوان",
      coverUrl: cover,
      description: desc,
      genres: genres
    };
  }

  function parseChaptersFast(html) {
    if (!html) return [];
    var chapters = [];
    var seen = {};

    var liRe = /<(?:li|div)[^>]*class="[^"]*wp-manga-chapter[^"]*"[^>]*>([\s\S]*?)<\/(?:li|div)>/gi;
    var lm;
    while ((lm = liRe.exec(html)) !== null) {
      var block = lm[1];
      var aM = block.match(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
      if (!aM) continue;
      var chUrl = makeAbsolute(aM[1]);
      if (!chUrl || seen[chUrl] || chUrl.indexOf("/ajax/") !== -1) continue;
      seen[chUrl] = true;

      var rawTitle = cleanTitle(aM[2]);
      var num = extractNumber(chUrl, rawTitle);

      var dateM = block.match(/<span[^>]*class="[^"]*(?:chapter-release-date|timediff|post-on)[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
      var date = dateM ? cleanTitle(dateM[1]) : "";
      var isLocked = /fa-lock|premium|c-premium|premium-chapter/i.test(block);

      chapters.push({
        number: num,
        title: rawTitle || ("الفصل " + num),
        views: 0,
        url: chUrl,
        isLocked: isLocked,
        date: date
      });
    }

    if (!chapters.length) {
      var aRe = /<a[^>]+href="([^"]*(?:manga\/[^\/]+\/\d+|\/chapter-|\/ch-|\/الفصل)[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
      var am;
      while ((am = aRe.exec(html)) !== null) {
        var chUrlFallback = makeAbsolute(am[1]);
        if (!chUrlFallback || seen[chUrlFallback] || chUrlFallback.indexOf("/ajax/") !== -1) continue;
        seen[chUrlFallback] = true;
        var t = cleanTitle(am[2]);
        if (t.length > 50) continue;
        var numFallback = extractNumber(chUrlFallback, t);
        chapters.push({
          number: numFallback,
          title: t || ("الفصل " + numFallback),
          views: 0,
          url: chUrlFallback,
          isLocked: false,
          date: ""
        });
      }
    }

    chapters.sort(function(a, b) {
      return (parseFloat(b.number) || 0) - (parseFloat(a.number) || 0);
    });
    return chapters;
  }

  function parseChapterPagesFast(html) {
    if (!html) return [];
    var urls = [];

    // Filter by page-break container to avoid header/footer promos
    var pbRe = /<div[^>]*class="[^"]*page-break[^"]*"[^>]*>[\s\S]*?<img[^>]+(?:data-src|data-lazy-src|src)=["']([^"']+)["']/gi;
    var pbm;
    while ((pbm = pbRe.exec(html)) !== null) {
      var pu = makeAbsolute(pbm[1].trim());
      if (pu && pu.indexOf("data:image") === -1 && urls.indexOf(pu) === -1) {
        urls.push(pu);
      }
    }

    // Fallback if no page-break container
    if (!urls.length) {
      var imgRe = /<img[^>]+class="[^"]*wp-manga-chapter-img[^"]*"[^>]*>/gi;
      var m;
      while ((m = imgRe.exec(html)) !== null) {
        var srcM = m[0].match(/(?:data-src|data-lazy-src|src)="([^"]+)"/i);
        if (srcM) {
          var u = makeAbsolute(srcM[1].trim());
          if (u && u.indexOf("data:image") === -1 && urls.indexOf(u) === -1) {
            urls.push(u);
          }
        }
      }
    }

    return urls;
  }

  function normalizeUrl(url) {
    if (!url) return url;
    if (url.indexOf(baseUrl) === 0) return url;
    if (url.indexOf("http://") === 0 || url.indexOf("https://") === 0) {
      var pathMatch = url.match(/^https?:\/\/[^/]+(\/.*)$/);
      return baseUrl.replace(/\/$/, "") + (pathMatch ? pathMatch[1] : "/");
    }
    return makeAbsolute(url);
  }

  return {
    requiresCloudflare: false,

    async getHomepageManga(args) {
      try {
        var page = (args && args.page) || 1;
        // Primary URL: starzmanga root gives 20 cards per page
        var url = page === 1 ? baseUrl + "/" : baseUrl + "/page/" + page + "/";
        var html = await fetchHtml(url);
        var list = parseMangaListFast(html);

        // Fallback to /manga/?m_orderby=latest if root returns no cards
        if (!list.length) {
          var fallbackUrl = page === 1
            ? baseUrl + "/manga/?m_orderby=latest"
            : baseUrl + "/manga/page/" + page + "/?m_orderby=latest";
          var fallbackHtml = await fetchHtml(fallbackUrl);
          list = parseMangaListFast(fallbackHtml);
        }

        return list;
      } catch (e) {
        return [];
      }
    },

    async search(args) {
      try {
        var query = (args && args.query) || "";
        var page = (args && args.page) || 1;
        if (!query.trim()) return [];
        var url = page === 1
          ? baseUrl + "/?s=" + encodeURIComponent(query) + "&post_type=wp-manga"
          : baseUrl + "/page/" + page + "/?s=" + encodeURIComponent(query) + "&post_type=wp-manga";
        var html = await fetchHtml(url);
        return parseMangaListFast(html);
      } catch (e) {
        return [];
      }
    },

    async getMangaDetails(args) {
      var url = normalizeUrl((args && args.url) || "");
      var html = await fetchHtml(url);
      var meta = parseMangaDetailsFast(html, url);

      // Extract chapters directly from detail HTML
      var chapters = parseChaptersFast(html);

      // If detail HTML has no chapters, fallback to ajax endpoint
      if (!chapters.length) {
        var ajaxUrl = url.replace(/\/+$/, "") + "/ajax/chapters/";
        try {
          var ajaxHtml = await fetchHtml(ajaxUrl, {
            "Referer": url,
            "X-Requested-With": "XMLHttpRequest",
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"
          }, "POST", "");
          if (ajaxHtml && ajaxHtml.indexOf("<") !== -1) {
            chapters = parseChaptersFast(ajaxHtml);
          }
        } catch (eAjax) {}
      }

      return {
        title: meta.title,
        coverUrl: meta.coverUrl,
        description: meta.description,
        genres: meta.genres,
        chapters: chapters,
        originalUrl: url,
        hasMoreChapters: false,
        lastFetchedPage: 1,
        contentType: "manga"
      };
    },

    async getChapterPages(args) {
      var chapterUrl = normalizeUrl((args && args.url) || "");
      lastChapterUrl = chapterUrl || lastChapterUrl;
      var html = await fetchHtml(chapterUrl);
      return parseChapterPagesFast(html);
    },

    async getChapterContent(args) {
      return { kind: "image", imageUrls: await this.getChapterPages(args) };
    },

    async getFilteredManga(args) {
      try {
        var page = (args && args.page) || 1;
        var params = ["post_type=wp-manga"];
        if (args && args.genre) params.push("genre[]=" + encodeURIComponent(args.genre));
        if (args && args.type) params.push("manga-type=" + encodeURIComponent(args.type));
        var url = page === 1
          ? baseUrl + "/?s=&" + params.join("&")
          : baseUrl + "/page/" + page + "/?s=&" + params.join("&");
        var html = await fetchHtml(url);
        return parseMangaListFast(html);
      } catch (e) {
        return [];
      }
    },

    async getGenresAndTypes() {
      return { genres: defaultGenres, types: defaultTypes };
    },

    async fetchMoreChapters() {
      return null;
    },

    getImageHeaders() {
      return {
        "User-Agent": userAgent,
        "Referer": lastChapterUrl || baseUrl + "/",
        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "Accept-Language": "ar,en-US;q=0.9,en;q=0.8",
        "Sec-Fetch-Dest": "image",
        "Sec-Fetch-Mode": "no-cors",
        "Sec-Fetch-Site": "cross-site"
      };
    },

    sanitizeCoverUrl(args) {
      return makeAbsolute((args && args.url) || "");
    },

    getFilterOptions() {
      return {
        genres: defaultGenres,
        types: defaultTypes,
        sortOptions: ["latest", "alphabet", "rating", "trending", "views", "new-manga"]
      };
    }
  };
}
