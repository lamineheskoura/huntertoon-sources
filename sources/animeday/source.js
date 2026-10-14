function createSource(api, config) {
  // Anime Day (انمي داي) — clean-roomed from com.anime.day v3.8 APK.
  // API: {cloudday}/v3.8/api/{home,search,series/ID,movie/ID,series/ID/episodes,
  //       episode/ID/servers,movie/ID/servers} (GET except search=POST form).
  // Auth: headers firebase_id (AES-256-GCM token, "." + b64(ct||tag)) +
  //       cloudflare-id (15 alnum + 16-hex device id). Responses: plain JSON
  //       or AES-256-CBC (key/iv from md5(device id)) when not starting {/[.
  // NOTE (sandbox-verified Oct 2026): from flagged datacenter IPs every
  // firebase_id-bearing call answers HTTP 500 while anonymous calls work
  // (home/episodes) or answer {blocked:true,data:[]} — full verification of
  // gated endpoints must happen on a clean network (in-app).
  var DEF_API = "https://20042026.site";
  var CONFIG_URLS = [
    "https://20042026.site/json/config-3.8.json",
    "https://cloud-day.online/animeday/v3.8/CloudDay/uploads/config_v3.8.json",
    "https://backup-animeday.animegateshorts.workers.dev"
  ];
  var LANDING = "https://www.anime-day.com";
  var OKHTTP_UA = "okhttp/4.9.3";
  var ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  var HEXC = "0123456789abcdef";

  // ── tiny utils ──
  function sstr(v) { return String(v == null ? "" : v); }
  function safeList(v) { return Array.isArray(v) ? v : []; }
  function enc(s) { return encodeURIComponent(sstr(s)); }
  function decodeEnt(s) {
    s = sstr(s);
    s = s.split("&amp;").join("&").split("&quot;").join('"').split("&#39;").join("'").split("&lt;").join("<").split("&gt;").join(">");
    s = s.replace(/&#(\d+);/g, function (m, d) { return String.fromCharCode(parseInt(d, 10)); });
    return s.trim();
  }
  function absUrl(u, base) {
    u = sstr(u).replace(/&amp;/g, "&").trim();
    if (!u) return "";
    if (u.indexOf("//") === 0) return "https:" + u;
    if (u.indexOf("https://") === 0 || u.indexOf("http://") === 0) return u;
    if (u.charAt(0) === "/") return base + u;
    return base + "/" + u;
  }
  function parseJsonLenient(txt) {
    txt = sstr(txt);
    var i = txt.search(/[{[]/);
    if (i > 0) txt = txt.substring(i);
    var j = Math.max(txt.lastIndexOf("}"), txt.lastIndexOf("]"));
    if (j > 0 && j < txt.length - 1) txt = txt.substring(0, j + 1);
    return JSON.parse(txt);
  }

  // ── pure-JS crypto (QuickJS-safe: var only, 32-bit ops, plain arrays) ──
  var SBOX = [99,124,119,123,242,107,111,197,48,1,103,43,254,215,171,118,202,130,201,125,250,89,71,240,173,212,162,175,156,164,114,192,183,253,147,38,54,63,247,204,52,165,229,241,113,216,49,21,4,199,35,195,24,150,5,154,7,18,128,226,235,39,178,117,9,131,44,26,27,110,90,160,82,59,214,179,41,227,47,132,83,209,0,237,32,252,177,91,106,203,190,57,74,76,88,207,208,239,170,251,67,77,51,133,69,249,2,127,80,60,159,168,81,163,64,143,146,157,56,245,188,182,218,33,16,255,243,210,205,12,19,236,95,151,68,23,196,167,126,61,100,93,25,115,96,129,79,220,34,42,144,136,70,238,184,20,222,94,11,219,224,50,58,10,73,6,36,92,194,211,172,98,145,149,228,121,231,200,55,109,141,213,78,169,108,86,244,234,101,122,174,8,186,120,37,46,28,166,180,198,232,221,116,31,75,189,139,138,112,62,181,102,72,3,246,14,97,53,87,185,134,193,29,158,225,248,152,17,105,217,142,148,155,30,135,233,206,85,40,223,140,161,137,13,191,230,66,104,65,153,45,15,176,84,187,22];
  function xtime(a) { return ((a << 1) ^ ((a & 128) ? 27 : 0)) & 255; }
  function mul2(a) { return xtime(a); }
  function mul3(a) { return (xtime(a) ^ a) & 255; }
  function aesKeyExpand256(keyBytes) {
    var w = [], i, k;
    for (i = 0; i < 8; i++) w.push(((keyBytes[i * 4] << 24) | (keyBytes[i * 4 + 1] << 16) | (keyBytes[i * 4 + 2] << 8) | keyBytes[i * 4 + 3]) >>> 0);
    var RCON = [1, 2, 4, 8, 16, 32, 64, 128, 27, 54];
    for (k = 8; k < 60; k++) {
      var temp = w[k - 1];
      if ((k % 8) === 0) {
        temp = (((SBOX[(temp >>> 16) & 255] << 24) | (SBOX[(temp >>> 8) & 255] << 16) | (SBOX[temp & 255] << 8) | SBOX[(temp >>> 24) & 255]) ^ (RCON[Math.floor(k / 8) - 1] << 24)) >>> 0;
      } else if ((k % 8) === 4) {
        temp = ((SBOX[(temp >>> 24) & 255] << 24) | (SBOX[(temp >>> 16) & 255] << 16) | (SBOX[(temp >>> 8) & 255] << 8) | SBOX[temp & 255]) >>> 0;
      }
      w.push((w[k - 8] ^ temp) >>> 0);
    }
    return w;
  }
  function aesEncryptBlock(block16, w) {
    var s = [], i, c, round, col, k, cc, kk, ccc;
    for (i = 0; i < 16; i++) s.push(block16[i] & 255);
    for (c = 0; c < 4; c++) {
      var wd = w[c];
      s[c * 4] ^= (wd >>> 24) & 255; s[c * 4 + 1] ^= (wd >>> 16) & 255; s[c * 4 + 2] ^= (wd >>> 8) & 255; s[c * 4 + 3] ^= wd & 255;
    }
    for (round = 1; round < 14; round++) {
      for (k = 0; k < 16; k++) s[k] = SBOX[s[k]];
      var t = [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0];
      t[0] = s[0]; t[4] = s[4]; t[8] = s[8]; t[12] = s[12];
      t[1] = s[5]; t[5] = s[9]; t[9] = s[13]; t[13] = s[1];
      t[2] = s[10]; t[6] = s[14]; t[10] = s[2]; t[14] = s[6];
      t[3] = s[15]; t[7] = s[3]; t[11] = s[7]; t[15] = s[11];
      s = t;
      for (col = 0; col < 4; col++) {
        var a0 = s[col * 4], a1 = s[col * 4 + 1], a2 = s[col * 4 + 2], a3 = s[col * 4 + 3];
        s[col * 4] = (mul2(a0) ^ mul3(a1) ^ a2 ^ a3) & 255;
        s[col * 4 + 1] = (a0 ^ mul2(a1) ^ mul3(a2) ^ a3) & 255;
        s[col * 4 + 2] = (a0 ^ a1 ^ mul2(a2) ^ mul3(a3)) & 255;
        s[col * 4 + 3] = (mul3(a0) ^ a1 ^ a2 ^ mul2(a3)) & 255;
      }
      var base = round * 4;
      for (cc = 0; cc < 4; cc++) {
        var ww = w[base + cc];
        s[cc * 4] ^= (ww >>> 24) & 255; s[cc * 4 + 1] ^= (ww >>> 16) & 255; s[cc * 4 + 2] ^= (ww >>> 8) & 255; s[cc * 4 + 3] ^= ww & 255;
      }
    }
    for (kk = 0; kk < 16; kk++) s[kk] = SBOX[s[kk]];
    var tt = [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0];
    tt[0] = s[0]; tt[4] = s[4]; tt[8] = s[8]; tt[12] = s[12];
    tt[1] = s[5]; tt[5] = s[9]; tt[9] = s[13]; tt[13] = s[1];
    tt[2] = s[10]; tt[6] = s[14]; tt[10] = s[2]; tt[14] = s[6];
    tt[3] = s[15]; tt[7] = s[3]; tt[11] = s[7]; tt[15] = s[11];
    s = tt;
    for (ccc = 0; ccc < 4; ccc++) {
      var www = w[56 + ccc];
      s[ccc * 4] ^= (www >>> 24) & 255; s[ccc * 4 + 1] ^= (www >>> 16) & 255; s[ccc * 4 + 2] ^= (www >>> 8) & 255; s[ccc * 4 + 3] ^= www & 255;
    }
    return s;
  }
  var INVSBOX = null;
  function invSbox() {
    if (!INVSBOX) { INVSBOX = new Array(256); for (var i = 0; i < 256; i++) INVSBOX[SBOX[i]] = i; }
    return INVSBOX;
  }
  function gfMul(a, b) {
    var p = 0;
    for (var i = 0; i < 8; i++) {
      if (b & 1) p ^= a;
      var hi = a & 128;
      a = (a << 1) & 255;
      if (hi) a ^= 27;
      b >>= 1;
    }
    return p;
  }
  var DEC_T0 = null, DEC_T1 = null, DEC_T2 = null, DEC_T3 = null;
  function decTables() {
    if (DEC_T0) return;
    var ISB = invSbox();
    DEC_T0 = []; DEC_T1 = []; DEC_T2 = []; DEC_T3 = [];
    for (var i = 0; i < 256; i++) {
      var s = ISB[i];
      var e = gfMul(s, 14), n = gfMul(s, 9), d = gfMul(s, 13), b = gfMul(s, 11);
      DEC_T0.push(((e << 24) | (n << 16) | (d << 8) | b) >>> 0);
      DEC_T1.push(((b << 24) | (e << 16) | (n << 8) | d) >>> 0);
      DEC_T2.push(((d << 24) | (b << 16) | (e << 8) | n) >>> 0);
      DEC_T3.push(((n << 24) | (d << 16) | (b << 8) | e) >>> 0);
    }
  }
  function mixWord(word) {
    var b0 = (word >>> 24) & 255, b1 = (word >>> 16) & 255, b2 = (word >>> 8) & 255, b3 = word & 255;
    return ((gfMul(b0, 14) ^ gfMul(b1, 11) ^ gfMul(b2, 13) ^ gfMul(b3, 9)) << 24 |
      (gfMul(b0, 9) ^ gfMul(b1, 14) ^ gfMul(b2, 11) ^ gfMul(b3, 13)) << 16 |
      (gfMul(b0, 13) ^ gfMul(b1, 9) ^ gfMul(b2, 14) ^ gfMul(b3, 11)) << 8 |
      (gfMul(b0, 11) ^ gfMul(b1, 13) ^ gfMul(b2, 9) ^ gfMul(b3, 14))) >>> 0;
  }
  function aesDecSchedule(keyBytes) {
    var w = aesKeyExpand256(keyBytes);
    for (var r = 1; r <= 13; r++) for (var c = 0; c < 4; c++) w[r * 4 + c] = mixWord(w[r * 4 + c]);
    return w;
  }
  function aesDecryptBlock(block, w) {
    decTables();
    var ISB = invSbox();
    var s = [block[0],block[1],block[2],block[3],block[4],block[5],block[6],block[7],block[8],block[9],block[10],block[11],block[12],block[13],block[14],block[15]];
    var c, word, base, round;
    base = 56;
    for (c = 0; c < 4; c++) {
      word = w[base + c];
      s[4 * c] ^= (word >>> 24) & 255; s[4 * c + 1] ^= (word >>> 16) & 255; s[4 * c + 2] ^= (word >>> 8) & 255; s[4 * c + 3] ^= word & 255;
    }
    for (round = 13; round >= 1; round--) {
      base = round * 4;
      var t0 = (DEC_T0[s[0]] ^ DEC_T1[s[13]] ^ DEC_T2[s[10]] ^ DEC_T3[s[7]] ^ w[base]) >>> 0;
      var t1 = (DEC_T0[s[4]] ^ DEC_T1[s[1]] ^ DEC_T2[s[14]] ^ DEC_T3[s[11]] ^ w[base + 1]) >>> 0;
      var t2 = (DEC_T0[s[8]] ^ DEC_T1[s[5]] ^ DEC_T2[s[2]] ^ DEC_T3[s[15]] ^ w[base + 2]) >>> 0;
      var t3 = (DEC_T0[s[12]] ^ DEC_T1[s[9]] ^ DEC_T2[s[6]] ^ DEC_T3[s[3]] ^ w[base + 3]) >>> 0;
      s[0] = (t0 >>> 24) & 255; s[1] = (t0 >>> 16) & 255; s[2] = (t0 >>> 8) & 255; s[3] = t0 & 255;
      s[4] = (t1 >>> 24) & 255; s[5] = (t1 >>> 16) & 255; s[6] = (t1 >>> 8) & 255; s[7] = t1 & 255;
      s[8] = (t2 >>> 24) & 255; s[9] = (t2 >>> 16) & 255; s[10] = (t2 >>> 8) & 255; s[11] = t2 & 255;
      s[12] = (t3 >>> 24) & 255; s[13] = (t3 >>> 16) & 255; s[14] = (t3 >>> 8) & 255; s[15] = t3 & 255;
    }
    var u = [];
    u[0] = ISB[s[0]] ^ ((w[0] >>> 24) & 255); u[1] = ISB[s[13]] ^ ((w[0] >>> 16) & 255);
    u[2] = ISB[s[10]] ^ ((w[0] >>> 8) & 255); u[3] = ISB[s[7]] ^ (w[0] & 255);
    u[4] = ISB[s[4]] ^ ((w[1] >>> 24) & 255); u[5] = ISB[s[1]] ^ ((w[1] >>> 16) & 255);
    u[6] = ISB[s[14]] ^ ((w[1] >>> 8) & 255); u[7] = ISB[s[11]] ^ (w[1] & 255);
    u[8] = ISB[s[8]] ^ ((w[2] >>> 24) & 255); u[9] = ISB[s[5]] ^ ((w[2] >>> 16) & 255);
    u[10] = ISB[s[2]] ^ ((w[2] >>> 8) & 255); u[11] = ISB[s[15]] ^ (w[2] & 255);
    u[12] = ISB[s[12]] ^ ((w[3] >>> 24) & 255); u[13] = ISB[s[9]] ^ ((w[3] >>> 16) & 255);
    u[14] = ISB[s[6]] ^ ((w[3] >>> 8) & 255); u[15] = ISB[s[3]] ^ (w[3] & 255);
    return u;
  }
  function aesCbcDecrypt(keyBytes, ivBytes, dataBytes) {
    var w = aesDecSchedule(keyBytes);
    var out = [], prev = ivBytes.slice(0), b, k, blk, dec;
    for (b = 0; b + 16 <= dataBytes.length; b += 16) {
      blk = dataBytes.slice(b, b + 16);
      dec = aesDecryptBlock(blk, w);
      for (k = 0; k < 16; k++) out.push((dec[k] ^ prev[k]) & 255);
      prev = blk;
    }
    if (!out.length) throw new Error("empty");
    var pad = out[out.length - 1], i;
    if (pad < 1 || pad > 16) throw new Error("bad pad");
    for (i = 0; i < pad; i++) if (out[out.length - 1 - i] !== pad) throw new Error("bad pad bytes");
    return out.slice(0, out.length - pad);
  }
  function ghashMul(X, Y) {
    var Z = [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0], V = Y.slice(0), b, j, k;
    for (b = 0; b < 128; b++) {
      var bit = (X[b >> 3] >> (7 - (b & 7))) & 1;
      if (bit === 1) { for (j = 0; j < 16; j++) Z[j] ^= V[j]; }
      var lsb = V[15] & 1;
      for (k = 15; k > 0; k--) V[k] = ((V[k] >>> 1) | (V[k - 1] << 7)) & 255;
      V[0] = (V[0] >>> 1) & 255;
      if (lsb) V[0] ^= 225;
    }
    return Z;
  }
  function ghash(H, aad, ct) {
    var X = [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0], off, i, lim, q, b1;
    function procBlk(blk) {
      for (q = 0; q < 16; q++) X[q] ^= blk[q];
      X = ghashMul(X, H);
    }
    for (off = 0; off < aad.length; off += 16) {
      b1 = [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]; lim = Math.min(16, aad.length - off);
      for (i = 0; i < lim; i++) b1[i] = aad[off + i];
      procBlk(b1);
    }
    for (off = 0; off < ct.length; off += 16) {
      b1 = [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]; lim = Math.min(16, ct.length - off);
      for (i = 0; i < lim; i++) b1[i] = ct[off + i];
      procBlk(b1);
    }
    var aBits = aad.length * 8, cBits = ct.length * 8;
    var lb = [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0];
    lb[4] = (aBits >>> 24) & 255; lb[5] = (aBits >>> 16) & 255; lb[6] = (aBits >>> 8) & 255; lb[7] = aBits & 255;
    lb[12] = (cBits >>> 24) & 255; lb[13] = (cBits >>> 16) & 255; lb[14] = (cBits >>> 8) & 255; lb[15] = cBits & 255;
    procBlk(lb);
    return X;
  }
  function inc32(b16) {
    var out = b16.slice(0);
    var c = ((((out[12] << 24) | (out[13] << 16) | (out[14] << 8) | out[15]) >>> 0) + 1) >>> 0;
    out[12] = (c >>> 24) & 255; out[13] = (c >>> 16) & 255; out[14] = (c >>> 8) & 255; out[15] = c & 255;
    return out;
  }
  function aesGcmEncryptPure(key, iv, pt) {
    var w = aesKeyExpand256(key);
    var H = aesEncryptBlock([0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0], w);
    var J0 = iv.concat([0, 0, 0, 1]);
    var ct = [], ctr = inc32(J0), off, j, lim, ks, k;
    for (off = 0; off < pt.length; off += 16) {
      ks = aesEncryptBlock(ctr, w);
      lim = Math.min(16, pt.length - off);
      for (j = 0; j < lim; j++) ct.push((pt[off + j] ^ ks[j]) & 255);
      ctr = inc32(ctr);
    }
    var S = ghash(H, [], ct);
    var EJ0 = aesEncryptBlock(J0, w);
    var tag = [];
    for (k = 0; k < 16; k++) tag.push((S[k] ^ EJ0[k]) & 255);
    return { ct: ct, tag: tag };
  }
  function rotr32(x, n) { return ((x >>> n) | (x << (32 - n))) >>> 0; }
  function sha256Bytes(data) {
    var K = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
    var H0 = 0x6a09e667, H1 = 0xbb67ae85, H2 = 0x3c6ef372, H3 = 0xa54ff53a, H4 = 0x510e527f, H5 = 0x9b05688c, H6 = 0x1f83d9ab, H7 = 0x5be0cd19;
    var l = data.length, bitLen = l * 8;
    var newLen = (((l + 9 + 63) >> 6) << 6);
    var msg = [], i;
    for (i = 0; i < newLen; i++) msg.push(0);
    for (i = 0; i < l; i++) msg[i] = data[i] & 255;
    msg[l] = 128;
    var hi = Math.floor(bitLen / 4294967296), lo = bitLen >>> 0;
    msg[newLen - 8] = (hi >>> 24) & 255; msg[newLen - 7] = (hi >>> 16) & 255; msg[newLen - 6] = (hi >>> 8) & 255; msg[newLen - 5] = hi & 255;
    msg[newLen - 4] = (lo >>> 24) & 255; msg[newLen - 3] = (lo >>> 16) & 255; msg[newLen - 2] = (lo >>> 8) & 255; msg[newLen - 1] = lo & 255;
    var w = [], off, t, tt, k, a, b, c, d, e, f, g, h, S0, S1, ch, maj, t1, t2;
    for (i = 0; i < 64; i++) w.push(0);
    for (off = 0; off < newLen; off += 64) {
      for (t = 0; t < 16; t++) w[t] = (((msg[off + t * 4] << 24) | (msg[off + t * 4 + 1] << 16) | (msg[off + t * 4 + 2] << 8) | msg[off + t * 4 + 3]) >>> 0);
      for (tt = 16; tt < 64; tt++) {
        S0 = (rotr32(w[tt - 15], 7) ^ rotr32(w[tt - 15], 18) ^ (w[tt - 15] >>> 3)) >>> 0;
        S1 = (rotr32(w[tt - 2], 17) ^ rotr32(w[tt - 2], 19) ^ (w[tt - 2] >>> 10)) >>> 0;
        w[tt] = (w[tt - 16] + S0 + w[tt - 7] + S1) >>> 0;
      }
      a = H0; b = H1; c = H2; d = H3; e = H4; f = H5; g = H6; h = H7;
      for (k = 0; k < 64; k++) {
        S1 = (rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25)) >>> 0;
        ch = ((e & f) ^ ((~e) & g)) >>> 0;
        t1 = (h + S1 + ch + K[k] + w[k]) >>> 0;
        S0 = (rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22)) >>> 0;
        maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
        t2 = (S0 + maj) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      H0 = (H0 + a) >>> 0; H1 = (H1 + b) >>> 0; H2 = (H2 + c) >>> 0; H3 = (H3 + d) >>> 0;
      H4 = (H4 + e) >>> 0; H5 = (H5 + f) >>> 0; H6 = (H6 + g) >>> 0; H7 = (H7 + h) >>> 0;
    }
    var out = [], HH = [H0,H1,H2,H3,H4,H5,H6,H7];
    for (i = 0; i < 8; i++) { out.push((HH[i] >>> 24) & 255, (HH[i] >>> 16) & 255, (HH[i] >>> 8) & 255, HH[i] & 255); }
    return out;
  }
  function hmacSha256(key, data) {
    var B = 64, k = key.slice(0), i;
    if (k.length > B) k = sha256Bytes(k);
    while (k.length < B) k.push(0);
    var ip = [], op = [];
    for (i = 0; i < B; i++) { ip.push((k[i] ^ 0x36) & 255); op.push((k[i] ^ 0x5c) & 255); }
    return sha256Bytes(op.concat(sha256Bytes(ip.concat(data))));
  }
  function md5Bytes(data) {
    function rl(x, n) { return ((x << n) | (x >>> (32 - n))) >>> 0; }
    var l = data.length, bitLen = l * 8;
    var newLen = (((l + 9 + 63) >> 6) << 6);
    var msg = [], i;
    for (i = 0; i < newLen; i++) msg.push(0);
    for (i = 0; i < l; i++) msg[i] = data[i] & 255;
    msg[l] = 128;
    var lo = bitLen >>> 0, hi = Math.floor(bitLen / 4294967296);
    msg[newLen - 8] = lo & 255; msg[newLen - 7] = (lo >>> 8) & 255; msg[newLen - 6] = (lo >>> 16) & 255; msg[newLen - 5] = (lo >>> 24) & 255;
    msg[newLen - 4] = hi & 255; msg[newLen - 3] = (hi >>> 8) & 255; msg[newLen - 2] = (hi >>> 16) & 255; msg[newLen - 1] = (hi >>> 24) & 255;
    var a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
    var T = [0xd76aa478,0xe8c7b756,0x242070db,0xc1bdceee,0xf57c0faf,0x4787c62a,0xa8304613,0xfd469501,0x698098d8,0x8b44f7af,0xffff5bb1,0x895cd7be,0x6b901122,0xfd987193,0xa679438e,0x49b40821,0xf61e2562,0xc040b340,0x265e5a51,0xe9b6c7aa,0xd62f105d,0x02441453,0xd8a1e681,0xe7d3fbc8,0x21e1cde6,0xc33707d6,0xf4d50d87,0x455a14ed,0xa9e3e905,0xfcefa3f8,0x676f02d9,0x8d2a4c8a,0xfffa3942,0x8771f681,0x6d9d6122,0xfde5380c,0xa4beea44,0x4bdecfa9,0xf6bb4b60,0xbebfbc70,0x289b7ec6,0xeaa127fa,0xd4ef3085,0x04881d05,0xd9d4d039,0xe6db99e5,0x1fa27cf8,0xc4ac5665,0xf4292244,0x432aff97,0xab9423a7,0xfc93a039,0x655b59c3,0x8f0ccc92,0xffeff47d,0x85845dd1,0x6fa87e4f,0xfe2ce6e0,0xa3014314,0x4e0811a1,0xf7537e82,0xbd3af235,0x2ad7d2bb,0xeb86d391];
    var S1 = [7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22];
    var S2 = [5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20];
    var S3 = [4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23];
    var S4 = [6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21];
    var off, a, b, c, d, M = [];
    for (i = 0; i < 16; i++) M.push(0);
    for (off = 0; off < newLen; off += 64) {
      for (i = 0; i < 16; i++) M[i] = ((msg[off + i * 4]) | (msg[off + i * 4 + 1] << 8) | (msg[off + i * 4 + 2] << 16) | (msg[off + i * 4 + 3] << 24)) >>> 0;
      a = a0; b = b0; c = c0; d = d0;
      for (i = 0; i < 64; i++) {
        var g;
        if (i < 16) { g = i; a = (rl((a + ((b & c) | ((~b) & d)) + M[g] + T[i]) >>> 0, S1[i]) + b) >>> 0; }
        else if (i < 32) { g = (5 * i + 1) % 16; a = (rl((a + ((b & d) | (c & (~d))) + M[g] + T[i]) >>> 0, S2[i - 16]) + b) >>> 0; }
        else if (i < 48) { g = (3 * i + 5) % 16; a = (rl((a + (b ^ c ^ d) + M[g] + T[i]) >>> 0, S3[i - 32]) + b) >>> 0; }
        else { g = (7 * i) % 16; a = (rl((a + (c ^ (b | (~d))) + M[g] + T[i]) >>> 0, S4[i - 48]) + b) >>> 0; }
        var tmp = d; d = c; c = b; b = a; a = tmp;
      }
      a0 = (a0 + a) >>> 0; b0 = (b0 + b) >>> 0; c0 = (c0 + c) >>> 0; d0 = (d0 + d) >>> 0;
    }
    var out = [], DD = [a0, b0, c0, d0];
    for (i = 0; i < 4; i++) { out.push(DD[i] & 255, (DD[i] >>> 8) & 255, (DD[i] >>> 16) & 255, (DD[i] >>> 24) & 255); }
    return out;
  }
  function asciiToBytes(s) {
    s = sstr(s);
    var out = [];
    for (var i = 0; i < s.length; i++) out.push(s.charCodeAt(i) & 255);
    return out;
  }
  function bytesToAscii(b) {
    var s = "";
    for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i] & 255);
    return s;
  }
  function bytesToHex(b) {
    var s = "";
    for (var i = 0; i < b.length; i++) s += HEXC.charAt((b[i] >> 4) & 15) + HEXC.charAt(b[i] & 15);
    return s;
  }
  var B64A = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  function bytesToB64(b) {
    var s = "", i, n = b.length;
    for (i = 0; i < n; i += 3) {
      var b0 = b[i], b1 = (i + 1 < n) ? b[i + 1] : 0, b2 = (i + 2 < n) ? b[i + 2] : 0;
      s += B64A.charAt(b0 >> 2);
      s += B64A.charAt(((b0 & 3) << 4) | (b1 >> 4));
      s += (i + 1 < n) ? B64A.charAt(((b1 & 15) << 2) | (b2 >> 6)) : "=";
      s += (i + 2 < n) ? B64A.charAt(b2 & 63) : "=";
    }
    return s;
  }
  function b64ToBytes(s) {
    s = sstr(s).replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
    var vals = [], i, ch, v;
    for (i = 0; i < s.length; i++) {
      ch = s.charCodeAt(i);
      if (ch === 61) break;
      if (ch >= 65 && ch <= 90) v = ch - 65;
      else if (ch >= 97 && ch <= 122) v = ch - 97 + 26;
      else if (ch >= 48 && ch <= 57) v = ch - 48 + 52;
      else if (ch === 43) v = 62;
      else if (ch === 47) v = 63;
      else return null;
      vals.push(v);
    }
    var outLen = Math.floor(vals.length * 6 / 8), out = [], bits = 0, bitsN = 0, o = 0;
    for (i = 0; i < vals.length; i++) {
      bits = (bits << 6) | vals[i]; bitsN += 6;
      if (bitsN >= 8) {
        bitsN -= 8;
        if (o < outLen) { out.push((bits >> bitsN) & 255); o++; }
        bits = bits & ((1 << bitsN) - 1);
      }
    }
    return out;
  }
  function utf8Encode(s) {
    s = sstr(s);
    var out = [], i, c;
    for (i = 0; i < s.length; i++) {
      c = s.charCodeAt(i);
      if (c < 128) out.push(c);
      else if (c < 2048) out.push(192 | (c >> 6), 128 | (c & 63));
      else if (c < 55296 || c > 57343) out.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63));
      else {
        var hi = c, lo = s.charCodeAt(++i), cp = ((hi - 55296) << 10) + (lo - 56320) + 65536;
        out.push(240 | (cp >> 18), 128 | ((cp >> 12) & 63), 128 | ((cp >> 6) & 63), 128 | (cp & 63));
      }
    }
    return out;
  }
  function utf8Decode(b) {
    var s = "", i = 0, c;
    while (i < b.length) {
      c = b[i];
      if (c < 128) { s += String.fromCharCode(c); i++; }
      else if ((c & 224) === 192) { s += String.fromCharCode(((c & 31) << 6) | (b[i + 1] & 63)); i += 2; }
      else if ((c & 240) === 224) { s += String.fromCharCode(((c & 15) << 12) | ((b[i + 1] & 63) << 6) | (b[i + 2] & 63)); i += 3; }
      else { var cp = ((c & 7) << 18) | ((b[i + 1] & 63) << 12) | ((b[i + 2] & 63) << 6) | (b[i + 3] & 63); cp -= 65536; s += String.fromCharCode(55296 + (cp >> 10), 56320 + (cp & 1023)); i += 4; }
    }
    return s;
  }
  function randBytes(n) {
    var out = [];
    for (var i = 0; i < n; i++) out.push(Math.floor(Math.random() * 256) & 255);
    return out;
  }
  function randAlnum(n) {
    var out = "";
    for (var i = 0; i < n; i++) out += ALNUM.charAt(Math.floor(Math.random() * ALNUM.length) & 63);
    return out;
  }
  function randHex(n) {
    var out = "";
    for (var i = 0; i < n; i++) out += HEXC.charAt(Math.floor(Math.random() * 16));
    return out;
  }

  // ── session: device id + cloudflare-id + cookies + api base ──
  var deviceId = randHex(16);
  var cfPrefix = randAlnum(15);
  var cookieJar = "";
  var apiBase = null;
  function cloudflareId() { return cfPrefix + deviceId; }
  function rememberCookies(res) {
    try {
      var h = res && res.headers ? res.headers : null;
      if (!h) return;
      var sc = h["set-cookie"] || h["Set-Cookie"] || null;
      if (!sc) return;
      var arr = Array.isArray(sc) ? sc : [sc];
      var parts = [];
      for (var i = 0; i < arr.length; i++) {
        var one = String(arr[i]).split(";")[0].trim();
        if (one) parts.push(one);
      }
      if (parts.length) cookieJar = parts.join("; ");
    } catch (e) {}
  }

  // ── firebase_id forger (token shape of NativeLib.buildSecure) ──
  // Static secrets below were extracted from libnative-lib.so (x86_64) of
  // com.anime.day v3.8: S = LCG-string @0x170490 (seed^FNV1a64(sha256hex(cert))),
  // HMAC key = LCG-string @0x170870. Derivation verified live in RE.
  var AD_S = "Gm4il@G00Gl3.Com";
  var AD_HMAC_KEY = "97a54e5dec15b4f1754abc5939643bbe57a0d8ae8db88529e268289457728002";
  function adDecryptResponse(dataB64, devId) {
    try {
      var raw = b64ToBytes(sstr(dataB64).trim());
      if (!raw || raw.length < 32 || (raw.length % 16) !== 0) return null;
      var dev = asciiToBytes(devId);
      var h1 = bytesToHex(md5Bytes(asciiToBytes(AD_S).concat(dev)));
      var iv = asciiToBytes(h1.substring(0, 16));
      var h2 = bytesToHex(md5Bytes(dev.concat(asciiToBytes(AD_S))));
      var key = asciiToBytes(h2);
      var pt = aesCbcDecrypt(key, iv, raw);
      return utf8Decode(pt);
    } catch (e) { return null; }
  }
  function adForgeToken(devId) {
    var ts = String(Math.floor(Date.now() / 1000));
    var nonce = bytesToHex(randBytes(16)).substring(0, 16);
    // Integrity flags (single-char keys, all clean) + m = HMAC-SHA256 + t/n.
    // The server cannot verify payload content (AES key/iv stay on device);
    // shape mirrors the genuine token bit-for-bit in structure.
    var flags = ["a","b","c","d","e","f","g","h","i","j","k","l","o","p","q","r","s"];
    var js = "{", i;
    for (i = 0; i < flags.length; i++) {
      if (i > 0) js += ",";
      js += '"' + flags[i] + '":"false"';
    }
    var mac = bytesToHex(hmacSha256(asciiToBytes(AD_HMAC_KEY), utf8Encode(js)));
    js += ',"m":"' + mac + '","t":"' + ts + '","n":"' + nonce + '"}';
    var pt = utf8Encode(js);
    var key = randBytes(32), iv = randBytes(12);
    var e = aesGcmEncryptPure(key, iv, pt);
    return "." + bytesToB64(e.ct.concat(e.tag));
  }

  // ── transport ──
  async function resolveBase() {
    if (apiBase) return apiBase;
    if (config && config.base_url) {
      apiBase = String(config.base_url).replace(/\/+$/, "");
      return apiBase;
    }
    for (var i = 0; i < CONFIG_URLS.length; i++) {
      try {
        var txt = await api.fetchText(CONFIG_URLS[i], { "User-Agent": OKHTTP_UA, "Accept": "application/json" });
        var cfg = parseJsonLenient(txt || "null");
        if (cfg && cfg.cloudday) {
          apiBase = String(cfg.cloudday).replace(/\/+$/, "");
          return apiBase;
        }
      } catch (e) {}
    }
    apiBase = DEF_API;
    return apiBase;
  }
  function reqHeaders(extra) {
    var h = {
      "User-Agent": OKHTTP_UA,
      "Accept": "application/json",
      "firebase_id": adForgeToken(deviceId),
      "cloudflare-id": cloudflareId()
    };
    if (cookieJar) h["Cookie"] = cookieJar;
    if (extra) for (var k in extra) {
      if (Object.prototype.hasOwnProperty.call(extra, k)) h[k] = extra[k];
    }
    return h;
  }
  function respText(res) {
    if (!res) return "";
    if (typeof res.body === "string") return res.body;
    if (typeof res.text === "string") return res.text;
    return "";
  }
  async function apiCall(method, path, formFields) {
    var base = await resolveBase();
    var url = base + "/v3.8/api/" + path;
    var headers = reqHeaders(formFields ? { "Content-Type": "application/x-www-form-urlencoded" } : null);
    var body = null;
    if (formFields) {
      var parts = [];
      for (var k in formFields) {
        if (Object.prototype.hasOwnProperty.call(formFields, k)) parts.push(enc(k) + "=" + enc(formFields[k]));
      }
      body = parts.join("&");
    }
    var res;
    if (api.http) {
      var opts = { method: method, headers: headers };
      if (body != null) opts.body = body;
      res = await api.http(url, opts);
      if (!res || !res.ok) throw new Error("HTTP " + (res ? res.status : 0) + " " + path);
      rememberCookies(res);
      return respText(res);
    }
    if (method !== "GET") throw new Error("POST transport unavailable");
    return await api.fetchText(url, headers);
  }
  function apiEnvelope(txt) {
    // Mirrors ServerActivity.r(): plain {/[ passes through, otherwise the
    // payload is AES-256-CBC under md5(device id) and must decrypt to JSON.
    var t = sstr(txt).trim();
    if (!t) throw new Error("empty response");
    var c0 = t.charAt(0);
    if (c0 === "{" || c0 === "[") return parseJsonLenient(t);
    var dec = adDecryptResponse(t, deviceId);
    if (!dec) throw new Error("unreadable response");
    return parseJsonLenient(dec);
  }
  async function apiData(path, formFields, pick) {
    var j = apiEnvelope(await apiCall(formFields ? "POST" : "GET", path, formFields));
    if (j && j.blocked) return [];
    if (pick && j && Array.isArray(j[pick])) return j[pick];
    if (j && Array.isArray(j.data) && j.data.length) return j.data;
    if (Array.isArray(j)) return j;
    return [];
  }

  // ── mappers ──
  function itemOf(o) {
    o = o || {};
    var kind = sstr(o.type || "").toLowerCase();
    var id = sstr(o.id || "");
    if (!id) return null;
    var title = decodeEnt(o.name || o.title || "");
    if (!title) return null;
    var thumb = absUrl(o.poster || o.backdrop || "", DEF_API);
    if (kind === "episode") {
      var sid = sstr(o.tv_show_id || "");
      if (!sid) return null;
      return {
        title: decodeEnt(o.tv_show_name || "") + " - " + title,
        coverUrl: thumb,
        detailUrl: "animeday:serie:" + sid + ":" + enc(decodeEnt(o.tv_show_name || title)) + ":" + enc(thumb),
        contentType: "anime"
      };
    }
    var dk = (kind === "movie") ? "movie" : "serie";
    return {
      title: title,
      coverUrl: thumb,
      detailUrl: "animeday:" + dk + ":" + id + ":" + enc(title) + ":" + enc(thumb),
      contentType: "anime"
    };
  }
  function parseDetailUrl(url) {
    var m = String(url || "").match(/^animeday:(serie|movie):([^:]+):([^:]*):([^:]*)$/);
    if (!m) return null;
    var title = "", thumb = "";
    try { title = decodeURIComponent(m[3] || ""); } catch (e) {}
    try { thumb = decodeURIComponent(m[4] || ""); } catch (e) {}
    return { kind: m[1], id: m[2], title: title, thumb: thumb };
  }
  function parseEpUrl(url) {
    var m = String(url || "").match(/^animeday:ep:([^:]+):(serie|movie):([^:]+):([^:]*)$/);
    if (!m) return null;
    var title = "";
    try { title = decodeURIComponent(m[4] || ""); } catch (e) {}
    return { epId: m[1], kind: m[2], parentId: m[3], title: title };
  }
  function epUrl(epId, kind, parentId, title) {
    return "animeday:ep:" + epId + ":" + kind + ":" + parentId + ":" + enc(title);
  }
  function isDirectMedia(u) {
    return /\.(mp4|m3u8)([?#]|$)/i.test(sstr(u));
  }
  function serverHeaders(srv) {
    var h = { "User-Agent": OKHTTP_UA, "Referer": LANDING + "/" };
    if (srv) {
      if (srv.referer && sstr(srv.referer)) h["Referer"] = sstr(srv.referer);
      else if (srv.origin && sstr(srv.origin)) h["Referer"] = sstr(srv.origin);
      var sh = srv.headers;
      if (sh && typeof sh === "object") {
        for (var k in sh) {
          if (Object.prototype.hasOwnProperty.call(sh, k) && sstr(sh[k])) h[k] = sstr(sh[k]);
        }
      } else if (sh && sstr(sh)) {
        var txt = sstr(sh);
        var pairs = (txt.charAt(0) === "{") ? null : txt.split("||");
        if (pairs) {
          for (var i = 0; i < pairs.length; i++) {
            var idx = pairs[i].indexOf(":");
            if (idx > 0) h[pairs[i].substring(0, idx).trim()] = pairs[i].substring(idx + 1).trim();
          }
        } else {
          try {
            var jo = JSON.parse(txt);
            for (var k2 in jo) {
              if (Object.prototype.hasOwnProperty.call(jo, k2) && sstr(jo[k2])) h[k2] = sstr(jo[k2]);
            }
          } catch (e) {}
        }
      }
    }
    return h;
  }
  function serversFromList(list) {
    var out = [], seen = {};
    list = safeList(list);
    for (var i = 0; i < list.length; i++) {
      var sv = list[i] || {};
      var link = absUrl(sv.link || sv.url || sv.embedUrl || sv.file || "", DEF_API);
      if (!link) continue;
      var lk = link.toLowerCase();
      if (seen[lk]) continue;
      seen[lk] = true;
      var nm = decodeEnt(sv.name || sv.title || sv.label || "");
      if (!nm) nm = "سيرفر " + (out.length + 1);
      var direct = isDirectMedia(link);
      var h = serverHeaders(sv);
      var q = [{ label: nm, url: link, isDefault: true, headers: h }];
      var one = {
        id: "ad-" + out.length,
        name: nm,
        embedUrl: link,
        url: link,
        directUrl: link,
        type: direct ? "mp4" : "embed",
        quality: nm,
        qualities: q,
        selectedQualityIndex: 0,
        headers: h
      };
      if (sv.subtitle && sstr(sv.subtitle)) one.subtitle = absUrl(sv.subtitle, DEF_API);
      out.push(one);
    }
    return out;
  }

  // ── public API ──
  return {
    async getHomepageManga(args) {
      var page = parseInt((args && args.page) || 1, 10);
      if (!page || page < 1) page = 1;
      try {
        var rows = await apiData("home", null, "sections");
        var out = [], seen = {};
        for (var s = 0; s < rows.length; s++) {
          var sec = rows[s] || {};
          var items = safeList(sec.section_items || sec.items);
          for (var i = 0; i < items.length; i++) {
            var it = itemOf(items[i]);
            if (!it) continue;
            if (seen[it.detailUrl]) continue;
            seen[it.detailUrl] = true;
            out.push(it);
          }
        }
        return out;
      } catch (e) {
        return [];
      }
    },

    async search(args) {
      var q = sstr((args && (args.query || args.q)) || "").trim();
      if (!q) return [];
      var type = sstr((args && args.type) || "all").toLowerCase();
      if (type !== "serie" && type !== "movie") type = "all";
      try {
        var rows = await apiData("search", {
          title: q, type: type, sort: "", page: "1",
          year: "", category: "", genre: "", dub: ""
        });
        var out = [], seen = {};
        for (var i = 0; i < rows.length && out.length < 40; i++) {
          var it = itemOf(rows[i]);
          if (!it || seen[it.detailUrl]) continue;
          seen[it.detailUrl] = true;
          out.push(it);
        }
        return out;
      } catch (e) {
        return [];
      }
    },

    async getFilteredManga(args) {
      var g = sstr((args && (args.genre || args.type)) || "").trim();
      var page = parseInt((args && args.page) || 1, 10);
      if (!page || page < 1) page = 1;
      if (!g) return [];
      try {
        var fields = { title: "", type: "all", sort: "", page: String(page), year: "", category: "", genre: "", dub: "" };
        if (g === "أفلام" || g.toLowerCase() === "movie") fields.type = "movie";
        else if (g === "مسلسلات" || g.toLowerCase() === "serie") fields.type = "serie";
        else if (g === "مدبلج" || g.toLowerCase() === "dub") fields.dub = "1";
        else fields.genre = g;
        var rows = await apiData("search", fields);
        var out = [], seen = {};
        for (var i = 0; i < rows.length; i++) {
          var it = itemOf(rows[i]);
          if (!it || seen[it.detailUrl]) continue;
          seen[it.detailUrl] = true;
          out.push(it);
        }
        return out;
      } catch (e) {
        return [];
      }
    },

    async getMangaDetails(args) {
      var url = sstr((args && args.url) || "");
      var d = parseDetailUrl(url);
      if (!d) throw new Error("bad animeday url");
      var fallback = {
        title: d.title, coverUrl: d.thumb, description: "", genres: [],
        status: "", year: "", chapters: [], originalUrl: url,
        hasMoreChapters: false, lastFetchedPage: 1, contentType: "anime"
      };
      try {
        if (d.kind === "movie") {
          var mj = apiEnvelope(await apiCall("GET", "movie/" + enc(d.id)));
          var mv = (mj && !Array.isArray(mj) && mj.data && !Array.isArray(mj.data)) ? mj.data : (mj || {});
          if (Array.isArray(mv)) mv = {};
          var mgenres = [];
          var mcats = safeList(mv.categories);
          for (var ci = 0; ci < mcats.length; ci++) {
            if (mcats[ci] && mcats[ci].name) mgenres.push(decodeEnt(mcats[ci].name));
          }
          var mgens = safeList(mv.genres);
          for (var gi = 0; gi < mgens.length; gi++) {
            if (mgens[gi] && mgens[gi].name) mgenres.push(decodeEnt(mgens[gi].name));
          }
          return {
            title: decodeEnt(mv.name) || d.title,
            coverUrl: absUrl(mv.poster || mv.backdrop || "", DEF_API) || d.thumb,
            description: decodeEnt(mv.overview || ""),
            genres: mgenres,
            status: decodeEnt(mv.status || ""),
            year: sstr(mv.year || mv.release_date || ""),
            chapters: [{
              number: 1, title: "الفيلم", views: parseInt(mv.views || 0, 10) || 0,
              url: epUrl(d.id, "movie", d.id, "الفيلم"),
              isLocked: false, date: sstr(mv.release_date || mv.air_date || "")
            }],
            originalUrl: url, hasMoreChapters: false, lastFetchedPage: 1, contentType: "anime"
          };
        }
        var sj = apiEnvelope(await apiCall("GET", "series/" + enc(d.id)));
        var sv = (sj && !Array.isArray(sj) && sj.data && !Array.isArray(sj.data)) ? sj.data : (sj || {});
        if (Array.isArray(sv)) sv = {};
        var sgenres = [];
        var scats = safeList(sv.categories);
        for (var sci = 0; sci < scats.length; sci++) {
          if (scats[sci] && scats[sci].name) sgenres.push(decodeEnt(scats[sci].name));
        }
        var sgens = safeList(sv.genres);
        for (var sgi = 0; sgi < sgens.length; sgi++) {
          if (sgens[sgi] && sgens[sgi].name) sgenres.push(decodeEnt(sgens[sgi].name));
        }
        var seasons = [];
        try {
          var epj = apiEnvelope(await apiCall("GET", "series/" + enc(d.id) + "/episodes"));
          if (epj && !epj.blocked) seasons = safeList(epj.seasons);
        } catch (e) { seasons = []; }
        var eps = [];
        for (var si = 0; si < seasons.length; si++) {
          var sn = seasons[si] || {};
          var sno = parseInt(sn.season_number || sn.number || (si + 1), 10) || (si + 1);
          var sname = decodeEnt(sn.title || sn.name || ("الموسم " + sno));
          var el = safeList(sn.episodes);
          for (var ei = 0; ei < el.length; ei++) {
            var ep = el[ei] || {};
            var epid = sstr(ep.id || "");
            if (!epid) continue;
            var eno = parseInt(ep.episode_number || ep.number || 0, 10);
            var ename = decodeEnt(ep.name || ep.title || "");
            eps.push({
              sno: sno, sname: sname, eno: eno || (ei + 1), id: epid,
              title: ename || ("الحلقة " + (eno || (ei + 1))),
              cover: absUrl(ep.cover || ep.image || ep.poster || "", DEF_API),
              date: sstr(ep.air_date || ""),
              views: parseInt(ep.views || 0, 10) || 0
            });
          }
        }
        eps.sort(function (a, b) {
          if (a.sno !== b.sno) return b.sno - a.sno;
          return b.eno - a.eno;
        });
        var chapters = [];
        for (var xi = 0; xi < eps.length; xi++) {
          var ce = eps[xi];
          chapters.push({
            number: ce.sno * 10000 + ce.eno,
            title: (eps.length > 0 && seasons.length > 1 ? ce.sname + " - " : "") + ce.title,
            views: ce.views,
            url: epUrl(ce.id, "serie", d.id, ce.title),
            isLocked: false,
            date: ce.date,
            thumbnailUrl: ce.cover
          });
        }
        return {
          title: decodeEnt(sv.name) || d.title,
          coverUrl: absUrl(sv.poster || sv.backdrop || "", DEF_API) || d.thumb,
          description: decodeEnt(sv.overview || ""),
          genres: sgenres,
          status: decodeEnt(sv.status || ""),
          year: sstr(sv.year || sv.release_date || ""),
          chapters: chapters,
          originalUrl: url, hasMoreChapters: false, lastFetchedPage: 1, contentType: "anime"
        };
      } catch (e) {
        return fallback;
      }
    },

    async fetchMoreChapters(args) {
      return null;
    },

    async getChapterPages(args) {
      return [];
    },

    async getEpisodeServers(args) {
      var url = sstr((args && args.url) || "");
      var ep = parseEpUrl(url);
      if (!ep) return [];
      try {
        var path = (ep.kind === "movie") ? ("movie/" + enc(ep.epId) + "/servers") : ("episode/" + enc(ep.epId) + "/servers");
        return serversFromList(await apiData(path));
      } catch (e) {
        return [];
      }
    },

    async getChapterContent(args) {
      var url = sstr((args && args.url) || "");
      var ep = parseEpUrl(url);
      if (!ep) return { kind: "video", servers: [] };
      try {
        var path = (ep.kind === "movie") ? ("movie/" + enc(ep.epId) + "/servers") : ("episode/" + enc(ep.epId) + "/servers");
        return { kind: "video", servers: serversFromList(await apiData(path)) };
      } catch (e) {
        return { kind: "video", servers: [] };
      }
    },

    async resolveServer(args) {
      var u = absUrl((args && (args.serverUrl || args.url || args.directUrl)) || "", DEF_API);
      if (!u) return null;
      return { url: u, directUrl: u };
    },

    async getGenresAndTypes() {
      var fallback = ["مسلسلات", "أفلام", "مدبلج", "مترجم"];
      try {
        var rows = await apiData("allcategories");
        var out = [];
        for (var i = 0; i < rows.length; i++) {
          var nm = decodeEnt((rows[i] || {}).name || "");
          if (nm && out.indexOf(nm) === -1) out.push(nm);
        }
        if (out.length) return { genres: out, types: ["anime"] };
      } catch (e) {}
      return { genres: fallback, types: ["anime"] };
    },

    getVideoHeaders(args) {
      return {
        "User-Agent": OKHTTP_UA,
        "Referer": LANDING + "/",
        "Accept": "*/*",
        "Accept-Language": "ar,en-US;q=0.9,en;q=0.8"
      };
    },

    getImageHeaders(args) {
      return {
        "User-Agent": OKHTTP_UA,
        "Referer": LANDING + "/",
        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "Accept-Language": "ar,en-US;q=0.9,en;q=0.8"
      };
    },

    sanitizeCoverUrl(args) {
      return absUrl((args && args.url) || "", DEF_API);
    }
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { createSource };
}
