function createSource(api, config) {
  var baseUrl = (config && config.base_url) || "https://3asq.online";
  var selectors = (config && config.selectors) || {};
  var userAgent = (config && config.user_agent) || "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";

  var defaultHeaders = {
    "User-Agent": userAgent,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "ar,en-US;q=0.9,en;q=0.8",
    "Referer": baseUrl + "/"
  };

  var lastChapterUrl = baseUrl + "/";
  var defaultGenres = ["أكشن", "مغامرة", "خيال", "دراما", "رومانسي", "شونين", "سينين", "شريحة من الحياة", "نفسي", "غموض"];
  var defaultTypes = ["manga", "manhwa", "manhua", "novel"];

  // Arabic genre name -> /manga-genre/ slug (scraped from site filter menu).
  // The site IGNORES ?genre[]= query params, so filtering must use these URLs.
  var genreSlugMap = {
    "أكشن": "action", "مغامرة": "adventure", "خيال": "fantasy", "دراما": "drama",
    "رومانسي": "romance", "رومانسية": "romance", "شونين": "shounen", "سينين": "seinen",
    "شريحة من الحياة": "slice-of-life", "نفسي": "psychological", "غموض": "mystery",
    "كوميديا": "comedy", "رعب": "horror", "خارق للطبيعة": "supernatural",
    "خيال علمي": "sci-fi", "فنون قتالية": "martial-arts", "قوى خارقة": "super-powers",
    "مدرسة": "school-life", "رياضة": "sports", "تاريخ": "historical", "حريم": "harem",
    "شوجو": "shoujo", "جوسي": "josei", "مأساة": "tragedy", "نفسي ": "psychological",
    "علم نفس": "psychological", "شياطين": "demons", "مدرسي": "school-life",
    "إيسيكاي": "isekai", "إيتشي": "ecchi", "عسكري": "military", "عسكرية": "military",
    "ميكا": "mecha", "غموض ": "mystery", "فلسفة": "philosophy", "جريمة": "crime",
    "حرب": "war", "نينجا": "ninja", "ساموراي": "samurai", "مصاصي دماء": "vampires"
  };

  function genreToSlug(genre) {
    var g = String(genre || "").trim();
    if (!g) return "";
    if (genreSlugMap[g]) return genreSlugMap[g];
    // Already a slug? (ascii, dashes)
    if (/^[a-z0-9-]+$/i.test(g)) return g.toLowerCase();
    return "";
  }

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
      try {
        var reqOpts = { method: method || "GET", headers: headers };
        if (postBody !== undefined && postBody !== null) reqOpts.body = postBody;
        var res = await api.http(url, reqOpts);
        if (res && res.ok && res.body && res.body.length > 200) {
          return res.body;
        }
      } catch (eHttp) {}
    }

    // 2. Secondary fallback: Headless WebView solver (fast 8s timeout)
    if (typeof api.browser === "function" && (!method || method === "GET")) {
      try {
        var rendered = await api.browser(url, {
          waitForSelector: ".page-item-detail, .post-title, .wp-manga-chapter",
          timeoutSeconds: 8
        });
        if (rendered && rendered.length > 500) {
          return rendered;
        }
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

      // Title & URL: prioritize .item-thumb a (has clean manga title and direct manga URL)
      var thumbM = block.match(/<div[^>]*class="[^"]*item-thumb[^"]*"[^>]*>[\s\S]*?<a[^>]*href="([^"]*)"[^>]*title="([^"]*)"/i);
      var postM = block.match(/<div[^>]*class="[^"]*post-title[^"]*"[^>]*>[\s\S]*?<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i);

      var title = "";
      var href = "";

      if (thumbM && thumbM[2] && thumbM[2].trim()) {
        title = cleanTitle(thumbM[2]);
        href = thumbM[1] ? thumbM[1].trim() : "";
      } else if (postM) {
        title = cleanTitle(postM[2]);
        href = postM[1] ? postM[1].trim() : "";
      }

      if (!href && thumbM && thumbM[1]) href = thumbM[1].trim();

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

    // Search results use .tab-thumb blocks (no .page-item-detail wrapper):
    // <div class="tab-thumb ..."><a href="URL" title="TITLE"><img src="COVER">
    if (!results.length) {
      var tabRe = /<div[^>]*class="[^"]*tab-thumb[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
      var tm;
      while ((tm = tabRe.exec(html)) !== null) {
        var tblock = tm[1];
        var taM = tblock.match(/<a[^>]*href="([^"]*)"[^>]*title="([^"]*)"/i) ||
                  tblock.match(/<a[^>]*title="([^"]*)"[^>]*href="([^"]*)"/i);
        var tHref = "";
        var tTitle = "";
        if (taM) {
          // normalize: first alternative gives (href, title), second gives (title, href)
          if (tblock.match(/<a[^>]*href="([^"]*)"[^>]*title="([^"]*)"/i)) {
            tHref = (taM[1] || "").trim();
            tTitle = cleanTitle(taM[2]);
          } else {
            tTitle = cleanTitle(taM[1]);
            tHref = (taM[2] || "").trim();
          }
        } else {
          var soloA = tblock.match(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i);
          if (soloA) {
            tHref = (soloA[1] || "").trim();
            tTitle = cleanTitle(soloA[2]);
          }
        }
        var tDetailUrl = makeAbsolute(tHref);
        if (!tTitle || !tDetailUrl || seen[tDetailUrl]) continue;
        seen[tDetailUrl] = true;
        var tCoverM = tblock.match(/<img[^>]+(?:data-src|data-lazy-src|src)="([^"]+)"/i);
        var tCover = tCoverM ? tCoverM[1].trim() : "";
        if (tCover.indexOf("data:image") === 0) tCover = "";
        results.push({
          title: tTitle,
          detailUrl: tDetailUrl,
          coverUrl: tCover ? makeAbsolute(tCover) : "",
          contentType: "manga"
        });
      }
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
      var isLocked = /fa-lock|premium|c-premium/i.test(block);

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

    // Fallback if no .wp-manga-chapter-img class found
    if (!urls.length) {
      var pbRe = /<div[^>]*class="[^"]*page-break[^"]*"[^>]*>[\s\S]*?<img[^>]+(?:data-src|data-lazy-src|src)=["']([^"']+)["']/gi;
      var pbm;
      while ((pbm = pbRe.exec(html)) !== null) {
        var pu = makeAbsolute(pbm[1].trim());
        if (pu && pu.indexOf("data:image") === -1 && urls.indexOf(pu) === -1) {
          urls.push(pu);
        }
      }
    }

    return urls;
  }

  return {
    requiresCloudflare: false,

    async getHomepageManga(args) {
      try {
        var page = (args && args.page) || 1;
        var url = page === 1
          ? baseUrl + "/manga/?m_orderby=latest"
          : baseUrl + "/manga/page/" + page + "/?m_orderby=latest";
        var html = await fetchHtml(url);
        return parseMangaListFast(html);
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
      var url = makeAbsolute((args && args.url) || "");
      var html = await fetchHtml(url);
      var meta = parseMangaDetailsFast(html, url);

      // Fast chapters retrieval: Ajax endpoint returns all chapters (up to 400+)
      var chapters = [];
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

      // Fallback to detail HTML if ajax returned no chapters
      if (!chapters.length) {
        chapters = parseChaptersFast(html);
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
      var chapterUrl = makeAbsolute((args && args.url) || "");
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
        // NOTE: the site IGNORES ?genre[]=/ ?type= query params (returns unfiltered
        // latest list), so genre filtering must use /manga-genre/{slug}/ URLs.
        var slug = genreToSlug(args && args.genre);
        var url;
        if (slug) {
          url = page === 1
            ? baseUrl + "/manga-genre/" + slug + "/"
            : baseUrl + "/manga-genre/" + slug + "/page/" + page + "/";
        } else {
          url = page === 1
            ? baseUrl + "/manga/?m_orderby=latest"
            : baseUrl + "/manga/page/" + page + "/?m_orderby=latest";
        }
        var html = await fetchHtml(url);
        return parseMangaListFast(html);
      } catch (e) {
        return await this.getHomepageManga(args || {});
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
