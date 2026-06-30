function createSource(api, config) {
  var baseUrl = (config && config.base_url) || "https://lavascans.com";
  var selectors = (config && config.selectors) || {};

  var userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
  var defaultHeaders = {
    "User-Agent": userAgent,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "ar,en-US;q=0.9,en;q=0.8",
    "Referer": baseUrl + "/",
    "Origin": baseUrl,
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "same-origin",
    "Upgrade-Insecure-Requests": "1"
  };

  var defaultGenres = [
    "أكشن", "مغامرة", "كوميديا", "شياطين", "دراما", "ايكتشي",
    "خيال", "حريم", "تاريخي", "رعب", "فنون قتالية", "ناضج", "ميكا", "خيال علمي", "شريحة من الحياة"
  ];
  var defaultTypes = ["manga", "manhwa", "manhua", "comic"];

  function sel(key, fallback) {
    return selectors[key] || fallback;
  }

  async function fetchHtml(url, extraHeaders, method) {
    var headers = {};
    for (var k in defaultHeaders) headers[k] = defaultHeaders[k];
    if (extraHeaders) for (var x in extraHeaders) headers[x] = extraHeaders[x];
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
    if (url.indexOf("http://") === 0) return "https:" + url.substring(5);
    if (url.indexOf("https://") === 0) return url;
    if (url.indexOf("//") === 0) return "https:" + url;
    if (url.indexOf("/") === 0) return baseUrl + url;
    return baseUrl + "/" + url;
  }

  function extractNumber(url, title) {
    var text = String(url || "") + " " + String(title || "");
    var m = text.match(/(?:chapter|ch|فصل)[\s_.-]*(\d+(?:\.\d+)?)/i) || text.match(/(\d+(?:\.\d+)?)/);
    return m ? m[1] : "0";
  }

  async function toMangaList(html, listSel, opts) {
    opts = opts || {};
    var titleSel = opts.titleSel || ".magma-title a, .pop-name, .legend-title a, .tt a, .tt, img";
    var coverSel = opts.coverSel || ".magma-bg img, .pop-poster img, .legend-img, .limit img, img";
    var urlSel = opts.urlSel || "a[href*='/manga/'], .magma-title a, a";
    var items = await api.cssMap(html, listSel, {
      title: { selector: titleSel, type: "text" },
      titleAttr: { selector: "img", type: "attr", attr: "title" },
      altAttr: { selector: "img", type: "attr", attr: "alt" },
      href: { selector: urlSel, type: "attr", attr: "href" },
      coverDataSrc: { selector: coverSel, type: "attr", attr: "data-src" },
      coverLazySrc: { selector: coverSel, type: "attr", attr: "data-lazy-src" },
      coverSrc: { selector: coverSel, type: "attr", attr: "src" }
    });
    var results = [];
    var seen = {};
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var title = (item.title || "").trim();
      if (!title) title = (item.titleAttr || item.altAttr || "").trim();
      if (!title) continue;
      var detailUrl = makeAbsolute(item.href || "");
      if (!detailUrl || seen[detailUrl]) continue;
      seen[detailUrl] = true;
      var cover = item.coverDataSrc || item.coverLazySrc || item.coverSrc || "";
      if (cover.indexOf("data:image") !== -1) cover = "";
      results.push({ title: title, detailUrl: detailUrl, coverUrl: cover, contentType: "manga" });
    }
    return results;
  }

  async function extractChapters(html) {
    var listSel = sel("chapter_list", ".ch-item, #chapterlist li, .eplister li, .clstyle li");
    var dateSel = sel("chapter_date", ".ch-date, .chapterdate");
    var lockSel = sel("chapter_locked", ".fa-lock, .paywall, .locked");
    var numAttr = sel("chapter_number_attr", "data-num");

    var items = await api.cssMap(html, listSel, {
      href: { selector: "a", type: "attr", attr: "href" },
      num: { selector: "", type: "attr", attr: numAttr },
      title: { selector: "a", type: "text" },
      date: { selector: dateSel, type: "text" }
    });
    var lockedItems = await api.cssMap(html, listSel, {
      locked: { selector: lockSel, type: "text" }
    });

    var chapters = [];
    var seen = {};
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var chapterUrl = makeAbsolute(item.href || "");
      if (!chapterUrl || seen[chapterUrl]) continue;
      seen[chapterUrl] = true;
      var chapterNumber = item.num || "";
      if (!chapterNumber) {
        var m = (item.title || "").match(/(?:فصل|chapter|ch)[\s_.-]*(\d+(?:\.\d+)?)/i) || (item.title || "").match(/(\d+(?:\.\d+)?)/);
        chapterNumber = m ? m[1] : "0";
      }
      chapters.push({
        number: chapterNumber,
        title: (item.title || "").trim(),
        views: 0,
        url: chapterUrl,
        isLocked: !!(lockedItems[i] && lockedItems[i].locked && lockedItems[i].locked.trim()),
        date: (item.date || "").trim()
      });
    }

    chapters.sort(function(a, b) {
      return (parseFloat(b.number) || 0) - (parseFloat(a.number) || 0);
    });

    return chapters;
  }

  async function extractPageImages(html) {
    var urls = [];

    // Strategy 1: CSS selector via bridge
    var imgSel = sel("chapter_page_image", "#readerarea img, .reading-content img, .page-break img");
    var images = await api.cssMap(html, imgSel, {
      dataSrc: { selector: "", type: "attr", attr: "data-src" },
      lazy: { selector: "", type: "attr", attr: "data-lazy-src" },
      src: { selector: "", type: "attr", attr: "src" }
    });
    for (var i = 0; i < images.length; i++) {
      var src = images[i].dataSrc || images[i].lazy || images[i].src || "";
      if (src && src.indexOf("data:image") === -1) {
        src = makeAbsolute(src);
        if (urls.indexOf(src) === -1) urls.push(src);
      }
    }
    if (urls.length) return urls;

    // Strategy 2: noscript fallback
    var noscriptMatch = html.match(/<noscript>([\s\S]*?)<\/noscript>/gi);
    if (noscriptMatch) {
      for (var n = 0; n < noscriptMatch.length; n++) {
        var imgRegex = /<img[^>]+src\s*=\s*["']([^"']+)["']/gi;
        var m;
        while ((m = imgRegex.exec(noscriptMatch[n])) !== null) {
          var s = makeAbsolute(m[1]);
          if (s && urls.indexOf(s) === -1) urls.push(s);
        }
      }
      if (urls.length) return urls;
    }

    // Strategy 3: regex for image tags with valid extensions
    var exts = (sel("chapter_image_extensions", ".webp,.jpg,.jpeg,.png")).split(",");
    var extPattern = "\\.(" + exts.map(function(e) { return e.replace(".", ""); }).join("|") + ")";
    var imgRegex2 = new RegExp("<img[^>]+src\\s*=\\s*[\"']([^\"']+" + extPattern + ")[\"']", "gi");
    while ((m = imgRegex2.exec(html)) !== null) {
      var s = makeAbsolute(m[1]);
      if (s && urls.indexOf(s) === -1) urls.push(s);
    }
    if (urls.length) return urls;

    // Strategy 4: ts_reader JSON
    var tsMatch = html.match(/ts_reader\.(?:run|init)\s*\(\s*({[\s\S]*?})\s*\)/);
    if (tsMatch) {
      try {
        var data = JSON.parse(tsMatch[1]);
        var imgList = (data.sources && data.sources[0] && data.sources[0].images) || data.images;
        if (imgList && typeof imgList.forEach === "function") {
          imgList.forEach(function(img) {
            var s = makeAbsolute(String(img));
            if (s && urls.indexOf(s) === -1) urls.push(s);
          });
        }
      } catch (e) {}
    }

    return urls;
  }

  return {
    requiresCloudflare: false,

    async getHomepageManga(args) {
      try {
        var page = (args && args.page) || 1;
        var url = page === 1 ? baseUrl : baseUrl + "/page/" + page + "/";
        var html = await fetchHtml(url);
        var listSel = sel("homepage_list", ".magma-card, .pop-card, .legend-card, .listupd .bs, .listupd .bsx");
        return await toMangaList(html, listSel, {
          titleSel: sel("homepage_title", ".magma-title a, .pop-name, .legend-title a, .tt a, .tt, img"),
          coverSel: sel("homepage_cover", ".magma-bg img, .pop-poster img, .legend-img, .limit img, img"),
          urlSel: sel("homepage_url", "a[href*='/manga/'], .magma-title a, a")
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
        var url = page === 1
          ? baseUrl + "/?s=" + encodeURIComponent(query)
          : baseUrl + "/page/" + page + "/?s=" + encodeURIComponent(query);
        var html = await fetchHtml(url);
        var listSel = sel("search_list", ".magma-card, .pop-card, .legend-card, .listupd .bs, .listupd .bsx");
        return await toMangaList(html, listSel, {
          titleSel: sel("search_title", ".magma-title a, .pop-name, .legend-title a, .tt a, .tt, img"),
          coverSel: sel("search_cover", ".magma-bg img, .pop-poster img, .legend-img, .limit img, img"),
          urlSel: "a"
        });
      } catch (e) {
        return [];
      }
    },

    async getMangaDetails(args) {
      var url = (args && args.url) || "";
      var html = await fetchHtml(url);

      var title = await api.cssAttr(html, "meta[property='og:title']", "content");
      if (!title) title = await api.cssText(html, sel("manga_title", ".lh-title, .m-title, .entry-title, h1"));
      if (!title) title = "بدون عنوان";

      var coverSel = sel("manga_cover", ".lh-poster img, .manga-cover img, .thumb img, meta[property='og:image']");
      var cover = await api.cssAttr(html, coverSel, "data-src");
      if (!cover) cover = await api.cssAttr(html, coverSel, "data-lazy-src");
      if (!cover) cover = await api.cssAttr(html, coverSel, "src");
      if (!cover) cover = await api.cssAttr(html, "meta[property='og:image']", "content");

      var description = await api.cssText(html, sel("manga_description", ".lh-story-content, .m-desc, .entry-content p, .entry-content"));
      description = (description || "").replace("متابعة قراءة", "").replace(/\s+/g, " ").trim();

      var genres = await api.cssList(html, sel("manga_genres", ".lh-genre-tag, .genre-tag, .mgen a, .genres a"));

      var chapters = await extractChapters(html);

      return {
        title: title.trim(),
        coverUrl: cover || "",
        description: description,
        genres: genres.map(function (g) { return String(g).trim(); }).filter(function (g) { return !!g; }),
        chapters: chapters,
        originalUrl: url,
        hasMoreChapters: false,
        lastFetchedPage: 1,
        contentType: "manga"
      };
    },

    async getChapterPages(args) {
      var chapterUrl = makeAbsolute((args && args.url) || "");
      var html = await fetchHtml(chapterUrl);
      return await extractPageImages(html);
    },

    async getChapterContent(args) {
      return { kind: "image", imageUrls: await this.getChapterPages(args) };
    },

    async getFilteredManga(args) {
      try {
        var page = (args && args.page) || 1;
        var genre = (args && args.genre) || "";
        var url;
        if (genre) {
          var slug = genre.toLowerCase().replace(/ /g, "-");
          url = page === 1 ? baseUrl + "/genres/" + slug + "/" : baseUrl + "/genres/" + slug + "/page/" + page + "/";
        } else {
          url = page === 1 ? baseUrl + "/" : baseUrl + "/page/" + page + "/";
        }
        var html = await fetchHtml(url);
        var listSel = sel("filter_list", ".magma-card, .pop-card, .legend-card, .listupd .bs");
        return await toMangaList(html, listSel, {
          titleSel: sel("filter_title", ".magma-title a, .pop-name, .legend-title a, .tt a, .tt, img"),
          coverSel: sel("filter_cover", ".magma-bg img, .pop-poster img, .legend-img, img"),
          urlSel: sel("filter_url", "a")
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
        "User-Agent": userAgent,
        "Referer": baseUrl + "/",
        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "Accept-Language": "ar,en-US;q=0.9,en;q=0.8",
        "Sec-Fetch-Dest": "image",
        "Sec-Fetch-Mode": "no-cors",
        "Sec-Fetch-Site": "cross-site"
      };
    },

    sanitizeCoverUrl(args) {
      return (args && args.url) || "";
    }
  };
}
