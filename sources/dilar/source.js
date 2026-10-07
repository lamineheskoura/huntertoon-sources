function createSource(api, config) {
  var baseUrl = (config && config.base_url) || "https://dilar.tube";
  var apiBase = baseUrl.replace(/\/$/, "") + "/api";

  var headers = {
    "User-Agent": (config && config.user_agent) || "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "ar,en-US;q=0.9,en;q=0.8",
    "Referer": baseUrl + "/"
  };

  function mergeHeaders(extra) {
    var out = {};
    for (var k in headers) if (headers.hasOwnProperty(k)) out[k] = headers[k];
    if (extra) for (var k2 in extra) if (extra.hasOwnProperty(k2)) out[k2] = extra[k2];
    return out;
  }

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

  async function getJson(url) {
    var text = await api.fetchText(url, headers);
    if (!text) throw new Error("Empty response: " + url);
    text = String(text);
    if (text.charAt(0) !== "{" && text.charAt(0) !== "[") {
      var inner = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
      if (inner) text = inner[0];
    }
    return JSON.parse(text);
  }

  // ==================== SOURCE HELPERS ====================
  function coverUrl(id, filename) {
    if (!id || !filename) return "";
    return baseUrl + "/uploads/manga/cover/" + id + "/large_" + filename;
  }

  function toManga(item) {
    var id = String(item.id || "");
    var title = String(item.title || "");
    var slug = String(item.slug || "");
    if (!id || !title) return null;
    return {
      title: title,
      detailUrl: baseUrl + "/series/" + id + "/" + slug,
      coverUrl: coverUrl(id, String(item.cover || "")),
      contentType: "manga"
    };
  }

  function formatChapter(value) {
    if (!value) return "0";
    var n = parseFloat(String(value));
    if (!isNaN(n)) return n === Math.floor(n) ? String(Math.floor(n)) : String(n);
    return String(value).trim();
  }

  function isNovelToken(value) {
    if (!value) return false;
    var v = String(value).toLowerCase().trim();
    return v === "novel" || v === "light_novel" || v === "lightnovel" ||
      v === "light-novel" || v === "web_novel" || v === "webnovel" ||
      v === "web-novel" || v === "رواية" || v === "روايه" || v === "روايات";
  }

  function detectContentType(series) {
    if (!series || typeof series !== "object") return "manga";
    if (isNovelToken(series.type) || isNovelToken(series.series_type) || isNovelToken(series.category)) {
      return "novel";
    }
    if (series.seriesType && typeof series.seriesType === "object") {
      if (isNovelToken(series.seriesType.title) || isNovelToken(series.seriesType.name)) return "novel";
    }
    var categories = Array.isArray(series.categories) ? series.categories : [];
    for (var i = 0; i < categories.length; i++) {
      var c = categories[i];
      if (c && typeof c === "object" && isNovelToken(c.name || c.title)) return "novel";
    }
    return "manga";
  }

  var WIN_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
  var CHAPTER_API = "https://www.dilar.tube/api";
  var DH_CAPS = "1,2,3,4,5,6,7,8,9,10,11,12,13,14,15";
  var HAS_BIGINT = (typeof BigInt !== "undefined");

  function chapterHeaders(extra) {
    var out = {
      "User-Agent": WIN_UA,
      "Accept": "application/json, text/plain, */*",
      "Accept-Language": "ar,en-US;q=0.9,en;q=0.8",
      "Referer": "https://www.dilar.tube/"
    };
    if (extra) for (var k in extra) if (extra.hasOwnProperty(k)) out[k] = extra[k];
    return out;
  }

  // ==================== PURE-JS v15 CRYPTO (no app changes needed) ====================
  // Self-contained AES-ECB + P-256 ECDH + SIV glue. Uses only generic bridge
  // ops (api.http + api.cryptoOp sha512/hmacSha512/hkdf/sha256). Verified
  // against RFC 4493/5297 vectors and live envelopes. Ephemeral keys come
  // from Math.random (single-use transport keys; documented trade-off).

  var EC = null;
  function ecInit() {
    if (EC) return true;
    if (!HAS_BIGINT) return false;
    try {
      EC = {
        P: BigInt("0xFFFFFFFF00000001000000000000000000000000FFFFFFFFFFFFFFFFFFFFFFFF"),
        N: BigInt("0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551"),
        GX: BigInt("0x6B17D1F2E12C4247F8BCE6E563A440F277037D812DEB33A0F4A13945D898C296"),
        GY: BigInt("0x4FE342E2FE1A7F9B8EE7EB4A7C0F9E162BCE33576B315ECECBB6406837BF51F5")
      };
      return true;
    } catch (e) {
      EC = null;
      return false;
    }
  }

  function ecMod(a) {
    var r = a % EC.P;
    return r < BigInt(0) ? r + EC.P : r;
  }
  function ecInv(a) {
    var e = EC.P - BigInt(2), r = BigInt(1), b = ecMod(a);
    while (e > BigInt(0)) {
      if (e & BigInt(1)) r = ecMod(r * b);
      b = ecMod(b * b);
      e >>= BigInt(1);
    }
    return r;
  }
  function ecAddPt(P, Q) {
    if (P === null) return Q;
    if (Q === null) return P;
    if (P[0] === Q[0]) {
      if (ecMod(P[1] + Q[1]) === BigInt(0)) return null;
      return ecDblPt(P);
    }
    var lam = ecMod((Q[1] - P[1]) * ecInv(Q[0] - P[0]));
    var x3 = ecMod(lam * lam - P[0] - Q[0]);
    var y3 = ecMod(lam * (P[0] - x3) - P[1]);
    return [x3, y3];
  }
  function ecDblPt(P) {
    var lam = ecMod((BigInt(3) * P[0] * P[0] - BigInt(3)) * ecInv(BigInt(2) * P[1]));
    var x3 = ecMod(lam * lam - BigInt(2) * P[0]);
    var y3 = ecMod(lam * (P[0] - x3) - P[1]);
    return [x3, y3];
  }
  function ecMultPt(k, P) {
    var R = null, bits = k.toString(2);
    for (var j = 0; j < bits.length; j++) {
      if (R !== null) R = ecDblPt(R);
      if (bits.charAt(j) === "1") R = ecAddPt(R, P);
    }
    return R;
  }
  function ecPad64(x) {
    var s = x.toString(16);
    while (s.length < 64) s = "0" + s;
    return s;
  }

  function hxArr(h) {
    var out = [];
    for (var i = 0; i < h.length; i += 2) out.push(parseInt(h.substr(i, 2), 16));
    return out;
  }
  function arrHx(a) {
    var s = "";
    for (var i = 0; i < a.length; i++) s += (a[i] < 16 ? "0" : "") + a[i].toString(16);
    return s;
  }
  function b64decArr(s) {
    var bin = atob(String(s).replace(/-/g, "+").replace(/_/g, "/"));
    var out = [];
    for (var i = 0; i < bin.length; i++) out.push(bin.charCodeAt(i) & 0xFF);
    return out;
  }
  function b64encArr(a) {
    var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    var s = "";
    var i;
    for (i = 0; i + 2 < a.length; i += 3) {
      s += chars[a[i] >> 2] + chars[((a[i] & 3) << 4) | (a[i + 1] >> 4)] +
        chars[((a[i + 1] & 15) << 2) | (a[i + 2] >> 6)] + chars[a[i + 2] & 63];
    }
    var rem = a.length - i;
    if (rem === 1) s += chars[a[i] >> 2] + chars[(a[i] & 3) << 4] + "==";
    else if (rem === 2) s += chars[a[i] >> 2] + chars[((a[i] & 3) << 4) | (a[i + 1] >> 4)] + chars[(a[i + 1] & 15) << 2] + "=";
    return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function utf8Arr(s) {
    var out = [], i = 0;
    s = String(s);
    while (i < s.length) {
      var c = s.charCodeAt(i++);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) { out.push(0xC0 | (c >> 6), 0x80 | (c & 0x3F)); }
      else if (c >= 0xD800 && c <= 0xDBFF && i < s.length) {
        var lo = s.charCodeAt(i++);
        var cp = ((c - 0xD800) << 10) + (lo - 0xDC00) + 0x10000;
        out.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3F), 0x80 | ((cp >> 6) & 0x3F), 0x80 | (cp & 0x3F));
      } else out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F));
    }
    return out;
  }
  function concatArrs(list) {
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      for (var j = 0; j < a.length; j++) out.push(a[j]);
    }
    return out;
  }
  function u16beArr(n) { return [(n >> 8) & 0xFF, n & 0xFF]; }
  function u32beArr(n) {
    return [(n >>> 24) & 0xFF, (n >>> 16) & 0xFF, (n >>> 8) & 0xFF, n & 0xFF];
  }

  var AES_SBOX = null;
  function aesGfMul(a, b) {
    var p = 0;
    for (var i = 0; i < 8; i++) {
      if (b & 1) p ^= a;
      var hi = a & 0x80;
      a = (a << 1) & 0xFF;
      if (hi) a ^= 0x1B;
      b >>= 1;
    }
    return p;
  }
  function aesInitTables() {
    if (AES_SBOX) return;
    function rotl8(x, n) { return ((x << n) | (x >> (8 - n))) & 0xFF; }
    var s = new Array(256);
    for (var i = 0; i < 256; i++) {
      var e = 254, r = 1, b = i;
      while (e > 0) {
        if (e & 1) r = aesGfMul(r, b);
        b = aesGfMul(b, b);
        e >>= 1;
      }
      var x = (i === 0) ? 0 : r;
      var v = (x ^ rotl8(x, 1) ^ rotl8(x, 2) ^ rotl8(x, 3) ^ rotl8(x, 4) ^ 0x63) & 0xFF;
      s[i] = v;
    }
    AES_SBOX = s;
  }
  function aesExpandKey(key) {
    aesInitTables();
    var nk = key.length / 4, nr = nk + 6, rk = [];
    var i;
    for (i = 0; i < nk; i++) rk.push((key[4 * i] << 24) | (key[4 * i + 1] << 16) | (key[4 * i + 2] << 8) | key[4 * i + 3]);
    var rc = 1;
    for (i = nk; i < 4 * (nr + 1); i++) {
      var t = rk[i - 1];
      if (i % nk === 0) {
        t = ((AES_SBOX[(t >> 16) & 0xFF] << 24) | (AES_SBOX[(t >> 8) & 0xFF] << 16) | (AES_SBOX[t & 0xFF] << 8) | AES_SBOX[(t >> 24) & 0xFF]) ^ (rc << 24);
        rc = aesGfMul(rc, 2);
      } else if (nk > 6 && i % nk === 4) {
        t = (AES_SBOX[(t >> 24) & 0xFF] << 24) | (AES_SBOX[(t >> 16) & 0xFF] << 16) | (AES_SBOX[(t >> 8) & 0xFF] << 8) | AES_SBOX[t & 0xFF];
      }
      rk.push((rk[i - nk] ^ t) >>> 0);
    }
    return { rk: rk, rounds: nr };
  }
  function aesEcbEncBlock(ks, blk) {
    var S = AES_SBOX;
    var s0 = ((blk[0] << 24) | (blk[1] << 16) | (blk[2] << 8) | blk[3]) ^ ks.rk[0];
    var s1 = ((blk[4] << 24) | (blk[5] << 16) | (blk[6] << 8) | blk[7]) ^ ks.rk[1];
    var s2 = ((blk[8] << 24) | (blk[9] << 16) | (blk[10] << 8) | blk[11]) ^ ks.rk[2];
    var s3 = ((blk[12] << 24) | (blk[13] << 16) | (blk[14] << 8) | blk[15]) ^ ks.rk[3];
    for (var r = 1; r < ks.rounds; r++) {
      var a0 = [S[(s0 >> 24) & 0xFF], S[(s0 >> 16) & 0xFF], S[(s0 >> 8) & 0xFF], S[s0 & 0xFF]];
      var a1 = [S[(s1 >> 24) & 0xFF], S[(s1 >> 16) & 0xFF], S[(s1 >> 8) & 0xFF], S[s1 & 0xFF]];
      var a2 = [S[(s2 >> 24) & 0xFF], S[(s2 >> 16) & 0xFF], S[(s2 >> 8) & 0xFF], S[s2 & 0xFF]];
      var a3 = [S[(s3 >> 24) & 0xFF], S[(s3 >> 16) & 0xFF], S[(s3 >> 8) & 0xFF], S[s3 & 0xFF]];
      var b0 = [a0[0], a1[1], a2[2], a3[3]];
      var b1 = [a1[0], a2[1], a3[2], a0[3]];
      var b2 = [a2[0], a3[1], a0[2], a1[3]];
      var b3 = [a3[0], a0[1], a1[2], a2[3]];
      var rk = r * 4;
      s0 = mcWord(b0) ^ ks.rk[rk];
      s1 = mcWord(b1) ^ ks.rk[rk + 1];
      s2 = mcWord(b2) ^ ks.rk[rk + 2];
      s3 = mcWord(b3) ^ ks.rk[rk + 3];
    }
    var f0 = [S[(s0 >> 24) & 0xFF], S[(s0 >> 16) & 0xFF], S[(s0 >> 8) & 0xFF], S[s0 & 0xFF]];
    var f1 = [S[(s1 >> 24) & 0xFF], S[(s1 >> 16) & 0xFF], S[(s1 >> 8) & 0xFF], S[s1 & 0xFF]];
    var f2 = [S[(s2 >> 24) & 0xFF], S[(s2 >> 16) & 0xFF], S[(s2 >> 8) & 0xFF], S[s2 & 0xFF]];
    var f3 = [S[(s3 >> 24) & 0xFF], S[(s3 >> 16) & 0xFF], S[(s3 >> 8) & 0xFF], S[s3 & 0xFF]];
    var g0 = [f0[0], f1[1], f2[2], f3[3]];
    var g1 = [f1[0], f2[1], f3[2], f0[3]];
    var g2 = [f2[0], f3[1], f0[2], f1[3]];
    var g3 = [f3[0], f0[1], f1[2], f2[3]];
    var fr = ks.rounds * 4;
    var o0 = wordOf(g0) ^ ks.rk[fr];
    var o1 = wordOf(g1) ^ ks.rk[fr + 1];
    var o2 = wordOf(g2) ^ ks.rk[fr + 2];
    var o3 = wordOf(g3) ^ ks.rk[fr + 3];
    return bytesOf(o0).concat(bytesOf(o1), bytesOf(o2), bytesOf(o3));
  }
  function mcWord(col) {
    return wordOf([
      aesGfMul(col[0], 2) ^ aesGfMul(col[1], 3) ^ col[2] ^ col[3],
      col[0] ^ aesGfMul(col[1], 2) ^ aesGfMul(col[2], 3) ^ col[3],
      col[0] ^ col[1] ^ aesGfMul(col[2], 2) ^ aesGfMul(col[3], 3),
      aesGfMul(col[0], 3) ^ col[1] ^ col[2] ^ aesGfMul(col[3], 2)
    ]);
  }
  function wordOf(bytes4) {
    return ((bytes4[0] << 24) | (bytes4[1] << 16) | (bytes4[2] << 8) | bytes4[3]) >>> 0;
  }
  function bytesOf(w) {
    return [(w >>> 24) & 0xFF, (w >>> 16) & 0xFF, (w >>> 8) & 0xFF, w & 0xFF];
  }
  function cmacAes(key, data) {
    var ks = aesExpandKey(key);
    function dbl16(b) {
      var carry = 0, out = new Array(16);
      for (var i = 15; i >= 0; i--) {
        var v = b[i];
        out[i] = ((v << 1) & 0xFF) | carry;
        carry = (v >> 7) & 1;
      }
      if ((b[0] >> 7) & 1) out[15] ^= 0x87;
      return out;
    }
    function xor16(a, b) {
      var o = new Array(16);
      for (var i = 0; i < 16; i++) o[i] = a[i] ^ b[i];
      return o;
    }
    var L = aesEcbEncBlock(ks, [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]);
    var K1 = dbl16(L), K2 = dbl16(K1);
    var n = data.length === 0 ? 1 : Math.floor((data.length + 15) / 16);
    var lastC = data.length > 0 && data.length % 16 === 0;
    var x = [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0];
    for (var i = 0; i < n - 1; i++) x = aesEcbEncBlock(ks, xor16(x, data.slice(i * 16, i * 16 + 16)));
    var last;
    if (data.length === 0) {
      var z = [0x80,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0];
      last = xor16(z, K2);
    } else if (lastC) {
      last = xor16(data.slice(data.length - 16), K1);
    } else {
      var t = data.slice((n - 1) * 16);
      var firstLen = data.length - (n - 1) * 16;
      while (t.length < 16) t.push(t.length === firstLen ? 0x80 : 0x00);
      last = xor16(t, K2);
    }
    return aesEcbEncBlock(ks, xor16(x, last));
  }
  function sivS2V(k1, headers, pt) {
    var D = cmacAes(k1, [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]);
    function dbl16(b) {
      var carry = 0, out = new Array(16);
      for (var i = 15; i >= 0; i--) {
        var v = b[i];
        out[i] = ((v << 1) & 0xFF) | carry;
        carry = (v >> 7) & 1;
      }
      if ((b[0] >> 7) & 1) out[15] ^= 0x87;
      return out;
    }
    function xor16(a, b) {
      var o = new Array(16);
      for (var i = 0; i < 16; i++) o[i] = a[i] ^ b[i];
      return o;
    }
    var h;
    for (h = 0; h < headers.length; h++) D = xor16(dbl16(D), cmacAes(k1, headers[h]));
    var T;
    if (pt.length >= 16) {
      var Tn = pt.slice();
      for (h = 0; h < 16; h++) Tn[pt.length - 16 + h] ^= D[h];
      T = cmacAes(k1, Tn);
    } else {
      var pad = pt.slice();
      while (pad.length < 16) pad.push(pad.length === pt.length ? 0x80 : 0x00);
      T = cmacAes(k1, xor16(dbl16(D), pad));
    }
    return T;
  }
  function sivCtrCrypt(k2, iv16, data) {
    var ks = aesExpandKey(k2);
    var out = new Array(data.length);
    var ctr = iv16.slice();
    var off = 0;
    while (off < data.length) {
      var block = aesEcbEncBlock(ks, ctr);
      for (var i = 0; i < 16 && off < data.length; i++, off++) out[off] = data[off] ^ block[i];
      for (var j = 15; j >= 0; j--) {
        ctr[j] = (ctr[j] + 1) & 0xFF;
        if (ctr[j] !== 0) break;
      }
    }
    return out;
  }

  async function dilarJsHandshake(relId) {
    if (!ecInit()) throw new Error("no-bigint");
    if (typeof api.http !== "function" || typeof api.cryptoOp !== "function") {
      throw new Error("no-bridge");
    }
    var priv = [];
    for (var i = 0; i < 32; i++) priv.push(Math.floor(Math.random() * 256));
    var privHex = arrHx(priv);
    var pubPt = ecMultPt(BigInt("0x" + privHex), [EC.GX, EC.GY]);
    if (!pubPt) throw new Error("bad-key");
    var pubRaw = hxArr("04" + ecPad64(pubPt[0]) + ecPad64(pubPt[1]));
    var pubB64 = b64encArr(pubRaw);
    var H = chapterHeaders({
      "X-Crypto-Caps": DH_CAPS,
      "X-DH-Pub": pubB64
    });
    var opened = await dilarJsOpen(CHAPTER_API + "/chapters/" + relId, H, privHex, pubRaw);
    if (opened.freePass === true) {
      var ru = await api.http(CHAPTER_API + "/chapters/" + relId + "/unlock/free", {
        method: "POST",
        headers: chapterHeaders({ "Content-Type": "application/json" }),
        body: "{}"
      });
      var token = "";
      try {
        token = JSON.parse((ru && ru.body) || "{}").token || "";
      } catch (e) {}
      if (!token) throw new Error("no-token");
      H["X-Unlock-Free-Chapter"] = String(token);
      opened = await dilarJsOpen(CHAPTER_API + "/chapters/" + relId, H, privHex, pubRaw);
    }
    return opened;
  }

  async function dilarJsOpen(url, H, privHex, pubRaw) {
    var r = await api.http(url, { method: "GET", headers: H });
    if (!r || !r.ok) throw new Error("HTTP " + (r ? r.status : 0));
    var env = JSON.parse(r.body || "{}");
    if (!env || typeof env.ct !== "string") throw new Error("bad-envelope");
    var epk = b64decArr(env.epk), ivb = b64decArr(env.iv);
    var ct = b64decArr(env.ct), tag = b64decArr(env.tag);
    var e = String(env.e);
    var S = ecMultPt(BigInt("0x" + privHex), [
      BigInt("0x" + arrHx(epk.slice(1, 33))),
      BigInt("0x" + arrHx(epk.slice(33, 65)))
    ]);
    if (!S) throw new Error("bad-shared");
    var sharedHex = ecPad64(S[0]);
    var saltHex = await api.cryptoOp("hmacSha512",
      arrHx(concatArrs([u16beArr(pubRaw.length), pubRaw, u16beArr(epk.length), epk])),
      { key: arrHx(ivb) });
    var infoDigHex = await api.cryptoOp("sha512",
      arrHx(concatArrs([u16beArr(ivb.length), ivb, u16beArr(epk.length), epk])), {});
    var infoB64 = b64encArr(hxArr(infoDigHex)).slice(0, 22);
    var infoStr = "dilar.response.ecies.v15|" + e + "|" + infoB64;
    var derivedHex = await api.cryptoOp("hkdf", sharedHex,
      { salt: saltHex, info: arrHx(utf8Arr(infoStr)), hash: "sha512", length: 76 });
    var key64 = hxArr(derivedHex.slice(0, 128));
    var nonce12 = hxArr(derivedHex.slice(128, 152));
    var T = hxArr(await api.cryptoOp("sha256",
      arrHx(concatArrs([
        u16beArr(24), utf8Arr("dilar.response.ecies.v15"),
        u16beArr(2), utf8Arr("15"), u16beArr(e.length), utf8Arr(e),
        u16beArr(epk.length), epk, u16beArr(ivb.length), ivb,
        u16beArr(4), u32beArr(ct.length)
      ])), {}));
    var K1 = key64.slice(0, 32), K2 = key64.slice(32, 64);
    var siv = tag, c = ct;
    var iv = siv.slice();
    iv[8] &= 0x7F;
    iv[12] &= 0x7F;
    var pt = sivCtrCrypt(K2, iv, c);
    var chk = sivS2V(K1, [T, nonce12], pt);
    for (var i = 0; i < 16; i++) {
      if (chk[i] !== siv[i]) throw new Error("siv-mismatch");
    }
    var text = new TextDecoder().decode(new Uint8Array(pt));
    var dec = JSON.parse(text);
    if (dec.free_pass_required === true) return { freePass: true };
    var pages = dec.pages || dec.webp_pages || [];
    var sk = dec.storage_key || "", mt = dec.media_token || "";
    var out = [];
    for (var p = 0; p < pages.length; p++) {
      var f = pages[p].url || pages[p].webp_url || "";
      if (f) out.push(baseUrl + "/uploads/releases/" + sk + "/hq/" + f + "?t=" + mt);
    }
    if (dec.content && !out.length) return { textContent: String(dec.content) };
    return { imageUrls: out };
  }

  function getSeriesId(url) {
    var match = String(url || "").match(/\/(?:series|reader|novel|chapter)\/(\d+)/);
    return match ? match[1] : "";
  }

  function getRelId(url) {
    var match = String(url || "").match(/\/chapters\/(\d+)/);
    if (match) return match[1];
    var m2 = String(url || "").match(/\/(?:reader|chapter)\/.*?(\d+)(?:[^\d]|$)/);
    return m2 ? m2[1] : String(url || "").replace(/[^\d]/g, "");
  }

  function toChapter(ch) {
    var releases = Array.isArray(ch.releases) ? ch.releases : [];
    if (!releases.length) return null;
    var relId = String(releases[0].id || "");
    if (!relId) return null;
    var number = formatChapter(ch.chapter || "0");
    var title = String(ch.title || "").trim();
    if (!title) title = "الفصل " + number;
    return {
      number: number,
      title: title,
      views: 0,
      url: apiBase + "/chapters/" + relId,
      isLocked: false,
      date: String(ch.created_at || "")
    };
  }

  return {
    requiresCloudflare: false,

    async getHomepageManga(args) {
      return this.getFilteredManga(args || {});
    },

    async search(args) {
      try {
        var query = (args && args.query) || "";
        var page = (args && args.page) || 1;
        var data = await getJson(apiBase + "/series" + buildQuery({ page: page, title: query }));
        var series = Array.isArray(data.series) ? data.series : [];
        return series.map(toManga).filter(function (x) { return !!x; });
      } catch (e) {
        return [];
      }
    },

    async getFilteredManga(args) {
      try {
        var page = (args && args.page) || 1;
        var data = await getJson(apiBase + "/series" + buildQuery({ page: page }));
        var series = Array.isArray(data.series) ? data.series : [];
        return series.map(toManga).filter(function (x) { return !!x; });
      } catch (e) {
        return [];
      }
    },

    async getMangaDetails(args) {
      var url = (args && args.url) || "";
      var id = getSeriesId(url);
      if (!id) throw new Error("Could not find series id in: " + url);

      var data = await getJson(apiBase + "/series/" + id);
      var series = data.series || data;

      var chData = {};
      try {
        chData = await getJson(apiBase + "/series/" + id + "/chapters");
      } catch (e) { }

      var rawChapters = Array.isArray(chData.chapters) ? chData.chapters : [];
      var chapters = [];
      for (var i = 0; i < rawChapters.length; i++) {
        var ch = toChapter(rawChapters[i]);
        if (ch) chapters.push(ch);
      }
      chapters.sort(function (a, b) {
        return (parseFloat(b.number) || 0) - (parseFloat(a.number) || 0);
      });

      var rawGenres = Array.isArray(series.categories) ? series.categories : [];
      var genres = [];
      for (var gi = 0; gi < rawGenres.length; gi++) {
        var name = String((rawGenres[gi] && (rawGenres[gi].name || rawGenres[gi].title)) || "").trim();
        if (name) genres.push(name);
      }

      var type = detectContentType(series);

      return {
        title: String(series.title || "").trim(),
        coverUrl: coverUrl(String(series.id || id), String(series.cover || "")),
        description: String(series.summary || series.description || "").trim(),
        genres: genres,
        chapters: chapters,
        originalUrl: url,
        hasMoreChapters: false,
        lastFetchedPage: 1,
        contentType: type
      };
    },

    async getChapterPages(args) {
      var relId = getRelId(args && args.url);
      if (!relId) return [];

      // 1. Preferred: pure-JS v15 (no app changes needed; works on the
      // current released runtime via generic api.http + api.cryptoOp).
      try {
        var js = await dilarJsHandshake(relId);
        if (js && js.imageUrls && js.imageUrls.length) return js.imageUrls;
      } catch (e0) { }

      // 2. Legacy native Dart bridge (v12-era; kept as fallback).
      if (typeof api.dilarChapter === "function") {
        try {
          var res = await api.dilarChapter(relId);
          if (res && res.imageUrls && res.imageUrls.length) {
            return res.imageUrls;
          }
        } catch (e) { }
      }

      // 3. Headless browser fallback
      if (typeof api.browser === "function") {
        try {
          var html = await api.browser(baseUrl + "/reader/" + relId, { waitForSelector: "img", timeoutSeconds: 8 });
          if (html) {
            var urls = [];
            var re = /https:\/\/dilar\.tube\/uploads\/releases\/[^"']+\/hq\/[^"']+/g;
            var m;
            while ((m = re.exec(html)) !== null) {
              if (m[0] && urls.indexOf(m[0]) === -1) urls.push(m[0]);
            }
            if (urls.length) return urls;
          }
        } catch (e2) { }
      }

      return [];
    },

    async getChapterContent(args) {
      var relId = getRelId(args && args.url);
      if (!relId) return { kind: "image", imageUrls: [] };

      // 1. Preferred: pure-JS v15 (handles both novel text and manga images).
      try {
        var js = await dilarJsHandshake(relId);
        if (js) {
          if (js.textContent) return { kind: "text", textContent: js.textContent };
          if (js.imageUrls && js.imageUrls.length) {
            return { kind: "image", imageUrls: js.imageUrls };
          }
        }
      } catch (e0) { }

      // 2. Legacy native Dart bridge.
      if (typeof api.dilarChapter === "function") {
        try {
          var res = await api.dilarChapter(relId);
          if (res && res.kind === "text" && res.textContent) {
            return { kind: "text", textContent: res.textContent };
          }
          if (res && res.imageUrls && res.imageUrls.length) {
            return { kind: "image", imageUrls: res.imageUrls };
          }
        } catch (e) { }
      }

      var pages = await this.getChapterPages(args);
      return { kind: "image", imageUrls: pages || [] };
    },

    async fetchMoreChapters() {
      return null;
    },

    async getGenresAndTypes() {
      return { genres: [], types: [] };
    },

    getImageHeaders() {
      return {
        "User-Agent": headers["User-Agent"],
        "Referer": baseUrl + "/"
      };
    },

    sanitizeCoverUrl(args) {
      return (args && args.url) || "";
    }
  };
}
