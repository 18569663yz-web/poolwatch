// v3fees kernel —— Uniswap V3 未领取手续费：池地址推导 + RPC 批量读 + 手续费计算
// 纯 ESM、零第三方运行时依赖（keccak256 自带），浏览器 / Node 18+ 都能跑。
// 接口契约见 ../INTERFACE.md §2。
//
//   poolAddress(token0, token1, fee) -> string
//   fetchState(positions, opts)      -> Promise<State>
//   computeFees(pos, state)          -> { ok:true, fees0, fees1 } | { ok:false, reason }
//   collectFees(positions, opts)     -> Promise<Array>

import { keccak256Bytes, hexToBytes, bytesToHex } from './keccak.mjs';
import {
  RpcPool,
  SELECTORS,
  calldata,
  encodeAddress,
  encodeInt,
  encodeUint,
  decodeAddress,
  decodeUint,
  decodeInt,
  word,
} from './rpc.mjs';

// 顺手转出常用的哈希工具，方便调用方（和测试）少引一个文件
export { keccak256, keccak256Bytes, bytesToHex, hexToBytes } from './keccak.mjs';
export { SELECTORS, RpcPool } from './rpc.mjs';

export const FACTORY_ADDRESS = '0x1F98431c8aD98523631AE4a59f267346ea31F984';
export const POOL_INIT_CODE_HASH = '0xe34f199b19b2b4f47f68442619d555527d244f78a3297ea89325f843f87b8b54';
export const NFT_POSITION_MANAGER = '0xC36442b4a4522E871399CD717aBDD847Ab11FE88';
export const FEE_TIERS = [100, 500, 3000, 10000];

// 默认端点：已实测支持 JSON-RPC batch 的三个（顺序即优先级）。见 INTERFACE.md §2.2 / §7。
// 与 v3fees/data-adapter.js 的 RPC_URLS 保持一致。
// 不做默认值的端点（但调用方仍可显式传入，RpcPool 会自动把它们标记为 batch:false 走单发）：
//   https://1rpc.io/eth      —— 对 batch 返回非数组（不支持），且有 usage limit
//   https://eth.drpc.org     —— 小批量 200、5 项批量 HTTP 500（不稳定）
// 故意不放进默认列表：一旦前三个全挂，回退到单发端点会把 1818 个调用串行化（分钟级 → 小时级）。
export const DEFAULT_RPC_URLS = [
  'https://ethereum-rpc.publicnode.com',
  'https://virginia.rpc.blxrbdn.com',
  'https://eth.rpc.blxrbdn.com',
];

export const Q128 = 1n << 128n;
export const MASK256 = (1n << 256n) - 1n;
export const MAX_UINT128 = (1n << 128n) - 1n;

const DEFAULTS = {
  rpcUrls: DEFAULT_RPC_URLS,
  batchSize: 100,
  concurrency: 3,
  timeoutMs: 15000,
  maxRetries: 8,
  blockTag: 'latest',
  signal: null,
  onProgress: null,
};

// ---------------------------------------------------------------- 工具

/** 统一成小写 0x 地址；非法就抛 */
export function normalizeAddress(addr, field = 'address') {
  const h = String(addr == null ? '' : addr).trim().toLowerCase();
  const body = h.startsWith('0x') ? h.slice(2) : h;
  if (!/^[0-9a-f]{40}$/.test(body)) throw new Error(`${field}: 非法地址「${addr}」`);
  return '0x' + body;
}

function toBig(v) {
  if (typeof v === 'bigint') return v;
  if (v === null || v === undefined || v === '') return 0n;
  return BigInt(v);
}

function concatBytes(...arrs) {
  let n = 0;
  for (const a of arrs) n += a.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const a of arrs) {
    out.set(a, o);
    o += a.length;
  }
  return out;
}

/** 同时支持 Map 与普通对象（测试里手写 state 更方便） */
function lookup(m, key) {
  if (!m) return undefined;
  return m instanceof Map ? m.get(key) : m[key];
}

/** 把 blockNumber/blockTag 归一成 eth_call 的块参数 */
function blockParam(opts) {
  if (opts.blockNumber !== undefined && opts.blockNumber !== null) {
    return '0x' + BigInt(opts.blockNumber).toString(16);
  }
  return opts.blockTag || 'latest';
}

// ---------------------------------------------------------------- 仓位归一化

/** 长字段名 ← 短字段名（离线快照用短名，链上枚举用长名） */
const POS_ALIAS = {
  tokenId: ['tokenId', 'id'],
  token0: ['token0', 't0'],
  token1: ['token1', 't1'],
  tickLower: ['tickLower', 'tl'],
  tickUpper: ['tickUpper', 'tu'],
  liquidity: ['liquidity', 'L'],
  feeGrowthInsideLast0: ['feeGrowthInsideLast0', 'feeGrowthInside0LastX128', 'f0'],
  feeGrowthInsideLast1: ['feeGrowthInsideLast1', 'feeGrowthInside1LastX128', 'f1'],
  tokensOwed0: ['tokensOwed0', 'o0'],
  tokensOwed1: ['tokensOwed1', 'o1'],
};

const BIGINT_FIELDS = new Set(['liquidity', 'feeGrowthInsideLast0', 'feeGrowthInsideLast1', 'tokensOwed0', 'tokensOwed1']);

function pickField(raw, keys) {
  for (const k of keys) {
    const v = raw[k];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

/**
 * 归一化一个仓位到 INTERFACE.md §2.3 的字段名。
 * 同时接受离线快照短名 { id, t0, t1, fee, tl, tu, L, f0, f1, o0, o1 }。
 * 返回新对象（不改入参），保留原始对象上其它附加字段。
 */
export function normalizePosition(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('bad-position: 空的仓位对象');
  const out = { ...raw };
  for (const [canon, keys] of Object.entries(POS_ALIAS)) {
    const v = pickField(raw, keys);
    if (v === undefined) {
      delete out[canon];
      continue;
    }
    out[canon] = BIGINT_FIELDS.has(canon) ? toBig(v) : v;
  }
  const fee = pickField(raw, ['fee']);
  if (fee !== undefined) out.fee = Number(fee);
  if (out.tickLower !== undefined) out.tickLower = Number(out.tickLower);
  if (out.tickUpper !== undefined) out.tickUpper = Number(out.tickUpper);
  if (out.tokenId !== undefined) out.tokenId = String(out.tokenId);
  return out;
}

// ---------------------------------------------------------------- 2.1 poolAddress

/**
 * CREATE2 推导 Uniswap V3 池地址（不发 RPC）。
 * token0/token1 大小写不敏感，内部按地址数值排序后计算。
 * @returns {string} 小写 0x 池地址
 */
export function poolAddress(token0, token1, fee) {
  const a = normalizeAddress(token0, 'token0');
  const b = normalizeAddress(token1, 'token1');
  const f = BigInt(fee);
  if (f < 0n || f > 0xffffffn) throw new Error(`fee: 非法费率 ${fee}`);
  // 同长度小写 hex 的字符串序 == 地址数值序
  const t0 = a <= b ? a : b;
  const t1 = a <= b ? b : a;
  const salt = keccak256Bytes(hexToBytes(encodeAddress(t0) + encodeAddress(t1) + encodeUint(f)));
  const digest = keccak256Bytes(
    concatBytes(hexToBytes('0xff'), hexToBytes(FACTORY_ADDRESS), salt, hexToBytes(POOL_INIT_CODE_HASH)),
  );
  return '0x' + bytesToHex(digest).slice(24);
}

// ---------------------------------------------------------------- 2.2 fetchState

/**
 * 批量读链上池状态。
 * @param {Array} positions 仓位数组（只需 token0/token1/fee/tickLower/tickUpper/liquidity）
 * @param {object} opts { rpcUrls, batchSize, concurrency, timeoutMs, maxRetries, backoffMs, blockTag, blockNumber, signal, onProgress }
 *   端点级故障的退避基数可调（`backoffMs`，默认 provider 限流 1000ms / 其他 250ms，上限 8000ms）；
 *   退避只在**所有端点都在冷却**时真正等待——只要还有健康端点就立即换端点。
 * @returns {Promise<{byPool:Map, byTick:Map, errors:Array, blockNumber:number|null}>}
 */
export async function fetchState(positions, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const list = Array.isArray(positions) ? positions : [];
  const errors = [];
  const seenErr = new Set();
  const addErr = (e) => {
    const k = `${e.pool}|${e.tick}|${e.reason}`;
    if (seenErr.has(k)) return;
    seenErr.add(k);
    errors.push(e);
  };

  const poolMeta = new Map(); // 小写池地址 -> { token0, token1, fee }
  const tickSet = new Map(); // `${pool}:${tick}` -> { pool, tick }

  for (const raw of list) {
    let p;
    try {
      p = normalizePosition(raw);
    } catch (e) {
      addErr({ pool: '', reason: `bad-position: ${String(e && e.message).slice(0, 80)}` });
      continue;
    }
    let pl;
    try {
      pl = poolAddress(p.token0, p.token1, p.fee);
    } catch (e) {
      addErr({ pool: '', reason: `bad-position: ${String(e && e.message).slice(0, 80)}` });
      continue;
    }
    if (!poolMeta.has(pl)) {
      poolMeta.set(pl, {
        token0: normalizeAddress(p.token0),
        token1: normalizeAddress(p.token1),
        fee: Number(p.fee),
      });
    }
    if (toBig(p.liquidity) > 0n) {
      for (const t of [p.tickLower, p.tickUpper]) {
        const tick = Number(t);
        const k = `${pl}:${tick}`;
        if (!tickSet.has(k)) tickSet.set(k, { pool: pl, tick });
      }
    }
  }

  const block = blockParam(o);
  const jobs = [];
  for (const pl of poolMeta.keys()) {
    jobs.push({ params: [{ to: pl, data: SELECTORS.slot0 }, block], kind: 'slot0', pool: pl });
    jobs.push({ params: [{ to: pl, data: SELECTORS.feeGrowthGlobal0X128 }, block], kind: 'fg0', pool: pl });
    jobs.push({ params: [{ to: pl, data: SELECTORS.feeGrowthGlobal1X128 }, block], kind: 'fg1', pool: pl });
  }
  for (const t of tickSet.values()) {
    jobs.push({
      params: [{ to: t.pool, data: calldata(SELECTORS.ticks, encodeInt(t.tick)) }, block],
      kind: 'ticks',
      pool: t.pool,
      tick: t.tick,
    });
  }

  const client = new RpcPool(o.rpcUrls, {
    timeoutMs: o.timeoutMs,
    maxRetries: o.maxRetries,
    signal: o.signal,
    backoffMs: o.backoffMs,
  });
  const results = await client.run(jobs, {
    batchSize: o.batchSize,
    concurrency: o.concurrency,
    onProgress: o.onProgress,
  });

  const rawPool = new Map(); // pool -> { sqrtPriceX96, tick, fg0, fg1 }
  const byTick = new Map();

  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    const r = results[i];
    if (!r || !r.ok) {
      addErr({ pool: job.pool, ...(job.tick !== undefined ? { tick: job.tick } : {}), reason: r ? r.reason : 'rpc-failed' });
      continue;
    }
    try {
      if (job.kind === 'slot0') {
        const e = rawPool.get(job.pool) || {};
        e.sqrtPriceX96 = decodeUint(word(r.result, 0));
        e.tick = Number(decodeInt(word(r.result, 1)));
        rawPool.set(job.pool, e);
      } else if (job.kind === 'fg0') {
        const e = rawPool.get(job.pool) || {};
        e.fg0 = decodeUint(word(r.result, 0));
        rawPool.set(job.pool, e);
      } else if (job.kind === 'fg1') {
        const e = rawPool.get(job.pool) || {};
        e.fg1 = decodeUint(word(r.result, 0));
        rawPool.set(job.pool, e);
      } else {
        // ticks(int24) returns:
        //   (uint128 liquidityGross, int128 liquidityNet, uint256 feeGrowthOutside0X128,
        //    uint256 feeGrowthOutside1X128, int56 tickCumulativeOutside,
        //    uint160 secondsPerLiquidityOutsideX128, uint32 secondsOutside, bool initialized)
        // → feeGrowthOutside0/1X128 are words 2 and 3, NOT 0 and 1.
        byTick.set(`${job.pool}:${job.tick}`, {
          feeGrowthOutside0X128: decodeUint(word(r.result, 2)),
          feeGrowthOutside1X128: decodeUint(word(r.result, 3)),
        });
      }
    } catch (e) {
      addErr({ pool: job.pool, ...(job.tick !== undefined ? { tick: job.tick } : {}), reason: `decode: ${String(e && e.message).slice(0, 80)}` });
    }
  }

  const byPool = new Map();
  for (const [pl, e] of rawPool) {
    if (e.sqrtPriceX96 === undefined || e.tick === undefined || e.fg0 === undefined || e.fg1 === undefined) continue;
    byPool.set(pl, {
      sqrtPriceX96: e.sqrtPriceX96,
      tick: e.tick,
      feeGrowthGlobal0X128: e.fg0,
      feeGrowthGlobal1X128: e.fg1,
    });
  }

  return {
    byPool,
    byTick,
    errors,
    blockNumber: o.blockNumber !== undefined && o.blockNumber !== null ? Number(o.blockNumber) : null,
  };
}

// ---------------------------------------------------------------- 2.3 computeFees

/** feeGrowthInside，严格按合约的 256-bit 回绕语义 */
function feeGrowthInside(global, lower, upper, curTick, tickLower, tickUpper) {
  if (curTick < tickLower) return (lower - upper) & MASK256;
  if (curTick >= tickUpper) return (upper - lower) & MASK256;
  return (global - lower - upper) & MASK256;
}

/**
 * 纯函数：算一个仓位的未领取手续费（tokensOwed + 现算累积）。
 * @returns {{ok:true, fees0:bigint, fees1:bigint} | {ok:false, reason:'degenerate'|'missing-state'}}
 */
export function computeFees(pos, state) {
  if (!pos) return { ok: false, reason: 'missing-state' };
  let p;
  try {
    p = normalizePosition(pos);
  } catch {
    return { ok: false, reason: 'missing-state' };
  }
  let pl;
  try {
    pl = poolAddress(p.token0, p.token1, p.fee);
  } catch {
    return { ok: false, reason: 'missing-state' };
  }
  const L = toBig(p.liquidity);
  const owed0 = toBig(p.tokensOwed0);
  const owed1 = toBig(p.tokensOwed1);

  // 没有流动性 → 不会再累积，只剩 tokensOwed（合约里 liquidity*delta/2^128 == 0）
  if (L === 0n) return { ok: true, fees0: owed0, fees1: owed1 };

  const ps = lookup(state && state.byPool, pl);
  if (!ps) return { ok: false, reason: 'missing-state' };
  const lo = lookup(state && state.byTick, `${pl}:${Number(p.tickLower)}`);
  const up = lookup(state && state.byTick, `${pl}:${Number(p.tickUpper)}`);
  if (!lo || !up) return { ok: false, reason: 'missing-state' };
  if (ps.tick === undefined || ps.tick === null) return { ok: false, reason: 'missing-state' };

  const curTick = Number(ps.tick);
  const tickLower = Number(p.tickLower);
  const tickUpper = Number(p.tickUpper);

  const inside0 = feeGrowthInside(
    toBig(ps.feeGrowthGlobal0X128),
    toBig(lo.feeGrowthOutside0X128),
    toBig(up.feeGrowthOutside0X128),
    curTick,
    tickLower,
    tickUpper,
  );
  const inside1 = feeGrowthInside(
    toBig(ps.feeGrowthGlobal1X128),
    toBig(lo.feeGrowthOutside1X128),
    toBig(up.feeGrowthOutside1X128),
    curTick,
    tickLower,
    tickUpper,
  );

  const delta0 = (inside0 - toBig(p.feeGrowthInsideLast0)) & MASK256;
  const delta1 = (inside1 - toBig(p.feeGrowthInsideLast1)) & MASK256;
  const fee0 = (L * delta0) / Q128;
  const fee1 = (L * delta1) / Q128;

  // NonfungiblePositionManager 的 uint128 截断区：链上金额本身就是垃圾值
  if (fee0 >= Q128 || fee1 >= Q128) return { ok: false, reason: 'degenerate' };

  return { ok: true, fees0: fee0 + owed0, fees1: fee1 + owed1 };
}

// ---------------------------------------------------------------- 2.4 collectFees

/**
 * 便捷管道：fetchState → 逐仓 computeFees。
 * 返回数组，每项 { ok, position, pool, fees0/fees1 | reason }。
 * 数组上挂了一个不可枚举的 `errors`（= state.errors），失败信息不丢。
 */
export async function collectFees(positions, opts = {}) {
  const list = Array.isArray(positions) ? positions : [];
  const state = await fetchState(list, opts);
  const out = list.map((position) => {
    let norm = null;
    try {
      norm = normalizePosition(position);
    } catch {
      norm = null;
    }
    let pl = null;
    try {
      pl = poolAddress(position.token0 ?? position.t0, position.token1 ?? position.t1, position.fee);
    } catch {
      pl = null;
    }
    const r = computeFees(position, state);
    if (r.ok) {
      const item = { ok: true, position, normalized: norm, pool: pl, fees0: r.fees0, fees1: r.fees1 };
      const byPool = state.byPool.get(pl);
      if (byPool) item.tick = byPool.tick;
      return item;
    }
    return { ok: false, position, normalized: norm, pool: pl, reason: r.reason };
  });
  Object.defineProperty(out, 'errors', { value: state.errors, enumerable: false });
  return out;
}

// ---------------------------------------------------- fetchOwnedPositions（链上枚举）

const NFT_MANAGER_DEFAULTS = { batchSize: 100, concurrency: 3 };

/**
 * 纯链上枚举一个地址拥有的全部 Uniswap V3 仓位（不依赖离线快照）。
 *   balanceOf → tokenOfOwnerByIndex(i) → positions(tokenId) → ownerOf 复核
 * @returns {Promise<{positions:Array, errors:Array, balance:number, blockNumber:number|null, complete:boolean}>}
 *   positions 已归一化（§2.3 字段名），并额外带 `pool` 字段。
 *
 * ⚠️ 调用方**必须先查 `complete`（或 `errors.length`）**：RPC 全挂时 positions 会是空数组，
 *    若直接当成「这个地址没有仓位 / 没有未领手续费」就会给用户看到假结论。
 *    `complete === false` 时应报错让用户重试，而不是显示 0。
 */
export async function fetchOwnedPositions(owner, opts = {}) {
  const o = { ...DEFAULTS, ...NFT_MANAGER_DEFAULTS, ...opts };
  const who = normalizeAddress(owner, 'owner');
  const errors = [];
  const block = blockParam(o);
  const client = new RpcPool(o.rpcUrls, {
    timeoutMs: o.timeoutMs,
    maxRetries: o.maxRetries,
    signal: o.signal,
    backoffMs: o.backoffMs,
  });
  const to = NFT_POSITION_MANAGER;
  const call = (data) => client.request('eth_call', [{ to, data }, block]);

  // 1) balanceOf(owner)
  const balHex = await call(calldata(SELECTORS.balanceOf, encodeAddress(who)));
  const balance = Number(decodeUint(word(balHex, 0)));

  // 2) tokenOfOwnerByIndex(owner, i) —— 批量
  const idxJobs = Array.from({ length: balance }, (_, i) => ({
    params: [{ to, data: calldata(SELECTORS.tokenOfOwnerByIndex, encodeAddress(who), encodeUint(i)) }, block],
    i,
  }));
  const idxRes = await client.run(idxJobs, {
    batchSize: o.batchSize,
    concurrency: o.concurrency,
    onProgress: o.onProgress,
  });

  const tokenIds = [];
  for (let i = 0; i < balance; i++) {
    const r = idxRes[i];
    if (!r || !r.ok) {
      errors.push({ tokenId: `#index:${i}`, reason: (r && r.reason) || 'rpc-failed' });
      continue;
    }
    try {
      tokenIds.push(BigInt(decodeUint(word(r.result, 0))).toString());
    } catch (e) {
      errors.push({ tokenId: `#index:${i}`, reason: `decode: ${String(e && e.message).slice(0, 60)}` });
    }
  }

  // 3) positions(tokenId) + ownerOf(tokenId) 复核（防枚举期间被转走）
  const posJobs = tokenIds.map((id) => ({
    params: [{ to, data: calldata(SELECTORS.positions, encodeUint(BigInt(id))) }, block],
    kind: 'positions',
    tokenId: id,
  }));
  const ownJobs = tokenIds.map((id) => ({
    params: [{ to, data: calldata(SELECTORS.ownerOf, encodeUint(BigInt(id))) }, block],
    kind: 'ownerOf',
    tokenId: id,
  }));
  const all = await client.run(posJobs.concat(ownJobs), {
    batchSize: o.batchSize,
    concurrency: o.concurrency,
    onProgress: o.onProgress,
  });
  const posRes = all.slice(0, posJobs.length);
  const ownRes = all.slice(posJobs.length);

  const positions = [];
  for (let i = 0; i < tokenIds.length; i++) {
    const id = tokenIds[i];
    const pr = posRes[i];
    if (!pr || !pr.ok) {
      errors.push({ tokenId: id, reason: (pr && pr.reason) || 'rpc-failed' });
      continue;
    }
    const or = ownRes[i];
    if (or && or.ok) {
      let holder = null;
      try {
        holder = decodeAddress(word(or.result, 0));
      } catch {
        holder = null;
      }
      if (holder && holder.toLowerCase() !== who) {
        errors.push({ tokenId: id, reason: 'owner-changed' });
        continue;
      }
    }
    try {
      const p = decodeNftPosition(id, pr.result);
      positions.push(p);
    } catch (e) {
      errors.push({ tokenId: id, reason: `decode: ${String(e && e.message).slice(0, 60)}` });
    }
  }

  return {
    positions,
    errors,
    balance,
    blockNumber: o.blockNumber !== undefined && o.blockNumber !== null ? Number(o.blockNumber) : null,
    complete: errors.length === 0,
  };
}

/**
 * 解 NonfungiblePositionManager.positions(uint256) 的 12 字元组。
 *   0 nonce  1 operator  2 token0  3 token1  4 fee
 *   5 tickLower(int24)  6 tickUpper(int24)  7 liquidity
 *   8 feeGrowthInside0LastX128  9 feeGrowthInside1LastX128  10 tokensOwed0  11 tokensOwed1
 */
export function decodeNftPosition(tokenId, hex) {
  const w = (i) => word(hex, i);
  const token0 = decodeAddress(w(2));
  const token1 = decodeAddress(w(3));
  const fee = Number(decodeUint(w(4)));
  const tickLower = Number(BigInt.asIntN(24, decodeUint(w(5))));
  const tickUpper = Number(BigInt.asIntN(24, decodeUint(w(6))));
  let pool = null;
  try {
    pool = poolAddress(token0, token1, fee);
  } catch {
    pool = null;
  }
  return {
    tokenId: String(tokenId),
    token0,
    token1,
    fee,
    tickLower,
    tickUpper,
    liquidity: decodeUint(w(7)),
    feeGrowthInsideLast0: decodeUint(w(8)),
    feeGrowthInsideLast1: decodeUint(w(9)),
    tokensOwed0: decodeUint(w(10)),
    tokensOwed1: decodeUint(w(11)),
    pool,
  };
}
