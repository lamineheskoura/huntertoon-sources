function createSource(api, config) {
  var baseUrl = ((config && config.base_url) || "https://kolnovel.com").replace(/\/+$/, "");
  var apiBase = baseUrl + "/wp-json/app/v2";
  var userAgent = (config && config.user_agent) || "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
  var headers = {
    "User-Agent": userAgent,
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "ar,en-US;q=0.9,en;q=0.8",
    "Referer": baseUrl + "/"
  };
  var htmlHeaders = {
    "User-Agent": userAgent,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "ar,en-US;q=0.9,en;q=0.8",
    "Referer": baseUrl + "/",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "same-origin",
    "Upgrade-Insecure-Requests": "1"
  };
  var PAGE_SIZE = 40;
  var FILTER_SCAN_PAGES = 5;
  var GENRES = ["أكشن", "إثارة", "انتقام", "ايسيكاي", "الخيال العلمي", "بطل شرير", "بناء مملكة", "تدريب", "تقمص شخصيات", "تناسخ", "جريمة", "جوسي", "حروب", "حريم", "حياة مدرسية", "خارق للطبيعة", "خيال", "دراما", "دموي", "رعب", "رومانسي", "سحر", "سوداوي", "سياسة", "سينن", "شريحة من الحياة", "شونين", "شيانشيا", "ظواهر خارقة للطبيعة", "عسكري", "غموض", "فان فيكشن", "فانتازيا", "فنون القتال", "فنون قتال", "قوى خارقة", "كوميدي", "كوميديا", "مأساوي", "مؤامرة", "ما بعد الكارثة", "مضاد البطل", "مغامرة", "مكر و خداع", "ناضج", "نظام", "نفسي"];

  function abs(url) {
    if (!url) return "";
    url = String(url).replace(/&amp;/g, "&").trim();
    if (!url || url.indexOf("data:image") === 0) return "";
    if (url.indexOf("//") === 0) return "https:" + url;
    if (url.indexOf("http://") === 0) return "https://" + url.substring(7);
    if (url.indexOf("https://") === 0) return url;
    if (url.charAt(0) === "/") return baseUrl + url;
    return baseUrl + "/" + url;
  }

  async function fetchText(url, hdrs) {
    if (api.http) {
      var res = await api.http(url, { method: "GET", headers: hdrs || htmlHeaders });
      if (!res || !res.ok) throw new Error("HTTP " + (res ? res.status : 0) + " for " + url);
      return res.body || "";
    }
    return (await api.fetchText(url, hdrs || htmlHeaders)) || "";
  }

  async function getJson(url) {
    var text = await fetchText(url, headers);
    return JSON.parse(text || "{}");
  }

  function stripHtml(value) {
    return String(value || "")
      .replace(/<br\s*\/?\s*>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<\/div>/gi, "\n")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, "\"")
      .replace(/&#39;/g, "'")
      .replace(/[\u200B-\u200D\u2060-\u2064\uFEFF\u00AD\u2063]/g, "")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function slugFromUrl(url) {
    var m = String(url || "").match(/\/series\/([^\/?#]+)/);
    return m ? m[1] : "";
  }

  function toNovel(item) {
    item = item || {};
    var title = String(item.title || "").trim();
    if (!title) return null;
    var slug = String(item.slug || "").trim();
    if (!slug) return null;
    return {
      title: title,
      coverUrl: abs(item.cover_url || ""),
      detailUrl: baseUrl + "/series/" + slug + "/",
      contentType: "novel"
    };
  }

  async function listDiscoverRaw(params, page) {
    var url = apiBase + "/discover";
    var qs = [];
    if (params) {
      for (var k in params) {
        if (params[k] !== null && params[k] !== undefined && params[k] !== "") {
          qs.push(encodeURIComponent(k) + "=" + encodeURIComponent(String(params[k])));
        }
      }
    }
    if (page && page > 1) qs.push("cursor=" + ((page - 1) * PAGE_SIZE));
    if (qs.length) url += "?" + qs.join("&");
    var json = await getJson(url);
    return (json && json.data) || [];
  }

  async function listDiscover(params, page) {
    var items = await listDiscoverRaw(params, page);
    var out = [];
    for (var i = 0; i < items.length; i++) {
      var n = toNovel(items[i]);
      if (n) out.push(n);
    }
    return out;
  }

  function seriesIdFromHtml(pageHtml) {
    var m = String(pageHtml || "").match(/chapterAjaxView\((\d+)/);
    return m ? m[1] : "";
  }

  function genreNamesOf(detail) {
    var out = [];
    var gs = (detail && detail.genres) || [];
    for (var i = 0; i < gs.length; i++) {
      var g = gs[i] || {};
      var name = String(g.name || "").trim();
      if (name) out.push(name);
    }
    return out;
  }

  async function parseChaptersFromHtml(pageHtml) {
    var items = await api.cssAll(pageHtml, ".eplister li[data-id]");
    var out = [];
    var seen = {};
    var lastNum = 0;
    for (var i = 0; i < items.length; i++) {
      var it = items[i] || {};
      var attrs = it.attrs || {};
      var cid = String(attrs["data-id"] || "").trim();
      if (!cid || seen[cid]) continue;
      var inner = it.html || "";
      var numText = stripHtml(await api.cssText(inner, ".epl-num") || "");
      var nm = numText.match(/(\d+)/);
      var num = nm ? parseInt(nm[1], 10) : 0;
      if (!num || isNaN(num)) {
        if (lastNum > 1) num = lastNum - 1;
        else continue;
      }
      lastNum = num;
      seen[cid] = true;
      var title = stripHtml(await api.cssText(inner, ".epl-title") || "");
      if (!title) title = "الفصل " + num;
      var date = stripHtml(await api.cssText(inner, ".epl-date") || "");
      out.push({
        number: num,
        title: title,
        views: 0,
        url: apiBase + "/reader/" + cid,
        isLocked: false,
        date: date
      });
    }
    out.sort(function (a, b) { return b.number - a.number; });
    return out;
  }

  return {
    requiresCloudflare: false,

    async getHomepageManga(args) {
      var page = (args && args.page) || 1;
      if (page < 1) page = 1;
      try {
        return await listDiscover(null, page);
      } catch (e) {
        return [];
      }
    },

    async search(args) {
      var q = ((args && args.query) || "").trim();
      if (!q) return [];
      var page = (args && args.page) || 1;
      if (page < 1) page = 1;
      try {
        return await listDiscover({ search: q }, page);
      } catch (e) {
        return [];
      }
    },

    async getFilteredManga(args) {
      var genre = ((args && args.genre) || "").trim();
      var page = (args && args.page) || 1;
      if (page < 1) page = 1;
      if (!genre) {
        try {
          return await listDiscover(null, page);
        } catch (e) {
          return [];
        }
      }
      try {
        var collected = [];
        var seen = {};
        var p = 1;
        while (collected.length < 30 && p <= FILTER_SCAN_PAGES) {
          var items = await listDiscoverRaw(null, p);
          if (!items.length) break;
          for (var i = 0; i < items.length; i++) {
            var gs = (items[i] && items[i].genres) || [];
            var keep = false;
            for (var g = 0; g < gs.length; g++) {
              var gname = String((gs[g] && gs[g].name) || "").trim();
              if (gname && gname === genre) { keep = true; break; }
            }
            if (!keep) continue;
            var card = toNovel(items[i]);
            if (card && !seen[card.detailUrl]) {
              seen[card.detailUrl] = true;
              collected.push(card);
              if (collected.length >= 30) break;
            }
          }
          p++;
        }
        var start = (page - 1) * 30;
        return collected.slice(start, start + 30);
      } catch (e) {
        return [];
      }
    },

    async getMangaDetails(args) {
      var url = abs((args && args.url) || "");
      var slug = slugFromUrl(url);
      if (!slug) throw new Error("bad novel url");
      var pageHtml = await fetchText(url);
      var sid = seriesIdFromHtml(pageHtml);
      var title = stripHtml(await api.cssText(pageHtml, "h1.entry-title") || "");
      if (!title) title = stripHtml(await api.cssText(pageHtml, "h1") || "");
      var cover = abs(await api.cssAttr(pageHtml, ".bsx img", "src") ||
        await api.cssAttr(pageHtml, "meta[property='og:image']", "content") || "");
      var descriptions = [];
      try {
        var blocks = await api.cssListHtml(pageHtml, ".sersys.entry-content");
        for (var bi = 0; bi < blocks.length; bi++) {
          var bt = stripHtml(blocks[bi] || "");
          if (bt && bt.length > 50) descriptions.push(bt);
        }
      } catch (e) {}
      var htmlDesc = "";
      for (var di = 0; di < descriptions.length; di++) {
        if (descriptions[di].length > htmlDesc.length) htmlDesc = descriptions[di];
      }
      var description = htmlDesc;
      if (!description) {
        description = stripHtml(await api.cssAttr(pageHtml, "meta[property='og:description']", "content") || "");
      }
      var genres = [];
      var detail = null;
      if (sid) {
        try {
          detail = await getJson(apiBase + "/titles/" + sid);
          genres = genreNamesOf(detail && detail.data);
          var dt = stripHtml(String((detail.data && detail.data.title) || ""));
          if (dt && !title) title = dt;
          var dc = abs((detail.data && detail.data.cover_url) || "");
          if (dc && !cover) cover = dc;
          var dd = stripHtml(String((detail.data && detail.data.description) || ""));
          if (dd && dd.length > description.length) description = dd;
        } catch (e) {}
      }
      if (!title) title = slug;
      var chapters = await parseChaptersFromHtml(pageHtml);
      var total = chapters.length;
      if (detail && detail.data && detail.data.chapter_count) {
        var tc = parseInt(detail.data.chapter_count, 10);
        if (!isNaN(tc) && tc > total) total = tc;
      }
      return {
        title: title,
        coverUrl: cover,
        description: description,
        genres: genres,
        chapters: chapters,
        originalUrl: url,
        hasMoreChapters: total > chapters.length,
        lastFetchedPage: chapters.length,
        contentType: "novel"
      };
    },

    async fetchMoreChapters(args) {
      return null;
    },

    async getChapterPages(args) {
      return [];
    },

    async getChapterContent(args) {
      var url = abs((args && args.url) || "");
      var m = String(url).match(/\/reader\/(\d+)/);
      if (!m || !m[1]) return { kind: "text", chapterTitle: "", textContent: "" };
      try {
        var json = await getJson(apiBase + "/reader/" + m[1]);
        var entry = (json && json.data && json.data.entry) || {};
        var chapterTitle = stripHtml(entry.title || "");
        var textContent = stripHtml(entry.content || "");
        return { kind: "text", chapterTitle: chapterTitle, textContent: textContent };
      } catch (e) {
        return { kind: "text", chapterTitle: "", textContent: "" };
      }
    },

    async getGenresAndTypes() {
      return { genres: GENRES, types: ["novel"] };
    },

    getImageHeaders(args) {
      return {
        "User-Agent": userAgent,
        "Referer": baseUrl + "/",
        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "Accept-Language": "ar,en-US;q=0.9,en;q=0.8"
      };
    },

    sanitizeCoverUrl(args) {
      return abs((args && args.url) || "");
    }
  };
}

if (typeof module !== "undefined") module.exports = { createSource: createSource };
