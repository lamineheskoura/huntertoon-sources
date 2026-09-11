function createSource(api, config) {
  var baseUrl = (config && config.base_url) || "https://mangalik.net";
  var selectors = (config && config.selectors) || {};

  var userAgent = (config && config.user_agent) || "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
  var cloudflareUserAgent = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
  var defaultHeaders = {
    "User-Agent": userAgent,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9,ar;q=0.8",
    "Referer": baseUrl + "/",
    "Origin": baseUrl,
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
    // 1. Primary: fast direct HTTP via api.http
    if (api.http) {
      try {
        var reqOpts = { method: method || "GET", headers: headers };
        if (postBody !== undefined && postBody !== null) reqOpts.body = postBody;
        var res = await api.http(url, reqOpts);
        if (res && res.ok && res.body && res.body.length > 200) return res.body;
      } catch (eHttp) {}
    }
    // 2. Secondary: headless WebView solver for CF-challenged pages
    if (typeof api.browser === "function" && (!method || method === "GET")) {
      try {
        var rendered = await api.browser(url, {
          waitForSelector: ".page-item-detail, .post-title, .wp-manga-chapter",
          timeoutSeconds: 10
        });
        if (rendered && rendered.length > 500) return rendered;
      } catch (eBrowser) {}
    }
    // 3. Tertiary: direct fetchText
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
    if (url.indexOf("http://") === 0) return "https://" + url.substring(7);
    if (url.indexOf("https://") === 0) return url;
    if (url.indexOf("//") === 0) return "https:" + url;
    if (url.indexOf("/") === 0) return baseUrl.replace(/\/$/, "") + url;
    return baseUrl.replace(/\/$/, "") + "/" + url;
  }

  function cleanTitle(title) {
    return String(title || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  }

  // Search-result fallback: .tab-thumb blocks (no .page-item-detail wrapper).
  function parseTabThumbList(html) {
    if (!html) return [];
    var results = [];
    var seen = {};
    var tabRe = /<div[^>]*class="[^"]*tab-thumb[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
    var tm;
    while ((tm = tabRe.exec(html)) !== null) {
      var block = tm[1];
      var href = "", title = "";
      var m1 = block.match(/<a[^>]*href="([^"]+)"[^>]*title="([^"]*)"/i);
      var m2 = !m1 && block.match(/<a[^>]*title="([^"]*)"[^>]*href="([^"]+)"/i);
      if (m1) {
        href = m1[1].trim();
        title = cleanTitle(m1[2]);
      } else if (m2) {
        title = cleanTitle(m2[1]);
        href = m2[2].trim();
      } else {
        var m3 = block.match(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
        if (m3) {
          href = m3[1].trim();
          title = cleanTitle(m3[2]);
        }
      }
      var detailUrl = makeAbsolute(href);
      if (!title || !detailUrl || seen[detailUrl]) continue;
      seen[detailUrl] = true;
      var cover = "";
      var cm = block.match(/<img[^>]+(?:data-src|data-lazy-src|src)="([^"]+)"/i);
      if (cm) cover = makeAbsolute(cm[1].trim());
      if (cover.indexOf("data:image") === 0) cover = "";
      results.push({ title: title, detailUrl: detailUrl, coverUrl: cover, contentType: "manga" });
    }
    return results;
  }

  function extractNumber(url, title) {
    var text = String(url || "") + " " + String(title || "");
    var m = text.match(/(?:chapter|ch|الفصل|فصل)[- _]*(\d+(?:\.\d+)?)/i) || text.match(/(\d+(?:\.\d+)?)/);
    return m ? m[1] : "0";
  }

  async function toMangaList(html, listSel, opts) {
    opts = opts || {};
    var items = await api.cssMap(html, listSel, {
      title: { selector: opts.titleSel, type: "text" },
      href: { selector: opts.urlSel || opts.titleSel, type: "attr", attr: "href" },
      cover: { selector: opts.coverSel, type: "attr", attr: "data-src" },
      coverLazy: { selector: opts.coverSel, type: "attr", attr: "data-lazy-src" },
      coverSrc: { selector: opts.coverSel, type: "attr", attr: "src" }
    });
    var results = [];
    var seen = {};
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var title = (item.title || "").trim();
      var detailUrl = makeAbsolute(item.href || "");
      if (!title || !detailUrl || seen[detailUrl]) continue;
      seen[detailUrl] = true;
      var cover = item.cover || item.coverLazy || item.coverSrc || "";
      if (cover.indexOf("data:image") !== -1) cover = "";
      results.push({ title: title, detailUrl: detailUrl, coverUrl: cover, contentType: "manga" });
    }
    return results;
  }

  async function extractChapters(html) {
    var listSel = sel("chapter_list", ".wp-manga-chapter, li.wp-manga-chapter");
    var dateSel = sel("chapter_date", ".chapter-release-date i, .chapter-release-date");
    var lockSel = sel("chapter_locked", ".premium-chapter, .c-premium, .fa-lock, .premium-block");
    var items = await api.cssMap(html, listSel, {
      title: { selector: "a", type: "text" },
      href: { selector: "a", type: "attr", attr: "href" },
      date: { selector: dateSel, type: "text" },
      locked: { selector: lockSel, type: "text" }
    });
    var chapters = [];
    var seen = {};
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var chapterUrl = makeAbsolute(item.href || "");
      if (!chapterUrl || seen[chapterUrl]) continue;
      seen[chapterUrl] = true;
      var title = (item.title || "").trim();
      chapters.push({
        number: extractNumber(chapterUrl, title),
        title: title,
        views: 0,
        url: chapterUrl,
        isLocked: !!(item.locked && item.locked.trim()),
        date: (item.date || "").trim()
      });
    }
    return chapters;
  }

  function normalizeUrl(url) {
    if (!url) return url;
    url = String(url).trim();
    url = url.replace(/([?&])style=(paged|list)\b/gi, "$1").replace(/[?&]$/, "");
    if (url.indexOf(baseUrl) === 0) return url;
    if (url.indexOf("http://") === 0 || url.indexOf("https://") === 0) {
      var pathMatch = url.match(/^https?:\/\/[^/]+(\/.*)$/);
      return baseUrl.replace(/\/$/, "") + (pathMatch ? pathMatch[1] : "/");
    }
    return makeAbsolute(url);
  }

  return {
    requiresCloudflare: true,

    async getHomepageManga(args) {
      try {
        var page = (args && args.page) || 1;
        // Primary: front page (/) + /page/N/ (proven wp-pagenavi scheme).
        // Fallback: /manga/ archive pagination.
        var urls = page === 1
          ? [baseUrl + "/", baseUrl + "/manga/?m_orderby=latest"]
          : [baseUrl + "/page/" + page + "/", baseUrl + "/manga/page/" + page + "/?m_orderby=latest"];
        for (var i = 0; i < urls.length; i++) {
          var html = await fetchHtml(urls[i]);
          var list = await toMangaList(html, sel("homepage_list", ".page-item-detail"), {
            titleSel: sel("homepage_title", ".post-title h3 a, .post-title h5 a, .post-title h4 a, .post-title a"),
            coverSel: sel("homepage_cover", ".item-thumb a img, .item-thumb img"),
            urlSel: sel("homepage_url", ".post-title h3 a, .post-title h5 a, .post-title h4 a, .post-title a")
          });
          if (list.length) return list;
        }
        return [];
      } catch (e) {
        return [];
      }
    },

    async search(args) {
      try {
        var query = (args && args.query) || "";
        var page = (args && args.page) || 1;
        if (!query.trim()) return [];
        var html = await fetchHtml(baseUrl + "/page/" + page + "/?s=" + encodeURIComponent(query) + "&post_type=wp-manga");
        var list = await toMangaList(html, sel("search_list", ".c-tabs-item__content"), {
          titleSel: sel("search_title", ".post-title h3 a, .post-title h4 a"),
          coverSel: sel("search_cover", ".tab-thumb a img"),
          urlSel: sel("search_title", ".post-title h3 a, .post-title h4 a")
        });
        if (!list.length) list = parseTabThumbList(html);
        return list;
      } catch (e) {
        return [];
      }
    },

    async getMangaDetails(args) {
      var url = normalizeUrl((args && args.url) || "");
      var html = await fetchHtml(url);
      if (!html) throw new Error("Empty response: " + url);
      var title = await api.cssText(html, sel("manga_title", ".post-title h1"));
      if (!title) title = await api.cssText(html, sel("manga_title_h2", ".post-title h2"));
      if (!title) title = await api.cssAttr(html, "meta[property='og:title']", "content");
      var cover = await api.cssAttr(html, sel("manga_cover", ".summary_image img"), "data-src");
      if (!cover) cover = await api.cssAttr(html, sel("manga_cover", ".summary_image img"), "data-lazy-src");
      if (!cover) cover = await api.cssAttr(html, sel("manga_cover", ".summary_image img"), "src");
      if (!cover) cover = await api.cssAttr(html, "meta[property='og:image']", "content");
      var description = await api.cssText(html, sel("manga_description", ".description-summary .summary__content, .description-summary"));
      var genres = await api.cssList(html, sel("manga_genres", ".genres-content a"));
      var chapters = await extractChapters(html);
      if (!chapters.length) {
        var ajaxUrl = url.replace(/\/+$/, "") + "/ajax/chapters/";
        try {
          var ajaxHtml = await fetchHtml(ajaxUrl, { "Referer": url }, "POST", "");
          if (ajaxHtml) chapters = await extractChapters(ajaxHtml);
        } catch (eAjax) {}
      }
      return {
        title: (title || "بدون عنوان").trim(),
        coverUrl: cover || "",
        description: (description || "").replace(/\s+/g, " ").trim(),
        genres: genres.map(function (g) { return String(g).trim(); }).filter(function (g) { return !!g; }),
        chapters: chapters,
        originalUrl: url,
        hasMoreChapters: false,
        lastFetchedPage: 1,
        contentType: "manga"
      };
    },

    async getChapterPages(args) {
      var chapterUrl = normalizeUrl((args && args.url) || "");
      lastChapterUrl = chapterUrl;
      var html = await fetchHtml(chapterUrl);
      var imgSel = sel("chapter_page_image", "#readerarea img, .reader-area img, .reading-content img, .reading-content .page-break img, .page-break img, .wp-manga-chapter-img");
      var images = await api.cssMap(html, imgSel, {
        dataSrc: { selector: "", type: "attr", attr: "data-src" },
        lazy: { selector: "", type: "attr", attr: "data-lazy-src" },
        orig: { selector: "", type: "attr", attr: "data-original" },
        srcset: { selector: "", type: "attr", attr: "srcset" },
        src: { selector: "", type: "attr", attr: "src" }
      });
      var urls = [];
      for (var i = 0; i < images.length; i++) {
        var raw = images[i].dataSrc || images[i].lazy || images[i].orig || images[i].src || "";
        if (!raw && images[i].srcset) {
          raw = String(images[i].srcset).split(",")[0].trim().split(/\s+/)[0];
        }
        var src = makeAbsolute(String(raw || "").trim());
        if (src && src.indexOf("data:image") === -1 && urls.indexOf(src) === -1) urls.push(src);
      }
      return urls;
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
        var html = await fetchHtml(baseUrl + "/page/" + page + "/?s=&" + params.join("&"));
        return await toMangaList(html, ".page-item-detail, .c-tabs-item__content", {
          titleSel: ".post-title h3 a, .post-title h4 a, .post-title h5 a",
          coverSel: ".item-thumb a img, .tab-thumb a img",
          urlSel: ".post-title h3 a, .post-title h4 a, .post-title h5 a"
        });
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
        "User-Agent": cloudflareUserAgent,
        "Referer": lastChapterUrl || baseUrl + "/",
        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9,ar;q=0.8",
        "Sec-Fetch-Dest": "image",
        "Sec-Fetch-Mode": "no-cors",
        "Sec-Fetch-Site": "cross-site"
      };
    },

    sanitizeCoverUrl(args) {
      return makeAbsolute((args && args.url) || "") || ((args && args.url) || "");
    }
  };
}
