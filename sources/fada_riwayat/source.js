function createSource(api, config) {
  var baseUrl = ((config && config.base_url) || "https://cenele.com").replace(/\/+$/, "");
  var userAgent = (config && config.user_agent) || "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
  var lastChapterUrl = baseUrl + "/";
  var headers = { "User-Agent": userAgent, "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8", "Accept-Language": "ar,en-US;q=0.9,en;q=0.8", "Referer": baseUrl + "/" };

  function abs(url) { if (!url) return ""; url = String(url).replace(/&amp;/g, "&").trim(); if (url.indexOf("//") === 0) return "https:" + url; if (url.indexOf("http://") === 0) return "https://" + url.substring(7); if (url.indexOf("https://") === 0) return url; if (url.charAt(0) === "/") return baseUrl + url; return baseUrl + "/" + url; }
  async function html(url) { if (api.http) { var res = await api.http(url, { method: "GET", headers: headers }); if (!res || !res.ok) throw new Error("HTTP " + (res ? res.status : 0)); return res.body || ""; } return await api.fetchText(url, headers) || ""; }
  function strip(s) { return String(s || "").replace(/<br\s*\/?\s*>/gi, "\n").replace(/<\/p>/gi, "\n\n").replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/[\u200B-\u200F\u202A-\u202E]/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim(); }
  function cleanNovelHtml(raw) { return String(raw || "").replace(/<[^>]+style=["'][^"']*(?:display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0)[^"']*["'][^>]*>[\s\S]*?<\/[^>]+>/gi, "").replace(/<[^>]+class=["'][^"']*(?:orw-|watermark|ads?|donat|pdf|vip|protected|hidden)[^"']*["'][^>]*>[\s\S]*?<\/[^>]+>/gi, "").replace(/(?:تابعونا|لا تنسوا|حقوق|المصدر|نسخ|تطبيق|pdf|donat|vip)[^\n]{0,160}/gi, ""); }
  function validImage(src) { src = abs(src); var l = src.toLowerCase(); if (!src || l.indexOf("data:") === 0 || l.indexOf(".svg") !== -1) return ""; return src; }
  function isMangaMarker(text) { text = String(text || "").toLowerCase(); return text.indexOf("manga") !== -1 || text.indexOf("مانجا") !== -1 || text.indexOf("comic") !== -1; }

  async function listCards(pageHtml) {
    var nodes = await api.cssAll(pageHtml, ".page-item-detail, .c-tabs-item__content, .listupd .bs, .bsx, article");
    var out = [], seen = {};
    for (var i = 0; i < nodes.length; i++) {
      var h = nodes[i].html || "";
      var href = await api.cssAttr(h, "a", "href") || (nodes[i].attrs && nodes[i].attrs.href) || "";
      var detail = abs(href);
      if (!detail || seen[detail]) continue;
      seen[detail] = true;
      var title = await api.cssText(h, ".post-title h3 a, h3, h4, .tt, a") || await api.cssAttr(h, "img", "alt") || nodes[i].text || "";
      var cover = await api.cssAttr(h, "img", "data-src") || await api.cssAttr(h, "img", "src") || "";
      out.push({ title: strip(title), coverUrl: validImage(cover), detailUrl: detail, contentType: isMangaMarker(h) ? "manga" : "novel" });
    }
    return out;
  }

  async function parseChapters(pageHtml) {
    var nodes = await api.cssAll(pageHtml, ".wp-manga-chapter, li.wp-manga-chapter, .chapter-item, #chapterlist li, .eplister li, a[href*='chapter']");
    var out = [], seen = {};
    for (var i = 0; i < nodes.length; i++) {
      var h = nodes[i].html || "";
      var href = await api.cssAttr(h, "a", "href") || (nodes[i].attrs && nodes[i].attrs.href) || "";
      var url = abs(href);
      if (!url || seen[url]) continue;
      seen[url] = true;
      var text = await api.cssText(h, "a, .chapternum, .epx") || nodes[i].text || "";
      var m = (url + " " + text).match(/(?:chapter|ch|فصل|الفصل)[\s_.-]*(\d+(?:\.\d+)?)/i) || (url + " " + text).match(/(\d+(?:\.\d+)?)/);
      out.push({ number: m ? m[1] : String(out.length + 1), title: strip(text), views: 0, url: url, isLocked: /locked|vip|premium|fa-lock/.test(h), date: strip(await api.cssText(h, ".chapter-release-date, .chapterdate, .date") || "") });
    }
    out.sort(function (a, b) { return (parseFloat(b.number) || 0) - (parseFloat(a.number) || 0); });
    return out;
  }

  return {
    requiresCloudflare: false,
    async getHomepageManga(args) { var page = (args && args.page) || 1; try { var url = page === 1 ? baseUrl + "/cont/" : baseUrl + "/cont/page/" + page + "/"; return await listCards(await html(url)); } catch (e) { try { return await listCards(await html(baseUrl + "/")); } catch (_) { return []; } } },
    async search(args) { var q = (args && args.query) || ""; if (!q.trim()) return []; try { return await listCards(await html(baseUrl + "/?s=" + encodeURIComponent(q) + "&post_type=wp-manga")); } catch (e) { return []; } },
    async getFilteredManga(args) { return await this.getHomepageManga(args); },
    async getMangaDetails(args) { var url = abs((args && args.url) || ""); var page = await html(url); var title = await api.cssText(page, ".post-title h1, h1, .entry-title") || await api.cssAttr(page, "meta[property='og:title']", "content") || "بدون عنوان"; var cover = await api.cssAttr(page, ".summary_image img, .thumb img", "data-src") || await api.cssAttr(page, ".summary_image img, .thumb img", "src") || await api.cssAttr(page, "meta[property='og:image']", "content") || ""; var description = await api.cssText(page, ".description-summary .summary__content, .description-summary, .entry-content") || ""; var genres = await api.cssList(page, ".genres-content a, .mgen a, .genres a"); return { title: strip(title), coverUrl: validImage(cover), description: strip(description), genres: genres.map(strip).filter(Boolean), chapters: await parseChapters(page), originalUrl: url, hasMoreChapters: false, lastFetchedPage: 1, contentType: isMangaMarker(page) ? "manga" : "novel" }; },
    async getChapterPages(args) { var content = await this.getChapterContent(args); return content.kind === "image" ? content.imageUrls : []; },
    async getChapterContent(args) { 
        var url = abs((args && args.url) || ""); 
        lastChapterUrl = url; 
        var page = await html(url); 
        var body = (await api.cssHtml(page, ".reading-content.current .text-left")) || 
                   (await api.cssHtml(page, ".text-left")) || 
                   (await api.cssHtml(page, ".reading-content")) || 
                   (await api.cssHtml(page, ".entry-content")) || 
                   (await api.cssHtml(page, ".chapter-content")) || 
                   (await api.cssHtml(page, ".content")) || ""; 
        if (!isMangaMarker(page) || strip(body).length > 300) 
            return { 
                kind: "text", 
                chapterTitle: strip(await api.cssText(page, "h1") || await api.cssText(page, ".entry-title") || ""), 
                textContent: cleanNovelHtml(body) || strip(page) 
            }; 
        var imgs = await api.cssAll(page, ".reading-content img, #readerarea img, .page-break img, img"); 
        var urls = []; 
        for (var i = 0; i < imgs.length; i++) { 
            var a = imgs[i].attrs || {}; 
            var src = validImage(a["data-src"] || a["data-lazy-src"] || a.src || ""); 
            if (src && urls.indexOf(src) === -1) urls.push(src); 
        } 
        return { kind: "image", imageUrls: urls }; 
    },
    async fetchMoreChapters() { return null; },
    async getGenresAndTypes() { return { genres: [], types: ["novel", "manga"] }; },
    getImageHeaders() { return { "User-Agent": userAgent, "Referer": lastChapterUrl || baseUrl + "/", "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8" }; },
    sanitizeCoverUrl(args) { return validImage((args && args.url) || "") || ((args && args.url) || ""); }
  };
}

if (typeof module !== "undefined") module.exports = { createSource: createSource };
