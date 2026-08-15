function createSource(api, config) {
  var baseUrl = ((config && config.base_url) || "https://mangadar.com").replace(/\/+$/, "");
  var userAgent =
    (config && config.user_agent) ||
    "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
  var lastChapterUrl = baseUrl + "/";
  var headers = {
    "User-Agent": userAgent,
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "ar,en-US;q=0.9,en;q=0.8",
    Referer: baseUrl + "/",
    Origin: baseUrl,
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "same-origin",
    "Upgrade-Insecure-Requests": "1"
  };

  function abs(url) {
    if (!url) return "";
    url = String(url).replace(/&/g, "&").trim();
    if (url.indexOf("//") === 0) return "https:" + url;
    if (url.indexOf("http://") === 0) return "https://" + url.substring(7);
    if (url.indexOf("https://") === 0) return url;
    if (url.charAt(0) === "/") return baseUrl + url;
    return baseUrl + "/" + url;
  }

  async function html(url) {
    if (api.http) {
      var res = await api.http(url, { method: "GET", headers: headers });
      if (!res || !res.ok) throw new Error("HTTP " + (res ? res.status : 0) + " for " + url);
      return res.body || "";
    }
    return (await api.fetchText(url, headers)) || "";
  }

  function validImage(src) {
    src = abs(src);
    var l = src.toLowerCase();
    if (!src || l.indexOf("data:") === 0 || l.indexOf(".svg") !== -1) return "";
    if (l.indexOf(".gif") !== -1 && l.indexOf("icon") !== -1) return "";
    return src;
  }

  function decodeEntities(s) {
    return String(s || "")
      .replace(/&/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, " ");
  }

  // ────────────────── Listing / Homepage ──────────────────

  var seriesRe = /^(?:https:\/\/mangadar\.com)?\/manga\/([a-z0-9-]+)\/$/i;

  async function listCards(pageHtml) {
    var out = [];
    var seen = {};

    var nodes = await api.cssAll(pageHtml, "a");
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i] || {};
      var href = (node.attrs && node.attrs.href) || "";
      var sm = href.match(seriesRe);
      if (!sm || sm[1] === "feed" || sm[1] === "page") continue;
      var detailUrl = abs(href);
      if (seen[detailUrl]) continue;
      seen[detailUrl] = true;

      var h = node.html || "";
      var title =
        (await api.cssText(h, "h3")) ||
        (await api.cssAttr(h, "img", "alt")) ||
        (sm && sm[1]) || "";
      title = decodeEntities(title).replace(/\s+/g, " ").trim();

      var cover =
        (await api.cssAttr(h, "img", "src")) ||
        (await api.cssAttr(h, "img", "data-src")) ||
        "";
      cover = validImage(cover);

      out.push({
        title: title,
        coverUrl: cover,
        detailUrl: detailUrl,
        originalUrl: detailUrl,
        contentType: "manga",
        lastEpisode: "",
        status: "",
        views: 0
      });
    }
    return out;
  }

  // ────────────────── Public API ──────────────────

  return {
    requiresCloudflare: true,

    async getHomepageManga(args) {
      var page = (args && args.page) || 1;
      var urls =
        page === 1
          ? [baseUrl + "/manga/"]
          : [baseUrl + "/manga/page/" + page + "/"];
      for (var i = 0; i < urls.length; i++) {
        try {
          var pageHtml = await html(urls[i]);
          var items = await listCards(pageHtml);
          if (items.length) return items;
        } catch (e) {
          continue;
        }
      }
      return [];
    },

    async search(args) {
      var q = (args && args.query) || "";
      if (!q.trim()) return [];
      var url =
        baseUrl + "/wp-admin/admin-ajax.php?action=mangaverse_search&q=" + encodeURIComponent(q);
      try {
        var body = await html(url);
        var data = JSON.parse(body);
        var arr = (data && data.data) || [];
        var out = [];
        for (var i = 0; i < arr.length; i++) {
          var it = arr[i] || {};
          if (!it.title) continue;
          out.push({
            title: decodeEntities(it.title).trim(),
            coverUrl: validImage(it.cover || ""),
            detailUrl: abs(it.url),
            originalUrl: abs(it.url),
            contentType: "manga",
            lastEpisode: it.last_ch ? String(it.last_ch) : "",
            status: it.status || "",
            views: 0
          });
        }
        return out;
      } catch (e) {
        return [];
      }
    },

    async getFilteredManga(args) {
      return await this.getHomepageManga(args);
    },

    async getMangaDetails(args) {
      var url = abs((args && args.url) || "");
      var pageHtml = await html(url);

      var title =
        (await api.cssText(pageHtml, "h1")) ||
        (await api.cssAttr(pageHtml, "meta[property='og:title']", "content")) ||
        "";
      title = decodeEntities(title).replace(/\s+/g, " ").trim();

      var cover =
        (await api.cssAttr(pageHtml, "meta[property='og:image']", "content")) ||
        (await api.cssAttr(pageHtml, "img", "src")) ||
        "";
      cover = validImage(cover);

      // Description: the "ملخص القصة" panel holds the synopsis in a div with
      // x-ref="synContent".
      var description = "";
      var divs = await api.cssAll(pageHtml, "div");
      for (var i = 0; i < divs.length; i++) {
        var dv = divs[i] || {};
        var attrs = dv.attrs || {};
        if (attrs["x-ref"] === "synContent" || attrs["x_ref"] === "synContent") {
          var inner = dv.html || "";
          description = decodeEntities(inner)
            .replace(/<br\s*\/?\s*>/gi, "\n")
            .replace(/<\/p>/gi, "\n\n")
            .replace(/<[^>]*>/g, "")
            .replace(/\s+/g, " ")
            .trim();
          break;
        }
      }

      // Chapters: the page embeds the full chapter list as Alpine x-data:
      // rows: [[id, number, url, timestamp, sortNum], ...]
      var chapters = [];
      var rowRe = /\[(\d+),"([^"]*)","([^"]*?)",(\d+),([\d.-]+)\]/g;
      var m;
      while ((m = rowRe.exec(pageHtml)) !== null) {
        var number = m[2];
        var chUrl = abs(m[3]);
        var ts = parseInt(m[4], 10);
        chapters.push({
          number: number,
          title: "الفصل " + number,
          url: chUrl,
          views: 0,
          isLocked: false,
          date: ts > 0 ? new Date(ts * 1000).toISOString() : ""
        });
      }

      return {
        title: title || "بدون عنوان",
        coverUrl: cover,
        description: description,
        genres: [],
        chapters: chapters,
        originalUrl: url,
        hasMoreChapters: false,
        lastFetchedPage: 1,
        contentType: "manga"
      };
    },

    async getChapterPages(args) {
      var url = abs((args && args.url) || "");
      lastChapterUrl = url;

      var pageHtml = await html(url);

      // Chapter pages are served as a JSON array in a script tag:
      // <script type="application/json" id="mv-pages-123">["https://storage.../001.webp", ...]</script>
      var m = pageHtml.match(/<script[^>]*type=["']application\/json["'][^>]*id=["']mv-pages-[^"']*["'][^>]*>([\s\S]*?)<\/script>/i);
      var urls = [];
      if (m && m[1]) {
        try {
          var arr = JSON.parse(m[1].trim());
          for (var i = 0; i < arr.length; i++) {
            var src = validImage(arr[i]);
            if (src && urls.indexOf(src) === -1) urls.push(src);
          }
        } catch (e) {}
      }

      if (urls.length) return urls;

      // Fallback: any large image in the reader body
      var imgs = await api.cssAll(pageHtml, "img");
      for (var j = 0; j < imgs.length; j++) {
        var a = imgs[j].attrs || {};
        var s = validImage(a.src || a["data-src"] || a["data-lazy-src"] || "");
        if (s && s.indexOf("/wp-content/") === -1 && urls.indexOf(s) === -1) urls.push(s);
      }
      return urls;
    },

    async getChapterContent(args) {
      var urls = await this.getChapterPages(args);
      return { kind: "image", imageUrls: urls };
    },

    async fetchMoreChapters() { return null; },

    async getGenresAndTypes() { return { genres: [], types: ["manga", "manhwa", "manhua"] }; },

    getImageHeaders(args) {
      return {
        "User-Agent": userAgent,
        Referer: lastChapterUrl || baseUrl + "/",
        Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "Accept-Language": "ar,en-US;q=0.9,en;q=0.8",
        "Sec-Fetch-Dest": "image",
        "Sec-Fetch-Mode": "no-cors",
        "Sec-Fetch-Site": "cross-site"
      };
    },

    sanitizeCoverUrl(args) {
      return validImage((args && args.url) || "") || ((args && args.url) || "");
    }
  };
}

if (typeof module !== "undefined") module.exports = { createSource: createSource };