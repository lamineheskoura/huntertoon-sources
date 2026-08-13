// HunterToon JS source for novelsparadise.site (جنة الروايات)
// Self-contained Arabic novel source for the WordPress/ts_reader theme.
// Note: chapter pages are protected by Cloudflare managed challenge - the app's
// CF-bypass flow provides the cookies needed.
function createSource(api, config) {
  var baseUrl = ((config && config.base_url) || "https://novelsparadise.site").replace(/\/+$/, "");
  var cfgHeaders = (config && config.headers) || {};
  var userAgent =
    cfgHeaders["User-Agent"] ||
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

  var defaultHeaders = {
    "User-Agent": userAgent,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "ar,en;q=0.9",
    "Referer": baseUrl + "/",
    "Origin": baseUrl,
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "same-origin",
    "Upgrade-Insecure-Requests": "1"
  };

  function mergeHeaders(a, b) {
    var out = {};
    if (a) for (var k in a) out[k] = a[k];
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

  function clean(s) { return String(s || "").replace(/\s+/g, " ").trim(); }

  function abs(url) {
    if (!url) return "";
    url = String(url).trim();
    if (url.indexOf("https://") === 0 || url.indexOf("http://") === 0) return url;
    if (url.indexOf("//") === 0) return "https:" + url;
    if (url.charAt(0) === "/") return baseUrl + url;
    return baseUrl + "/" + url;
  }

  function htmlEscape(s) {
    return String(s || "")
      .replace(/&#0*34;/g, "\x22")
      .replace(/&#0*39;/g, "\x27")
      .replace(/&#0*60;/g, "\x3C")
      .replace(/&#0*62;/g, "\x3E")
      .replace(/&#0*38;/g, "\x26")
      .replace(/&quot;/g, "\x22")
      .replace(/&apos;/g, "\x27")
      .replace(/&lt;/g, "\x3C")
      .replace(/&gt;/g, "\x3E")
      .replace(/&amp;/g, "\x26");
  }

  // Extract series slug from detail URL (/series/<slug>/)
  function seriesSlugFromUrl(url) {
    var m = String(url || "").match(/\/series\/([^\/?#]+)/);
    return m ? decodeURIComponent(m[1]) : "";
  }

  // Build a card from a WordPress series item extracted via regex.
  function buildCard(item) {
    if (!item || !item.url || !item.title) return null;
    var detailUrl = abs(item.url);
    var slug = seriesSlugFromUrl(detailUrl);
    if (!slug) return null;
    return {
      title: item.title,
      coverUrl: abs(item.cover || ""),
      detailUrl: detailUrl,
      contentType: "novel",
      status: clean(item.status || ""),
      rating: item.rating || "",
      slug: slug
    };
  }

  function dedupeCards(arr) {
    var seen = {};
    var out = [];
    for (var i = 0; i < arr.length; i++) {
      var c = buildCard(arr[i]);
      if (!c || seen[c.detailUrl]) continue;
      seen[c.detailUrl] = true;
      out.push(c);
    }
    return out;
  }

  // Parse series cards from homepage or search HTML using regex.
  // Homepage cards (.listupd .utao .uta): <a href=".../series/<slug>/" title="...">
  //   ...<img src="cover" alt="...">  and second anchor with <h3>Title</h3>.
  // Search cards (article.maindet): .mdthumb a > img, .mdinfo h2 a text.
  var SERIES_HREF_RE = /(?:https?:\/\/[^"\/?#]+\/)?\/series\/([^"\/?#]+)\//;
  function seriesHrefMatch(href) {
    var m = SERIES_HREF_RE.exec(String(href || ""));
    return m ? { slug: decodeURIComponent(m[1]), url: abs(m[0].replace(/\/$/, "")) + "/" } : null;
  }

  function decodeEntities(t) {
    if (!t) return "";
    return String(t)
      .replace(/&#(?:x([0-9a-f]+)|([0-9]+));/gi, function (all, h, d) {
        return String.fromCharCode(h ? parseInt(h, 16) : parseInt(d, 10));
      })
      .replace(/&quot;/g, "\x22")
      .replace(/&apos;/g, "\x27")
      .replace(/&lt;/g, "\x3C")
      .replace(/&gt;/g, "\x3E")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "\x26");
  }

  function parseCardsFromHtml(html) {
    var out = [];
    var seen = {};

    // Pass 1: homepage grid cards - <a href=".../series/<slug>/"> contain <img>.
    // The img must be inside the SAME anchor (guard against "list-mode" toggles).
    var reImg = /<a\s[^>]*href="([^"]*\/series\/[^"\/?#]+\/)"[^>]*>(?:(?!<\/a>).){0,5000}?<img\b[^>]*?(?:src|data-src)="([^"]+)"[^>]*?(?:alt|title)="([^"]*)"/g;
    var m;
    while ((m = reImg.exec(html)) !== null) {
      var sm = seriesHrefMatch(m[1]);
      if (!sm || seen[sm.url]) continue;
      var t = decodeEntities(clean(m[3]));
      if (!t) continue;
      seen[sm.url] = true;
      out.push({ url: sm.url, cover: m[2], title: t });
    }

    // Pass 2: anchor with <h3>child (homepage luf block)
    var reH3 = /<a\s[^>]*href="([^"]*\/series\/[^"\/?#]+\/)"[^>]*>\s*<h3>([^<]+)<\/h3>/g;
    while ((m = reH3.exec(html)) !== null) {
      var sm2 = seriesHrefMatch(m[1]);
      if (!sm2 || seen[sm2.url]) continue;
      var t2 = decodeEntities(clean(m[2]));
      if (!t2) continue;
      seen[sm2.url] = true;
      out.push({ url: sm2.url, cover: "", title: t2 });
    }

    // Pass 3: search/browse list cards - article.maindet with .mdthumb a > img
    // and .mdinfo h2 a text (used by /search/ and /series/?order=update).
    var reCard = /<article\s[^>]*class="[^"]*\bmaindet\b[^"]*"[\s\S]*?<\/article>/g;
    while ((m = reCard.exec(html)) !== null) {
      var block = m[0];
      var h2m = block.match(/<h2[^>]*>\s*<a\s[^>]*href="([^"]*\/series\/[^"\/?#]+\/)"[^>]*>([^<]+)<\/a>/i);
      if (!h2m) continue;
      var sm3 = seriesHrefMatch(h2m[1]);
      if (!sm3 || seen[sm3.url]) continue;
      var t3 = decodeEntities(clean(h2m[2]));
      if (!t3) continue;
      var imgm = block.match(/<img\b[^>]*?(?:src|data-src)="([^"]+)"/i);
      seen[sm3.url] = true;
      out.push({ url: sm3.url, cover: imgm ? imgm[1] : "", title: t3 });
    }

    return out;
  }

  // Fetch homepage cards (series list page - browse side triggers CF bypass)
  async function getHomepageCards(page) {
    // Use "/series" WITHOUT the trailing slash and without "?order=update":
    // that exact URL returns the Cloudflare 403 challenge, which triggers the
    // app's CF-bypass flow and saves the cookies needed for chapter pages.
    // "/series/" returns 200 directly, so no cookies are stored and chapters fail.
    var url = baseUrl + "/series";
    if (page && page > 1) url = baseUrl + "/series/page/" + Math.floor(page) + "/";
    var html = await fetchHtml(url);
    return dedupeCards(parseCardsFromHtml(html));
  }

  // Fetch search cards (WordPress search /search/<query>/ canonical form)
  async function getSearchCards(query) {
    if (!query || !query.trim()) return [];
    var url = baseUrl + "/search/" + encodeURIComponent(query.trim());
    var html = await fetchHtml(url);
    return dedupeCards(parseCardsFromHtml(html));
  }

  // Parse novel detail (series page)
  async function getNovelDetail(detailUrl) {
    var html = await fetchHtml(detailUrl);
    var slug = seriesSlugFromUrl(detailUrl);

    // Title
    var title = clean(await api.cssText(html, "h1.entry-title") || "");
    if (!title) title = clean(await api.cssAttr(html, "meta[property='og:title']", "content") || "");
    title = title.replace(/\s*[|-]\s*(جنة\s*الروايات|novelsparadise).*$/i, "").trim();

    // Cover
    var cover = await api.cssAttr(html, "meta[property='og:image']", "content") || "";
    if (!cover) {
      try {
        var imgs = await api.cssAll(html, ".sertocont img, .sertoinfo img");
        if (imgs && imgs.length) cover = imgs[0].attrs && imgs[0].attrs.src || "";
      } catch (e) {}
    }

    // Description: prefer the descriptive paragraphs inside .sersys.entry-content
    var desc = "";
    try {
      var pS = await api.cssAll(html, ".sersys.entry-content > p");
      var pTxt = [];
      for (var pi = 0; pi < pS.length; pi++) {
        var tp = clean(pS[pi].text || "");
        if (tp) pTxt.push(tp);
      }
      desc = pTxt.join("\n");
    } catch (e) {}
    if (!desc) desc = clean(await api.cssText(html, ".sersys.entry-content") || "");
    if (!desc) desc = clean(await api.cssAttr(html, "meta[property='og:description']", "content") || "");

    // Status
    var status = clean(await api.cssText(html, ".sertostat .Ongoing, .sertostat .Completed") || "");
    if (!status) {
      var ogType = clean(await api.cssAttr(html, "meta[property='og:type']", "content") || "");
      if (/book|article/i.test(ogType)) status = "";
    }

    // Author
    var author = clean(await api.cssText(html, ".serl .serval a[href*='/writer/']") || "");

    // Genres
    var genres = [];
    try {
      var ga = await api.cssAll(html, ".sertogenre a, a[href*='/genre/']");
      for (var gi = 0; gi < ga.length; gi++) {
        var g = clean(ga[gi].text || "");
        if (g && genres.indexOf(g) === -1) genres.push(g);
      }
    } catch (e) {}

    // Chapters: build URLs from chapter links inside the page.
    // Pattern: /<slug>-<N>/ at root.
    var chapters = parseChapters(html, slug);

    return {
      title: title || slug || "Unknown",
      coverUrl: abs(cover || ""),
      description: desc,
      genres: genres,
      status: status,
      author: author,
      chapters: chapters,
      originalUrl: detailUrl,
      hasMoreChapters: false,
      lastFetchedPage: 1,
      contentType: "novel",
      slug: slug
    };
  }

  // Parse chapter links from a series page HTML.
  // Pattern: <a href="https://novelsparadise.site/<slug>-<N>/">Title</a>
  function parseChapters(html, slug) {
    if (!slug) return [];
    var out = [];
    var seen = {};
    var escSlug = slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    var re = new RegExp('href="((?:https?:)?\\/[^"\/?#]*?' + escSlug + '-(\\d+)\\/)"', 'g');
    var m;
    while ((m = re.exec(html)) !== null) {
      var url = abs(m[1]);
      var num = parseInt(m[2], 10);
      if (!num || seen[num]) continue;
      seen[num] = true;
      out.push({
        number: String(num),
        title: "الفصل " + num,
        url: url,
        chapterId: String(num),
        date: "",
        views: 0,
        isLocked: false
      });
    }
    // If regex pattern misses (e.g. percent-encoded slug), try a broader scan
    if (!out.length) {
      var re2 = /href="((?:https?:)?\/\/novelsparadise\.site\/[^"\/?#]*-(\d+)\/)"/g;
      while ((m = re2.exec(html)) !== null) {
        var url2 = abs(m[1]);
        var num2 = parseInt(m[2], 10);
        if (!num2 || seen[num2]) continue;
        seen[num2] = true;
        out.push({
          number: String(num2),
          title: "الفصل " + num2,
          url: url2,
          chapterId: String(num2),
          date: "",
          views: 0,
          isLocked: false
        });
      }
    }
    // Sort desc by number
    out.sort(function (a, b) { return (parseInt(b.number, 10) || 0) - (parseInt(a.number, 10) || 0); });
    return out;
  }

  // Extract chapter text from HTML using common ts_reader / WP novel selectors.
  async function fetchChapterText(chapterUrl) {
    if (!chapterUrl) return { kind: "text", chapterTitle: "", textContent: "" };
    var html = await fetchHtml(chapterUrl);

    // Chapter title: try entry-title, then og:title.
    var chapterTitle = clean(await api.cssText(html, "h1.entry-title, .chapter-title") || "");
    if (!chapterTitle) chapterTitle = clean(await api.cssAttr(html, "meta[property='og:title']", "content") || "");
    chapterTitle = chapterTitle.replace(/\s*[|-]\s*(جنة\s*الروايات|novelsparadise).*$/i, "").trim();

    // Try selectors in priority order.
    var selectors = [
      ".reading-content .text-left",
      ".reading-content",
      ".chapter-content",
      "#chapter-text",
      ".entry-content[itemprop='articleBody']",
      ".epcontent",
      "article .entry-content",
      ".text-left",
      "#content .entry-content",
      ".post-content",
      "article"
    ];
    var raw = "";
    for (var i = 0; i < selectors.length && !raw; i++) {
      try {
        var nodes = await api.cssAll(html, selectors[i]);
        for (var j = 0; j < nodes.length; j++) {
          raw += (nodes[j].html || nodes[j].text || "") + "\n";
        }
      } catch (e) {}
    }

    var text = cleanText(raw);
    return { kind: "text", chapterTitle: chapterTitle, textContent: text };
  }

  function cleanText(html) {
    if (!html) return "";
    var s = String(html);
    // Strip script/style blocks
    s = s.replace(/<script[\s\S]*?<\/script>/gi, "");
    s = s.replace(/<style[\s\S]*?<\/style>/gi, "");
    s = s.replace(/<noscript[\s\S]*?<\/noscript>/gi, "");
    // Convert paragraph/line breaks
    s = s.replace(/<br\s*\/?>/gi, "\n");
    s = s.replace(/<\/p>/gi, "\n\n");
    s = s.replace(/<\/div>/gi, "\n");
    s = s.replace(/<[^>]+>/g, " ");
    // Decode common HTML entities (kept simple to avoid string-literal ambiguity)
    s = s.replace(/&nbsp;/g, " ");
    s = s.replace(/&/g, String.fromCharCode(38));
    s = s.replace(/"/g, String.fromCharCode(34));
    s = s.replace(/'/g, String.fromCharCode(39));
    s = s.replace(/</g, String.fromCharCode(60));
    s = s.replace(/>/g, String.fromCharCode(62));
    // Drop zero-width and formatters
    s = s.replace(/[\u200B-\u200D\u2060-\u2064\uFEFF\u00AD\u2063]/g, "");
    // Collapse whitespace per line, but preserve paragraph breaks
    s = s.replace(/[ \t]+/g, " ");
    s = s.replace(/ *\n[ \t]*/g, "\n");
    s = s.replace(/\n{3,}/g, "\n\n");
    return s.trim();
  }

  return {
    requiresCloudflare: true,

    async getHomepageManga(args) {
      try {
        var page = (args && args.page) || 1;
        return await getHomepageCards(page);
      } catch (e) { return []; }
    },

    async search(args) {
      try {
        var q = (args && args.query) || "";
        if (!q.trim()) return [];
        return await getSearchCards(q);
      } catch (e) { return []; }
    },

    async getMangaDetails(args) {
      try {
        var url = abs((args && args.url) || "");
        return await getNovelDetail(url);
      } catch (e) {
        return {
          title: "Error", coverUrl: "", description: "", genres: [], status: "",
          author: "", chapters: [], originalUrl: (args && args.url) || "",
          hasMoreChapters: false, lastFetchedPage: 0, contentType: "novel"
        };
      }
    },

    async fetchMoreChapters() { return null; },

    async getChapterPages() { return []; },

    async getChapterContent(args) {
      try {
        var url = abs((args && args.url) || "");
        return await fetchChapterText(url);
      } catch (e) {
        return { kind: "text", chapterTitle: "", textContent: "" };
      }
    },

    async getGenresAndTypes() {
      return { genres: [], types: ["novel"] };
    },

    getImageHeaders() {
      return {
        "User-Agent": userAgent,
        "Referer": baseUrl + "/",
        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "Accept-Language": "ar,en;q=0.9",
        "Sec-Fetch-Dest": "image",
        "Sec-Fetch-Mode": "no-cors",
        "Sec-Fetch-Site": "same-origin"
      };
    },

    sanitizeCoverUrl(args) { return abs((args && args.url) || ""); }
  };
}

if (typeof module !== "undefined") module.exports = { createSource: createSource };
