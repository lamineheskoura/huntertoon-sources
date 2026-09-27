function createSource(api, config) {
  var baseUrl = ((config && config.base_url) || "https://cenele.com").replace(/\/+$/, "");
  var userAgent =
    (config && config.user_agent) ||
    "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
  var lastChapterUrl = baseUrl + "/";

  // Verified-live genre slugs (/cont-genre/{slug}/). Other slugs seen on
  // detail pages (e.g. اكشن, فنون-قتاليه) 302 to homepage — the title guard
  // in getFilteredManga rejects those instead of returning homepage cards.
  var defaultGenres = ["مغامرة", "خيال", "xianxia", "مكتملة"];
  var defaultTypes = ["novel", "manga"];
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

  async function postHtml(url) {
    if (api.http) {
      var res = await api.http(url, { method: "POST", headers: headers, body: null });
      if (!res || !res.ok) throw new Error("HTTP " + (res ? res.status : 0) + " for " + url);
      return res.body || "";
    }
    return (await api.fetchText(url, headers)) || "";
  }

  // ────────────────── Full chapter list via nhv AJAX (verified live) ──
  // Detail pages embed only the latest 8 chapters; the full list loads in
  // two POST steps to admin-ajax.php:
  //  1. {action:nhv_novel_v2_section, nonce, post_id, section:chapters}
  //     (tools shell; not strictly needed)
  //  2. {action:nhv_manga_single_chapters_page, nonce:chaptersNonce,
  //     manga_id:postId, volume:-1, page:1, per_page:50, meta_only:1}
  //     → {volumes:[{num,count}]}; then per volume {same-volume, page,
  //     per_page:50} → {html, has_more}. Config comes from the inline
  //  `var nhvNovelV2 = {...}` JSON on the detail page.
  function nhvConfig(pageHtml) {
    var m = String(pageHtml || "").match(/var\s+nhvNovelV2\s*=\s*(\{[\s\S]*?\});/);
    var cfg = {};
    if (m) {
      try { cfg = JSON.parse(m[1]); } catch (e) { cfg = {}; }
    }
    if (!cfg.postId) {
      var pm = String(pageHtml || "").match(/data-(?:manga-id|post)="(\d+)"/);
      if (pm) cfg.postId = pm[1];
    }
    return cfg;
  }

  async function postAjax(params, referer) {
    var body = [];
    for (var k in params) body.push(encodeURIComponent(k) + "=" + encodeURIComponent(params[k]));
    var h = {
      "User-Agent": userAgent,
      "Accept": "application/json, text/plain, */*",
      "Accept-Language": "ar,en-US;q=0.9,en;q=0.8",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
      "Referer": referer || baseUrl + "/",
      "Origin": baseUrl
    };
    if (api.http) {
      var res = await api.http(baseUrl + "/wp-admin/admin-ajax.php", { method: "POST", headers: h, body: body.join("&") });
      if (!res || !res.ok) throw new Error("HTTP " + (res ? res.status : 0) + " for chapters ajax");
      try { return JSON.parse(res.body || "{}"); } catch (e) { throw new Error("Bad chapters JSON"); }
    }
    throw new Error("POST unsupported by runtime");
  }

  async function fetchChaptersFull(detailUrl, pageHtml) {
    var cfg = nhvConfig(pageHtml);
    var postId = cfg.postId || "";
    var nonce = cfg.chaptersNonce || cfg.nonce || "";
    if (!postId || !nonce) return [];
    var meta = await postAjax({ action: "nhv_manga_single_chapters_page", nonce: nonce, manga_id: postId, volume: "-1", page: "1", per_page: "50", meta_only: "1", order: "desc" }, detailUrl);
    var volumes = (meta && meta.volumes) || [];
    if (!volumes.length) volumes = [{ num: 0 }];
    var out = [];
    var seen = {};
    for (var v = 0; v < volumes.length; v++) {
      var vol = (volumes[v] && volumes[v].num !== undefined) ? volumes[v].num : 0;
      var page = 1;
      for (var guard = 0; guard < 60; guard++) {
        var data = await postAjax({ action: "nhv_manga_single_chapters_page", nonce: nonce, manga_id: postId, volume: String(vol), page: String(page), per_page: "50", order: "desc" }, detailUrl);
        if (!data || !data.success) break;
        var rows = await parseChapters(data.html || "");
        var added = 0;
        for (var i = 0; i < rows.length; i++) {
          if (seen[rows[i].url]) continue;
          seen[rows[i].url] = true;
          out.push(rows[i]);
          added++;
          if (out.length > 3000) break;
        }
        if (out.length > 3000) break;
        if (!data.has_more || !added) break;
        page++;
      }
      if (out.length > 3000) break;
    }
    out.sort(function (a, b) {
      return (parseFloat(b.number) || 0) - (parseFloat(a.number) || 0);
    });
    return out;
  }

  function validImage(src) {
    src = abs(src);
    var l = src.toLowerCase();
    if (!src || l.indexOf("data:") === 0 || l.indexOf(".svg") !== -1) return "";
    if (l.indexOf(".gif") !== -1 && l.indexOf("icon") !== -1) return "";
    return src;
  }

  function isMangaMarker(text) {
    text = String(text || "").toLowerCase();
    return text.indexOf("manga") !== -1 || text.indexOf("مانجا") !== -1 || text.indexOf("comic") !== -1;
  }

  function isNovelMarker(text) {
    text = String(text || "");
    return text.indexOf("رواية") !== -1 || text.indexOf("Novel") !== -1;
  }

  function decodeEntities(s) {
    return String(s || "")
      .replace(/&/g, "&")
      .replace(/"/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, " ");
  }

  // ────────────────── Anti-scrape text cleaning ──────────────────
  // Matches the Dart FadaRiwayatSource anti-scrape defense:
  // 1. Strip CSS-hidden elements (display:none, visibility:hidden, opacity:0,
  //    position:absolute with zero size or off-screen)
  // 2. Strip orw-* class elements and data-orw* attributes
  // 3. Strip aria-hidden="true" elements
  // 4. Strip structural noise (scripts, styles, ads, VIP gates, etc.)
  // 5. For each paragraph, normalize zero-width chars FIRST, then check
  //    for watermark tail — split and keep real text
  // 6. Remove full junk paragraphs (copyright, app promotion, etc.)
  // 7. Strip hash tags from paragraph ends

  var zeroWidth = /[\u200B-\u200D\u2060-\u2064\uFEFF\u00AD\u2063]/g;

  // Arabic diacritics + tatweel used to obfuscate watermark text (تطـبيق، فضــاء)
  var diacritics = /[\u0640\u064B-\u065F\u0670\u0653-\u0655]/g;

  var stripSelectors = [
    ".orw-reader-gap",
    ".orw-ad-slot",
    ".orw-ads",
    ".orw-spoof",
    ".orw-watermark",
    ".orw-protector",
    ".orw-protect",
    ".nhv-support-box",
    ".chapter-warning",
    ".paypal-donations",
    ".paypal-donations-box",
    ".donation-box",
    ".report-chapter",
    ".nhv-report-chapter",
    ".nhv-pdf-lock",
    ".nhv-vip-overlay",
    ".nhv-vip-notice",
    ".nhv-paywall",
    ".adsbygoogle",
    "script",
    "style",
    "noscript",
    "iframe",
    "form",
    "input[type='hidden']"
  ];

  // Watermark tail markers — after zero-width normalization
  var watermarkTailMarkers = [
    /هذا\s*نص\s*تمويهي/,
    /هذا\s*نص\s*حقوق\s*الترجمة/,
    /كل\s*الفص[ـ]*ول\s*مس[ـ]*روقة/,
    /cenele\.com/,
    /اقرأ\s*من\s*المصدر/,
    /نؤكد\s*لمتابعينا\s*الكرام/,
    /تنبيه:\s*تطبيق\s*شاي\s*روايات/,
    /play\.google\.com\/store\/apps/,
    /اقرأ\s*من\s*تطبيق/,
    /تابع\s*على\s*تطبيق\s*فضاء/,
    /افضل\s*موقع\s*لقراءة\s*الروايات/,
    /متوفر\s*على\s*غوغل\s*بلاي/,
    /القس\s*المجنون\s*ولورد\s*الغوامض/
  ];

  // Full junk paragraph patterns — entire paragraph is anti-scrape
  var fullJunkPatterns = [
    /هذا\s*نص\s*حقوق\s*الترجمة\s*من\s*موقع\s*فضاء\s*الروايات/,
    /نؤكد\s*لمتابعينا\s*الكرام/,
    /تنبيه:\s*تطبيق\s*شاي\s*روايات/,
    /play\.google\.com\/store\/apps/,
    /^اقرأ\s*من\s*المصدر/,
    /شاي\s*(ال)?روايات\s*تطبيق\s*سارق/,
    /^https?:\/\//,
    /تابع\s*على\s*تطبيق\s*فضاء\s*الروايات/,
    /فضاء\s*الروايات\s*متوفر\s*على\s*غوغل/
  ];

  // Anti-scrape legacy patterns
  var antiScrapePatterns = [
    /هذا\s*نص\s*تمويهي/,
    /اقرأ\s*من\s*المصدر/,
    /شاي\s*الروايات/,
    /شاي\s*روايات/,
    /تطبيق\s*سارق/,
    /تم\s*نسخ\s*هذا\s*المحتوى/,
    /المصدر\s*مسروق/,
    /هذا\s*المحتوى\s*من\s*موقع/,
    /نسخة\s*من\s*الموقع/,
    /فضاء\s*الروايات\s*فقط/,
    /فالمصدر\s*مسروق/,
    /نزله\s*و\s*إقرأ\s*منه/,
    /تحمل\s*فصول\s*للقراءة/,
    /بدون\s*إتصال/,
    /نزل\s*تطبيقنا\s*واقرأ/,
    /المصدر\s*الأصلي\s*للمحتوى/,
    /تنقل\s*المحتوى\s*دون\s*إذن/,
    /cenele\.com/,
    /\d{3,4}\*\/\*\d{3,4}[a-z]{3}/
  ];

  var hashTagPattern = /\s*#[A-Za-z0-9]{6,12}\s*$/;

  // Poison markers for self-heal retry
  var poisonMarkers = [
    /cenele\.com/,
    /اقرأ\s*من\s*المصدر/,
    /نؤكد\s*لمتابعينا/,
    /تنبيه:\s*تطبيق\s*شاي\s*روايات/,
    /play\.google\.com\/store\/apps/,
    /هذا\s*نص\s*تمويهي/,
    /هذا\s*نص\s*حقوق/,
    /كل\s*الفص[ـ]*ول\s*مس[ـ]*روقة/,
    /شاي\s*روايات/,
    /فضاء\s*الروايات\s*فقط/,
    /تابع\s*على\s*تطبيق\s*فضاء\s*الروايات/
  ];

  function isPoisonedText(text) {
    if (!text) return false;
    var cleaned = String(text).replace(zeroWidth, "");
    for (var i = 0; i < poisonMarkers.length; i++) {
      if (poisonMarkers[i].test(cleaned)) return true;
    }
    return false;
  }

  // Strip CSS-hidden elements from raw HTML by matching inline style attributes
  function stripHiddenElements(rawHtml) {
    var s = String(rawHtml || "");
    // Match elements with style containing display:none / visibility:hidden / etc.
    // Pattern: <tag ... style="...display:none..." ...>...</tag>
    // This is a best-effort regex — won't catch every case but covers the
    // common inline watermark patterns used by cenele.com.
    var hiddenStyle =
      /<([a-z][a-z0-9]*)\b[^>]*style=["'][^"']*(?:display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0[^"']*font-size\s*:\s*0|position\s*:\s*absolute[^"']*(?:width\s*:\s*0|height\s*:\s*0|left\s*:\s*-9999|top\s*:\s*-9999|text-indent\s*:\s*-9999))[^"']*["'][^>]*>[\s\S]*?<\/\1>/gi;
    s = s.replace(hiddenStyle, "");
    // Also remove self-closing hidden elements
    var hiddenSelfClose =
      /<([a-z][a-z0-9]*)\b[^>]*style=["'][^"']*(?:display\s*:\s*none|visibility\s*:\s*hidden)[^"']*["'][^>]*\/>/gi;
    s = s.replace(hiddenSelfClose, "");
    return s;
  }

  // Strip elements by class prefix or attribute
  function stripByClassPrefix(rawHtml, prefix) {
    var s = String(rawHtml || "");
    var re = new RegExp(
      "<([a-z][a-z0-9]*)\\b[^>]*class=[\"'][^\"']*" + prefix + "[^\"']*[\"'][^>]*>[\\s\\S]*?<\\/\\1>",
      "gi"
    );
    return s.replace(re, "");
  }

  // Strip elements with aria-hidden="true"
  function stripAriaHidden(rawHtml) {
    var s = String(rawHtml || "");
    var re =
      /<([a-z][a-z0-9]*)\b[^>]*aria-hidden=["']true["'][^>]*>[\s\S]*?<\/\1>/gi;
    s = s.replace(re, "");
    return s;
  }

  // Master HTML cleaner: removes all anti-scrape elements from raw HTML
  function cleanNovelHtml(raw) {
    var s = String(raw || "");

    // 0. Strip CSS-hidden elements (inline watermarks, decoys)
    s = stripHiddenElements(s);

    // 1. Strip structural noise by tag/class
    for (var i = 0; i < stripSelectors.length; i++) {
      var sel = stripSelectors[i];
      if (sel.charAt(0) === ".") {
        // class-based
        var cls = sel.substring(1).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        s = s.replace(
          new RegExp(
            "<([a-z][a-z0-9]*)\\b[^>]*class=[\"'][^\"']*" + cls + "[^\"']*[\"'][^>]*>[\\s\\S]*?<\\/\\1>",
            "gi"
          ),
          ""
        );
      } else if (sel.indexOf("[") !== -1) {
        // attribute-based (e.g. input[type='hidden'])
        var attrMatch = sel.match(/^([a-z]+)\[([a-z]+)=['"]([^'"]+)['"]\]$/i);
        if (attrMatch) {
          var tag = attrMatch[1];
          var attr = attrMatch[2];
          var val = attrMatch[3];
          s = s.replace(
            new RegExp(
              "<" + tag + "\\b[^>]*" + attr + "=[\"']" + val + "[\"'][^>]*/?>",
              "gi"
            ),
            ""
          );
        }
      } else {
        // tag-based (script, style, iframe, etc.)
        s = s.replace(
          new RegExp("<" + sel + "\\b[^>]*>[\\s\\S]*?<\\/" + sel + ">", "gi"),
          ""
        );
      }
    }

    // 2. Strip orw-* class elements (rotating obfuscator names)
    s = stripByClassPrefix(s, "orw-");

    // 3. Strip data-orw* attribute elements
    s = s.replace(
      /<([a-z][a-z0-9]*)\b[^>]*data-orw[a-z]*=["'][^"']*["'][^>]*>[\s\S]*?<\/\1>/gi,
      ""
    );

    // 4. Strip aria-hidden="true" elements
    s = stripAriaHidden(s);

    // 5. Strip HTML comments
    s = s.replace(/<!--[\s\S]*?-->/g, "");

    return s;
  }

  // Clean the extracted text — normalize zero-width chars, remove watermark
  // tails, junk paragraphs, hash tags, and anti-scrape content.
  function cleanTextContent(raw) {
    // First, convert HTML to text
    var text = String(raw || "")
      .replace(/<br\s*\/?\s*>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<\/div>/gi, "\n")
      .replace(/<p[^>]*>/gi, "")
      .replace(/<div[^>]*>/gi, "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&quot;/g, '"')
      .replace(/&/g, "&")
      .replace(/"/g, '"')
      .replace(/&#39;/g, "'");

    // Split into paragraphs
    var lines = text.split(/\n+/);
    var out = [];

    for (var i = 0; i < lines.length; i++) {
      var raw2 = lines[i];
      // Normalize zero-width chars BEFORE any pattern matching
      var cleaned = raw2.replace(zeroWidth, "").replace(/[ \t]+/g, " ").trim();
      if (cleaned.length === 0) continue;
      // Normalize diacritics/tatweel for pattern matching (watermarks use تطبـيق، فضــاء)
      var norm = cleaned.replace(diacritics, "");

      // Check if entire paragraph is a full junk block
      var isFullJunk = false;
      for (var j = 0; j < fullJunkPatterns.length; j++) {
        if (fullJunkPatterns[j].test(norm)) {
          isFullJunk = true;
          break;
        }
      }
      if (isFullJunk) continue;

      // Try to rescue real text from watermark tail
      var rescued = null;
      for (var k = 0; k < watermarkTailMarkers.length; k++) {
        var match = watermarkTailMarkers[k].exec(norm);
        if (match && match.index > 10) {
          var candidate = cleaned.substring(0, match.index).trim();
          if (candidate.length >= 8) {
            rescued = candidate;
            break;
          }
        }
      }
      if (rescued && rescued.length > 0) {
        // Remove trailing hash tag
        rescued = rescued.replace(hashTagPattern, "").trim();
        if (rescued.length >= 8) {
          out.push(rescued);
          continue;
        }
      }

      // Check if paragraph matches anti-scrape patterns (whole thing is junk)
      var isAntiScrape = false;
      for (var m = 0; m < antiScrapePatterns.length; m++) {
        if (antiScrapePatterns[m].test(norm)) {
          isAntiScrape = true;
          break;
        }
      }
      if (isAntiScrape) continue;

      // Detect shuffled-word decoy paragraphs (very short with watermark residue)
      var cleanedNoHash = cleaned.replace(hashTagPattern, "").trim();
      if (cleanedNoHash.length < 20) {
        var hasResidue =
          norm.indexOf("cenele") !== -1 ||
          norm.indexOf("فضاء") !== -1 ||
          norm.indexOf("مسروق") !== -1 ||
          norm.indexOf("تطبيق") !== -1 ||
          norm.indexOf("موقع") !== -1 ||
          norm.indexOf("فضاء") !== -1 ||
          norm.indexOf("الفصول") !== -1 ||
          hashTagPattern.test(norm);
        if (hasResidue) continue;
      }

      // Remove hash tags from end of otherwise-clean paragraphs
      if (hashTagPattern.test(cleaned)) {
        var withoutHash = cleaned.replace(hashTagPattern, "").trim();
        if (withoutHash.length > 0) {
          out.push(withoutHash);
        }
        continue;
      }

      // Clean paragraph — keep it
      out.push(cleaned);
    }

    return out.join("\n\n").trim();
  }

  // ────────────────── Homepage / Search ──────────────────

  async function listCards(pageHtml) {
    var selectors = [
      "article.nhv-library-card",
      ".page-item-detail",
      ".nhv-pitem",
      ".c-tabs-item__content",
      ".page-listing-item .row > div"
    ];
    var coverSel = ".nhv-library-card__cover img, .item-thumb img, .nhv-pitem__cover img, .tab-thumb img, img";
    var titleSel =
      "h2.nhv-library-card__title a, .post-title h3 a, .post-title a, .nhv-pitem__title, .tab-content .post-title a, h3 a, h4 a";
    var urlSel =
      "a.nhv-library-card__cover, .post-title a, .item-thumb a, .nhv-pitem, .tab-content .post-title a, h3 a, h4 a";

    var out = [];
    var seen = {};

    for (var s = 0; s < selectors.length; s++) {
      var nodes = await api.cssAll(pageHtml, selectors[s]);
      if (!nodes.length) continue;

      for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i] || {};
        var h = node.html || "";

        var title = "";
        var ariaTitle = await api.cssAttr(h, "a.nhv-library-card__cover", "aria-label");
        if (ariaTitle && ariaTitle.trim()) {
          title = ariaTitle.trim();
        } else {
          var titleSelectors = titleSel.split(",").map(function (e) { return e.trim(); });
          for (var t = 0; t < titleSelectors.length; t++) {
            var tText = await api.cssText(h, titleSelectors[t]);
            if (tText && tText.trim()) {
              title = tText.trim();
              break;
            }
          }
        }
        if (!title) continue;

        var href = "";
        var urlSelectors = urlSel.split(",").map(function (e) { return e.trim(); });
        for (var u = 0; u < urlSelectors.length; u++) {
          href = await api.cssAttr(h, urlSelectors[u], "href");
          if (href) break;
        }
        if (!href) continue;

        var detailUrl = abs(href);
        if (!detailUrl || seen[detailUrl]) continue;
        seen[detailUrl] = true;

        var cover = await api.cssAttr(h, coverSel, "src") || await api.cssAttr(h, coverSel, "data-src") || await api.cssAttr(h, coverSel, "data-lazy-src") || "";

        var cardText = node.text || "";
        var contentType = "novel";
        if (isMangaMarker(cardText) && !isNovelMarker(cardText)) {
          contentType = "manga";
        }

        out.push({
          title: decodeEntities(title),
          coverUrl: abs(cover),
          detailUrl: detailUrl,
          contentType: contentType
        });
      }

      if (out.length) break;
    }

    return out;
  }

  // ────────────────── Chapter list (AJAX + page fallback) ──────────────────

  async function parseChapters(pageHtml) {
    var nodes = await api.cssAll(pageHtml, ".wp-manga-chapter, .nhv-chapters-list .nhv-chapter-item, .chapter-item, #chapterlist li, .eplister li");
    var out = [];
    var seen = {};

    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i] || {};
      var h = node.html || "";
      var href = await api.cssAttr(h, "a", "href") || (node.attrs && node.attrs.href) || "";
      var url = abs(href);
      if (!url || seen[url]) continue;
      seen[url] = true;

      var text = await api.cssText(h, "a") || node.text || "";
      var nameEl = await api.cssText(h, ".nhv-chapter-name");
      if (nameEl && text.indexOf(nameEl) === -1) {
        text = text ? text + " - " + nameEl : nameEl;
      }

      var m = text.match(/\d+(?:\.\d+)?/);
      var num = m ? m[0] : "0";
      var date = await api.cssText(h, ".chapter-release-date, .chapterdate, .date") || "";

      out.push({
        number: num,
        title: decodeEntities(text).trim(),
        url: url,
        views: 0,
        isLocked: false,
        date: decodeEntities(date).trim()
      });
    }

    out.sort(function (a, b) {
      return (parseFloat(b.number) || 0) - (parseFloat(a.number) || 0);
    });
    return out;
  }

  async function fetchChapters(detailUrl) {
    // Strategy 0 (primary): nhv full-list AJAX (detail page holds latest 8).
    try {
      var detailHtml = await html(detailUrl);
      var full = await fetchChaptersFull(detailUrl, detailHtml);
      if (full.length) return full;
    } catch (e0) {}
    // Strategy 1: AJAX endpoint (Madara standard)
    var ajaxUrl = detailUrl;
    if (ajaxUrl.charAt(ajaxUrl.length - 1) !== "/") ajaxUrl += "/";
    ajaxUrl += "ajax/chapters/";

    try {
      var ajaxHtml = await postHtml(ajaxUrl);
      if (ajaxHtml && ajaxHtml.indexOf("wp-manga-chapter") !== -1) {
        var chapters = await parseChapters(ajaxHtml);
        if (chapters.length) return chapters;
      }
    } catch (e) {
      // fall through to page parsing
    }

    // Strategy 2: parse the detail page directly
    try {
      var pageHtml = await html(detailUrl);
      return await parseChapters(pageHtml);
    } catch (e) {
      return [];
    }
  }

  // ────────────────── Novel text extraction ──────────────────

  async function extractNovelText(pageHtml) {
    // Try selectors in order — most specific first
    var selectors = [
      ".reading-content.current",
      ".reading-content",
      ".text-left",
      ".entry-content",
      ".chapter-content",
      ".content"
    ];

    var rawHtml = "";
    for (var i = 0; i < selectors.length; i++) {
      rawHtml = await api.cssHtml(pageHtml, selectors[i]);
      if (rawHtml && rawHtml.trim()) break;
    }

    if (!rawHtml) return "";

    // Keep only the main <article> block when present — this drops chapter
    // headers, donation forms, store promos and footers in one shot.
    var articleMatch = rawHtml.match(/<article\b[^>]*>[\s\S]*?<\/article>/i);
    if (articleMatch) rawHtml = articleMatch[0];

    // Clean the HTML to remove anti-scrape elements
    var cleanedHtml = cleanNovelHtml(rawHtml);

    // Convert to text and apply text-level cleaning
    var text = cleanTextContent(cleanedHtml);

    // Fallback: if too little text, try all <p> elements in the page
    if (text.length < 80) {
      var allPara = await api.cssAll(pageHtml, "p");
      var fallbackParts = [];
      for (var j = 0; j < allPara.length; j++) {
        var pText = (allPara[j].text || "").replace(zeroWidth, "").trim();
        if (!pText) continue;

        // Skip if anti-scrape
        var skip = false;
        for (var k = 0; k < antiScrapePatterns.length; k++) {
          if (antiScrapePatterns[k].test(pText)) { skip = true; break; }
        }
        if (skip) continue;
        for (var k2 = 0; k2 < fullJunkPatterns.length; k2++) {
          if (fullJunkPatterns[k2].test(pText)) { skip = true; break; }
        }
        if (skip) continue;

        // Try rescue from watermark tail
        var rescued2 = pText;
        for (var m = 0; m < watermarkTailMarkers.length; m++) {
          var match2 = watermarkTailMarkers[m].exec(pText);
          if (match2 && match2.index > 10) {
            var cand = pText.substring(0, match2.index).trim();
            if (cand.length >= 8) { rescued2 = cand; break; }
          }
        }
        rescued2 = rescued2.replace(hashTagPattern, "").trim();
        if (rescued2) fallbackParts.push(rescued2);
      }
      if (fallbackParts.length) {
        var fallbackText = fallbackParts.join("\n\n").trim();
        if (fallbackText.length > text.length) text = fallbackText;
      }
    }

    return text;
  }

  function extractChapterTitle(pageHtml) {
    // synchronous-style: use cssText on each selector
    // Can't await in a sync function, so return a promise via async
    return (async function () {
      var selectors = [".chapter-name", "h1.chapter-title", "#chapter-heading", "meta[property='og:title']"];
      for (var i = 0; i < selectors.length; i++) {
        var t = await api.cssText(pageHtml, selectors[i]);
        if (t && t.trim()) return t.trim();
        if (selectors[i].indexOf("meta[") !== -1) {
          var c = await api.cssAttr(pageHtml, selectors[i], "content");
          if (c && c.trim()) return c.trim();
        }
      }
      return "";
    })();
  }

  function cleanTitleFallback(s) {
    return decodeEntities(String(s || "").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
  }

  // Guard: unknown genre slugs 302 to the homepage (200 with homepage
  // cards). A valid genre archive titles itself "{genre} - ...".
  function isGenrePage(pageHtml, genre) {
    var m = String(pageHtml || "").match(/<title>([\s\S]*?)<\/title>/i);
    if (!m) return false;
    var title = cleanTitleFallback(m[1]);
    return title.indexOf(genre) === 0;
  }

  // ────────────────── Public API ──────────────────

  return {
    requiresCloudflare: false,

    async getHomepageManga(args) {
      var page = (args && args.page) || 1;
      var urls =
        page === 1
          ? [baseUrl + "/cont/", baseUrl + "/"]
          : [baseUrl + "/cont/page/" + page + "/", baseUrl + "/page/" + page + "/?m_orderby=latest"];

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
      var encoded = encodeURIComponent(q);
      var urls =
        (args && args.page) > 1
          ? [baseUrl + "/page/" + args.page + "/?s=" + encoded + "&post_type=wp-manga", baseUrl + "/?s=" + encoded + "&post_type=wp-manga&page=" + args.page]
          : [baseUrl + "/?s=" + encoded + "&post_type=wp-manga"];

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

    async getFilteredManga(args) {
      // Genre archives live at /cont-genre/{slug}/ (verified live slugs in
      // defaultGenres). Unknown slugs 302 to the homepage — the title guard
      // rejects those instead of returning homepage cards as filtered data.
      try {
        var page = (args && args.page) || 1;
        var genre = cleanTitleFallback((args && args.genre) || "");
        if (genre) {
          var gurl = page === 1
            ? baseUrl + "/cont-genre/" + encodeURIComponent(genre) + "/"
            : baseUrl + "/cont-genre/" + encodeURIComponent(genre) + "/page/" + page + "/";
          var ghtml = await html(gurl);
          if (!ghtml || !isGenrePage(ghtml, genre)) return [];
          return await listCards(ghtml);
        }
        return await this.getHomepageManga(args);
      } catch (e) {
        return [];
      }
    },

    async getMangaDetails(args) {
      var url = abs((args && args.url) || "");
      var pageHtml = await html(url);

      // Title
      var title =
        (await api.cssText(pageHtml, "h1.nhv-novel-title")) ||
        (await api.cssText(pageHtml, ".post-title h1")) ||
        (await api.cssAttr(pageHtml, "meta[property='og:title']", "content")) ||
        "بدون عنوان";

      // Cover
      var cover =
        (await api.cssAttr(pageHtml, ".nhv-novel-cover img", "src")) ||
        (await api.cssAttr(pageHtml, ".summary_image img", "src")) ||
        (await api.cssAttr(pageHtml, ".summary_image img", "data-src")) ||
        (await api.cssAttr(pageHtml, "meta[property='og:image']", "content")) ||
        "";

      // Description
      var description =
        (await api.cssText(pageHtml, ".nhv-novel-synopsis")) ||
        (await api.cssText(pageHtml, ".summary__content p, .description-summary p, .manga-excerpt p, .summary__content")) || "";

      // Genres (union across markup variants; empty arrays are truthy
      // so fallbacks must merge, not ||-chain)
      var genresRaw = [];
      var genreSels = [".nhv-novel-genres a", "a[href*=cont-genre]", ".genres-content a"];
      for (var gi = 0; gi < genreSels.length; gi++) {
        try {
          var gl = await api.cssList(pageHtml, genreSels[gi]);
          if (gl) for (var gj = 0; gj < gl.length; gj++) genresRaw.push(gl[gj]);
        } catch (eG) {}
      }
      var genresClean = [];
      for (var gk = 0; gk < genresRaw.length; gk++) {
        var gv = decodeEntities(genresRaw[gk]).trim();
        if (gv && genresClean.indexOf(gv) === -1) genresClean.push(gv);
      }

      // Content type detection
      var kicker = (await api.cssText(pageHtml, ".nhv-novel-kicker")) || "";
      var bodyClass = await api.cssAttr(pageHtml, "body", "class") || "";
      var contentType = "novel";
      if (isMangaMarker(kicker)) {
        contentType = "manga";
      } else if (!kicker && bodyClass.indexOf("chapter-type-novel") === -1 &&
          bodyClass.indexOf("post-type-wp-manga-novel") === -1 &&
          !genresClean.some(function (g) { return g.indexOf("رواية") !== -1; })) {
        contentType = "manga";
      }

      var chapters = await fetchChapters(url);

      return {
        title: decodeEntities(title).trim() || "بدون عنوان",
        coverUrl: abs(cover),
        description: decodeEntities(description).trim(),
        genres: genresClean,
        chapters: chapters,
        originalUrl: url,
        hasMoreChapters: false,
        lastFetchedPage: 1,
        contentType: contentType
      };
    },

    async getChapterPages(args) {
      var content = await this.getChapterContent(args);
      return content.kind === "image" ? content.imageUrls : [];
    },

    async getChapterContent(args) {
      var url = abs((args && args.url) || "");
      lastChapterUrl = url;

      var pageHtml = await html(url);

      // Novel detection: body class or novel container
      var bodyClass = await api.cssAttr(pageHtml, "body", "class") || "";
      var hasNovelClass = bodyClass.indexOf("chapter-type-novel") !== -1 || bodyClass.indexOf("chapter-type-text") !== -1;
      var hasNovelContainer = false;
      if (!hasNovelClass) {
        var n1 = await api.cssHtml(pageHtml, ".text-left[dir='rtl']");
        var n2 = await api.cssHtml(pageHtml, ".reading-content.current");
        hasNovelContainer = !!(n1 && n1.trim()) || !!(n2 && n2.trim());
      }
      var isNovel = hasNovelClass || hasNovelContainer;

      if (isNovel) {
        var text = await extractNovelText(pageHtml);
        // Self-heal: if text is poisoned, retry once
        if (text && isPoisonedText(text)) {
          try {
            await new Promise(function (resolve) { setTimeout(resolve, 400); });
            var retryHtml = await html(url);
            text = await extractNovelText(retryHtml);
          } catch (_) {}
        }
        if (text && text.length > 0) {
          var chapterTitle = await extractChapterTitle(pageHtml);
          return { kind: "text", chapterTitle: chapterTitle || "", textContent: text };
        }
      }

      // Manga fallback (image pages)
      var imgs = await api.cssAll(pageHtml, ".reading-content img, .page-break img, #readerarea img");
      var urls = [];
      for (var i = 0; i < imgs.length; i++) {
        var a = imgs[i].attrs || {};
        var src = validImage(a["data-src"] || a["data-lazy-src"] || a.src || "");
        if (src && urls.indexOf(src) === -1) urls.push(src);
      }
      return { kind: "image", imageUrls: urls };
    },

    async fetchMoreChapters() { return null; },

    async getGenresAndTypes() { return { genres: defaultGenres, types: defaultTypes }; },

    getImageHeaders(args) {
      return {
        "User-Agent": userAgent,
        Referer: lastChapterUrl || baseUrl + "/",
        Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "Accept-Language": "ar,en-US;q=0.9,en;q=0.8",
        "Sec-Fetch-Dest": "image",
        "Sec-Fetch-Mode": "no-cors",
        "Sec-Fetch-Site": "same-origin"
      };
    },

    sanitizeCoverUrl(args) {
      return validImage((args && args.url) || "") || ((args && args.url) || "");
    }
  };
}

if (typeof module !== "undefined") module.exports = { createSource: createSource };
