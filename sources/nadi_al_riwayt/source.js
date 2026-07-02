function createSource(api, config) {
  var baseUrl = ((config && config.base_url) || "https://rewayat.club").replace(/\/+$/, "");
  var apiCoverBase = "https://api.rewayat.club";
  var userAgent = (config && config.user_agent) || "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
  var headers = { "User-Agent": userAgent, "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "Accept-Language": "ar,en-US;q=0.9,en;q=0.8", "Referer": baseUrl + "/" };

  function abs(url) { if (!url) return ""; url = String(url).replace(/&amp;/g, "&").trim(); if (url.indexOf("//") === 0) return "https:" + url; if (url.indexOf("http://") === 0) return "https://" + url.substring(7); if (url.indexOf("https://") === 0) return url; if (url.charAt(0) === "/") return baseUrl + url; return baseUrl + "/" + url; }
  async function html(url) { if (api.http) { var res = await api.http(url, { method: "GET", headers: headers }); if (!res || !res.ok) throw new Error("HTTP " + (res ? res.status : 0)); return res.body || ""; } return await api.fetchText(url, headers) || ""; }
  function strip(s) { return String(s || "").replace(/<br\s*\/?\s*>/gi, "\n").replace(/<\/p>/gi, "\n\n").replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/\s+\n/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim(); }
  function cleanText(raw) { return strip(String(raw || "").replace(/<[^>]+class=["'][^"']*(?:comment|hidden|protected|dialog|ads?)[^"']*["'][^>]*>[\s\S]*?<\/[^>]+>/gi, "").replace(/(?:اقرأ على المصدر|حمل التطبيق|التعليقات|إبلاغ|حقوق)[^\n]{0,140}/gi, "")); }
  function slugFromUrl(url) { var m = String(url || "").match(/\/novel\/([^\/?#]+)/); if (m) return m[1]; return String(url || "").replace(/[?#].*$/, "").replace(/\/+$/, "").split("/").pop(); }

  function extractCoverFromPayload(pageHtml, slug) {
    var text = pageHtml.replace(/\\\//g, "/");
    var idx = text.indexOf(slug);
    var chunk = idx >= 0 ? text.substring(Math.max(0, idx - 4000), Math.min(text.length, idx + 8000)) : text;
    var m = chunk.match(/"poster_url"\s*:\s*"([^"]+)"/) || chunk.match(/poster_url['"]?\s*[:=]\s*['"]([^'"]+)/);
    if (!m) return "";
    var url = m[1];
    if (url.indexOf("http") === 0) return url;
    return apiCoverBase + (url.charAt(0) === "/" ? url : "/" + url);
  }

  async function listCards(pageHtml) {
    var nodes = await api.cssAll(pageHtml, "a[href*='/novel/'], .v-card, .book-card, .novel-card");
    var out = [], seen = {};
    for (var i = 0; i < nodes.length; i++) {
      var h = nodes[i].html || "";
      var href = await api.cssAttr(h, "a[href*='/novel/']", "href") || (nodes[i].attrs && nodes[i].attrs.href) || "";
      var detail = abs(href);
      if (!detail || detail.indexOf("/novel/") === -1 || seen[detail]) continue;
      seen[detail] = true;
      var slug = slugFromUrl(detail);
      var title = await api.cssText(h, ".v-card-title, h3, h2, .title, a") || nodes[i].text || slug;
      var cover = await api.cssAttr(h, "img", "src") || await api.cssAttr(h, "img", "data-src") || extractCoverFromPayload(pageHtml, slug);
      out.push({ title: strip(title), coverUrl: abs(cover), detailUrl: detail, contentType: "novel" });
    }
    return out;
  }

  async function fetchChapterPage(slug, page) {
    var pageHtml = await html(baseUrl + "/novel/" + slug + "?page=" + page);
    var links = await api.cssAll(pageHtml, "a[href*='?chapter='], a[href*='chapter'], .chapter-item a");
    var out = [];
    for (var i = 0; i < links.length; i++) {
      var href = (links[i].attrs && links[i].attrs.href) || await api.cssAttr(links[i].html || "", "a", "href") || "";
      var url = abs(href);
      var text = strip(links[i].text || "");
      var m = (url + " " + text).match(/(?:chapter|ch|فصل|الفصل|page=)(\d+(?:\.\d+)?)/i) || (url + " " + text).match(/(\d+(?:\.\d+)?)/);
      if (url) out.push({ number: m ? m[1] : String(out.length + 1), title: text || "الفصل " + (out.length + 1), views: 0, url: url, isLocked: false, date: "" });
    }
    return out;
  }

  return {
    requiresCloudflare: false,
    async getHomepageManga(args) { var page = (args && args.page) || 1; try { return await listCards(await html(baseUrl + "/library" + (page > 1 ? "?page=" + page : ""))); } catch (e) { return []; } },
    async search(args) { var q = (args && args.query) || ""; if (!q.trim()) return []; try { return await listCards(await html(baseUrl + "/library?search=" + encodeURIComponent(q))); } catch (e) { return []; } },
    async getFilteredManga(args) { return await this.getHomepageManga(args); },
    async getMangaDetails(args) { var url = abs((args && args.url) || ""); var slug = slugFromUrl(url); var pageHtml = await html(url); var title = await api.cssText(pageHtml, "h1, .v-card-title, .novel-title") || await api.cssAttr(pageHtml, "meta[property='og:title']", "content") || slug; var cover = await api.cssAttr(pageHtml, "meta[property='og:image']", "content") || await api.cssAttr(pageHtml, "img", "src") || extractCoverFromPayload(pageHtml, slug); var description = await api.cssText(pageHtml, ".description, .summary, .v-card-text, .novel-description") || ""; var chapters = await fetchChapterPage(slug, 1); return { title: strip(title), coverUrl: abs(cover), description: strip(description), genres: [], chapters: chapters, originalUrl: url, hasMoreChapters: true, lastFetchedPage: 1, contentType: "novel" }; },
    async fetchMoreChapters(args) { var url = abs((args && args.url) || ""); var nextPage = (args && args.nextPage) || 2; var slug = slugFromUrl(url); var chapters = await fetchChapterPage(slug, nextPage); return { title: "", coverUrl: "", description: "", genres: [], chapters: chapters, originalUrl: url, hasMoreChapters: chapters.length > 0, lastFetchedPage: nextPage, contentType: "novel" }; },
    async getChapterPages() { return []; },
    async getChapterContent(args) { var url = abs((args && args.url) || ""); var pageHtml = await html(url); var body = await api.cssHtml(pageHtml, ".v-card__text, .chapter-content, .content, article") || pageHtml; return { kind: "text", chapterTitle: strip(await api.cssText(pageHtml, "h1, .chapter-title") || ""), textContent: cleanText(body) }; },
    async getGenresAndTypes() { return { genres: [], types: ["novel"] }; },
    getImageHeaders(args) { var url = args && args.url || ""; var referer = url.indexOf("api.reway") !== -1 ? baseUrl + "/" : baseUrl + "/"; return { "User-Agent": userAgent, "Referer": referer, "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8", "Cache-Control": "no-cache" }; },
    sanitizeCoverUrl(args) { return abs((args && args.url) || ""); }
  };
}

if (typeof module !== "undefined") module.exports = { createSource: createSource };
