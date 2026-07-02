function createSource(api, config) {
  var baseUrl = (config && config.base_url) || "https://hijala.com";
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
  var defaultGenres = ["أكشن", "مغامرة", "كوميديا", "شياطين", "دراما", "ايكتشي", "خيال", "حريم", "تاريخي", "رعب", "فنون قتالية", "ناضج", "ميكا"];
  var defaultTypes = ["manga", "manhwa", "manhua", "comic"];

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

  function cleanText(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
  }

  function isInRepeatedHomeBlock(item) {
    var html = String((item && item.html) || "").toLowerCase();
    return html.indexOf("popularslider") !== -1 || html.indexOf("hothome") !== -1;
  }

  function imageFromItem(item, prefix) {
    var url = item[prefix + "DataSrc"] || item[prefix + "LazySrc"] || item[prefix + "Src"] || "";
    if (url.indexOf("data:image/") === 0) url = item[prefix + "LazySrc"] || item[prefix + "Src"] || "";
    if (url.indexOf("data:image/") === 0) return "";
    return url ? makeAbsolute(url) : "";
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

  async function toMangaList(html, listSel, opts) {
    opts = opts || {};
    var items = await api.cssMap(html, listSel, {
      html: { selector: "", type: "html" },
      title: { selector: opts.titleSel || ".tt a, .tt, img", type: "text" },
      titleAttr: { selector: "img", type: "attr", attr: "title" },
      altAttr: { selector: "img", type: "attr", attr: "alt" },
      href: { selector: opts.urlSel || "a", type: "attr", attr: "href" },
      coverDataSrc: { selector: opts.coverSel || ".limit img, img", type: "attr", attr: "data-src" },
      coverLazySrc: { selector: opts.coverSel || ".limit img, img", type: "attr", attr: "data-lazy-src" },
      coverSrc: { selector: opts.coverSel || ".limit img, img", type: "attr", attr: "src" }
    });
    var results = [];
    var seen = {};
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      if (opts.filterRepeatedHomeCards && isInRepeatedHomeBlock(item)) continue;
      var title = cleanText(item.title || item.titleAttr || item.altAttr);
      var detailUrl = makeAbsolute(item.href || "");
      if (!title || !detailUrl || seen[detailUrl]) continue;
      seen[detailUrl] = true;
      results.push({ title: title, detailUrl: detailUrl, coverUrl: imageFromItem(item, "cover"), contentType: "manga" });
    }
    return results;
  }

  async function extractChapters(html) {
    var listSel = sel("chapter_list", "#chapterlist li, .eplister li, .clstyle li");
    var items = await api.cssMap(html, listSel, {
      href: { selector: "a", type: "attr", attr: "href" },
      num: { selector: "", type: "attr", attr: sel("chapter_number_attr", "data-num") },
      title: { selector: ".chapternum, .epx, a", type: "text" },
      date: { selector: sel("chapter_date", ".chapterdate"), type: "text" },
      locked: { selector: sel("chapter_locked", ".fa-lock, .paywall"), type: "text" }
    });
    var chapters = [];
    var seen = {};
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var chapterUrl = makeAbsolute(item.href || "");
      if (!chapterUrl || seen[chapterUrl]) continue;
      seen[chapterUrl] = true;
      var number = item.num || "";
      if (!number) {
        var match = String(item.title || chapterUrl).match(/(?:فصل|chapter|ch|ep)[\s_.#-]*(\d+(?:\.\d+)?)/i) || String(item.title || chapterUrl).match(/(\d+(?:\.\d+)?)/);
        number = match ? match[1] : "0";
      }
      chapters.push({
        number: number,
        title: "",
        views: 0,
        url: chapterUrl,
        isLocked: !!(item.locked && item.locked.trim()),
        date: cleanText(item.date)
      });
    }
    chapters.sort(function(a, b) { return (parseFloat(b.number) || 0) - (parseFloat(a.number) || 0); });
    return chapters;
  }

  function isValidImageUrl(url) {
    if (!url) return false;
    var lower = url.toLowerCase();
    if (lower.indexOf(".svg") !== -1) return false;
    if (lower.indexOf(".gif") !== -1 && lower.indexOf("icon") !== -1) return false;
    if (lower.indexOf("data:") === 0) return false;
    return true;
  }

  function extractImageFromAttrs(attrs) {
    attrs = attrs || {};
    var src = attrs["data-src"] || attrs["data-lazy-src"] || attrs.src || "";
    if (src.indexOf("data:image/") === 0) src = attrs["data-lazy-src"] || attrs.src || "";
    src = makeAbsolute(src);
    return isValidImageUrl(src) ? src : "";
  }

  async function extractBySelector(html) {
    var selectorsList = sel("chapter_page_image", "#readerarea img, .reading-content img, .page-break img").split(",");
    for (var s = 0; s < selectorsList.length; s++) {
      var selector = selectorsList[s].trim();
      if (!selector) continue;
      var images = await api.cssAll(html, selector);
      if (!images || !images.length) continue;
      images.sort(function(a, b) {
        var ai = parseInt((a.attrs && a.attrs["data-index"]) || "", 10);
        var bi = parseInt((b.attrs && b.attrs["data-index"]) || "", 10);
        if (!isNaN(ai) && !isNaN(bi)) return ai - bi;
        return 0;
      });
      var urls = [];
      for (var i = 0; i < images.length; i++) {
        var url = extractImageFromAttrs(images[i].attrs);
        if (url && urls.indexOf(url) === -1) urls.push(url);
      }
      if (urls.length) return urls;
    }
    return [];
  }

  async function extractFromNoscript(html) {
    var container = await api.cssHtml(html, sel("chapter_reader_container", "#readerarea"));
    if (!container) return [];
    var match = container.match(/<noscript[^>]*>([\s\S]*?)<\/noscript>/i);
    if (!match) return [];
    var urls = [];
    var regex = /<img[^>]+(?:data-src|data-lazy-src|src)\s*=\s*["']([^"']+)["']/gi;
    var found;
    while ((found = regex.exec(match[1])) !== null) {
      var url = makeAbsolute(found[1]);
      if (isValidImageUrl(url) && urls.indexOf(url) === -1) urls.push(url);
    }
    return urls;
  }

  async function extractByRegex(html) {
    var container = await api.cssHtml(html, sel("chapter_reader_container", "#readerarea"));
    var source = container || html;
    var extensions = ["webp", "jpg", "jpeg", "png"];
    var regex = /<img[^>]+(?:data-src|data-lazy-src|src)\s*=\s*["']([^"']+)["']/gi;
    var urls = [];
    var found;
    while ((found = regex.exec(source)) !== null) {
      var raw = found[1];
      var lower = raw.toLowerCase();
      var hasExt = false;
      for (var i = 0; i < extensions.length; i++) {
        if (lower.indexOf("." + extensions[i]) !== -1) hasExt = true;
      }
      var url = makeAbsolute(raw);
      if (hasExt && isValidImageUrl(url) && urls.indexOf(url) === -1) urls.push(url);
    }
    return urls;
  }

  function extractFromTsReader(html) {
    var match = html.match(/ts_reader\.(?:run|init)\s*\(\s*({[\s\S]*?})\s*\)/);
    if (!match) return [];
    try {
      var data = JSON.parse(match[1]);
      var images = (data.sources && data.sources[0] && data.sources[0].images) || data.images || [];
      var urls = [];
      for (var i = 0; i < images.length; i++) {
        var url = makeAbsolute(String(images[i] || ""));
        if (isValidImageUrl(url) && urls.indexOf(url) === -1) urls.push(url);
      }
      return urls;
    } catch (e) {
      return [];
    }
  }

  async function extractPageImages(html) {
    var strategies = "selector,noscript,regex,ts_reader".split(",");
    var urls = [];
    for (var i = 0; i < strategies.length && !urls.length; i++) {
      var strategy = strategies[i];
      if (strategy === "selector") urls = await extractBySelector(html);
      if (strategy === "noscript") urls = await extractFromNoscript(html);
      if (strategy === "regex") urls = await extractByRegex(html);
      if (strategy === "ts_reader") urls = extractFromTsReader(html);
    }
    return urls;
  }

  function shouldSplitImages(html, urls) {
    if (!urls || urls.length < 2) return false;
    var containerMatch = html.match(/<(?:div|section)[^>]+id=["']readerarea["'][^>]*>/i);
    if (containerMatch) {
      var tag = containerMatch[0].toLowerCase();
      if (tag.indexOf("display: grid") !== -1 && tag.indexOf("grid-template-columns: repeat(2") !== -1) return true;
    }
    if (urls.length <= 20) return false;
    var count = 0;
    var max = Math.min(urls.length - 1, 10);
    for (var i = 0; i < max; i += 2) {
      var a = urls[i].match(/_(\d+)_/);
      var b = urls[i + 1].match(/_(\d+)_/);
      if (a && b && a[1] === b[1]) count++;
    }
    return count >= 3;
  }

  function pairSplitImages(urls) {
    var paired = [];
    for (var i = 0; i < urls.length; i += 2) {
      if (i + 1 < urls.length) paired.push("SPLIT:" + urls[i] + "|" + urls[i + 1]);
      else paired.push(urls[i]);
    }
    return paired;
  }

  return {
    requiresCloudflare: false,

    async getHomepageManga(args) {
      try {
        var page = (args && args.page) || 1;
        var html = await fetchHtml(page === 1 ? baseUrl : baseUrl + "/page/" + page + "/");
        return await toMangaList(html, sel("homepage_list", ".listupd .bs, .listupd .bsx"), {
          titleSel: sel("homepage_title", ".tt a, .tt, img"),
          coverSel: sel("homepage_cover", ".limit img, img"),
          urlSel: sel("homepage_url", "a"),
          filterRepeatedHomeCards: true
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
        return await toMangaList(html, sel("search_list", ".listupd .bs, .listupd .bsx"), {
          titleSel: sel("search_title", ".tt a, .tt, img"),
          coverSel: sel("search_cover", ".limit img, img"),
          urlSel: "a"
        });
      } catch (e) {
        return [];
      }
    },

    async getMangaDetails(args) {
      var url = makeAbsolute((args && args.url) || "");
      var html = await fetchHtml(url);
      var title = await firstText(html, sel("manga_title", ".entry-title, h1, meta[property='og:title']"));
      var cover = await firstAttr(html, sel("manga_cover", ".thumb img, meta[property='og:image']"), ["data-src", "data-lazy-src", "src", "content"]);
      var description = await firstText(html, sel("manga_description", ".entry-content p, .entry-content"));
      var genres = await api.cssList(html, sel("manga_genres", ".mgen a, .genres a"));
      return {
        title: cleanText(title) || "بدون عنوان",
        coverUrl: cover ? makeAbsolute(cover) : "",
        description: cleanText(description).replace("متابعة قراءة", "").trim(),
        genres: genres.map(function(g) { return cleanText(g); }).filter(function(g) { return !!g; }),
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
      var urls = await extractPageImages(html);
      return shouldSplitImages(html, urls) ? pairSplitImages(urls) : urls;
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
          var slug = String(genre).toLowerCase().replace(/ /g, "-");
          url = page === 1 ? baseUrl + "/genres/" + slug + "/" : baseUrl + "/genres/" + slug + "/page/" + page + "/";
        } else {
          url = page === 1 ? baseUrl + "/" : baseUrl + "/page/" + page + "/";
        }
        var html = await fetchHtml(url);
        return await toMangaList(html, sel("filter_list", ".listupd .bs"), {
          titleSel: sel("filter_title", ".tt a, .tt, img"),
          coverSel: sel("filter_cover", "img"),
          urlSel: sel("filter_url", "a"),
          filterRepeatedHomeCards: true
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
