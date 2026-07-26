function createSource(api, config) {
  var baseUrl = ((config && config.base_url) || "https://brownmanga.site").replace(/\/+$/, "");
  var configHeaders = (config && config.headers) || {};
  var userAgent =
    configHeaders["User-Agent"] ||
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";

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

  // Extract the RSC payload from Next.js __next_f.push script tags
  function extractRscPayload(html) {
    // Find all script tags
    var startMarker = "self.__next_f.push([";
    var payloads = [];
    var idx = 0;
    while (true) {
      var si = html.indexOf(startMarker, idx);
      if (si === -1) break;
      // Find the actual string content after the array start
      var arrStart = si + startMarker.length;
      // Skip the entry number (e.g. "1," or "0,")
      var comma = html.indexOf(",", arrStart);
      if (comma === -1) break;
      var strStart = html.indexOf("\"", comma + 1);
      if (strStart === -1) break;
      strStart += 1;
      // Find the closing quote (account for escape sequences)
      var strEnd = -1;
      var escape = false;
      for (var pi = strStart; pi < html.length; pi++) {
        var pc = html.charAt(pi);
        if (escape) { escape = false; continue; }
        if (pc === "\\") { escape = true; continue; }
        if (pc === "\"") { strEnd = pi; break; }
      }
      if (strEnd === -1) break;
      var content = html.substring(strStart, strEnd);
      // Unescape the JSON string
      content = content.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
      payloads.push(content);
      idx = strEnd + 1;
    }
    return payloads.join("");
  }

  // Find JSON value starting at position in a JSON string, tracking bracket depth
  function extractJsonValue(str, startPos) {
    if (startPos >= str.length) return null;
    var firstChar = str.charAt(startPos);
    if (firstChar === "{") return extractBalanced(str, startPos, "{", "}");
    if (firstChar === "[") return extractBalanced(str, startPos, "[", "]");
    return null;
  }

  function extractBalanced(str, startPos, openChar, closeChar) {
    var depth = 0;
    var inStr = false;
    var esc = false;
    var end = -1;
    for (var i = startPos; i < str.length; i++) {
      var c = str.charAt(i);
      if (esc) { esc = false; continue; }
      if (c === "\\") { esc = true; continue; }
      if (c === "\"") { inStr = !inStr; continue; }
      if (!inStr) {
        if (c === openChar) {
          depth++;
          if (depth === 1 && i !== startPos) return null;
        } else if (c === closeChar) {
          depth--;
          if (depth === 0) { end = i + 1; break; }
        }
      }
    }
    if (end === -1) return null;
    return str.substring(startPos, end);
  }

  // Parse manga items from the manhwaList in the RSC payload
  function parseMangaList(rscPayload) {
    // Look for "manhwaList":[ array
    var marker = '"manhwaList":[';
    var mhIdx = rscPayload.indexOf(marker);
    if (mhIdx === -1) return [];
    var listStart = mhIdx + marker.length - 1; // point to [
    var listStr = extractBalanced(rscPayload, listStart, "[", "]");
    if (!listStr) return [];
    try {
      return JSON.parse(listStr);
    } catch (e) {
      return [];
    }
  }

  // Parse serverData for detail page
  function parseServerData(rscPayload) {
    var marker = '"serverData":';
    var sdIdx = rscPayload.indexOf(marker);
    if (sdIdx === -1) return null;
    var valStart = sdIdx + marker.length;
    var valStr = extractJsonValue(rscPayload, valStart);
    if (!valStr) return null;
    try {
      return JSON.parse(valStr);
    } catch (e) {
      return null;
    }
  }

  // Build card objects from manhwaList JSON items
  function buildCards(manhwaList) {
    var out = [];
    var seen = {};
    for (var i = 0; i < manhwaList.length; i++) {
      var item = manhwaList[i];
      if (!item) continue;
      var slug = item.slug || "";
      if (!slug) continue;
      var detailUrl = makeAbsolute("/series/" + slug);
      if (seen[detailUrl]) continue;
      seen[detailUrl] = true;

      var title = cleanTitle(item.title || item.title_ar || "");
      if (!title) continue;

      var cover = item.cover_url || "";
      if (cover) cover = makeAbsolute(cover);

      var contentType = item.type || "manga";

      var status = item.status || "";

      var rating = "";
      if (item.average_rating !== null && item.average_rating !== undefined) {
        rating = String(item.average_rating);
      }

      out.push({
        title: title,
        coverUrl: cover || "",
        detailUrl: detailUrl,
        contentType: contentType,
        status: status,
        rating: rating
      });
    }
    return out;
  }

  // Parse cards from browse/home/search pages using RSC payload
  async function parseCards(html) {
    var payload = extractRscPayload(html);
    var list = parseMangaList(payload);
    var cards = buildCards(list);
    return cards;
  }

  // Extract chapters from the detail page's RSC payload and HTML
  function parseChapters(rscPayload, html) {
    var sd = parseServerData(rscPayload);
    var manhwa = (sd && sd.manhwa) || {};
    var slug = manhwa.slug || "";

    // Build metadata map from initialChapters (chapter_number → data)
    var metaMap = {};
    if (sd && sd.initialChapters) {
      for (var mi = 0; mi < sd.initialChapters.length; mi++) {
        var c = sd.initialChapters[mi];
        metaMap[String(c.chapter_number)] = c;
      }
    }

    // Extract all chapter links from HTML: /series/{slug}/chapter/{number}
    var chapters = [];
    var seen = {};
    var chPattern = new RegExp('href="([^"]*/series/' + slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/chapter/(\\d+\\.?\\d*))"', 'g');
    var chMatch;
    while ((chMatch = chPattern.exec(html)) !== null) {
      var chUrl = makeAbsolute(chMatch[1]);
      if (seen[chUrl]) continue;
      seen[chUrl] = true;
      var chNum = chMatch[2];
      var chMeta = metaMap[chNum] || {};
      chapters.push({
        number: chNum,
        title: cleanTitle(chMeta.title || "Chapter " + chNum),
        url: chUrl,
        views: chMeta.views || 0,
        isLocked: !!(chMeta.is_locked),
        date: chMeta.created_at || ""
      });
    }

    // Sort descending by chapter number
    chapters.sort(function(a, b) {
      return (parseFloat(b.number) || 0) - (parseFloat(a.number) || 0);
    });
    return chapters;
  }

  // Parse chapter pages from the chapter page RSC payload
  function parseChapterPages(rscPayload) {
    // Look for "pages":[{...}] array in the payload
    var marker = '"pages":[';
    var pIdx = rscPayload.indexOf(marker);
    if (pIdx === -1) return [];
    var listStart = pIdx + marker.length - 1;
    var listStr = extractBalanced(rscPayload, listStart, "[", "]");
    if (!listStr) return [];
    try {
      var pages = JSON.parse(listStr);
      var urls = [];
      for (var pi = 0; pi < pages.length; pi++) {
        if (pages[pi] && pages[pi].image_url) {
          urls.push(makeAbsolute(pages[pi].image_url));
        }
      }
      return urls;
    } catch (e) {
      return [];
    }
  }

  // Try to extract status from detail page serverData
  function extractStatus(html, rscPayload) {
    var sd = parseServerData(rscPayload);
    if (sd && sd.manhwa && sd.manhwa.status) {
      return sd.manhwa.status;
    }
    return "";
  }

  return {
    requiresCloudflare: false,

    async getHomepageManga(args) {
      try {
        var page = (args && args.page) || 1;
        var url = page === 1 ? baseUrl + "/browse" : baseUrl + "/browse?page=" + page;
        var html = await fetchHtml(url);
        return await parseCards(html);
      } catch (e) {
        return [];
      }
    },

    async search(args) {
      try {
        var query = (args && args.query) || "";
        if (!query.trim()) return [];
        var url = baseUrl + "/browse";
        var html = await fetchHtml(url);
        var items = await parseCards(html);
        var ql = query.toLowerCase();
        return items.filter(function(c) {
          return c.title.toLowerCase().indexOf(ql) !== -1;
        });
      } catch (e) {
        return [];
      }
    },

    async getMangaDetails(args) {
      try {
        var url = makeAbsolute((args && args.url) || "");
        var html = await fetchHtml(url);
        var payload = extractRscPayload(html);
        var sd = parseServerData(payload);

        var manhwa = (sd && sd.manhwa) || {};
        var title = cleanTitle(manhwa.title || manhwa.title_ar || "");
        if (!title) {
          title = cleanTitle((await api.cssText(html, "h1")) || "");
        }
        if (!title) {
          title = cleanTitle((await api.cssAttr(html, "meta[property='og:title']", "content")) || "");
          title = title.replace(/\s*\|.*$/, "").trim();
        }

        var cover = manhwa.cover_url || "";
        if (!cover) {
          cover = await api.cssAttr(html, "meta[property='og:image']", "content") || "";
        }
        cover = cover ? makeAbsolute(cover) : "";

        var description = cleanTitle(manhwa.description_ar || manhwa.description || "");
        if (!description) {
          description = await api.cssAttr(html, "meta[name='description']", "content") || "";
          description = cleanTitle(description);
        }

        var genres = [];
        if (manhwa.manhwa_genres) {
          // Genre IDs only, no names in the server data
        }
        // Try og tags for genres
        try {
          var genreEls = await api.cssAll(html, "a[href*='/genres?g=']");
          for (var gi = 0; gi < genreEls.length; gi++) {
            var gText = cleanTitle(genreEls[gi].text || "");
            if (gText) genres.push(gText);
          }
        } catch (e) {}

        var statusText = manhwa.status || "";

        // Extract chapters from the page if available
        var chapters = parseChapters(payload, html);

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
          contentType: manhwa.type || "manga"
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
      try {
        var chapterUrl = makeAbsolute((args && args.url) || "");
        if (!chapterUrl) return [];
        var html = await fetchHtml(chapterUrl);
        var payload = extractRscPayload(html);
        return parseChapterPages(payload);
      } catch (e) {
        return [];
      }
    },

    async getChapterContent(args) {
      var urls = await this.getChapterPages(args);
      return { kind: "image", imageUrls: urls };
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

        var html = await fetchHtml(url);
        var items = await parseCards(html);

        // Client-side filtering if server doesn't support it
        if (type) {
          items = items.filter(function(c) { return c.contentType === type; });
        }
        if (status) {
          items = items.filter(function(c) { return c.status === status; });
        }

        return items;
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
