const fs = require('fs');
const path = require('path');
const https = require('https');
const { JSDOM } = require('jsdom');

const sourcePath = path.join(__dirname, 'source.js');
const sourceCode = fs.readFileSync(sourcePath, 'utf-8');

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36' } }, (res) => {
      let body = '';
      res.on('data', (c) => body += c);
      res.on('end', () => resolve(body));
    }).on('error', reject);
  });
}

function createApi() {
  const cache = {};
  return {
    http: async (url, opts) => {
      if (cache[url]) return { ok: true, status: 200, body: cache[url] };
      const body = await fetchUrl(url);
      cache[url] = body;
      return { ok: true, status: 200, body };
    },
    fetchText: async (url) => {
      if (cache[url]) return cache[url];
      const body = await fetchUrl(url);
      cache[url] = body;
      return body;
    },
    cssAll: async (html, selector) => {
      const dom = new JSDOM(html);
      const doc = dom.window.document;
      const els = doc.querySelectorAll(selector);
      return Array.from(els).map(el => ({
        html: el.outerHTML,
        text: el.textContent || '',
        tagName: el.tagName.toLowerCase(),
        attrs: Object.fromEntries(Array.from(el.attributes).map(a => [a.name, a.value]))
      }));
    },
    cssText: async (html, selector) => {
      const dom = new JSDOM(html);
      const doc = dom.window.document;
      const el = doc.querySelector(selector);
      return el ? (el.textContent || '') : '';
    },
    cssAttr: async (html, selector, attr) => {
      const dom = new JSDOM(html);
      const doc = dom.window.document;
      const el = doc.querySelector(selector);
      return el ? (el.getAttribute(attr) || '') : '';
    }
  };
}

async function test() {
  const api = createApi();
  const config = {};
  const factory = new Function('api', 'config', sourceCode + '\nreturn createSource(api, config);');
  const source = factory(api, config);

  console.log('=== ONMA SOURCE TEST (L1-compliant) ===');
  console.log('requiresCloudflare:', source.requiresCloudflare);

  console.log('\n--- HOMEPAGE (page 1) ---');
  const lib = await source.getHomepageManga({ page: 1 });
  console.log('items:', lib.items.length, 'hasMore:', lib.hasMore, 'lastFetchedPage:', lib.lastFetchedPage);
  if (lib.items.length > 0) {
    console.log('first:', JSON.stringify(lib.items[0], null, 2));
  }

  console.log('\n--- SEARCH ---');
  const searchResults = await source.search({ query: 'one piece' });
  console.log('results:', searchResults.length);
  if (searchResults.length > 0) {
    console.log('first:', JSON.stringify(searchResults[0], null, 2));
  }

  console.log('\n--- FILTERED (action) ---');
  const filtered = await source.getFilteredManga({ genre: 'action', page: 1 });
  console.log('results:', filtered.length);

  if (lib.items.length > 0) {
    const detailUrl = lib.items[0].detailUrl;
    console.log('\n--- DETAILS ---', detailUrl);
    const details = await source.getMangaDetails({ url: detailUrl });
    console.log('title:', details.title);
    console.log('cover:', details.coverUrl?.substring(0, 80));
    console.log('description:', details.description?.substring(0, 100));
    console.log('genres:', details.genres);
    console.log('author:', details.author);
    console.log('chapters:', details.chapters.length);
    console.log('hasMoreChapters:', details.hasMoreChapters);
    console.log('lastFetchedPage:', details.lastFetchedPage);
    console.log('contentType:', details.contentType);

    if (details.chapters.length > 0) {
      console.log('\n--- CHAPTER CONTENT ---', details.chapters[0].url);
      const content = await source.getChapterContent({ url: details.chapters[0].url });
      console.log('title:', content.title);
      console.log('kind:', content.kind);
      console.log('pages:', content.pages.length);
      if (content.pages.length > 0) {
        console.log('first page:', content.pages[0].substring(0, 100));
      }
    }
  }

  console.log('\n--- GENRES & TYPES ---');
  const gt = await source.getGenresAndTypes();
  console.log('genres:', gt.genres.length, 'types:', gt.types);

  console.log('\n--- IMAGE HEADERS ---');
  const ih = source.getImageHeaders({});
  console.log('keys:', Object.keys(ih).join(', '));

  console.log('\n--- SANITIZE COVER ---');
  const sc = source.sanitizeCoverUrl({ url: '/test.jpg' });
  console.log('result:', sc);

  console.log('\n=== ALL TESTS PASSED ===');
}

test().catch(e => { console.error('TEST FAILED:', e.message); console.error(e.stack); process.exit(1); });
