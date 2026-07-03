function createSource(api, config) {
  var baseUrl = ((config && config.base_url) || "https://mnga4all.com").replace(/\/+$/, "");
  var configHeaders = (config && config.headers) || {};
  var userAgent =
    configHeaders["User-Agent"] ||
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
  var lastChapterUrl = baseUrl + "/";

  var defaultGenres = [
    "أكشن", "مغامرة", "خيال", "دراما", "رومانسي",
    "شونين", "سينين", "شريحة من الحياة", "نفسي", "غموض",
    "إثارة", "رعب", "فنون قتالية", "مأساة", "تاريخي",
    "رياضي", "مدرسي", "شياطين", "سحر",
    "كوميديا", "تناسخ", "خارق للطبيعة", "عسكري"
  ];
  var defaultTypes = ["manga", "manhwa", "manhua"];

  var genreSlugMap = {
    "أكشن": "action",
    "مغامرة": "adventure",
    "خيال": "fantasy",
    "دراما": "drama",
    "رومانسي": "romance",
    "شونين": "shounen",
    "سينين": "seinen",
    "شريحة من الحياة": "slice-of-life",
    "نفسي": "psychological",
    "غموض": "mystery",
    "إثارة": "thriller",
    "رعب": "horror",
    "فنون قتالية": "martial-arts",
    "مأساة": "tragedy",
    "تاريخي": "historical",
    "رياضي": "sports",
    "مدرسي": "school-life",
    "شياطين": "demons",
    "سحر": "magic",
    "كوميديا": "comedy",
    "تناسخ": "reincarnation",
    "خارق للطبيعة": "supernatural",
    "عسكري": "military"
  };

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

  function mergeHeaders(a, b) {
    var out = {};
    for (var k in a) out[k] = a[k];
    if (b) for (var x in b) out[x] = b[x];
    return out;
  }

  async function fetchHtml(url, extraHeaders, method) {
    var headers = mergeHeaders(defaultHeaders, extraHeaders);
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

  function cleanTitle(s) {
    return String(s || "").replace(/\s+/g, " ").trim();
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

  function extractCover(html, selector) {
    return api.cssAttr(html, selector, "data-src")
      .then(function(src) {
        if (!src || src.indexOf("data:image") === 0) return api.cssAttr(html, selector, "data-lazy-src");
        return src;
      })
      .then(function(src) {
        if (!src || src.indexOf("data:image") === 0) return api.cssAttr(html, selector, "src");
        return src;
      })
      .then(function(src) {
        if (!src || src.indexOf("data:image") === 0) return "";
        return makeAbsolute(src);
      });
  }

  function lastNumFromUrl(url) {
    if (!url) return null;
    var parts = url.replace(/\/+$/, "").split("/");
    var last = parts[parts.length - 1] || "";
    var n = parseFloat(last);
    return !isNaN(n) && n > 0 ? String(n) : null;
  }

  async function parseCards(html) {
    var items = await api.cssAll(html, ".page-item-detail");
    var out = [];
    var seen = {};
    for (var i = 0; i < items.length; i++) {
      var itemHtml = (items[i] || {}).html || "";
      var title = await api.cssText(itemHtml, ".post-title a");
      if (!title || !title.trim()) continue;
      var detailUrl = makeAbsolute(await api.cssAttr(itemHtml, ".post-title a", "href") || "");
      if (!detailUrl || seen[detailUrl]) continue;
      seen[detailUrl] = true;
      var cover = await extractCover(itemHtml, ".item-thumb img");
      out.push({
        title: cleanTitle(title),
        coverUrl: cover,
        detailUrl: detailUrl,
        contentType: "manga"
      });
    }
    return out;
  }

  async function fetchChaptersViaAjax(mangaId) {
    try {
      var ajaxUrl = baseUrl + "/wp-admin/admin-ajax.php";
      var ajaxHeaders = mergeHeaders(defaultHeaders, {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Requested-With": "XMLHttpRequest",
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors"
      });
      var resp = await api.http(ajaxUrl, {
        method: "POST",
        headers: ajaxHeaders,
        body: "action=manga_get_chapters&manga_id=" + encodeURIComponent(mangaId)
      });
      if (!resp || !resp.ok) return null;
      var ajaxHtml = resp.body || "";
      if (!ajaxHtml.trim()) return null;
      var items = await api.cssAll(ajaxHtml, "li.wp-manga-chapter");
      var chapters = [];
      var seen = {};
      for (var i = 0; i < items.length; i++) {
        var c = items[i] || {};
        var cHtml = c.html || "";
        var href = await api.cssAttr(cHtml, "a", "href") || "";
        if (!href) continue;
        var chUrl = makeAbsolute(href);
        if (seen[chUrl]) continue;
        seen[chUrl] = true;
        var text = await api.cssText(cHtml, "a") || "";
        var numM = text.match(/(\d+(?:\.\d+)?)/);
        var number = numM ? numM[1] : lastNumFromUrl(href) || "0";
        chapters.push({
          number: number,
          title: "",
          url: chUrl,
          views: 0,
          isLocked: false,
          date: ""
        });
      }
      if (chapters.length) {
        chapters.sort(function(a, b) {
          return (parseFloat(b.number) || 0) - (parseFloat(a.number) || 0);
        });
        return chapters;
      }
    } catch (e) {}
    return null;
  }

  async function extractChaptersFromHtml(html, slug) {
    var chapters = [];
    var seen = {};
    var items = await api.cssAll(html, "li.wp-manga-chapter, ul.main li, .wp-manga-chapter");
    for (var i = 0; i < items.length; i++) {
      var itemHtml = (items[i] || {}).html || "";
      var href = await api.cssAttr(itemHtml, "a", "href") || "";
      if (!href) continue;
      var chUrl = makeAbsolute(href);
      if (seen[chUrl]) continue;
      seen[chUrl] = true;
      var text = await api.cssText(itemHtml, "a") || "";
      var numM = text.match(/(\d+(?:\.\d+)?)/);
      var number = numM ? numM[1] : lastNumFromUrl(href) || "0";
      chapters.push({
        number: number,
        title: "",
        url: chUrl,
        views: 0,
        isLocked: false,
        date: ""
      });
    }
    if (!chapters.length && slug) {
      var firstHref = await api.cssAttr(html, "#btn-read-first", "href") || "";
      var lastHref = await api.cssAttr(html, "#btn-read-last", "href") || "";
      var firstNumStr = lastNumFromUrl(firstHref);
      var lastNumStr = lastNumFromUrl(lastHref);
      if (firstNumStr && lastNumStr) {
        var start = Math.min(parseFloat(firstNumStr), parseFloat(lastNumStr));
        var end = Math.max(parseFloat(firstNumStr), parseFloat(lastNumStr));
        for (var n = end; n >= start; n--) {
          var chNum = String(n);
          var chUrl = baseUrl + "/manga/" + slug + "/" + chNum + "/";
          chapters.push({
            number: chNum,
            title: "",
            url: chUrl,
            views: 0,
            isLocked: false,
            date: ""
          });
        }
      }
    }
    if (chapters.length) {
      chapters.sort(function(a, b) {
        return (parseFloat(b.number) || 0) - (parseFloat(a.number) || 0);
      });
    }
    return chapters;
  }

  return {
    requiresCloudflare: false,
    async getHomepageManga(args) {
      try {
        var page = (args && args.page) || 1;
        var url = baseUrl + "/?s=&post_type=wp-manga";
        if (page > 1) url += "&paged=" + page;
        return await parseCards(await fetchHtml(url));
      } catch (e) {
        return [];
      }
    },
    async search(args) {
      try {
        var query = (args && args.query) || "";
        if (!query.trim()) return [];
        var page = (args && args.page) || 1;
        var url = baseUrl + "/?s=" + encodeURIComponent(query) + "&post_type=wp-manga";
        if (page > 1) url += "&paged=" + page;
        return await parseCards(await fetchHtml(url));
      } catch (e) {
        return [];
      }
    },
    async getMangaDetails(args) {
      var url = makeAbsolute((args && args.url) || "");
      var html = await fetchHtml(url);
      var title = await api.cssText(html, ".post-title h1") || "";
      var cover = await extractCover(html, ".summary_image img");
      if (!cover) {
        cover = await api.cssAttr(html, "meta[property='og:image']", "content").then(function(v) {
          return v ? makeAbsolute(v) : "";
        });
      }
      var description = await api.cssText(html, ".description-summary .summary__content") || "";
      description = cleanTitle(description).replace("متابعة قراءة", "").trim();
      var genres = await api.cssList(html, ".genres-content a") || [];
      genres = genres.map(cleanTitle).filter(Boolean);
      var slugMatch = url.match(/\/manga\/([^\/]+)/);
      var slug = slugMatch ? slugMatch[1] : "";
      var mangaIdMatch = html.match(/"manga_id"\s*:\s*"(\d+)"/);
      var mangaId = mangaIdMatch ? mangaIdMatch[1] : "";
      var chapters = null;
      if (mangaId && api.http) {
        chapters = await fetchChaptersViaAjax(mangaId);
      }
      if (!chapters) {
        chapters = await extractChaptersFromHtml(html, slug);
      }
      return {
        title: cleanTitle(title) || "بدون عنوان",
        coverUrl: cover || "",
        description: description,
        genres: genres,
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
      var urls = [];
      var images = await api.cssAll(html, ".reading-content img.wp-manga-chapter-img");
      for (var i = 0; i < images.length; i++) {
        var attrs = (images[i] || {}).attrs || {};
        var src = attrs["data-src"] || attrs["src"] || "";
        if (!src) continue;
        src = makeAbsolute(src);
        if (src && urls.indexOf(src) === -1) urls.push(src);
      }
      if (!urls.length) {
        var images2 = await api.cssAll(html, ".reading-content img, .page-break img");
        for (var i = 0; i < images2.length; i++) {
          var attrs = (images2[i] || {}).attrs || {};
          var src = attrs["data-src"] || attrs["src"] || "";
          if (!src) continue;
          src = makeAbsolute(src);
          if (src && urls.indexOf(src) === -1) urls.push(src);
        }
      }
      return urls;
    },
    async getChapterContent(args) {
      return { kind: "image", imageUrls: await this.getChapterPages(args) };
    },
    async getFilteredManga(args) {
      try {
        var page = (args && args.page) || 1;
        var genre = (args && args.genre) || "";
        var type = (args && args.type) || "";
        var typeSlugMap = { "manga": "مانجا", "manhwa": "مانهوا", "manhua": "مانها" };
        var url;
        if (genre) {
          var slug = genreSlugMap[genre] || genre.toLowerCase().replace(/ /g, "-");
          url = baseUrl + "/manga-genre/" + slug + "/";
          if (page > 1) url += "page/" + page + "/";
        } else if (type) {
          var tSlug = typeSlugMap[type] || type;
          url = baseUrl + "/manga-genre/" + encodeURIComponent(tSlug) + "/";
          if (page > 1) url += "page/" + page + "/";
        } else {
          url = baseUrl + "/?s=&post_type=wp-manga";
          if (page > 1) url += "&paged=" + page;
        }
        return await parseCards(await fetchHtml(url));
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
    }
  };
}

if (typeof module !== "undefined") module.exports = { createSource: createSource };
