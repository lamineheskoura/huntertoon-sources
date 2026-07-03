function createSource(api, config) {
  var baseUrl = (config && config.base_url) || "https://olympustaff.com";
  var selectors = (config && config.selectors) || {};

  var userAgent = (config && config.user_agent) || "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";

  var defaultHeaders = {
    "User-Agent": userAgent,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "ar,en-US;q=0.9,en;q=0.8",
    "Referer": baseUrl + "/",
  };

  var lastChapterUrl = baseUrl + "/";
  var defaultGenres = [
    "أكشن", "تشويق", "دراما", "خيال", "فنتازيا", "خيال علمي",
    "رومانسي", "كوميديا", "سوبر", "إثارة", "رعب", "مدرسة",
    "حياتي", "شونن", "شوجو",
  ];
  var defaultTypes = [
    "مانجا ياباني", "مانهوا كورية", "مانهوا صينية", "ويب تون",
  ];

  function sel(key, fallback) {
    return selectors[key] || fallback;
  }

  async function fetchHtml(url, extraHeaders) {
    var headers = {};
    for (var k in defaultHeaders) headers[k] = defaultHeaders[k];
    if (extraHeaders) {
      for (var k in extraHeaders) headers[k] = extraHeaders[k];
    }
    var html = await api.fetchText(url, headers);
    if (!html) throw new Error("Empty response: " + url);
    return html;
  }

  function makeAbsolute(url) {
    if (!url) return "";
    if (url.indexOf("http") === 0) return url;
    if (url.indexOf("//") === 0) return "https:" + url;
    if (url.indexOf("/") === 0) return baseUrl + url;
    return baseUrl + "/" + url;
  }

  async function tryText(html, selectorStr) {
    var list = selectorStr.split(",");
    for (var i = 0; i < list.length; i++) {
      var s = list[i].trim();
      if (!s) continue;
      var text = await api.cssText(html, s);
      if (text && text.trim()) return text.trim();
    }
    for (var i = 0; i < list.length; i++) {
      var s = list[i].trim();
      if (!s) continue;
      if (s.indexOf("meta") !== -1) {
        var val = await api.cssAttr(html, s, "content");
        if (val && val.trim()) return val.trim();
      }
    }
    return "";
  }

  async function tryAttr(html, selectorStr, attr) {
    var list = selectorStr.split(",");
    for (var i = 0; i < list.length; i++) {
      var s = list[i].trim();
      if (!s) continue;
      var val = await api.cssAttr(html, s, attr);
      if (val) return val;
    }
    return "";
  }

  async function toMangaList(html, listSel, opts) {
    opts = opts || {};
    var items = await api.cssAll(html, listSel);
    var mangas = [];
    var seen = {};

    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var href = await tryAttr(item.html, opts.urlSel || "a", "href");
      if (!href && item.attrs) href = item.attrs.href || "";
      if (!href) continue;
      var detailUrl = makeAbsolute(href);
      if (seen[detailUrl]) continue;
      seen[detailUrl] = true;

      var cover = await tryAttr(item.html, opts.coverSel || "img", "src");
      if (!cover) cover = await tryAttr(item.html, opts.coverSel || "img", "data-src");

      var title = await tryText(item.html, opts.titleSel || "img");
      if (!title) title = (item.text || "").trim();

      if (title) {
        mangas.push({
          title: title,
          coverUrl: makeAbsolute(cover),
          detailUrl: detailUrl,
          contentType: "manga",
        });
      }
    }
    return mangas;
  }

  async function fetchChapterPage(detailUrl, page) {
    var allChapters = [];
    var seenUrls = {};
    var url = page === 1 ? detailUrl : detailUrl + "?page=" + page;
    var html;
    try {
      html = await fetchHtml(url);
    } catch (e) {
      return allChapters;
    }

    var listSel = sel("chapter_list", ".chapter-card, .wp-manga-chapter, .chapter-item, .list-chapter li");
    var cards = await api.cssAll(html, listSel);
    if (!cards || cards.length === 0) return allChapters;

    for (var c = 0; c < cards.length; c++) {
      try {
        var card = cards[c];
        var link = await tryAttr(card.html, "a", "href");
        var chapterUrl = makeAbsolute(link);
        if (!chapterUrl || seenUrls[chapterUrl]) continue;
        seenUrls[chapterUrl] = true;

        var numAttr = sel("chapter_number_attr", "data-number");
        var chapterNumber = card.attrs[numAttr] || "0";

        var viewsAttr = sel("chapter_views_attr", "data-views");
        var viewsStr = card.attrs[viewsAttr] || "0";
        var views = parseInt(viewsStr, 10) || 0;

        var dateSel = sel("chapter_date", ".chapter-date, .date, .meta-date");
        var date = "";
        if (dateSel) date = await tryText(card.html, dateSel);

        var lockSel = sel("chapter_locked", ".locked, .fa-lock, .paywall, .premium, .status-badge.locked");
        var isLocked = false;
        if (lockSel) {
          var locked = await api.cssText(card.html, lockSel);
          isLocked = !!locked;
        }
        if (!isLocked) {
          var buyTarget = await api.cssAttr(card.html, "a", "data-bs-target");
          isLocked = buyTarget === "#buyModel";
        }

        allChapters.push({
          number: chapterNumber,
          title: "",
          views: views,
          url: chapterUrl,
          isLocked: isLocked,
          date: date,
        });
      } catch (e) {}
    }

    allChapters.sort(function (a, b) {
      var numA = parseFloat(a.number) || 0;
      var numB = parseFloat(b.number) || 0;
      return numB - numA;
    });

    return allChapters;
  }

  return {
    requiresCloudflare: false,

    async getHomepageManga(args) {
      try {
        var page = (args && args.page) || 1;
        var url = page === 1 ? baseUrl : baseUrl + "?page=" + page;
        var html = await fetchHtml(url);
        var listSel = sel("homepage_list", ".last-chapter .box, .page-listing-item .row .col-6, .listupd .bs");
        return await toMangaList(html, listSel, {
          titleSel: sel("homepage_title", ".info h3 a, .info h3, h3 a, img"),
          coverSel: sel("homepage_cover", ".imgu img, img"),
          urlSel: sel("homepage_url", "a"),
        });
      } catch (e) {
        return [];
      }
    },

    async search(args) {
      try {
        var query = (args && args.query) || "";
        if (!query.trim()) return [];

        var searchUrl = baseUrl + "/ajax/search?keyword=" + encodeURIComponent(query);
        var html = await fetchHtml(searchUrl, { "X-Requested-With": "XMLHttpRequest" });
        var listSel = sel("search_list", "a[href*='/series/']");
        return await toMangaList(html, listSel, {
          titleSel: sel("search_title", "h4, h3, img"),
          coverSel: sel("search_cover", "img"),
          urlSel: "a",
        });
      } catch (e) {
        return [];
      }
    },

    async getMangaDetails(args) {
      var url = (args && args.url) || "";
      var html = await fetchHtml(url);

      var titleSel = sel("manga_title", "h1, meta[property='og:title']");
      var title = await tryText(html, titleSel) || "بدون عنوان";

      var coverSel = sel("manga_cover", ".whitebox img.shadow-sm, .summary_image img, meta[property='og:image']");
      var cover = await tryAttr(html, coverSel, "src");
      if (!cover) cover = await tryAttr(html, coverSel, "content");
      if (!cover) cover = await tryAttr(html, coverSel, "data-src");

      var descSel = sel("manga_description", ".review-content p, .summary__content p, .description p");
      var description = await tryText(html, descSel);

      var genresSel = sel("manga_genres", ".review-author-info a, .genres-content a, .genres a");
      var genreItems = await api.cssList(html, genresSel);
      var genres = [];
      for (var i = 0; i < genreItems.length; i++) {
        var g = genreItems[i].trim();
        if (g) genres.push(g);
      }

      var chapters = await fetchChapterPage(url, 1);

      return {
        title: title,
        coverUrl: makeAbsolute(cover),
        description: description,
        genres: genres,
        chapters: chapters,
        originalUrl: url,
        hasMoreChapters: chapters.length > 0,
        lastFetchedPage: 1,
        contentType: "manga",
      };
    },

    async getChapterPages(args) {
      try {
        var chapterUrl = (args && args.url) || "";
        lastChapterUrl = chapterUrl;
        var html = await fetchHtml(chapterUrl);
        var imgSel = sel("chapter_page_image", ".image_list .page-break img, .reading-content img");
        var images = await api.cssAll(html, imgSel);
        var urls = [];

        for (var i = 0; i < images.length; i++) {
          var img = images[i];
          var src = img.attrs.src || img.attrs["data-src"] || "";
          src = src.trim();
          if (!src) continue;

          var lower = src.toLowerCase();
          if (lower.indexOf(".svg") !== -1) continue;
          if (lower.indexOf(".gif") !== -1 && lower.indexOf("icon") !== -1) continue;
          if (lower.indexOf("data:") === 0 && lower.indexOf("data:image") !== 0) continue;

          if (lower.indexOf("http") === 0 || lower.indexOf("//") === 0 || lower.indexOf("/") === 0) {
            var absolute = makeAbsolute(src);
            if (urls.indexOf(absolute) === -1) {
              urls.push(absolute);
            }
          }
        }
        return urls;
      } catch (e) {
        throw e;
      }
    },

    async fetchMoreChapters(args) {
      var url = (args && args.url) || "";
      var nextPage = (args && args.nextPage) || 2;
      var chapters = await fetchChapterPage(url, nextPage);
      return {
        title: "",
        coverUrl: "",
        description: "",
        genres: [],
        chapters: chapters,
        originalUrl: url,
        hasMoreChapters: chapters.length > 0,
        lastFetchedPage: nextPage,
        contentType: "manga"
      };
    },

    async getFilteredManga(args) {
      try {
        var genre = (args && args.genre) || null;
        var type = (args && args.type) || null;
        var page = (args && args.page) || 1;

        var queryParams = [];
        if (genre) queryParams.push("genre=" + encodeURIComponent(genre));
        if (type) queryParams.push("type=" + encodeURIComponent(type));
        queryParams.push("page=" + page);

        var url = baseUrl + "/series?" + queryParams.join("&");
        var html = await fetchHtml(url);

        var listSel = sel("filter_list", ".listupd .bs, .page-listing-item .row .col-6");
        return await toMangaList(html, listSel, {
          titleSel: sel("filter_title", ".tt, img"),
          coverSel: sel("filter_cover", "img"),
          urlSel: sel("filter_url", "a"),
        });
      } catch (e) {
        return [];
      }
    },

    async getGenresAndTypes() {
      try {
        var html = await fetchHtml(baseUrl + "/series");
        var genreItems = await api.cssAll(html, "select#genre option, select[name='genre'] option");
        var genres = [];
        for (var i = 0; i < genreItems.length; i++) {
          var opt = genreItems[i];
          var value = opt.attrs.value || "";
          if (value && value !== "all") {
            genres.push(opt.text || value);
          }
        }

        var typeItems = await api.cssAll(html, "select#type option, select[name='type'] option");
        var types = [];
        for (var i = 0; i < typeItems.length; i++) {
          var opt = typeItems[i];
          var value = opt.attrs.value || "";
          if (value && value !== "all") {
            types.push(opt.text || value);
          }
        }

        return {
          genres: genres.length > 0 ? genres : defaultGenres,
          types: types.length > 0 ? types : defaultTypes,
        };
      } catch (e) {
        return { genres: defaultGenres, types: defaultTypes };
      }
    },

    async getChapterContent(args) {
      var imageUrls = await this.getChapterPages(args);
      return { kind: "image", imageUrls: imageUrls };
    },

    getImageHeaders() {
      return {
        "User-Agent": userAgent,
        "Referer": lastChapterUrl || baseUrl + "/",
        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "Accept-Language": "ar,en-US;q=0.9,en;q=0.8",
        "Sec-Fetch-Dest": "image",
        "Sec-Fetch-Mode": "no-cors",
        "Sec-Fetch-Site": "same-origin",
      };
    },

    sanitizeCoverUrl(args) {
      return (args && args.url) || "";
    },
  };
}
