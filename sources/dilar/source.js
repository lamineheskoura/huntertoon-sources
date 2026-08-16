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
    return JSON.parse(text);
  }

  // ==================== UTILS ====================
  function toBigInt(bytes) {
    var v = 0n;
    for (var i = 0; i < bytes.length; i++) v = (v << 8n) | BigInt(bytes[i]);
    return v;
  }

  function toBytes(v, len) {
    var out = new Uint8Array(len);
    for (var i = len - 1; i >= 0; i--) { out[i] = Number(v & 0xffn); v >>= 8n; }
    return out;
  }

  function concatBytes() {
    var total = 0;
    for (var i = 0; i < arguments.length; i++) total += arguments[i].length;
    var out = new Uint8Array(total);
    var off = 0;
    for (var j = 0; j < arguments.length; j++) {
      out.set(arguments[j], off);
      off += arguments[j].length;
    }
    return out;
  }

  var B64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

  function b64decode(s) {
    s = String(s || "").replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    var bin = "";
    for (var i = 0; i < s.length; i += 4) {
      var chunk = s.slice(i, i + 4);
      var a = B64_CHARS.indexOf(chunk[0]);
      var b = B64_CHARS.indexOf(chunk[1]);
      var c = chunk[2] === "=" ? -1 : B64_CHARS.indexOf(chunk[2]);
      var d = chunk[3] === "=" ? -1 : B64_CHARS.indexOf(chunk[3]);
      if (a < 0 || b < 0) continue;
      bin += String.fromCharCode((a << 2) | (b >> 4));
      if (c >= 0) bin += String.fromCharCode(((b & 15) << 4) | (c >> 2));
      if (d >= 0) bin += String.fromCharCode(((c & 3) << 6) | d);
    }
    var out = new Uint8Array(bin.length);
    for (var j = 0; j < bin.length; j++) out[j] = bin.charCodeAt(j);
    return out;
  }

  function b64url(bytes) {
    var s = "";
    for (var i = 0; i < bytes.length; i += 3) {
      var b0 = bytes[i];
      var b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
      var b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
      s += B64_CHARS[b0 >> 2];
      s += B64_CHARS[((b0 & 3) << 4) | (b1 >> 4)];
      if (i + 1 < bytes.length) s += B64_CHARS[((b1 & 15) << 2) | (b2 >> 6)];
      if (i + 2 < bytes.length) s += B64_CHARS[b2 & 63];
    }
    return s.replace(/\+/g, "-").replace(/\//g, "_");
  }

  function utf8Encode(str) {
    str = String(str);
    var bytes = [];
    for (var i = 0; i < str.length; i++) {
      var code = str.charCodeAt(i);
      if (code < 0x80) {
        bytes.push(code);
      } else if (code < 0x800) {
        bytes.push(0xc0 | (code >> 6), 0x80 | (code & 63));
      } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < str.length) {
        var lo = str.charCodeAt(i + 1);
        if (lo >= 0xdc00 && lo <= 0xdfff) {
          var cp = 0x10000 + ((code - 0xd800) << 10) + (lo - 0xdc00);
          bytes.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
          i++;
        } else {
          bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
        }
      } else {
        bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
      }
    }
    return new Uint8Array(bytes);
  }

  function utf8Decode(bytes) {
    var out = "";
    for (var i = 0; i < bytes.length; i++) {
      var b = bytes[i];
      if (b < 0x80) {
        out += String.fromCharCode(b);
      } else if ((b & 0xe0) === 0xc0 && i + 1 < bytes.length) {
        out += String.fromCharCode(((b & 31) << 6) | (bytes[++i] & 63));
      } else if ((b & 0xf0) === 0xe0 && i + 2 < bytes.length) {
        out += String.fromCharCode(((b & 15) << 12) | ((bytes[++i] & 63) << 6) | (bytes[++i] & 63));
      } else if ((b & 0xf8) === 0xf0 && i + 3 < bytes.length) {
        var cp = ((b & 7) << 18) | ((bytes[++i] & 63) << 12) | ((bytes[++i] & 63) << 6) | (bytes[++i] & 63);
        out += String.fromCodePoint(cp);
      }
    }
    return out;
  }

  function hexToBytes(hex) {
    var out = new Uint8Array(hex.length / 2);
    for (var i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return out;
  }

  function hexBytes(u8) {
    var s = "";
    for (var i = 0; i < u8.length; i++) s += u8[i].toString(16).padStart(2, "0");
    return s;
  }

  function len2Bytes(u8) {
    return new Uint8Array([(u8.length >> 8) & 0xff, u8.length & 0xff]);
  }

  // ==================== SHA-256 ====================
  var K256 = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ]);

  function rotr(x, n) { return ((x >>> n) | (x << (32 - n))) >>> 0; }

  function sha256(msg) {
    if (typeof msg === "string") msg = utf8Encode(msg);
    var ml = msg.length;
    var bitLen = ml * 8;
    var padLen = ((ml + 1 + 8 + 63) >> 6) << 6;
    var buf = new Uint8Array(padLen);
    buf.set(msg);
    buf[ml] = 0x80;
    var dv = new DataView(buf.buffer);
    dv.setUint32(padLen - 8, Math.floor(bitLen / 0x100000000));
    dv.setUint32(padLen - 4, bitLen >>> 0);
    var W = new Uint32Array(64);
    var H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    for (var off = 0; off < padLen; off += 64) {
      for (var i = 0; i < 16; i++) W[i] = dv.getUint32(off + i * 4);
      for (var i2 = 16; i2 < 64; i2++) {
        var s0 = rotr(W[i2 - 15], 7) ^ rotr(W[i2 - 15], 18) ^ (W[i2 - 15] >>> 3);
        var s1 = rotr(W[i2 - 2], 17) ^ rotr(W[i2 - 2], 19) ^ (W[i2 - 2] >>> 10);
        W[i2] = (W[i2 - 16] + s0 + W[i2 - 7] + s1) >>> 0;
      }
      var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (var j = 0; j < 64; j++) {
        var S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        var ch = (e & f) ^ (~e & g);
        var t1 = (h + S1 + ch + K256[j] + W[j]) >>> 0;
        var S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        var maj = (a & b) ^ (a & c) ^ (b & c);
        var t2 = (S0 + maj) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
      H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
    }
    var out = new Uint8Array(32);
    var odv = new DataView(out.buffer);
    for (var k = 0; k < 8; k++) odv.setUint32(k * 4, H[k]);
    return out;
  }

  function hmacSha256(key, msg) {
    if (typeof msg === "string") msg = utf8Encode(msg);
    if (typeof key === "string") key = utf8Encode(key);
    var block = 64;
    if (key.length > block) key = sha256(key);
    var ipad = new Uint8Array(block);
    var opad = new Uint8Array(block);
    for (var i = 0; i < block; i++) {
      ipad[i] = (key[i] || 0) ^ 0x36;
      opad[i] = (key[i] || 0) ^ 0x5c;
    }
    var inner = new Uint8Array(block + msg.length);
    inner.set(ipad);
    inner.set(msg, block);
    var innerHash = sha256(inner);
    var outer = new Uint8Array(block + 32);
    outer.set(opad);
    outer.set(innerHash, block);
    return sha256(outer);
  }

  function hkdf(ikm, salt, info, length) {
    if (typeof salt === "string") salt = utf8Encode(salt);
    if (typeof info === "string") info = utf8Encode(info);
    if (!salt || !salt.length) salt = new Uint8Array(32);
    var prk = hmacSha256(salt, ikm);
    var out = [];
    var t = new Uint8Array(0);
    var counter = 1;
    while (out.length < length) {
      var input = new Uint8Array(t.length + info.length + 1);
      input.set(t);
      input.set(info, t.length);
      input[t.length + info.length] = counter;
      t = hmacSha256(prk, input);
      for (var i = 0; i < t.length; i++) out.push(t[i]);
      counter++;
    }
    return new Uint8Array(out.slice(0, length));
  }

  // ==================== AES ====================
  var SBOX = new Uint8Array([
    0x63, 0x7c, 0x77, 0x7b, 0xf2, 0x6b, 0x6f, 0xc5, 0x30, 0x01, 0x67, 0x2b, 0xfe, 0xd7, 0xab, 0x76,
    0xca, 0x82, 0xc9, 0x7d, 0xfa, 0x59, 0x47, 0xf0, 0xad, 0xd4, 0xa2, 0xaf, 0x9c, 0xa4, 0x72, 0xc0,
    0xb7, 0xfd, 0x93, 0x26, 0x36, 0x3f, 0xf7, 0xcc, 0x34, 0xa5, 0xe5, 0xf1, 0x71, 0xd8, 0x31, 0x15,
    0x04, 0xc7, 0x23, 0xc3, 0x18, 0x96, 0x05, 0x9a, 0x07, 0x12, 0x80, 0xe2, 0xeb, 0x27, 0xb2, 0x75,
    0x09, 0x83, 0x2c, 0x1a, 0x1b, 0x6e, 0x5a, 0xa0, 0x52, 0x3b, 0xd6, 0xb3, 0x29, 0xe3, 0x2f, 0x84,
    0x53, 0xd1, 0x00, 0xed, 0x20, 0xfc, 0xb1, 0x5b, 0x6a, 0xcb, 0xbe, 0x39, 0x4a, 0x4c, 0x58, 0xcf,
    0xd0, 0xef, 0xaa, 0xfb, 0x43, 0x4d, 0x33, 0x85, 0x45, 0xf9, 0x02, 0x7f, 0x50, 0x3c, 0x9f, 0xa8,
    0x51, 0xa3, 0x40, 0x8f, 0x92, 0x9d, 0x38, 0xf5, 0xbc, 0xb6, 0xda, 0x21, 0x10, 0xff, 0xf3, 0xd2,
    0xcd, 0x0c, 0x13, 0xec, 0x5f, 0x97, 0x44, 0x17, 0xc4, 0xa7, 0x7e, 0x3d, 0x64, 0x5d, 0x19, 0x73,
    0x60, 0x81, 0x4f, 0xdc, 0x22, 0x2a, 0x90, 0x88, 0x46, 0xee, 0xb8, 0x14, 0xde, 0x5e, 0x0b, 0xdb,
    0xe0, 0x32, 0x3a, 0x0a, 0x49, 0x06, 0x24, 0x5c, 0xc2, 0xd3, 0xac, 0x62, 0x91, 0x95, 0xe4, 0x79,
    0xe7, 0xc8, 0x37, 0x6d, 0x8d, 0xd5, 0x4e, 0xa9, 0x6c, 0x56, 0xf4, 0xea, 0x65, 0x7a, 0xae, 0x08,
    0xba, 0x78, 0x25, 0x2e, 0x1c, 0xa6, 0xb4, 0xc6, 0xe8, 0xdd, 0x74, 0x1f, 0x4b, 0xbd, 0x8b, 0x8a,
    0x70, 0x3e, 0xb5, 0x66, 0x48, 0x03, 0xf6, 0x0e, 0x61, 0x35, 0x57, 0xb9, 0x86, 0xc1, 0x1d, 0x9e,
    0xe1, 0xf8, 0x98, 0x11, 0x69, 0xd9, 0x8e, 0x94, 0x9b, 0x1e, 0x87, 0xe9, 0xce, 0x55, 0x28, 0xdf,
    0x8c, 0xa1, 0x89, 0x0d, 0xbf, 0xe6, 0x42, 0x68, 0x41, 0x99, 0x2d, 0x0f, 0xb0, 0x54, 0xbb, 0x16
  ]);

  function expandKey(key) {
    var nk = key.length / 4;
    var nr = nk + 6;
    var w = [];
    for (var i = 0; i < nk; i++) {
      w.push([key[i * 4], key[i * 4 + 1], key[i * 4 + 2], key[i * 4 + 3]]);
    }
    var rcon = 1;
    for (var i2 = nk; i2 < 4 * (nr + 1); i2++) {
      var temp = w[i2 - 1].slice();
      if (i2 % nk === 0) {
        temp = [SBOX[temp[1]] ^ rcon, SBOX[temp[2]], SBOX[temp[3]], SBOX[temp[0]]];
        rcon = ((rcon << 1) ^ (rcon & 0x80 ? 0x1b : 0)) & 0xff;
      } else if (nk > 6 && i2 % nk === 4) {
        temp = [SBOX[temp[0]], SBOX[temp[1]], SBOX[temp[2]], SBOX[temp[3]]];
      }
      var prev = w[i2 - nk];
      w.push([prev[0] ^ temp[0], prev[1] ^ temp[1], prev[2] ^ temp[2], prev[3] ^ temp[3]]);
    }
    return { w: w, nr: nr };
  }

  function gm(a, b) {
    var p = 0;
    for (var i = 0; i < 8; i++) {
      if (b & 1) p ^= a;
      var hi = a & 0x80;
      a = (a << 1) & 0xff;
      if (hi) a ^= 0x1b;
      b >>= 1;
    }
    return p;
  }

  function addRoundKey(s, w, r) {
    for (var c = 0; c < 4; c++)
      for (var i = 0; i < 4; i++) s[c * 4 + i] ^= w[r * 4 + c][i];
  }

  function shiftRows(s) {
    var t = s.slice();
    for (var r = 1; r < 4; r++)
      for (var c = 0; c < 4; c++) s[c * 4 + r] = t[((c + r) % 4) * 4 + r];
  }

  function mixColumns(s) {
    for (var c = 0; c < 4; c++) {
      var a = s[c * 4], b = s[c * 4 + 1], cc = s[c * 4 + 2], d = s[c * 4 + 3];
      s[c * 4] = gm(a, 2) ^ gm(b, 3) ^ cc ^ d;
      s[c * 4 + 1] = a ^ gm(b, 2) ^ gm(cc, 3) ^ d;
      s[c * 4 + 2] = a ^ b ^ gm(cc, 2) ^ gm(d, 3);
      s[c * 4 + 3] = gm(a, 3) ^ b ^ cc ^ gm(d, 2);
    }
  }

  function encryptBlock(ek, state) {
    var w = ek.w, nr = ek.nr;
    var s = state.slice();
    addRoundKey(s, w, 0);
    for (var r = 1; r < nr; r++) {
      for (var i = 0; i < 16; i++) s[i] = SBOX[s[i]];
      shiftRows(s);
      mixColumns(s);
      addRoundKey(s, w, r);
    }
    for (var i2 = 0; i2 < 16; i2++) s[i2] = SBOX[s[i2]];
    shiftRows(s);
    addRoundKey(s, w, nr);
    return s;
  }

  function gmul(x, y) {
    var z = 0n;
    var X = x, Y = y;
    for (var i = 0; i < 128; i++) {
      if (((X >> BigInt(127 - i)) & 1n) === 1n) z ^= Y;
      if ((Y & 1n) === 1n) Y = (Y >> 1n) ^ 0xe1000000000000000000000000000000n;
      else Y >>= 1n;
    }
    return z;
  }

  function aesGcmDecrypt(keyBytes, iv, ciphertextWithTag) {
    var ek = expandKey(keyBytes);
    var H = toBigInt(encryptBlock(ek, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
    var n = iv.length === 12
      ? (toBigInt(iv) << 32n) | 1n
      : (function () {
          var blocks = Math.ceil(iv.length / 16);
          var padded = new Uint8Array(blocks * 16);
          padded.set(iv);
          var lenBlock = new Uint8Array(16);
          var dv = new DataView(lenBlock.buffer);
          dv.setBigUint64(8, BigInt(blocks * 16 * 8));
          var acc = 0n;
          for (var i = 0; i < blocks; i++) {
            acc ^= toBigInt(padded.subarray(i * 16, i * 16 + 16));
            acc = gmul(acc, H);
          }
          acc ^= toBigInt(lenBlock);
          return gmul(acc, H);
        })();
    var J0 = toBytes(n, 16);
    var cLen = ciphertextWithTag.length - 16;
    var c = ciphertextWithTag.subarray(0, cLen);
    var tag = ciphertextWithTag.subarray(cLen);
    var plain = new Uint8Array(cLen);
    var counter = n;
    var one = 1n;
    for (var off = 0; off < cLen; off += 16) {
      counter = (counter + one) & ((1n << 128n) - 1n);
      var ks = encryptBlock(ek, toBytes(counter, 16));
      for (var i = 0; i < 16 && off + i < cLen; i++) {
        plain[off + i] = c[off + i] ^ ks[i];
      }
    }
    var blocks2 = Math.ceil(cLen / 16);
    var padded2 = new Uint8Array(blocks2 * 16);
    padded2.set(c);
    var acc2 = 0n;
    for (var i2 = 0; i2 < blocks2; i2++) {
      acc2 ^= toBigInt(padded2.subarray(i2 * 16, i2 * 16 + 16));
      acc2 = gmul(acc2, H);
    }
    var lenBlock2 = new Uint8Array(16);
    var dv2 = new DataView(lenBlock2.buffer);
    dv2.setBigUint64(8, BigInt(cLen * 8));
    acc2 ^= toBigInt(lenBlock2);
    acc2 = gmul(acc2, H);
    var s = encryptBlock(ek, J0);
    var expected = toBigInt(s) ^ acc2;
    var actual = toBigInt(tag);
    if (expected !== actual) throw new Error("GCM tag mismatch");
    return plain;
  }

  // ==================== P-256 ====================
  var P = 0xffffffff00000001000000000000000000000000ffffffffffffffffffffffffn;
  var N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
  var GX = 0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296n;
  var GY = 0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5n;

  function mod(a, m) {
    var r = a % m;
    return r < 0n ? r + m : r;
  }

  function modInv(a, m) {
    var t = 0n, nt = 1n, r = m, nr = mod(a, m);
    while (nr !== 0n) {
      var q = r / nr;
      var tt = nt, ntt = t - q * nt;
      t = tt; nt = ntt;
      var rr = nr, nrr = r - q * nr;
      r = rr; nr = nrr;
    }
    if (r !== 1n) throw new Error("not invertible");
    return mod(t, m);
  }

  function pointDouble(P1) {
    var X1 = P1[0], Y1 = P1[1], Z1 = P1[2];
    var A = mod(X1 * X1, P);
    var B = mod(Y1 * Y1, P);
    var C = mod(B * B, P);
    var X1B = mod(X1 + B, P);
    var D = mod(2n * (mod(X1B * X1B, P) - A - C), P);
    var E = mod(3n * (A - mod(Z1 * Z1 * Z1 * Z1, P)), P);
    var F = mod(E * E, P);
    var X3 = mod(F - 2n * D, P);
    var Y3 = mod(E * (D - X3) - 8n * C, P);
    var Z3 = mod(2n * Y1 * Z1, P);
    return [X3, Y3, Z3];
  }

  function pointAdd(P1, P2) {
    var X1 = P1[0], Y1 = P1[1], Z1 = P1[2];
    var X2 = P2[0], Y2 = P2[1], Z2 = P2[2];
    if (Z1 === 0n) return P2;
    if (Z2 === 0n) return P1;
    var Z1Z1 = mod(Z1 * Z1, P);
    var Z2Z2 = mod(Z2 * Z2, P);
    var U1 = mod(X1 * Z2Z2, P);
    var U2 = mod(X2 * Z1Z1, P);
    var S1 = mod(Y1 * Z2 * Z2Z2, P);
    var S2 = mod(Y2 * Z1 * Z1Z1, P);
    if (U1 === U2) {
      if (S1 !== S2) return [0n, 1n, 0n];
      return pointDouble(P1);
    }
    var H = mod(U2 - U1, P);
    var R = mod(S2 - S1, P);
    var HH = mod(H * H, P);
    var HHH = mod(H * HH, P);
    var V = mod(U1 * HH, P);
    var X3 = mod(R * R - HHH - 2n * V, P);
    var Y3 = mod(R * (V - X3) - S1 * HHH, P);
    var Z3 = mod(Z1 * Z2 * H, P);
    return [X3, Y3, Z3];
  }

  function scalarMult(k, point) {
    var Q = [0n, 1n, 0n];
    var R = point;
    while (k > 0n) {
      if ((k & 1n) === 1n) Q = pointAdd(Q, R);
      R = pointDouble(R);
      k >>= 1n;
    }
    return Q;
  }

  function toAffine(P1) {
    var X = P1[0], Y = P1[1], Z = P1[2];
    var zi = modInv(Z, P);
    var zi2 = mod(zi * zi, P);
    var zi3 = mod(zi2 * zi, P);
    return [mod(X * zi2, P), mod(Y * zi3, P)];
  }

  function ecdhShared(priv, epkBytes) {
    var off = epkBytes.length === 65 ? 1 : 0;
    var x = toBigInt(epkBytes.subarray(off, off + 32));
    var y = toBigInt(epkBytes.subarray(off + 32, off + 64));
    var Q = scalarMult(priv, [x, y, 1n]);
    var A = toAffine(Q);
    return toBytes(A[0], 32);
  }

  function randomScalar() {
    var b = [];
    for (var i = 0; i < 32; i++) b.push(Math.floor(Math.random() * 256));
    var v = 0n;
    for (var j = 0; j < 32; j++) v = (v << 8n) | BigInt(b[j]);
    v = mod(v, N - 1n) + 1n;
    return v;
  }

  function makeSession() {
    var priv = randomScalar();
    var pub = toAffine(scalarMult(priv, [GX, GY, 1n]));
    var raw = new Uint8Array(65);
    raw[0] = 4;
    var xb = toBytes(pub[0], 32);
    var yb = toBytes(pub[1], 32);
    raw.set(xb, 1);
    raw.set(yb, 33);
    var privHex = "";
    var pb = toBytes(priv, 32);
    for (var i = 0; i < 32; i++) privHex += pb[i].toString(16).padStart(2, "0");
    return { privHex: privHex, pubB64: b64url(raw) };
  }

  // ==================== ECIES (dilar v1..v8) ====================
  function decryptEnvelope(env, privHex, pubB64) {
    var priv = BigInt("0x" + privHex);
    var pubRaw = b64decode(pubB64);
    var epk = b64decode(env.epk);
    var iv = b64decode(env.iv);
    var shared = ecdhShared(priv, epk);
    var e = env.e;
    var infoBytes;
    var saltBytes;
    if (env.v === 1) {
      infoBytes = utf8Encode("dilar.response.ecies.v1|" + e);
      saltBytes = concatBytes(pubRaw, epk);
    } else if (env.v === 2) {
      infoBytes = utf8Encode("dilar.response.ecies.v2|" + e);
      saltBytes = concatBytes(epk, pubRaw);
    } else if (env.v === 3) {
      infoBytes = utf8Encode("dilar.response.ecies.v3|" + e);
      saltBytes = sha256(concatBytes(epk, pubRaw));
    } else if (env.v === 4) {
      infoBytes = utf8Encode("dilar.response.ecies.v4|" + e + "|" + b64url(iv));
      saltBytes = sha256(concatBytes(pubRaw, epk, iv));
    } else if (env.v === 5) {
      infoBytes = utf8Encode("dilar.response.ecies.v5|" + e);
      saltBytes = hmacSha256(iv, concatBytes(epk, pubRaw));
    } else if (env.v === 6) {
      infoBytes = utf8Encode("dilar.response.ecies.v6|" + e + "|" + b64url(iv));
      saltBytes = sha256(concatBytes(sha256(pubRaw), sha256(epk), iv));
    } else if (env.v === 7) {
      infoBytes = utf8Encode("dilar.response.ecies.v7|" + e);
      saltBytes = hkdf(iv, epk, "dilar.response.ecies.v7.salt", 32);
    } else if (env.v === 8) {
      infoBytes = utf8Encode("dilar.response.ecies.v8|" + e + "|" + hexBytes(iv));
      saltBytes = sha256(concatBytes(len2Bytes(pubRaw), pubRaw, len2Bytes(epk), epk, len2Bytes(iv), iv));
    } else {
      throw new Error("unknown envelope v " + env.v);
    }
    var key = hkdf(shared, saltBytes, infoBytes, 32);
    var ct = b64decode(env.ct);
    var tag = b64decode(env.tag);
    var combined = new Uint8Array(ct.length + tag.length);
    combined.set(ct);
    combined.set(tag, ct.length);
    var pt = aesGcmDecrypt(key, iv, combined);
    return JSON.parse(utf8Decode(pt));
  }

  // assets_enc (dilar.media.payload.v1): {v:1, k, e, s, iv, ct, tag}
  function decryptAssetsEnc(ae, unlockToken, mediaToken) {
    var ikm = utf8Encode(String(unlockToken) + "|" + String(mediaToken));
    var salt = b64decode(ae.s);
    var info = utf8Encode("dilar.media.payload.v1|" + ae.e);
    var key = hkdf(ikm, salt, info, 32);
    var iv = b64decode(ae.iv);
    var ct = b64decode(ae.ct);
    var tag = b64decode(ae.tag);
    var combined = new Uint8Array(ct.length + tag.length);
    combined.set(ct);
    combined.set(tag, ct.length);
    var pt = aesGcmDecrypt(key, iv, combined);
    return JSON.parse(utf8Decode(pt));
  }

  // ==================== DILAR API ====================
  var passCache = {};
  var mediaCache = {};

  function nowMs() {
    return typeof Date.now === "function" ? Date.now() : new Date().getTime();
  }

  async function getPassToken(relId) {
    var cached = passCache[relId];
    if (cached && cached.exp > nowMs()) return cached.token;
    var res = await api.http(apiBase + "/chapters/" + relId + "/unlock/free", {
      method: "POST",
      headers: mergeHeaders({ "Content-Type": "application/json" }),
      body: "{}"
    });
    var body = res && res.ok ? String(res.body || "") : "";
    var data = {};
    try { data = JSON.parse(body); } catch (e) { }
    var token = String(data.token || "");
    if (!token) throw new Error("unlock/free failed for " + relId);
    var ttl = Number(data.ttl_seconds) || 1800;
    passCache[relId] = { token: token, exp: nowMs() + (ttl - 60) * 1000 };
    return token;
  }

  async function fetchDetail(relId, session, pass) {
    var extra = {
      "X-Crypto-Caps": "1,2,3,4,5,6,7,8",
      "X-DH-Pub": session.pubB64
    };
    if (pass) extra["X-Unlock-Free-Chapter"] = pass;
    var res = await api.http(apiBase + "/chapters/" + relId, {
      method: "GET",
      headers: mergeHeaders(extra)
    });
    var body = res && res.ok ? String(res.body || "") : "";
    var env = {};
    try { env = JSON.parse(body); } catch (e) { }
    if (!env || !env.v || !env.epk || !env.ct) {
      throw new Error("chapter detail failed for " + relId);
    }
    return decryptEnvelope(env, session.privHex, session.pubB64);
  }

  async function getChapterDetail(relId) {
    var session = makeSession();
    var cached = passCache[relId];
    var payload = await fetchDetail(relId, session, cached && cached.exp > nowMs() ? cached.token : null);
    if (payload && payload.free_pass_required === true) {
      var pass = await getPassToken(relId);
      payload = await fetchDetail(relId, session, pass);
    }
    return payload;
  }

  function mediaUrl(storageKey, file, mediaToken) {
    return baseUrl + "/uploads/releases/" + storageKey + "/hq/" + file + "?t=" + mediaToken;
  }

  async function getChapterImages(relId, passToken) {
    var detail = await getChapterDetail(relId);
    var storageKey = String(detail.storage_key || "");
    var mediaToken = String(detail.media_token || "");
    var pages = Array.isArray(detail.pages) && detail.pages.length ? detail.pages : [];
    if (!pages.length && Array.isArray(detail.webp_pages) && detail.webp_pages.length) pages = detail.webp_pages;
    if (!pages.length && detail.assets_enc) {
      var pass = passToken || (passCache[relId] ? passCache[relId].token : null);
      try {
        var assets = decryptAssetsEnc(detail.assets_enc, pass, mediaToken);
        if (Array.isArray(assets)) pages = assets;
      } catch (e) { }
    }
    if (!storageKey || !mediaToken || !pages.length) return [];
    var urls = [];
    for (var i = 0; i < pages.length; i++) {
      var file = String((pages[i] && (pages[i].url || pages[i].webp_url)) || "").trim();
      if (!file) continue;
      urls.push(mediaUrl(storageKey, file, mediaToken));
    }
    return urls;
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

  function getSeriesId(url) {
    var match = String(url || "").match(/\/(?:series|reader|novel|chapter)\/(\d+)/);
    return match ? match[1] : "";
  }

  function getRelId(urlOrId) {
    var value = String(urlOrId || "");
    if (/^\d+$/.test(value)) return value;
    var apiMatch = value.match(/\/api\/chapters\/(\d+)/);
    if (apiMatch) return apiMatch[1];
    var reader = value.match(/\/reader\/\d+\/(\d+)/);
    if (reader) return reader[1];
    var tail = value.match(/\/(\d+)\/?$/);
    return tail ? tail[1] : value;
  }

  async function fetchChapters(seriesId) {
    var data = await getJson(apiBase + "/series/" + seriesId + "/chapters");
    var list = Array.isArray(data.chapters) ? data.chapters : [];
    var chapters = [];
    for (var i = 0; i < list.length; i++) {
      var ch = list[i];
      var releases = Array.isArray(ch.releases) ? ch.releases : [];
      if (!releases.length) continue;
      var relId = String(releases[0].id || "");
      if (!relId) continue;
      var number = formatChapter(ch.chapter || "0");
      var title = String(ch.title || "").trim();
      if (!title) title = "الفصل " + number;
      chapters.push({
        number: number,
        title: title,
        views: 0,
        url: apiBase + "/chapters/" + relId,
        isLocked: false,
        date: String(ch.created_at || "")
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
      var seriesId = getSeriesId(url);
      if (!seriesId) throw new Error("Invalid Dilar URL: " + url);
      var series = await getJson(apiBase + "/series/" + seriesId);
      var type = detectContentType(series);
      var genres = Array.isArray(series.genres)
        ? series.genres.map(function (g) { return String((g && (g.title || g.name)) || ""); }).filter(function (g) { return !!g; })
        : [];
      var chapters = await fetchChapters(seriesId);
      return {
        title: String(series.title || "بدون عنوان"),
        coverUrl: coverUrl(seriesId, String(series.cover || "")),
        description: String(series.summary || ""),
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
      try {
        var pages = await getChapterImages(relId);
        if (pages.length) return pages;
      } catch (e) { }
      try {
        delete passCache[relId];
        return await getChapterImages(relId);
      } catch (e) {
        return [];
      }
    },

    async getChapterContent(args) {
      try {
        var pages = await this.getChapterPages(args);
        if (pages.length) return { kind: "image", imageUrls: pages };
      } catch (e) { }
      return { kind: "image", imageUrls: [] };
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
