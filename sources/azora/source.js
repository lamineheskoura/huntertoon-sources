function createSource(api, config) {
  var baseUrl = ((config && config.base_url) || "https://azorafly.com").replace(/\/+$/, "");
  var apiBase = "https://api.azorafly.com";
  var userAgent = (config && config.user_agent) || "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
  var lastChapterUrl = baseUrl + "/";

  var headers = {
    "User-Agent": userAgent,
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "ar,en-US;q=0.9,en;q=0.8",
    "Referer": baseUrl + "/",
    "Origin": baseUrl,
    "Sec-Fetch-Site": "same-site"
  };

  var htmlHeaders = {
    "User-Agent": userAgent,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "ar,en-US;q=0.9,en;q=0.8",
    "Referer": baseUrl + "/",
    "Origin": baseUrl,
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none"
  };

  function buildQuery(params) {
    var parts = [];
    for (var key in params) {
      if (!params.hasOwnProperty(key)) continue;
      var value = params[key];
      if (value !== null && value !== undefined && value !== "") {
        parts.push(encodeURIComponent(key) + "=" + encodeURIComponent(String(value)));
      }
    }
    return parts.length ? "?" + parts.join("&") : "";
  }

  async function requestText(url, requestHeaders) {
    if (api.http) {
      var res = await api.http(url, { method: "GET", headers: requestHeaders || headers });
      if (!res || !res.ok) throw new Error("HTTP " + (res ? res.status : 0) + " for " + url);
      return res.body || "";
    }
    var text = await api.fetchText(url, requestHeaders || headers);
    if (!text) throw new Error("Empty response: " + url);
    return text;
  }

  async function getJson(url) {
    return JSON.parse(await requestText(url, headers));
  }

  async function getHtml(url) {
    return await requestText(url, htmlHeaders);
  }

  function makeAbsolute(url) {
    if (!url) return "";
    url = String(url).replace(/&amp;/g, "&").replace(/\\\//g, "/").trim();
    if (url.indexOf("//") === 0) return "https:" + url;
    if (url.indexOf("http://") === 0 || url.indexOf("https://") === 0) return url;
    if (url.charAt(0) === "/") return baseUrl + url;
    return baseUrl + "/" + url;
  }

  function sanitizeImageUrl(url) {
    url = makeAbsolute(url);
    if (!url || url.indexOf("data:image") === 0) return "";
    var match = url.match(/[?&]url=([^&]+)/);
    if (match) {
      try { url = decodeURIComponent(match[1]); } catch (e) {}
    }
    return makeAbsolute(url);
  }

  function stripHtml(text) {
    return String(text || "")
      .replace(/<[^>]*>/g, " ")
      .replace(/&quot;/g, "\"")
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, "&")
      .replace(/\s+/g, " ")
      .trim();
  }

  function chapterNumber(value) {
    var m = String(value || "").match(/chapter-(\d+(?:\.\d+)?)/i) || String(value || "").match(/(\d+(?:\.\d+)?)/);
    return m ? m[1] : "0";
  }

  function toManga(post) {
    if (!post) return null;
    var slug = String(post.slug || "");
    var title = String(post.postTitle || post.title || "");
    if (!slug || !title) return null;
    return {
      title: title,
      coverUrl: sanitizeImageUrl(post.featuredImage || ""),
      detailUrl: baseUrl + "/series/" + slug,
      contentType: post.isNovel ? "novel" : "manga"
    };
  }

  async function queryPosts(params) {
    params = params || {};
    if (!params.perPage) params.perPage = 20;
    if (!params.page) params.page = 1;
    var data = await getJson(apiBase + "/api/query" + buildQuery(params));
    return Array.isArray(data.posts) ? data.posts : [];
  }

  async function findPostBySlug(slug) {
    var posts = await queryPosts({ searchTerm: slug, perPage: 10, page: 1 });
    for (var i = 0; i < posts.length; i++) {
      if (String(posts[i].slug || "") === slug) return posts[i];
    }
    return null;
  }

  function extractSlug(url) {
    var value = String(url || "");
    var m = value.match(/\/(?:series|manga)\/([^\/?#]+)/);
    if (m) return m[1];
    value = value.replace(/[?#].*$/, "").replace(/\/+$/, "");
    var parts = value.split("/");
    return parts.length ? parts[parts.length - 1] : "";
  }

  function extractPostId(html) {
    var patterns = [
      /&quot;postId&quot;:\[0,(\d+)\]/,
      /"postId":\[0,(\d+)\]/,
      /&quot;post&quot;:\[0,\{&quot;id&quot;:\[0,(\d+)\]/,
      /"post":\[0,\{"id":\[0,(\d+)\]/
    ];
    for (var i = 0; i < patterns.length; i++) {
      var m = html.match(patterns[i]);
      if (m) return parseInt(m[1], 10);
    }
    return 0;
  }

  async function fetchChapters(postId, slug) {
    if (!postId) return [];
    var data = await getJson(apiBase + "/api/chapters" + buildQuery({ postId: postId, perPage: 999 }));
    var post = data.post || data;
    var list = Array.isArray(post.chapters) ? post.chapters : [];
    var chapters = [];
    for (var i = 0; i < list.length; i++) {
      var ch = list[i] || {};
      var number = String(ch.number || chapterNumber(ch.slug));
      var chSlug = String(ch.slug || ("chapter-" + number));
      chapters.push({
        number: number,
        title: String(ch.title || "") || "الفصل " + number,
        views: 0,
        url: baseUrl + "/series/" + slug + "/" + chSlug,
        isLocked: ch.isLocked === true || ch.isPermanentlyLocked === true || ch.isAccessible === false,
        date: String(ch.createdAt || "")
      });
    }
    chapters.sort(function (a, b) { return (parseFloat(b.number) || 0) - (parseFloat(a.number) || 0); });
    return chapters;
  }

  async function fallbackChaptersFromHtml(html) {
    var items = await api.cssMap(html, "a[href*='/chapter-']", {
      href: { selector: "", type: "attr", attr: "href" },
      title: { selector: "", type: "text" }
    });
    var seen = {};
    var chapters = [];
    for (var i = 0; i < items.length; i++) {
      var url = makeAbsolute(items[i].href || "");
      if (!url || seen[url]) continue;
      seen[url] = true;
      var number = chapterNumber(url);
      chapters.push({
        number: number,
        title: String(items[i].title || "").trim() || "الفصل " + number,
        views: 0,
        url: url,
        isLocked: false,
        date: ""
      });
    }
    chapters.sort(function (a, b) { return (parseFloat(b.number) || 0) - (parseFloat(a.number) || 0); });
    return chapters;
  }

  async function extractImages(html) {
    var entries = [];
    var seen = {};
    function add(raw, index) {
      var url = sanitizeImageUrl(raw || "");
      if (!url || seen[url]) return;
      if (url.indexOf("/featured/") !== -1 || url.indexOf("logo") !== -1 || url.indexOf("avatar") !== -1 || url.indexOf("icon") !== -1) return;
      seen[url] = true;
      entries.push({ url: url, index: typeof index === "number" ? index : 999999 });
    }

    var normalized = html.replace(/\\\//g, "/");
    var tagRegex = /<img[^>]+data-reader-page-image[^>]*>/gi;
    var attrRegex = /(src|data-src|data-lazy-src|data-reader-index)\s*=\s*["']([^"']+)["']/gi;
    var tagMatch;
    while ((tagMatch = tagRegex.exec(normalized)) !== null) {
      var tag = tagMatch[0];
      var attrs = {};
      var attrMatch;
      while ((attrMatch = attrRegex.exec(tag)) !== null) {
        attrs[attrMatch[1]] = attrMatch[2];
      }
      var index = parseInt(attrs["data-reader-index"] || "", 10);
      add(attrs.src || attrs["data-src"] || attrs["data-lazy-src"] || "", isNaN(index) ? 999999 : index);
      add(attrs["data-src"] || "", isNaN(index) ? 999999 : index);
      add(attrs["data-lazy-src"] || "", isNaN(index) ? 999999 : index);
    }

    if (!entries.length) {
      var images = await api.cssAll(html, ".comic-images-wrapper img[data-reader-page-image], img[data-reader-page-image]");
      for (var i = 0; i < images.length; i++) {
        var attrs = images[i].attrs || {};
        var index = parseInt(attrs["data-reader-index"] || "", 10);
        add(attrs.src || attrs["data-src"] || attrs["data-lazy-src"] || "", isNaN(index) ? 999999 : index);
        add(attrs["data-src"] || "", isNaN(index) ? 999999 : index);
        add(attrs["data-lazy-src"] || "", isNaN(index) ? 999999 : index);
      }
    }

    var re = /https?:\/\/storage\.azora(?:fly|moon)\.com\/[^\s"'<>\\]+\.(?:jpg|jpeg|png|webp)/gi;
    var m;
    while ((m = re.exec(normalized)) !== null) add(m[0], 999999);

    entries.sort(function (a, b) {
      if (a.index !== b.index) return a.index - b.index;
      function page(u) {
        var pm = u.match(/page-(\d+)/i) || u.split("/").pop().match(/^(\d+)/) || u.match(/(\d+)\.(?:jpg|jpeg|png|webp)$/i);
        return pm ? parseInt(pm[1], 10) : 999999;
      }
      return page(a.url) - page(b.url);
    });
    return entries.map(function (entry) { return entry.url; });
  }

  return {
    requiresCloudflare: false,

    async getHomepageManga(args) {
      try {
        var page = (args && args.page) || 1;
        var posts = await queryPosts({ page: page, perPage: 20 });
        return posts.map(toManga).filter(function (x) { return !!x; });
      } catch (e) {
        return [];
      }
    },

    async search(args) {
      try {
        var query = (args && args.query) || "";
        var page = (args && args.page) || 1;
        if (!query.trim()) return [];
        var posts = await queryPosts({ searchTerm: query, page: page, perPage: 20 });
        return posts.map(toManga).filter(function (x) { return !!x; });
      } catch (e) {
        return [];
      }
    },

    async getFilteredManga(args) {
      try {
        var params = { page: (args && args.page) || 1, perPage: 20 };
        if (args && args.type) params.seriesType = args.type;
        if (args && args.genre) params.genres = args.genre;
        var posts = await queryPosts(params);
        return posts.map(toManga).filter(function (x) { return !!x; });
      } catch (e) {
        return [];
      }
    },

    async getMangaDetails(args) {
      var url = makeAbsolute((args && args.url) || "");
      var slug = extractSlug(url);
      var html = await getHtml(url);
      var post = null;
      try { post = await findPostBySlug(slug); } catch (e) {}
      var postId = (post && post.id) || extractPostId(html);

      var title = (post && post.postTitle) || await api.cssAttr(html, "meta[property='og:title']", "content") || "بدون عنوان";
      var cover = sanitizeImageUrl((post && post.featuredImage) || await api.cssAttr(html, "meta[property='og:image']", "content") || "");
      var description = stripHtml((post && post.postContent) || await api.cssAttr(html, "meta[name='description']", "content") || "");
      var genres = [];
      if (post && Array.isArray(post.genres)) {
        genres = post.genres.map(function (g) { return String((g && g.name) || "").trim(); }).filter(function (g) { return !!g; });
      }

      var chapters = [];
      try {
        chapters = await fetchChapters(postId, slug);
      } catch (e) {}
      if (!chapters.length) {
        try {
          chapters = await fallbackChaptersFromHtml(html);
        } catch (e) {}
      }

      return {
        title: String(title).trim(),
        coverUrl: cover,
        description: description,
        genres: genres,
        chapters: chapters,
        originalUrl: url,
        hasMoreChapters: false,
        lastFetchedPage: 1,
        contentType: post && post.isNovel ? "novel" : "manga"
      };
    },

    async getChapterPages(args) {
      var chapterUrl = makeAbsolute((args && args.url) || "");
      lastChapterUrl = chapterUrl;
      return await extractImages(await getHtml(chapterUrl));
    },

    async getChapterContent(args) {
      return { kind: "image", imageUrls: await this.getChapterPages(args) };
    },

    async fetchMoreChapters() {
      return null;
    },

    async getGenresAndTypes() {
      return { genres: [], types: ["MANHWA", "MANHUA", "MANGA", "NOVEL"] };
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
      return sanitizeImageUrl((args && args.url) || "");
    }
  };
}
