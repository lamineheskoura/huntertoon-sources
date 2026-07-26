function createSource(api, config) {
  var baseUrl = ((config && config.base_url) || "https://brownmanga.site").replace(/\/+$/, "");
  var configHeaders = (config && config.headers) || {};
  var userAgent =
    configHeaders["User-Agent"] ||
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";

  var typeMap = {
    "manhwa": "manhwa",
    "manhua": "manhua",
    "manga": "manga",
    "comics": "comics",
    "novel": "novel",
    "مانهوا": "manhwa",
    "مانها": "manhua",
    "مانجا": "manga",
    "كوميكس": "comics",
    "رواية": "novel"
  };

  var statusMap = {
    "ongoing": "ongoing",
    "completed": "completed",
    "hiatus": "hiatus",
    "dropped": "dropped",
    "مستمر": "ongoing",
    "مكتمل": "completed",
    "متوقف": "hiatus",
    "ملغي": "dropped"
  };

  var defaultGenres = [
    "Action", "Adventure", "Comedy", "Drama", "Fantasy", "Horror",
    "Isekai", "Martial Arts", "Mystery", "Romance", "School Life",
    "Sci-Fi", "Shoujo", "Shounen", "Slice of Life", "Supernatural",
    "Thriller", "Historical", "Josei", "Harem", "Mecha", "Psychological",
    "Sports", "Tragedy"
  ];

  var genreSlugMap = {
    "action": "action", "adventure": "adventure", "comedy": "comedy",
    "drama": "drama", "fantasy": "fantasy", "horror": "horror",
    "isekai": "isekai", "martial arts": "martial-arts",
    "mystery": "mystery", "romance": "romance",
    "school life": "school-life", "sci-fi": "sci-fi",
    "shoujo": "shoujo", "shounen": "shounen",
    "slice of life": "slice-of-life", "supernatural": "supernatural",
    "thriller": "thriller", "historical": "historical",
    "josei": "josei", "harem": "harem", "mecha": "mecha",
    "psychological": "psychological", "sports": "sports",
    "tragedy": "tragedy"
  };

  var defaultTypes = ["manhwa", "manhua", "manga", "comics", "novel"];

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
    if (url.indexOf("/") === 0) return baseUrl.replace(/\/+$/, "") + url;
    return baseUrl.replace(/\/+$/, "") + "/" + url;
  }

  function mapStatus(text) {
    var t = cleanTitle(text).toLowerCase();
    return statusMap[t] || t;
  }

  function mapType(text) {
    var t = cleanTitle(text).toLowerCase();
    return typeMap[t] || t;
  }

  // Parse cards from browse, home, or search results
  // Browse/home use: a.group.block with badge spans
  // Search uses: simpler a links with img + text
  async function parseCards(html) {
    // Try the standard card selector first (browse/home)
    var items = await api.cssAll(html, "a.group.block");
    var out = [];
    var seen = {};

    for (var i = 0; i < items.length; i++) {
      var item = items[i] || {};
      var inner = item.html || "";
      var attrs = item.attrs || {};
      var detailUrl = makeAbsolute(attrs.href || "");
      if (!detailUrl || detailUrl.indexOf("/series/") === -1 && detailUrl.indexOf("/novel/") === -1) continue;
      if (seen[detailUrl]) continue;
      seen[detailUrl] = true;

      var title = "";
      var titleEl = await api.cssText(inner, "h3");
      if (titleEl) title = cleanTitle(titleEl);
      if (!title) {
        var imgAlt = await api.cssAttr(inner, "img", "alt");
        if (imgAlt) title = cleanTitle(imgAlt);
      }
      if (!title) continue;

      var cover = await api.cssAttr(inner, "img", "src");
      if (cover) cover = makeAbsolute(cover);

      // Extract status and type from badge spans
      var allSpans = await api.cssList(inner, "span");
      var statusText = "";
      var typeText = "";
      for (var si = 0; si < allSpans.length; si++) {
        var st = cleanTitle(allSpans[si]);
        if (!st) continue;
        var stl = st.toLowerCase();
        if (stl === "ongoing" || stl === "completed" || stl === "hiatus" || stl === "dropped" ||
            stl === "مستمر" || stl === "مكتمل" || stl === "متوقف" || stl === "ملغي") {
          statusText = st;
        } else if (stl === "manhwa" || stl === "manhua" || stl === "manga" || stl === "comics" || stl === "novel" ||
                   stl === "مانهوا" || stl === "مانها" || stl === "مانجا" || stl === "كوميكس" || stl === "رواية") {
          typeText = st;
        }
      }

      // Try to get rating from star svg parent
      var rating = "";
      try {
        var starDiv = await api.cssText(inner, "div.flex.items-center.gap-1");
        if (starDiv) {
          var rm = starDiv.match(/(\d+\.?\d*)/);
          if (rm) rating = rm[1];
        }
      } catch (e) {}

      out.push({
        title: title,
        coverUrl: cover || "",
        detailUrl: detailUrl,
        contentType: mapType(typeText) || "manga",
        status: mapStatus(statusText),
        rating: rating
      });
    }

    // If no cards found with standard selector, try search result format
    if (out.length === 0) {
      var searchItems = await api.cssAll(html, "a[href*='/series/'], a[href*='/novel/']");
      for (var si2 = 0; si2 < searchItems.length; si2++) {
        var sItem = searchItems[si2] || {};
        var sInner = sItem.html || "";
        var sAttrs = sItem.attrs || {};
        var sUrl = makeAbsolute(sAttrs.href || "");
        if (!sUrl || seen[sUrl]) continue;

        // Filter out nav/footer links
        if (sUrl.indexOf("/series/") === -1 && sUrl.indexOf("/novel/") === -1) continue;
        // Skip non-card links (header nav, footer, etc.)
        if (sUrl === baseUrl + "/series/" || sUrl === baseUrl + "/novel/") continue;

        var sTitle = "";
        var sImgAlt = await api.cssAttr(sInner, "img", "alt");
        if (sImgAlt) sTitle = cleanTitle(sImgAlt);
        if (!sTitle) {
          var sText = cleanTitle(sInner.replace(/<[^>]+>/g, ""));
          if (sText && sText.length > 1) sTitle = sText;
        }
        if (!sTitle) continue;

        var sCover = await api.cssAttr(sInner, "img", "src");
        if (sCover) sCover = makeAbsolute(sCover);

        out.push({
          title: sTitle,
          coverUrl: sCover || "",
          detailUrl: sUrl,
          contentType: "manga",
          status: "",
          rating: ""
        });
      }
    }

    return out;
  }

  async function extractChapters(html) {
    var items = await api.cssAll(html, "a[href*='/chapter/']");
    var chapters = [];
    var seen = {};
    for (var i = 0; i < items.length; i++) {
      var item = items[i] || {};
      var attrs = item.attrs || {};
      var inner = item.html || "";
      var href = attrs.href || "";
      if (!href) continue;
      var chapterUrl = makeAbsolute(href);
      if (!chapterUrl || seen[chapterUrl]) continue;
      seen[chapterUrl] = true;

      // Extract chapter number from URL
      var numMatch = chapterUrl.match(/\/chapter\/(\d+\.?\d*)\/?$/);
      var chNum = numMatch ? numMatch[1] : "0";

      // Extract chapter title from the first font-semibold span
      var chTitle = await api.cssText(inner, "span.font-semibold") || "";
      if (!chTitle) chTitle = await api.cssText(inner, "span.text-xs") || "";
      chTitle = cleanTitle(chTitle);

      // Extract date from last span
      var allSpans = await api.cssAll(inner, "span");
      var dateStr = "";
      if (allSpans && allSpans.length > 0) {
        var lastSpan = allSpans[allSpans.length - 1];
        dateStr = cleanTitle(lastSpan.text || "");
      }

      chapters.push({
        number: chNum,
        title: chTitle || "Chapter " + chNum,
        url: chapterUrl,
        views: 0,
        isLocked: false,
        date: dateStr
      });
    }
    // Sort descending by chapter number
    chapters.sort(function(a, b) {
      return (parseFloat(b.number) || 0) - (parseFloat(a.number) || 0);
    });
    return chapters;
  }

  async function extractReaderImages(html) {
    var urls = [];
    var seen = {};
    var images = await api.cssAll(html, "img[src*='/chapters/']");
    for (var i = 0; i < images.length; i++) {
      var attrs = (images[i] || {}).attrs || {};
      var src = attrs.src || "";
      if (!src || seen[src]) continue;
      seen[src] = true;
      urls.push(makeAbsolute(src));
    }
    return urls;
  }

  // Try to extract status from the detail page
  async function extractStatus(html) {
    // Try to find status in the JSON-LD or embedded data
    try {
      var jsonScripts = await api.cssAll(html, "script[type='application/ld+json']");
      for (var j = 0; j < jsonScripts.length; j++) {
        var jsonText = jsonScripts[j].text || "";
        if (jsonText) {
          var m = jsonText.match(/"creativeWorkStatus"\s*:\s*"([^"]+)"/);
          if (m && m[1]) return mapStatus(m[1]);
        }
      }
    } catch (e) {}

    // Try to find status from the page text area near the cover
    // The status is shown as "Ongoing" or "Completed" in the summary
    try {
      var allText = await api.cssText(html, "main") || "";
      var stMatch = allText.match(/\b(Ongoing|Completed|Hiatus|Dropped|مستمر|مكتمل|متوقف|ملغي)\b/i);
      if (stMatch) return mapStatus(stMatch[1]);
    } catch (e) {}

    return "";
  }

  return {
    requiresCloudflare: false,

    async getHomepageManga(args) {
      try {
        var page = (args && args.page) || 1;
        var url = page === 1 ? baseUrl + "/browse" : baseUrl + "/browse?page=" + page;
        return await parseCards(await fetchHtml(url));
      } catch (e) {
        return [];
      }
    },

    async search(args) {
      try {
        var query = (args && args.query) || "";
        if (!query.trim()) return [];
        var url = baseUrl + "/search?q=" + encodeURIComponent(query);
        var html = "";
        try {
          html = await fetchHtml(url);
        } catch (e) {
          return [];
        }
        var result = await parseCards(html);
        if (!result || !result.length) {
          // Fallback: fetch browse and filter locally
          url = baseUrl + "/browse";
          html = await fetchHtml(url);
          result = await parseCards(html);
          var ql = query.toLowerCase();
          result = result.filter(function(c) {
            return c.title.toLowerCase().indexOf(ql) !== -1;
          });
        }
        return result;
      } catch (e) {
        return [];
      }
    },

    async getMangaDetails(args) {
      try {
        var url = makeAbsolute((args && args.url) || "");
        var html = await fetchHtml(url);

        var title = await api.cssText(html, "h1") || "";
        if (!title) title = await api.cssAttr(html, "meta[property='og:title']", "content") || "";
        title = cleanTitle(title);
        // Remove site suffix from og:title if present
        title = title.replace(/\s*\|.*$/, "").trim();

        var cover = await api.cssAttr(html, "meta[property='og:image']", "content");
        cover = cover ? makeAbsolute(cover) : "";

        var description = await api.cssAttr(html, "meta[name='description']", "content") || "";
        description = cleanTitle(description);

        var genres = await api.cssList(html, "a[href*='/genres?g=']") || [];
        genres = genres.map(cleanTitle).filter(Boolean);

        var statusText = await extractStatus(html);
        var chapters = await extractChapters(html);

        return {
          title: title || "Unknown",
          coverUrl: cover,
          description: description,
          genres: genres,
          status: statusText,
          chapters: chapters,
          originalUrl: url,
          hasMoreChapters: false,
          lastFetchedPage: 1,
          contentType: "manga"
        };
      } catch (e) {
        return {
          title: "Error",
          coverUrl: "",
          description: "",
          genres: [],
          status: "",
          chapters: [],
          originalUrl: (args && args.url) || "",
          hasMoreChapters: false,
          lastFetchedPage: 1,
          contentType: "manga"
        };
      }
    },

    async getChapterPages(args) {
      var chapterUrl = makeAbsolute((args && args.url) || "");
      var html = await fetchHtml(chapterUrl);
      return await extractReaderImages(html);
    },

    async getChapterContent(args) {
      return { kind: "image", imageUrls: await this.getChapterPages(args) };
    },

    async getFilteredManga(args) {
      try {
        var page = (args && args.page) || 1;
        var genre = ((args && args.genre) || "").toLowerCase().trim();
        var type = ((args && args.type) || "").toLowerCase().trim();
        var status = ((args && args.status) || "").toLowerCase().trim();

        var url = page === 1 ? baseUrl + "/browse" : baseUrl + "/browse?page=" + page;
        var params = [];

        if (genre) {
          var slug = genreSlugMap[genre] || genre.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
          params.push("g=" + encodeURIComponent(slug));
        }
        if (type) params.push("type=" + encodeURIComponent(type));
        if (status) params.push("status=" + encodeURIComponent(status));

        if (params.length > 0) {
          url += (url.indexOf("?") === -1 ? "?" : "&") + params.join("&");
        }

        return await parseCards(await fetchHtml(url));
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
      return makeAbsolute((args && args.url) || "");
    }
  };
}

if (typeof module !== "undefined") module.exports = { createSource: createSource };
