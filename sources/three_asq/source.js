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

  function extractImageValue(item, prefix) {
    var url = item[prefix + "DataSrc"] || item[prefix + "LazySrc"] || item[prefix + "Src"] || "";
    if (url.indexOf("data:image") === 0) url = item[prefix + "LazySrc"] || item[prefix + "Src"] || "";
    if (url.indexOf("data:image") === 0) return "";
    return url ? makeAbsolute(url) : "";
  }

  function cleanTitle(title) {
    return String(title || "").replace(/\s+/g, " ").trim();
  }

  function extractNumber(url, title) {
    var path = String(url || "");
    var segments = path.split("?")[0].replace(/\/$/, "").split("/");
    var last = segments.length ? segments[segments.length - 1] : "";
    var exact = last.match(/^(\d+(?:\.\d+)?)$/);
    if (exact) return exact[1];
    var text = path + " " + String(title || "");
    var match = text.match(/(?:chapter|ch|الفصل|فصل)[\s_.-]*(\d+(?:\.\d+)?)/i) || text.match(/(\d+(?:\.\d+)?)/);
    return match ? match[1] : "0";
  }

  async function firstText(html, selectorStr) {
    var list = String(selectorStr || "").split(",");
    for (var i = 0; i < list.length; i++) {
      var selector = list[i].trim();
      if (!selector) continue;
      var text = await api.cssText(html, selector);
      if (text && text.trim()) return text.trim();
      if (selector.indexOf("meta") !== -1) {
        var content = await api.cssAttr(html, selector, "content");
        if (content && content.trim()) return content.trim();
      }
    }
    return "";
  }

  async function firstAttr(html, selectorStr, attrs) {
    var selectorsList = String(selectorStr || "").split(",");
    for (var i = 0; i < selectorsList.length; i++) {
      var selector = selectorsList[i].trim();
      if (!selector) continue;
      for (var j = 0; j < attrs.length; j++) {
        var value = await api.cssAttr(html, selector, attrs[j]);
        if (value && String(value).trim()) return String(value).trim();
      }
    }
    return "";
  }

  async function toMangaList(html, listSel, opts) {
    if (!html) return [];
    opts = opts || {};
    var items = await api.cssMap(html, listSel || ".page-item-detail", {
      thumbTitle: { selector: ".item-thumb a", type: "attr", attr: "title" },
      mangaTitle: { selector: ".post-title h3 a[href*='/manga/'], .post-title a[href*='/manga/']", type: "text" },
      thumbHref: { selector: ".item-thumb a", type: "attr", attr: "href" },
      mangaHref: { selector: ".post-title h3 a[href*='/manga/'], .post-title a[href*='/manga/']", type: "attr", attr: "href" },
      coverDataSrc: { selector: ".item-thumb img, img", type: "attr", attr: "data-src" },
      coverLazySrc: { selector: ".item-thumb img, img", type: "attr", attr: "data-lazy-src" },
      coverSrc: { selector: ".item-thumb img, img", type: "attr", attr: "src" }
    });
    var results = [];
    var seen = {};
    if (items && items.length) {
      for (var i = 0; i < items.length; i++) {
        var item = items[i];
        var title = cleanTitle(item.thumbTitle || item.mangaTitle);
        var href = item.thumbHref || item.mangaHref || "";
        var detailUrl = makeAbsolute(href);
        if (!title || !detailUrl || seen[detailUrl] || detailUrl.indexOf("/feed/") !== -1) continue;
        seen[detailUrl] = true;
        results.push({
          title: title,
          detailUrl: detailUrl,
          coverUrl: extractImageValue(item, "cover"),
          contentType: "manga"
        });
      }
    }
    return results;
  }

  async function extractChapters(html) {
    if (!html) return [];
    var listSel = sel("chapter_list", ".wp-manga-chapter, li.wp-manga-chapter, .chapter-item");
    var items = [];
    try {
      items = await api.cssMap(html, listSel, {
        title: { selector: sel("chapter_title", "a"), type: "text" },
        href: { selector: sel("chapter_url", "a"), type: "attr", attr: "href" },
        date: { selector: sel("chapter_date", ".chapter-release-date i, .chapter-release-date, .timediff, .post-on"), type: "text" },
        locked: { selector: sel("chapter_locked", ".c-premium, .fa-lock"), type: "text" }
      });
    } catch (e) {}

    var chapters = [];
    var seen = {};
    if (items && items.length) {
      for (var i = 0; i < items.length; i++) {
        var item = items[i];
        var chapterUrl = makeAbsolute(item.href || "");
        if (!chapterUrl || seen[chapterUrl]) continue;
        seen[chapterUrl] = true;
        var title = cleanTitle(item.title);
        chapters.push({
          number: extractNumber(chapterUrl, title),
          title: title || ("الفصل " + extractNumber(chapterUrl, title)),
          views: 0,
          url: chapterUrl,
          isLocked: !!(item.locked && item.locked.trim()),
          date: cleanTitle(item.date)
        });
      }
    }

    if (!chapters.length) {
      var re = /<a[^>]+href="([^"]*(?:manga\/[^\/]+\/\d+|\/chapter-|\/ch-|\/الفصل)[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
      var m;
      while ((m = re.exec(html)) !== null) {
        var chUrl = makeAbsolute(m[1]);
        if (!chUrl || seen[chUrl] || chUrl.indexOf("/ajax/") !== -1) continue;
        seen[chUrl] = true;
        var t = cleanTitle(m[2]);
        if (t.length > 50) continue;
        chapters.push({
          number: extractNumber(chUrl, t),
          title: t || "الفصل",
          views: 0,
          url: chUrl,
          isLocked: false,
          date: ""
        });
      }
    }

    chapters.sort(function(a, b) { return (parseFloat(b.number) || 0) - (parseFloat(a.number) || 0); });
    return chapters;
  }

  async function fetchChapters(detailUrl, detailHtml) {
    var direct = await extractChapters(detailHtml);
    if (direct && direct.length) return direct;

    var ajaxUrl = detailUrl.replace(/\/+$/, "") + "/ajax/chapters/";
    try {
      var ajaxHtml = await fetchHtml(ajaxUrl, {
        "Referer": detailUrl
      }, "POST", "");
      if (ajaxHtml && ajaxHtml.indexOf("<") !== -1) {
        var ajaxChapters = await extractChapters(ajaxHtml);
        if (ajaxChapters.length) return ajaxChapters;
      }
    } catch (e) {}

    return [];
  }

  function isValidImageUrl(url) {
    if (!url) return false;
    var lower = url.toLowerCase();
    if (lower.indexOf(".svg") !== -1) return false;
    if (lower.indexOf(".gif") !== -1 && lower.indexOf("icon") !== -1) return false;
    if (lower.indexOf("data:") === 0) return false;
    return true;
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
        return await toMangaList(html, sel("homepage_list", ".page-item-detail"));
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
        return await toMangaList(html, sel("search_list", ".c-tabs-item__content, .page-item-detail"));
      } catch (e) {
        return [];
      }
    },

    async getMangaDetails(args) {
      var url = makeAbsolute((args && args.url) || "");
      var html = await fetchHtml(url);
      var title = await firstText(html, sel("manga_title", ".post-title h1, meta[property='og:title']"));
      var cover = await firstAttr(html, sel("manga_cover", ".summary_image img, meta[property='og:image']"), ["data-src", "data-lazy-src", "src", "content"]);
      var description = await firstText(html, sel("manga_description", ".description-summary, .manga-excerpt"));
      var genres = await api.cssList(html, sel("manga_genres", ".genres-content a"));
      var chapters = await fetchChapters(url, html);
      return {
        title: cleanTitle(title) || "بدون عنوان",
        coverUrl: cover ? makeAbsolute(cover) : "",
        description: cleanTitle(description).replace("متابعة قراءة", "").trim(),
        genres: genres.map(function(g) { return cleanTitle(g); }).filter(function(g) { return !!g; }),
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
      var images = await api.cssMap(html, sel("chapter_page_image", ".reading-content .page-break img"), {
        dataSrc: { selector: "", type: "attr", attr: "data-src" },
        lazy: { selector: "", type: "attr", attr: "data-lazy-src" },
        src: { selector: "", type: "attr", attr: "src" }
      });
      var urls = [];
      for (var i = 0; i < images.length; i++) {
        var src = images[i].dataSrc || images[i].lazy || images[i].src || "";
        src = makeAbsolute(src);
        if (isValidImageUrl(src) && urls.indexOf(src) === -1) urls.push(src);
      }
      return urls;
    },

    async getChapterContent(args) {
      return { kind: "image", imageUrls: await this.getChapterPages(args) };
    },

    async getFilteredManga(args) {
      try {
        var page = (args && args.page) || 1;
        var params = ["m_orderby=latest"];
        if (args && args.genre) params.push("genre[]=" + encodeURIComponent(args.genre));
        if (args && args.type) params.push("type=" + encodeURIComponent(args.type));
        var url = page === 1
          ? baseUrl + "/manga/?" + params.join("&")
          : baseUrl + "/manga/page/" + page + "/?" + params.join("&");
        var html = await fetchHtml(url);
        return await toMangaList(html, sel("homepage_list", ".page-item-detail"));
      } catch (e) {
        return await this.getHomepageManga(args || {});
      }
    },

    async getGenresAndTypes() {
      try {
        var html = await fetchHtml(baseUrl + "/manga/");
        var genres = await api.cssList(html, ".list-unstyled li label, .genres-content a");
        genres = genres.map(function(g) { return cleanTitle(g); }).filter(function(g) { return !!g; });
        return { genres: genres.length ? genres : defaultGenres, types: defaultTypes };
      } catch (e) {
        return { genres: defaultGenres, types: defaultTypes };
      }
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
