function createSource(api, config) {
  var baseUrl = ((config && config.base_url) || "https://www.realmnovel.com").replace(/\/+$/, "");
  var userAgent = (config && config.user_agent) || "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
  var lastChapterUrl = baseUrl + "/";

  var defaultHeaders = {
    "User-Agent": userAgent,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "ar,en-US;q=0.9,en;q=0.8",
    "Referer": baseUrl + "/"
  };

  async function fetchHtml(url) {
    var headers = {};
    for (var k in defaultHeaders) headers[k] = defaultHeaders[k];
    if (api.http) {
      try {
        var res = await api.http(url, { method: "GET", headers: headers });
        if (res && res.ok && res.body && res.body.length > 200) return res.body;
      } catch (eHttp) {}
    }
    if (typeof api.browser === "function") {
      try {
        var rendered = await api.browser(url, {
          waitForSelector: ".g3card, .chapter-content",
          timeoutSeconds: 8
        });
        if (rendered && rendered.length > 500) return rendered;
      } catch (eBrowser) {}
    }
    try {
      var html = await api.fetchText(url, headers);
      if (html && html.length > 100) return html;
    } catch (eFetch) {}
    return "";
  }

  function makeAbsolute(url) {
    if (!url) return "";
    url = String(url).trim();
    if (url.indexOf("http://") === 0) return "https:" + url.substring(5);
    if (url.indexOf("https://") === 0) return url;
    if (url.indexOf("//") === 0) return "https:" + url;
    if (url.indexOf("/") === 0) return baseUrl + url;
    return baseUrl + "/" + url;
  }

  function cleanTitle(t) {
    return String(t || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  }

  function strip(s) {
    return String(s || "")
      .replace(/<br\s*\/?\s*>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, "\"")
      .replace(/&#39;/g, "'")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function novelIdFromUrl(url) {
    var m = String(url || "").match(/\/novel\/([0-9a-f]+)/i);
    return m ? m[1] : "";
  }

  // Cards: a.g3card[href=/novel/{id}] > .g3cover img + .g3body (.g3title/.g3sub/.g3cat)
  // + button.favbtn[data-title, data-titleen] as fallback title source.
  function parseCards(html) {
    if (!html) return [];
    var results = [];
    var seen = {};
    var cardRe = /<a[^>]*class="[^"]*g3card[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    var m;
    while ((m = cardRe.exec(html)) !== null) {
      var href = (m[1] || "").trim();
      var block = m[2] || "";
      var detailUrl = makeAbsolute(href);
      if (!detailUrl || seen[detailUrl] || detailUrl.indexOf("/novel/") === -1) continue;
      seen[detailUrl] = true;

      var title = "";
      var tm = block.match(/<div[^>]*class="[^"]*g3title[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
      if (tm) title = cleanTitle(tm[1]);
      var sub = "";
      var sm = block.match(/<div[^>]*class="[^"]*g3sub[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
      if (sm) sub = cleanTitle(sm[1]);
      if (!title) {
        var fm = block.match(/data-title="([^"]*)"/i);
        if (fm) title = cleanTitle(fm[1]);
      }
      if (!title && sub) title = sub;
      if (!title) continue;

      var cover = "";
      var im = block.match(/<img[^>]+src="([^"]+)"/i);
      if (im) cover = makeAbsolute(im[1].trim());
      if (!cover) {
        var nid = novelIdFromUrl(detailUrl);
        if (nid) cover = baseUrl + "/img/novel/" + nid + ".jpg";
      }
      if (cover.indexOf("data:image") === 0) cover = "";

      results.push({
        title: title,
        detailUrl: detailUrl,
        coverUrl: cover,
        contentType: "novel"
      });
    }
    return results;
  }

  function parseChapters(html, novelId) {
    if (!html) return [];
    var chapters = [];
    var seen = {};
    var re = /<a[^>]*href="(\/novel\/[0-9a-f]+\/chapter\/(\d+))[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
    var m;
    while ((m = re.exec(html)) !== null) {
      var num = m[2];
      var raw = cleanTitle(m[3]);
      var chUrl = baseUrl + m[1];
      if (!num || seen[chUrl]) continue;
      seen[chUrl] = true;
      var locked = /🔒|locked|paywall|fa-lock|مقفل/i.test(m[0] + " " + raw);
      var title = raw.replace(/اقرأ/gi, "").replace(/🔒/g, "").replace(/\s+/g, " ").trim();
      if (!title) title = "الفصل " + num;
      chapters.push({
        number: num,
        title: title,
        views: 0,
        url: chUrl,
        isLocked: locked,
        date: ""
      });
    }
    chapters.sort(function (a, b) {
      return (parseFloat(b.number) || 0) - (parseFloat(a.number) || 0);
    });
    return chapters;
  }

  return {
    requiresCloudflare: false,

    async getHomepageManga(args) {
      try {
        var page = (args && args.page) || 1;
        var url = page === 1 ? baseUrl + "/" : baseUrl + "/?page=" + page;
        return parseCards(await fetchHtml(url));
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
          : baseUrl + "/?s=" + encodeURIComponent(query) + "&page=" + page;
        return parseCards(await fetchHtml(url));
      } catch (e) {
        return [];
      }
    },

    async getFilteredManga(args) {
      // Site exposes category only as card data-cat; no genre archive found.
      // Fall back to the working latest list (same as previous versions).
      return await this.getHomepageManga(args || {});
    },

    async getGenresAndTypes() {
      return { genres: [], types: ["novel"] };
    },

    async getMangaDetails(args) {
      var url = makeAbsolute((args && args.url) || "");
      var html = await fetchHtml(url);
      var nid = novelIdFromUrl(url);

      var title = "";
      var tm = html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]+)"/i);
      if (tm) title = cleanTitle(tm[1]).split("—")[0].split("|")[0].trim();
      if (!title) {
        var h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
        if (h1) title = cleanTitle(h1[1]);
      }

      var cover = "";
      var cm = html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]+)"/i);
      if (cm) cover = makeAbsolute(cm[1]);
      if (!cover && nid) cover = baseUrl + "/img/novel/" + nid + ".jpg";

      var desc = "";
      var dm = html.match(/<meta[^>]*name="description"[^>]*content="([^"]+)"/i);
      if (dm) desc = strip(dm[1]);

      var status = "";
      var st = html.match(/مستمرة|مكتملة|متوقفة/);
      if (st) status = st[0];

      var chapters = parseChapters(html, nid);

      return {
        title: title || "بدون عنوان",
        coverUrl: cover,
        description: desc,
        genres: [],
        status: status,
        chapters: chapters,
        originalUrl: url,
        hasMoreChapters: false,
        lastFetchedPage: 1,
        contentType: "novel"
      };
    },

    async getChapterPages(args) {
      return [];
    },

    async getChapterContent(args) {
      var chapterUrl = makeAbsolute((args && args.url) || "");
      lastChapterUrl = chapterUrl || lastChapterUrl;
      var html = await fetchHtml(chapterUrl);
      var title = "";
      var tm = html.match(/<title>([\s\S]*?)<\/title>/i);
      if (tm) {
        var parts = cleanTitle(tm[1]).split("—");
        title = (parts.length > 1 ? parts[1] : parts[0]).split("|")[0].trim();
      }
      var body = "";
      var bm = html.match(/<div[^>]*class="[^"]*chapter-content[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?:<div[^>]*class="[^"]*chapter-nav|<footer|<script)/i);
      if (!bm) {
        bm = html.match(/<div[^>]*class="[^"]*chapter-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
      }
      if (bm) body = strip(bm[1]);
      return {
        kind: "text",
        chapterTitle: title,
        textContent: body
      };
    },

    async fetchMoreChapters() {
      return null;
    },

    getImageHeaders() {
      return {
        "User-Agent": userAgent,
        "Referer": lastChapterUrl || baseUrl + "/",
        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8"
      };
    },

    sanitizeCoverUrl(args) {
      return makeAbsolute((args && args.url) || "");
    }
  };
}

if (typeof module !== "undefined") module.exports = { createSource: createSource };
