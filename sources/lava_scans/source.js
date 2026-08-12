function createSource(api, config) {
  var baseUrl = (config && config.base_url) || "https://lavascans.com";
  var selectors = (config && config.selectors) || {};

  var userAgent = (config && config.user_agent) || "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
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

  var lastChapterUrl = baseUrl + "/";
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

  function extractImageUrl(img) {
    var url = (img.dataSrc || "").trim();
    if (!url || url.indexOf("data:image/") === 0) url = (img.lazy || "").trim();
    if (!url || url.indexOf("data:image/") === 0) url = (img.src || "").trim();
    if (url.indexOf("data:image/") === 0) return "";
    return url;
  }

  function pickCoverUrl(item) {
    var url = extractImageUrl({ dataSrc: item.coverDataSrc, lazy: item.coverLazySrc, src: item.coverSrc });
    return url ? makeAbsolute(url) : "";
  }

  function isValidImageUrl(url) {
    if (!url) return false;
    var lower = url.toLowerCase();
    if (lower.indexOf(".svg") !== -1) return false;
    if (lower.indexOf(".gif") !== -1 && lower.indexOf("icon") !== -1) return false;
    if (lower.indexOf("data:") === 0 && lower.indexOf("data:image/") !== 0) return false;
    return true;
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
      var title = (item.title || item.titleAttr || item.altAttr || "").trim();
      if (!title) continue;
      var detailUrl = makeAbsolute(item.href || "");
      if (!detailUrl || seen[detailUrl]) continue;
      seen[detailUrl] = true;
      results.push({ title: title, detailUrl: detailUrl, coverUrl: pickCoverUrl(item), contentType: "manga" });
    }
    return results;
  }

  async function extractChapters(html) {
    var listSel = sel("chapter_list", ".ch-item, #chapterlist li, .eplister li, .clstyle li");
    var dateSel = sel("chapter_date", ".ch-date, .chapterdate");
    var lockSel = sel("chapter_locked", ".fa-lock, .paywall, .locked");
    var numAttr = sel("chapter_number_attr", "data-ch");
    var items = await api.cssMap(html, listSel, {
      href: { selector: "a", type: "attr", attr: "href" },
      num: { selector: "", type: "attr", attr: numAttr },
      title: { selector: "a", type: "text" },
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
      var chapterNumber = item.num || "";
      if (!chapterNumber) {
        var match = (item.title || "").match(/(?:فصل|chapter|ch)[\s_.-]*(\d+(?:\.\d+)?)/i) || (item.title || chapterUrl).match(/(\d+(?:\.\d+)?)/);
        chapterNumber = match ? match[1] : "0";
      }
      chapters.push({ number: chapterNumber, title: (item.title || "").trim(), views: 0, url: chapterUrl, isLocked: !!(item.locked && item.locked.trim()), date: (item.date || "").trim() });
    }
    chapters.sort(function(a, b) { return (parseFloat(b.number) || 0) - (parseFloat(a.number) || 0); });
    return chapters;
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
    var list = String(selectorStr || "").split(",");
    for (var i = 0; i < list.length; i++) {
      var selector = list[i].trim();
      if (!selector) continue;
      for (var j = 0; j < attrs.length; j++) {
        var value = await api.cssAttr(html, selector, attrs[j]);
        if (value && String(value).trim()) return String(value).trim();
      }
    }
    return "";
  }

  async function extractPageImages(html) {
    var urls = [];
    var strategies = (sel("reader_fallback_strategy", "selector,noscript,regex,ts_reader")).split(",");
    for (var si = 0; si < strategies.length && !urls.length; si++) {
      var strategy = strategies[si].trim();
      if (strategy === "selector") {
        var selectorsStr = sel("chapter_page_image", "#readerarea img, .reading-content img, .page-break img");
        var selectorsList = selectorsStr.split(",");
        for (var si2 = 0; si2 < selectorsList.length; si2++) {
          var selStr = selectorsList[si2].trim();
          if (!selStr) continue;
          var images = await api.cssAll(html, selStr);
          if (!images || !images.length) continue;
          images.sort(function(a, b) {
            var idxA = parseInt((a.attrs && a.attrs["data-index"]) || "", 10);
            var idxB = parseInt((b.attrs && b.attrs["data-index"]) || "", 10);
            if (!isNaN(idxA) && !isNaN(idxB)) return idxA - idxB;
            return 0;
          });
          for (var j = 0; j < images.length; j++) {
            var attrs = images[j].attrs || {};
            var src = extractImageUrl({ dataSrc: attrs["data-src"], lazy: attrs["data-lazy-src"], src: attrs.src });
            src = makeAbsolute(src);
            if (isValidImageUrl(src) && urls.indexOf(src) === -1) urls.push(src);
          }
          if (urls.length) break;
        }
      }
      if (strategy === "noscript") {
        var containerHtml = await api.cssHtml(html, sel("chapter_reader_container", ".reader-area, #readerarea"));
        var noscriptMatch = containerHtml ? containerHtml.match(/<noscript[^>]*>([\s\S]*?)<\/noscript>/i) : null;
        var imgRegex = /<img[^>]+(?:data-src|data-lazy-src|src)\s*=\s*["']([^"']+)["']/gi;
        var found;
        while (noscriptMatch && (found = imgRegex.exec(noscriptMatch[1])) !== null) {
          var nsUrl = makeAbsolute(found[1]);
          if (isValidImageUrl(nsUrl) && urls.indexOf(nsUrl) === -1) urls.push(nsUrl);
        }
      }
      if (strategy === "regex") {
        var source = await api.cssHtml(html, sel("chapter_reader_container", ".reader-area, #readerarea"));
        if (!source) source = html;
        var regex = /<img[^>]+(?:data-src|data-lazy-src|src)\s*=\s*["']([^"']+\.(?:webp|jpg|jpeg|png)[^"']*)["']/gi;
        var match;
        while ((match = regex.exec(source)) !== null) {
          var rxUrl = makeAbsolute(match[1]);
          if (isValidImageUrl(rxUrl) && urls.indexOf(rxUrl) === -1) urls.push(rxUrl);
        }
      }
      if (strategy === "ts_reader") {
        var tsMatch = html.match(/ts_reader\.(?:run|init)\s*\(\s*({[\s\S]*?})\s*\)/);
        if (tsMatch) {
          try {
            var data = JSON.parse(tsMatch[1]);
            var imgList = (data.sources && data.sources[0] && data.sources[0].images) || data.images || [];
            for (var t = 0; t < imgList.length; t++) {
              var tsUrl = makeAbsolute(String(imgList[t]));
              if (isValidImageUrl(tsUrl) && urls.indexOf(tsUrl) === -1) urls.push(tsUrl);
            }
          } catch (e) {}
        }
      }
    }
    return urls;
  }

  return {
    requiresCloudflare: true,

    async getHomepageManga(args) {
      try {
        var page = (args && args.page) || 1;
        var url = page === 1 ? baseUrl : baseUrl + "/page/" + page + "/";
        var html = await fetchHtml(url);
        return await toMangaList(html, sel("homepage_list", ".magma-card, .pop-card, .legend-card, .listupd .bs, .listupd .bsx"), {
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
        var url = page === 1 ? baseUrl + "/?s=" + encodeURIComponent(query) : baseUrl + "/page/" + page + "/?s=" + encodeURIComponent(query);
        var html = await fetchHtml(url);
        return await toMangaList(html, sel("search_list", ".magma-card, .pop-card, .legend-card, .listupd .bs, .listupd .bsx"), {
          titleSel: sel("search_title", ".magma-title a, .pop-name, .legend-title a, .tt a, .tt, img"),
          coverSel: sel("search_cover", ".magma-bg img, .pop-poster img, .legend-img, .limit img, img"),
          urlSel: "a"
        });
      } catch (e) {
        return [];
      }
    },

    async getMangaDetails(args) {
      var url = makeAbsolute((args && args.url) || "");
      var html = await fetchHtml(url);
      var title = await firstText(html, sel("manga_title", ".lh-title, .m-title, .entry-title, h1, meta[property='og:title']"));
      var cover = await firstAttr(html, sel("manga_cover", ".lh-poster img, .manga-cover img, .thumb img, meta[property='og:image']"), ["data-src", "data-lazy-src", "src", "content"]);
      var description = await firstText(html, sel("manga_description", ".lh-story-content, .m-desc, .entry-content p, .entry-content"));
      var genres = await api.cssList(html, sel("manga_genres", ".lh-genre-tag, .genre-tag, .mgen a, .genres a"));
      return {
        title: (title || "بدون عنوان").trim(),
        coverUrl: cover ? makeAbsolute(cover) : "",
        description: (description || "").replace("متابعة قراءة", "").replace(/\s+/g, " ").trim(),
        genres: genres.map(function(g) { return String(g).trim(); }).filter(function(g) { return !!g; }),
        chapters: await extractChapters(html),
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
        return await toMangaList(html, sel("filter_list", ".magma-card, .pop-card, .legend-card, .listupd .bs"), {
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
