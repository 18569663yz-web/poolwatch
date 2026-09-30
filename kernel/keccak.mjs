// keccak256 —— 纯 JS 实现（原始 Keccak-256，以太坊用的那个，不是 NIST SHA3-256）
// 零依赖，浏览器 / Node 都能跑。用 BigInt 表示 64-bit lane，慢但正确。
// 输入：Uint8Array 或字符串（按 UTF-8 编码）；输出：Uint8Array(32)。

const MASK64 = (1n << 64n) - 1n;

// iota 轮常数
const RC = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];

// rho 旋转量，lane 下标 i = x + 5y
const RHO = [
  0, 1, 62, 28, 27,
  36, 44, 6, 55, 20,
  3, 10, 43, 25, 39,
  41, 45, 15, 21, 8,
  18, 2, 61, 56, 14,
].map((n) => BigInt(n));

const RATE = 136; // keccak-256：1088 bit rate

function rotl64(v, n) {
  if (n === 0n) return v;
  return ((v << n) | (v >> (64n - n))) & MASK64;
}

const A = new Array(25);
const B = new Array(25);
const C = new Array(5);

function keccakF() {
  for (let round = 0; round < 24; round++) {
    // theta
    for (let x = 0; x < 5; x++) C[x] = A[x] ^ A[x + 5] ^ A[x + 10] ^ A[x + 15] ^ A[x + 20];
    for (let x = 0; x < 5; x++) {
      const d = C[(x + 4) % 5] ^ rotl64(C[(x + 1) % 5], 1n);
      for (let y = 0; y < 5; y++) A[x + 5 * y] ^= d;
    }
    // rho + pi
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        const i = x + 5 * y;
        const j = y + 5 * ((2 * x + 3 * y) % 5);
        B[j] = rotl64(A[i], RHO[i]);
      }
    }
    // chi
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        A[x + 5 * y] = B[x + 5 * y] ^ ((~B[((x + 1) % 5) + 5 * y] & MASK64) & B[((x + 2) % 5) + 5 * y]);
      }
    }
    // iota
    A[0] ^= RC[round];
  }
}

function utf8Bytes(str) {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str);
  // 极端兜底（没有 TextEncoder 的环境）
  const out = [];
  for (const ch of unescape(encodeURIComponent(str))) out.push(ch.charCodeAt(0));
  return Uint8Array.from(out);
}

/**
 * keccak256 原始哈希。
 * @param {Uint8Array|string} input
 * @returns {Uint8Array} 32 字节
 */
export function keccak256Bytes(input) {
  const bytes = typeof input === 'string' ? utf8Bytes(input) : input;
  const total = Math.ceil((bytes.length + 1) / RATE) * RATE;
  const padded = new Uint8Array(total);
  padded.set(bytes);
  padded[bytes.length] = 0x01; // Keccak 原始 padding 域
  padded[total - 1] |= 0x80;

  for (let i = 0; i < 25; i++) A[i] = 0n;
  for (let off = 0; off < total; off += RATE) {
    for (let i = 0; i < RATE / 8; i++) {
      const p = off + i * 8;
      // lane 小端
      const lane =
        BigInt(padded[p]) |
        (BigInt(padded[p + 1]) << 8n) |
        (BigInt(padded[p + 2]) << 16n) |
        (BigInt(padded[p + 3]) << 24n) |
        (BigInt(padded[p + 4]) << 32n) |
        (BigInt(padded[p + 5]) << 40n) |
        (BigInt(padded[p + 6]) << 48n) |
        (BigInt(padded[p + 7]) << 56n);
      A[i] ^= lane;
    }
    keccakF();
  }

  const out = new Uint8Array(32);
  for (let i = 0; i < 4; i++) {
    let lane = A[i];
    for (let j = 0; j < 8; j++) {
      out[i * 8 + j] = Number(lane & 0xffn);
      lane >>= 8n;
    }
  }
  return out;
}

/**
 * keccak256 -> 小写 0x 十六进制字符串。
 * @param {Uint8Array|string} input
 * @returns {string}
 */
export function keccak256(input) {
  return '0x' + bytesToHex(keccak256Bytes(input));
}

/** Uint8Array -> 小写 hex（不带 0x） */
export function bytesToHex(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0');
  return s;
}

/** hex（可带 0x）-> Uint8Array */
export function hexToBytes(hex) {
  const h = hex.startsWith('0x') || hex.startsWith('0X') ? hex.slice(2) : hex;
  if (h.length % 2 !== 0) throw new Error('hexToBytes: odd length');
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
}
