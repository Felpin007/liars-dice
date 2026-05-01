// RNG determinístico com esquema commit-reveal (plan §6)
// Usa SubtleCrypto (SHA-256) quando disponível; fallback pure-JS para file://.

const RNG = (() => {
  const enc = new TextEncoder();

  // Pure-JS SHA-256 (fallback quando crypto.subtle indisponível em file://)
  function sha256Sync(data) {
    const K = [
      0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
      0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
      0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
      0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
      0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
      0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
      0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
      0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
    ];
    const H = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    const msg = data instanceof Uint8Array ? data : new Uint8Array(data);
    const len = msg.length;
    const bitLen = len * 8;
    const padLen = ((len + 9 + 63) & ~63);
    const buf = new Uint8Array(padLen);
    buf.set(msg);
    buf[len] = 0x80;
    const dv = new DataView(buf.buffer);
    dv.setUint32(padLen - 4, bitLen >>> 0, false);
    dv.setUint32(padLen - 8, Math.floor(bitLen / 2**32), false);
    const W = new Int32Array(64);
    const rotr = (x, n) => (x >>> n) | (x << (32 - n));
    for (let off = 0; off < padLen; off += 64) {
      for (let i = 0; i < 16; i++) W[i] = dv.getInt32(off + i * 4, false);
      for (let i = 16; i < 64; i++) {
        const s0 = rotr(W[i-15], 7) ^ rotr(W[i-15], 18) ^ (W[i-15] >>> 3);
        const s1 = rotr(W[i-2], 17) ^ rotr(W[i-2], 19) ^ (W[i-2] >>> 10);
        W[i] = (W[i-16] + s0 + W[i-7] + s1) | 0;
      }
      let [a,b,c,d,e,f,g,h] = H;
      for (let i = 0; i < 64; i++) {
        const S1 = rotr(e,6) ^ rotr(e,11) ^ rotr(e,25);
        const ch = (e & f) ^ (~e & g);
        const t1 = (h + S1 + ch + K[i] + W[i]) | 0;
        const S0 = rotr(a,2) ^ rotr(a,13) ^ rotr(a,22);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (S0 + maj) | 0;
        h=g; g=f; f=e; e=(d+t1)|0; d=c; c=b; b=a; a=(t1+t2)|0;
      }
      H[0]=(H[0]+a)|0; H[1]=(H[1]+b)|0; H[2]=(H[2]+c)|0; H[3]=(H[3]+d)|0;
      H[4]=(H[4]+e)|0; H[5]=(H[5]+f)|0; H[6]=(H[6]+g)|0; H[7]=(H[7]+h)|0;
    }
    const out = new Uint8Array(32);
    for (let i = 0; i < 8; i++) {
      out[i*4]   = (H[i] >>> 24) & 0xff;
      out[i*4+1] = (H[i] >>> 16) & 0xff;
      out[i*4+2] = (H[i] >>>  8) & 0xff;
      out[i*4+3] =  H[i]         & 0xff;
    }
    return out;
  }

  const subtle = typeof crypto !== "undefined" && crypto.subtle;

  function randomBytes(n) {
    const b = new Uint8Array(n);
    crypto.getRandomValues(b);
    return b;
  }

  function toHex(buf) {
    const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    return [...b].map(x => x.toString(16).padStart(2, "0")).join("");
  }

  function fromHex(hex) {
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
  }

  async function sha256(bytes) {
    if (subtle) {
      const h = await subtle.digest("SHA-256", bytes);
      return new Uint8Array(h);
    }
    return sha256Sync(bytes);
  }

  async function hmac(keyBytes, msgBytes) {
    if (subtle) {
      const key = await subtle.importKey(
        "raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
      );
      const sig = await subtle.sign("HMAC", key, msgBytes);
      return new Uint8Array(sig);
    }
    // Pure-JS HMAC-SHA256
    const BLOCK = 64;
    let k = keyBytes.length > BLOCK ? sha256Sync(keyBytes) : keyBytes;
    const kp = new Uint8Array(BLOCK);
    kp.set(k);
    const ipad = new Uint8Array(BLOCK), opad = new Uint8Array(BLOCK);
    for (let i = 0; i < BLOCK; i++) { ipad[i] = kp[i] ^ 0x36; opad[i] = kp[i] ^ 0x5c; }
    const inner = sha256Sync(concat(ipad, msgBytes));
    return sha256Sync(concat(opad, inner));
  }

  function concat(...arrs) {
    const total = arrs.reduce((s, a) => s + a.length, 0);
    const out = new Uint8Array(total);
    let o = 0;
    for (const a of arrs) { out.set(a, o); o += a.length; }
    return out;
  }

  // Cria compromisso para o round: seed aleatório + hash (público)
  async function createCommitment() {
    const seed = randomBytes(32);
    const hash = await sha256(seed);
    return { seedHex: toHex(seed), hashHex: toHex(hash) };
  }

  // Combina seed servidor + seeds clientes + matchId + round em um finalSeed (bytes)
  async function deriveFinalSeed({ serverSeedHex, clientSeedsHex, matchId, round }) {
    const parts = [
      fromHex(serverSeedHex),
      ...clientSeedsHex.map(s => fromHex(s)),
      enc.encode(`|${matchId}|${round}`),
    ];
    return await sha256(concat(...parts));
  }

  // PRF: HMAC(final_seed, "dice"||playerId||dieIndex) → byte → face 1..6
  async function rollDieFor(finalSeed, playerId, dieIndex) {
    const msg = enc.encode(`dice|${playerId}|${dieIndex}`);
    const mac = await hmac(finalSeed, msg);
    // Uniforme 0..5 usando rejection sampling nos primeiros bytes
    for (const b of mac) {
      if (b < 252) return 1 + (b % 6);
    }
    return 1 + (mac[0] % 6); // fallback praticamente inalcançável
  }

  async function rollHand(finalSeed, playerId, count) {
    const out = new Array(count);
    for (let i = 0; i < count; i++) out[i] = await rollDieFor(finalSeed, playerId, i);
    return out;
  }

  // Seed numérico derivado para animações (physics_seed)
  async function derivePhysicsSeed(finalSeed) {
    const mac = await hmac(finalSeed, enc.encode("physics"));
    let s = 0;
    for (let i = 0; i < 4; i++) s = (s << 8) | mac[i];
    return s >>> 0;
  }

  // Verifica que um compromisso bate com o seed revelado
  async function verifyCommitment(seedHex, hashHex) {
    const h = await sha256(fromHex(seedHex));
    return toHex(h) === hashHex.toLowerCase();
  }

  // PRNG mulberry32 para animação (determinístico)
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  return {
    randomBytes, toHex, fromHex, sha256, hmac,
    createCommitment, deriveFinalSeed, rollDieFor, rollHand,
    derivePhysicsSeed, verifyCommitment, mulberry32,
  };
})();
