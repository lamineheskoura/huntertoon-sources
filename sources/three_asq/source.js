function createSource(api, config) {
  var baseUrl = (config && config.base_url) || "https://3asq.online";
  var selectors = (config && config.selectors) || {};
  var userAgent = (config && config.user_agent) || "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
  var defaultHeaders = {
    "User-Agent": userAgent,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
    "Accept-Language": "ar,en-US;q=0.9,en;q=0.8",
    "Referer": baseUrl + "/",
    "Origin": baseUrl,
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "same-origin",
    "Upgrade-Insecure-Requests": "1"
  };

  var lastChapterUrl = baseUrl + "/";
  var defaultGenres = ["أكشن", "مغامرة", "خيال", "دراما", "رومانسي", "شونين", "سينين", "شريحة من الحياة", "نفسي", "غموض"];
  var defaultTypes = ["manga", "manhwa", "manhua", "novel"];

  function sel(key, fallback) {
    return selectors[key] || fallback;
  }

  async function fetchHtml(url, extraHeaders, method) {
    var headers = {};
    for (var key in defaultHeaders) headers[key] = defaultHeaders[key];
    if (extraHeaders) for (var extra in extraHeaders) headers[extra] = extraHeaders[extra];
    if (api.http) {
      var res = await api.http(url, { method: method || "GET", headers: headers });
      if (!res || !res.ok) throw new Error("HTTP " + (res ? res.status : 0) + " for " + url);
      return res.body || "";
    }
    if (method && method !== "GET") return "";
    var html = await api.fetchText(url, headers);
    if (!html) throw new Error("Empty response: " + url);
    return html;
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
    opts = opts || {};
    var items = await api.cssMap(html, listSel, {
      title: { selector: opts.titleSel, type: "text" },
      titleAttr: { selector: "img", type: "attr", attr: "title" },
      altAttr: { selector: "img", type: "attr", attr: "alt" },
      thumbHref: { selector: ".item-thumb a, .tab-thumb a, .poster", type: "attr", attr: "href" },
      href: { selector: opts.urlSel || opts.titleSel || "a", type: "attr", attr: "href" },
      anyHref: { selector: "a[href*='/manga/']", type: "attr", attr: "href" },
      coverDataSrc: { selector: opts.coverSel || "img", type: "attr", attr: "data-src" },
      coverLazySrc: { selector: opts.coverSel || "img", type: "attr", attr: "data-lazy-src" },
      coverSrc: { selector: opts.coverSel || "img", type: "attr", attr: "src" }
    });
    var results = [];
    var seen = {};
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var title = cleanTitle(item.title || item.titleAttr || item.altAttr);
      var href = item.thumbHref || item.href || item.anyHref || "";
      if (href.indexOf("/manga/") === -1 && item.anyHref) href = item.anyHref;
      var detailUrl = makeAbsolute(href);
      if (!title || !detailUrl || seen[detailUrl]) continue;
      seen[detailUrl] = true;
      results.push({ title: title, detailUrl: detailUrl, coverUrl: extractImageValue(item, "cover"), contentType: "manga" });
    }
    return results;
  }

  async function extractChapters(html) {
    var listSel = sel("chapter_list", ".wp-manga-chapter");
    var items = await api.cssMap(html, listSel, {
      title: { selector: sel("chapter_title", "a"), type: "text" },
      href: { selector: sel("chapter_url", "a"), type: "attr", attr: "href" },
      date: { selector: sel("chapter_date", ".chapter-release-date i"), type: "text" },
      locked: { selector: sel("chapter_locked", ".c-premium, .fa-lock"), type: "text" }
    });
    var chapters = [];
    var seen = {};
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var chapterUrl = makeAbsolute(item.href || "");
      if (!chapterUrl || seen[chapterUrl]) continue;
      seen[chapterUrl] = true;
      var title = cleanTitle(item.title);
      chapters.push({
        number: extractNumber(chapterUrl, title),
        title: title,
        views: 0,
        url: chapterUrl,
        isLocked: !!(item.locked && item.locked.trim()),
        date: cleanTitle(item.date)
      });
    }
    chapters.sort(function(a, b) { return (parseFloat(b.number) || 0) - (parseFloat(a.number) || 0); });
    return chapters;
  }

  async function fetchChapters(detailUrl, detailHtml) {
    var ajaxUrl = detailUrl.replace(/\/$/, "") + "/ajax/chapters/";
    try {
      var ajaxHtml = await fetchHtml(ajaxUrl, {
        "X-Requested-With": "XMLHttpRequest",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"
      }, "POST");
      var ajaxChapters = ajaxHtml ? await extractChapters(ajaxHtml) : [];
      if (ajaxChapters.length) return ajaxChapters;
    } catch (e) {}
    return await extractChapters(detailHtml);
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
        var html = await fetchHtml(baseUrl + "/manga/page/" + page + "/?m_orderby=latest");
        return await toMangaList(html, sel("homepage_list", ".page-item-detail"), {
          titleSel: sel("homepage_title", ".post-title h3 a"),
          coverSel: sel("homepage_cover", ".item-thumb a img"),
          urlSel: sel("homepage_url", ".post-title h3 a")
        });
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
        return await toMangaList(html, sel("search_list", ".c-tabs-item__content"), {
          titleSel: sel("search_title", ".post-title h3 a"),
          coverSel: sel("search_cover", ".tab-thumb a img"),
          urlSel: sel("search_title", ".post-title h3 a")
        });
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
      return {
        title: cleanTitle(title) || "بدون عنوان",
        coverUrl: cover ? makeAbsolute(cover) : "",
        description: cleanTitle(description).replace("متابعة قراءة", "").trim(),
        genres: genres.map(function(g) { return cleanTitle(g); }).filter(function(g) { return !!g; }),
        chapters: await fetchChapters(url, html),
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
        var html = await fetchHtml(baseUrl + "/manga/page/" + page + "/?" + params.join("&"));
        return await toMangaList(html, sel("homepage_list", ".page-item-detail"), {
          titleSel: sel("homepage_title", ".post-title h3 a"),
          coverSel: sel("homepage_cover", ".item-thumb a img"),
          urlSel: sel("homepage_url", ".post-title h3 a")
        });
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
    }
  };
}
