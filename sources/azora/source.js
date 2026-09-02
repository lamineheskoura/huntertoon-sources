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

  function isNovelPost(post) {
    return !!(post && (post.isNovel === true || String(post.seriesType || "").toUpperCase() === "NOVEL"));
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
      contentType: isNovelPost(post) ? "novel" : "manga"
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
    if (!slug) return null;
    try {
      var data = await getJson(apiBase + "/api/post?postSlug=" + encodeURIComponent(slug));
      if (data && data.post) return data.post;
    } catch (e) {}
    try {
      var search = String(slug).replace(/-/g, " ").trim();
      var posts = await queryPosts({ searchTerm: search, perPage: 10, page: 1 });
      for (var i = 0; i < posts.length; i++) {
        if (String(posts[i].slug || "") === slug) return posts[i];
      }
      return posts.length ? posts[0] : null;
    } catch (e2) {
      return null;
    }
  }

  function extractSlug(url) {
    var value = String(url || "");
    var m = value.match(/\/(?:series|manga)\/([^\/?#]+)/);
    if (m) return m[1];
    value = value.replace(/[?#].*$/, "").replace(/\/+$/, "");
    var parts = value.split("/");
    return parts.length ? parts[parts.length - 1] : "";
  }

  function extractChapterSlug(url) {
    var m = String(url || "").match(/\/chapter-([^\/?#]+)/);
    return m ? "chapter-" + m[1] : "";
  }

  function pagesFromChapter(chapter) {
    var imgs = Array.isArray(chapter.images) ? chapter.images.slice().sort(function (a, b) { return (a.order || 0) - (b.order || 0); }) : [];
    return imgs.map(function (p) { return sanitizeImageUrl(p.url); }).filter(function (u) { return !!u; });
  }

  function htmlToText(html) {
    var text = String(html || "");
    text = text.replace(/<br\s*\/?>/gi, "\n");
    text = text.replace(/<\/p>/gi, "\n");
    text = text.replace(/<[^>]*>/g, "");
    text = text.replace(/&nbsp;/gi, " ")
      .replace(/&quot;/g, "\"")
      .replace(/&#39;|&rsquo;/g, "'")
      .replace(/&ldquo;|&rdquo;/g, "\"")
      .replace(/&hellip;/g, "…")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");
    return text.replace(/\n{3,}/g, "\n\n").trim();
  }

  async function getChapterData(chapterUrl) {
    var slug = extractSlug(chapterUrl);
    var chapterSlug = extractChapterSlug(chapterUrl);
    if (!slug || !chapterSlug) return null;
    var data = await getJson(apiBase + "/api/chapter" + buildQuery({ mangaslug: slug, chapterslug: chapterSlug }));
    return data && data.chapter;
  }

  async function getChapterPagesFromApi(chapterUrl) {
    var chapter = await getChapterData(chapterUrl);
    if (!chapter) return null;
    if (chapter.isLocked === true || !Array.isArray(chapter.images) || chapter.images.length === 0) {
      var err = new Error("Chapter is locked");
      err.isLocked = true;
      throw err;
    }
    return pagesFromChapter(chapter);
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
      var post = await findPostBySlug(slug);
      var postId = (post && post.id) || 0;

      var title = (post && (post.postTitle || post.title)) || "";
      var cover = sanitizeImageUrl((post && post.featuredImage) || "");
      var description = stripHtml((post && (post.postContent || post.content)) || "");
      var genres = [];
      if (post && Array.isArray(post.genres)) {
        genres = post.genres.map(function (g) { return String((g && (g.name || g.title)) || "").trim(); }).filter(function (g) { return !!g; });
      }

      var chapters = [];
      if (postId) {
        try {
          chapters = await fetchChapters(postId, slug);
        } catch (e) {}
      }

      // If API post was not found, fallback to HTML if available
      if (!postId) {
        try {
          var html = await getHtml(url);
          if (html) {
            postId = extractPostId(html);
            if (!title) title = await api.cssAttr(html, "meta[property='og:title']", "content") || "بدون عنوان";
            if (!cover) cover = sanitizeImageUrl(await api.cssAttr(html, "meta[property='og:image']", "content") || "");
            if (!description) description = stripHtml(await api.cssAttr(html, "meta[name='description']", "content") || "");
            if (postId) {
              try { chapters = await fetchChapters(postId, slug); } catch (e2) {}
            }
            if (!chapters.length) {
              chapters = await fallbackChaptersFromHtml(html);
            }
          }
        } catch (e3) {}
      }

      return {
        title: String(title || "بدون عنوان").trim(),
        coverUrl: cover,
        description: description,
        genres: genres,
        chapters: chapters,
        originalUrl: url,
        hasMoreChapters: false,
        lastFetchedPage: 1,
        contentType: isNovelPost(post) ? "novel" : "manga"
      };
    },

    async getChapterPages(args) {
      var chapterUrl = makeAbsolute((args && args.url) || "");
      lastChapterUrl = chapterUrl;
      try {
        var pages = await getChapterPagesFromApi(chapterUrl);
        if (pages && pages.length) return pages;
      } catch (e) {}
      return [];
    },

    async getChapterContent(args) {
      var chapterUrl = makeAbsolute((args && args.url) || "");
      lastChapterUrl = chapterUrl;
      var chapter = null;
      try {
        chapter = await getChapterData(chapterUrl);
      } catch (e) {}
      if (!chapter || chapter.isLocked === true) {
        return { kind: "text", chapterTitle: "", textContent: "" };
      }
      var isNovel = !!((chapter.mangaPost && chapter.mangaPost.isNovel) || (chapter.content && !(Array.isArray(chapter.images) && chapter.images.length)));
      if (isNovel) {
        var number = String(chapter.number || "");
        return {
          kind: "text",
          chapterTitle: String(chapter.title || "") || (number ? "الفصل " + number : ""),
          textContent: htmlToText(chapter.content || "")
        };
      }
      return { kind: "image", imageUrls: pagesFromChapter(chapter) };
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
