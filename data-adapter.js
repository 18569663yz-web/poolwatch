// v3fees/data-adapter.js
//
// 属主：Lead。**签名冻结**（见 v3fees/INTERFACE.md §4），frontend-dev 只 import、不改。
//
// 实现：**完全实时读链，零数据文件、零服务器。**
//   1. balanceOf + tokenOfOwnerByIndex   -> 这个地址持有哪些仓位 NFT
//   2. positions(tokenId) × N + ownerOf  -> 每个仓位的原始状态（实时，不是快照）
//   3. poolAddress(CREATE2) + fetchState -> 池子当前 feeGrowthGlobal / ticks
//   4. computeFees × N                   -> 每个仓位欠多少
//   5. symbol()/decimals() + DefiLlama   -> 显示单位与 USD 估值
//
// 前端只需要 query(address) 就能把整站做完：它返回渲染就绪的行，
// 前端不需要碰 bigint、不需要发 RPC。

import { poolAddress, fetchState, computeFees } from './kernel/index.mjs';

// 已实测支持 JSON-RPC batch 的三个端点（顺序 = **冷启动**优先级，不是永久优先级；
// 在线排序由 probeEndpoints() 量到的 rtt 决定，见 pickEndpoint()）。见 INTERFACE.md §7。
//
// 为什么 publicnode 掉到最后：它曾经是最快的（76/s），但会整段挂死 —— 实测连续
// >8 秒无响应，而 Node 的 fetch 要 10.3 秒才报 TypeError 放弃连接。它排第一时，
// 每次查询都要先白等它一轮才失败换端点，「2 个仓位的地址」被拖到 11 秒。
// 排在最后意味着「冷启动时最后一个才轮到它」。
const RPC_URLS = [
  'https://virginia.rpc.blxrbdn.com',
  'https://eth.rpc.blxrbdn.com',
  'https://ethereum-rpc.publicnode.com',
];

const NFT = '0xC36442b4a4522E871399CD717aBDD847Ab11FE88';
const BURN_ADDRESSES = new Set([
  '0x000000000000000000000000000000000000dead',
  '0x0000000000000000000000000000000000000000',
  '0x0000000000000000000000000000000000000001',
]);

const SEL = {
  balanceOf: '0x70a08231',
  tokenOfOwnerByIndex: '0x2f745c59',
  positions: '0x99fbab88',
  ownerOf: '0x6352211e',
  symbol: '0x95d89b41',
  decimals: '0x313ce567',
};

const BATCH = 100;
const CONCURRENCY = 3;
const PRICE_TTL_MS = 5 * 60 * 1000;
// fetchState（slot0 + feeGrowthGlobal×2 + ticks）的并发。比枚举阶段高：公共端点被限流后
// kernel 的 RpcPool 会从 3s 起退避，并发不够就会一路干等冷却（实测过 >10 分钟卡住）。
const STATE_CONCURRENCY = 8;
// DefiLlama 报价上限（GET + 逗号批量，URL 长度所限）。超出的代币按「无价」处理，
// 会计入 totals.unpricedCount，界面须注明「总额是下界」。
const PRICE_TOKEN_LIMIT = 300;

// 向 DefiLlama 请求报价时混入的常见代币 —— 见 INTERFACE.md §7「隐私要求」。
// 不这么做的话，「有人查了代币集合 {A,B}」本身就泄露了钱包构成。
const PAD_TOKENS = [
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // USDC
  '0xdac17f958d2ee523a2206206994597c13d831ec7', // USDT
  '0x6b175474e89094c44da98b954eedeac495271d0f', // DAI
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', // WETH
  '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599', // WBTC
  '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984', // UNI
  '0x514910771af9ca656af840dff83e8264ecf986ca', // LINK
  '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9', // AAVE
  '0xc00e94cb662c3520282e6f5717214004a7f26888', // COMP
  '0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2', // MKR
  '0x0d8775f648430679a709e98d2b0cb6250d2887ef', // BAT
  '0xd533a949740bb3306d119cc777fa900ba034cd52', // CRV
  '0x5a98fcbea516cf06857215779fd812ca3bef1b32', // LDO
  '0xae7ab96520de3a18e5e111b5eaab095312d7fe84', // stETH
  '0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0', // wstETH
  '0x6b3595068778dd592e39a122f4f5a5cf09c90fe2', // SUSHI
  '0x111111111117dc0aa78b770fa6a738034120c302', // 1INCH
  '0xc18360217d8f7ab5e7c516566761ea12ce7f9d72', // ENS
  '0x6982508145454ce325ddbe47a25d4ec3d2311933', // PEPE
  '0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce', // SHIB
  '0xc944e90c64b2c07662a292be6244bdf05cda44a7', // GRT
  '0x455e53cbb86018ac2b8092fdcd39d8444affc3f6', // POL
  '0xd33526068d116ce69f19a9ee46f0bd304f21a51f', // RPL
  '0x4c9edd5852cd905f086c759e8383e09bff1e68b3', // USDe
  '0x57e114b691db790c35207b2e685d4a43181e6061', // ENA
];

// ---------------------------------------------------------------------------
// 缓存（localStorage 可用就用，不可用退化成内存 Map）
// ---------------------------------------------------------------------------
const mem = new Map();
function cacheGet(key) {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(key) : mem.get(key);
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (!o || typeof o.t !== 'number' || Date.now() - o.t > (o.ttl || PRICE_TTL_MS)) return null;
    return o.v;
  } catch { return null; }
}
function cacheSet(key, v, ttl) {
  const raw = JSON.stringify({ t: Date.now(), ttl: ttl || PRICE_TTL_MS, v });
  try { if (typeof localStorage !== 'undefined') localStorage.setItem(key, raw); } catch { /* 配额满就忽略 */ }
  mem.set(key, raw);
}

// ---------------------------------------------------------------------------
// 极简 JSON-RPC 批量客户端（端点健康度 + 超时 + 429 退避）
// ---------------------------------------------------------------------------
// 踩过的坑：这里原来是**朴素轮询**，既没有超时也没有健康度，于是每三次请求就撞上
// 一次不响的端点 —— 实测 `virginia.rpc.blxrbdn.com` 单次 eth_blockNumber 要 10,547ms，
// 而 publicnode 909ms、eth.rpc.blxrbdn.com 695ms。一次查询被硬拖到 11.4 秒。
// 2500ms 而不是 6000ms：正常端点单次 eth_call 在 700–900ms 内回，
// 而 fetchOwned 有 3 个**串行**批次 —— 每批都可能白等一个满超时。
// 实测 17 仓位地址 18.5s、101 仓位 24.4s，正是「3 × 6s 超时」的形状。
const RPC_TIMEOUT_MS = 2500;
const RPC_COOLDOWN_MS = 20000;

// 报价是**锦上添花**，绝不能主导延迟。DefiLlama 挂住时裸 fetch 会一直握着连接
// （实测 10,288ms 才抛 TypeError），而那时我们已经在结果页上了 —— 用户白等 10 秒
// 换来的只是一个「无价」。2.5 秒拿不到就按无价处理，界面会如实标注总额是下界。
const PRICE_TIMEOUT_MS = 2500;

const endpoints = RPC_URLS.map((url) => ({ url, coolingUntil: 0, fails: 0, rtt: null }));

// 启动时用一次极廉价的 eth_blockNumber 摸一遍各端点延迟，顺便**预热 DNS/TLS 连接**
// —— 冷连接要几百毫秒到 1.5 秒（virginia 实测冷启 481ms、后续 138ms），
// 预热之后真正的第一次查询就走已建立的连接。
// 实测三个端点的裸 RTT 会在 134ms 到 8,270ms 之间轮换。超时给 2500ms 而不是更短：
// 冷 TLS 握手本身就可能超过 1.2 秒，太短会把好端点误判成死端点。
// 探针**不在首屏关键路径上**（rpcPost 不 await 它）。
const PROBE_TIMEOUT_MS = 2500;
let probePromise = null;

function probeEndpoints() {
  if (probePromise) return probePromise;
  probePromise = Promise.all(
    endpoints.map(async (ep) => {
      const t0 = Date.now();
      try {
        const r = await fetchWithTimeout(
          ep.url,
          [{ jsonrpc: '2.0', id: 0, method: 'eth_blockNumber', params: [] }],
          PROBE_TIMEOUT_MS,
        );
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const j = await r.json();
        if (!Array.isArray(j) || !j[0] || !j[0].result) throw new Error('bad shape');
        ep.rtt = Date.now() - t0;
      } catch {
        ep.rtt = Infinity;
        ep.fails++;
      }
    }),
  );
  return probePromise;
}

function pickEndpoint() {
  const now = Date.now();
  const ready = endpoints.filter((e) => e.coolingUntil <= now);
  if (ready.length) {
    // 先看谁没怎么失败过，再按探测到的延迟排。
    // 没探到的必须当作**最慢**（Infinity），不能当典型值（曾经用 ?? 400）——
    // 否则冷启动时一个还没量过的端点会以「400ms」击败刚量到 481ms 的端点，
    // 于是我们偏偏挑了那个最不了解的。全都没量到时全部并列，稳定排序保留
    // RPC_URLS 的顺序，也就是已知最好的那个排第一。
    ready.sort((a, b) => a.fails - b.fails || (a.rtt ?? Infinity) - (b.rtt ?? Infinity));
    return ready[0];
  }
  // 全在冷却：挑最早解冻的，总比直接失败强
  return [...endpoints].sort((a, b) => a.coolingUntil - b.coolingUntil)[0];
}

// 按当前已知排名给出端点顺序，供 kernel 的 fetchState 使用 ——
// 它自己不做探测，只会按数组顺序试。不传的话它就从列表第一个开始试。
function rankedRpcUrls() {
  return [...endpoints]
    .sort((a, b) => a.fails - b.fails || (a.rtt ?? Infinity) - (b.rtt ?? Infinity))
    .map((e) => e.url);
}

// 模块一加载就开始探延迟 —— 但**只用来预热 DNS/TLS 连接和给后续请求排序**，
// 首屏不等它。等它就等于把用户押在「最慢的那个端点什么时候超时」上（实测 1.2s）。
// rpcPost 里的 fails/cooldown 已能处理「选中的端点中途挂了」。
probeEndpoints();

async function fetchWithTimeout(url, body, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function rpcPost(reqs) {
  // 不 await 探针：探针是 Promise.all，只要有一个端点在超时边缘磨蹭，等它就等于
  // 让用户替「挑端点」付 1.2 秒。pickEndpoint() 在谁都没量到时按 RPC_URLS 顺序取，
  // 已经是最好的猜测；选中的端点挂了就靠 fails/cooldown 换人。
  let lastErr = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const ep = pickEndpoint();
    try {
      const r = await fetchWithTimeout(ep.url, reqs, RPC_TIMEOUT_MS);
      if (r.status === 429) {
        lastErr = new Error('429 rate limited');
        ep.fails++;
        ep.coolingUntil = Date.now() + RPC_COOLDOWN_MS;
        await sleep(300 * (attempt + 1));
        continue;
      }
      if (!r.ok) {
        lastErr = new Error('HTTP ' + r.status);
        ep.fails++;
        ep.coolingUntil = Date.now() + RPC_COOLDOWN_MS;
        continue;
      }
      const j = await r.json();
      if (Array.isArray(j) && j.length === reqs.length) {
        ep.fails = 0; // 恢复正常就放回池子
        return j;
      }
      lastErr = new Error('bad rpc response shape');
      ep.fails++;
    } catch (e) {
      lastErr = e;
      // 超时 / 网络错误 —— 这个端点此刻不可用，冷却它、换别的
      ep.fails++;
      ep.coolingUntil = Date.now() + RPC_COOLDOWN_MS;
    }
    await sleep(150 * (attempt + 1));
  }
  throw lastErr || new Error('rpc failed');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pad64 = (hexNo0x) => hexNo0x.padStart(64, '0');
const u256 = (n) => pad64(BigInt(n).toString(16));
const addrArg = (a) => pad64(a.toLowerCase().replace(/^0x/, ''));

/**
 * 对同一合约发一批 eth_call，返回 `{result}|{error}` 数组。
 * `blockTag` 用来把整次查询钉在同一个区块 —— 否则 slot0 取自区块 N、
 * feeGrowthGlobal 取自区块 N+1，算出来的数在繁忙池子里就是错的，不只是噪声大。
 */
async function ethCallBatch(to, datas, onEach, blockTag = 'latest') {
  const out = new Array(datas.length);
  const chunks = [];
  for (let i = 0; i < datas.length; i += BATCH) chunks.push([i, datas.slice(i, i + BATCH)]);

  let next = 0;
  let done = 0;
  async function worker() {
    while (next < chunks.length) {
      const [base, part] = chunks[next++];
      const reqs = part.map((data, k) => ({
        jsonrpc: '2.0', id: k, method: 'eth_call', params: [{ to, data }, blockTag],
      }));
      let res;
      try { res = await rpcPost(reqs); } catch { res = null; }
      for (let k = 0; k < part.length; k++) {
        out[base + k] = res ? res[k] : { error: { message: 'rpc failed' } };
      }
      done += part.length;
      if (onEach) onEach(done, datas.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, chunks.length) }, worker));
  return out;
}

// ---------------------------------------------------------------------------
// 解码小工具
// ---------------------------------------------------------------------------
function isAddress(a) {
  return typeof a === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a.trim());
}

function wordAt(hexNo0x, i) {
  return hexNo0x.slice(i * 64, (i + 1) * 64);
}

/** positions(uint256) 的 12 word 元组 → Position（字段与 INTERFACE.md §2.3 一致） */
function parsePosition(tokenId, hex) {
  if (!hex || hex.length < 2 + 64 * 12) return null;
  const w = hex.slice(2);
  return {
    tokenId: String(tokenId),
    token0: '0x' + wordAt(w, 2).slice(24),
    token1: '0x' + wordAt(w, 3).slice(24),
    fee: Number(BigInt('0x' + wordAt(w, 4))),
    tickLower: Number(BigInt.asIntN(24, BigInt('0x' + wordAt(w, 5)))),
    tickUpper: Number(BigInt.asIntN(24, BigInt('0x' + wordAt(w, 6)))),
    liquidity: BigInt('0x' + wordAt(w, 7)),
    feeGrowthInsideLast0: BigInt('0x' + wordAt(w, 8)),
    feeGrowthInsideLast1: BigInt('0x' + wordAt(w, 9)),
    tokensOwed0: BigInt('0x' + wordAt(w, 10)),
    tokensOwed1: BigInt('0x' + wordAt(w, 11)),
  };
}

/** symbol() 返回 string 或 bytes32 两种，都要吃；解析不了返回 null */
function decodeSymbol(hex) {
  try {
    if (!hex || hex === '0x') return null;
    const w = hex.slice(2);
    const toStr = (bytes) => {
      const s = new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(bytes)).replace(/\0+$/, '').trim();
      return s.length ? s.slice(0, 32) : null;
    };
    if (w.length === 64) {                       // 老式 bytes32
      const b = [];
      for (let i = 0; i < 64; i += 2) { const v = parseInt(w.slice(i, i + 2), 16); if (v) b.push(v); }
      return toStr(b);
    }
    const off = Number(BigInt('0x' + wordAt(w, 0)));   // 单位是字节
    if (off !== 32) return null;
    const len = Number(BigInt('0x' + wordAt(w, 1)));
    if (len <= 0 || len > 64) return null;
    const data = w.slice(128, 128 + len * 2);
    const b = [];
    for (let i = 0; i < data.length; i += 2) b.push(parseInt(data.slice(i, i + 2), 16));
    return toStr(b);
  } catch { return null; }
}

function decodeDecimals(hex) {
  try {
    if (!hex || hex === '0x') return null;
    const n = Number(BigInt(hex));
    return Number.isInteger(n) && n >= 0 && n <= 77 ? n : null;
  } catch { return null; }
}

/** bigint + decimals → 十进制字符串（不丢精度，不经过 Number） */
export function toDecimalString(v, decimals) {
  let x = BigInt(v);
  const neg = x < 0n;
  if (neg) x = -x;
  const s = x.toString().padStart(decimals + 1, '0');
  const whole = s.slice(0, s.length - decimals);
  const frac = decimals > 0 ? s.slice(s.length - decimals).replace(/0+$/, '') : '';
  return (neg ? '-' : '') + whole + (frac ? '.' + frac : '');
}

// ---------------------------------------------------------------------------
// 代币元数据（链上实时读，缓存 24 小时）
// ---------------------------------------------------------------------------
const META_TTL = 24 * 60 * 60 * 1000;

export async function getTokenMetas(addresses, blockTag = 'latest') {
  const uniq = [...new Set(addresses.map((a) => a.toLowerCase()))];
  const out = new Map();
  const missing = [];
  for (const a of uniq) {
    const c = cacheGet('v3fees:meta:' + a);
    if (c && typeof c.decimals === 'number') out.set(a, c);
    else missing.push(a);
  }
  if (missing.length) {
    // symbol 与 decimals 是**对每个代币合约**发调用，不是对 NPM —— 需要按合约分组
    const joined = await callPerContract(missing, [SEL.symbol, SEL.decimals], blockTag);
    for (const a of missing) {
      const [symHex, decHex] = joined.get(a) || [];
      const meta = {
        symbol: decodeSymbol(symHex) || (a.slice(0, 6) + '…' + a.slice(-4)),
        decimals: decodeDecimals(decHex) ?? 18,
      };
      cacheSet('v3fees:meta:' + a, meta, META_TTL);
      out.set(a, meta);
    }
  }
  return out;
}

/** 对一组不同合约、每个合约 n 个 data 发批量调用，返回 Map<地址, 结果数组> */
async function callPerContract(addresses, datas, blockTag = 'latest') {
  const tasks = [];
  for (const a of addresses) for (const d of datas) tasks.push({ a, d });
  const res = await ethCallBatchMulti(tasks, null, blockTag);
  const out = new Map();
  tasks.forEach((t, i) => {
    if (!out.has(t.a)) out.set(t.a, new Array(datas.length).fill(undefined));
    const matchRes = res[i];
    if (matchRes && matchRes.result) out.get(t.a)[datas.indexOf(t.d)] = matchRes.result;
  });
  return out;
}

/** 对不同 (to, data) 组合混批 —— JSON-RPC 允许一批里 to 各不相同 */
async function ethCallBatchMulti(tasks, onEach, blockTag = 'latest') {
  const out = new Array(tasks.length);
  const chunks = [];
  for (let i = 0; i < tasks.length; i += BATCH) chunks.push([i, tasks.slice(i, i + BATCH)]);
  let next = 0, done = 0;
  async function worker() {
    while (next < chunks.length) {
      const [base, part] = chunks[next++];
      const reqs = part.map((t, k) => ({
        jsonrpc: '2.0', id: k, method: 'eth_call', params: [{ to: t.a, data: t.d }, blockTag],
      }));
      let res;
      try { res = await rpcPost(reqs); } catch { res = null; }
      for (let k = 0; k < part.length; k++) out[base + k] = res ? res[k] : { error: { message: 'rpc failed' } };
      done += part.length;
      if (onEach) onEach(done, tasks.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, chunks.length) }, worker));
  return out;
}

// ---------------------------------------------------------------------------
// DefiLlama 报价（浏览器直连；ACAO `*`；支持逗号批量）
// ---------------------------------------------------------------------------
export async function getTokenPrices(addresses) {
  const uniq = [...new Set(addresses.map((a) => a.toLowerCase()))];
  const out = new Map();
  const missing = [];
  for (const a of uniq) {
    const c = cacheGet('v3fees:price:' + a);
    if (c && typeof c.usd === 'number') out.set(a, c.usd);
    else if (c && c.usd === null) out.set(a, null);
    else missing.push(a);
  }
  if (!missing.length) return out;

  // 混入常见代币，破坏「请求集合 == 用户代币集合」这个相关性
  const padded = new Set(missing);
  let i = 0;
  while (padded.size < missing.length + 50 && i < PAD_TOKENS.length * 3) padded.add(PAD_TOKENS[i++ % PAD_TOKENS.length]);

  // DefiLlama 是 GET + 逗号批量，代币一多 URL 就被撑爆：实测 307 个代币 → URL **16,001 字符
  // → 414 URI Too Long**，整批报价全部落空。更糟的是旧写法会把 null 写进缓存，于是同一个会话里
  // 之后每个地址（哪怕只有 3 个仓位）都跟着报「无价」—— 浏览器里这份毒还会进 localStorage，
  // 存 5 分钟。所以必须切开发请求：70 个代币 ≈ 3.5 KB URL，留足余量。
  const PRICE_CHUNK = 70;
  const list = [...padded];
  const coins = {};
  const answered = new Set();
  for (let k = 0; k < list.length; k += PRICE_CHUNK) {
    const part = list.slice(k, k + PRICE_CHUNK);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), PRICE_TIMEOUT_MS);
    try {
      const url = 'https://coins.llama.fi/prices/current/' + part.map((a) => 'ethereum:' + a).join(',');
      const r = await fetch(url, { signal: ctrl.signal });
      if (r.ok) {
        Object.assign(coins, (await r.json()).coins || {});
        for (const a of part) answered.add(a);
      }
    } catch { /* 单批失败不拖垮其他批 */ } finally {
      clearTimeout(timer);
    }
  }

  for (const a of missing) {
    const hit = coins['ethereum:' + a];
    const usd = hit && typeof hit.price === 'number' ? hit.price : null;
    // 只有「这一批真的问到了」才缓存 null：干净地答「没有这个币的报价」可以缓存，
    // 而 414/超时造成的整批缺席绝不能缓存，否则一次失败毒掉 TTL 内所有共用这些代币的地址。
    if (answered.has(a)) cacheSet('v3fees:price:' + a, { usd });
    out.set(a, usd);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 枚举某地址持有的仓位（纯链上，实时）
// ---------------------------------------------------------------------------

/**
 * 单次查询的仓位数上限。实测分布：58,727 个地址里只有 **1 个**超过 6,000 个仓位
 * （最大 9,038），所以这个上限只影响约 0.002% 的地址。超过时只查前 MAX_POSITIONS 个，
 * 并把 `partial: true` 如实报给界面 —— 绝不能让界面把部分总额说成完整总额。
 */
const MAX_POSITIONS = 6000;

export async function fetchOwned(owner, opts = {}) {
  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;
  const w = addrArg(owner);

  // 1) balanceOf + 当前区块号，一批拿回
  const head = await rpcPost([
    { jsonrpc: '2.0', id: 0, method: 'eth_call', params: [{ to: NFT, data: SEL.balanceOf + w }, 'latest'] },
    { jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] },
  ]);
  const balance = head[0] && head[0].result ? Number(BigInt(head[0].result)) : 0;
  const blockNumber = head[1] && head[1].result ? Number(BigInt(head[1].result)) : null;
  // 把本地址的**全部**读取钉在同一个区块。只在 latest 上读会让 positions 与
  // slot0/feeGrowthGlobal 落在不同区块，繁忙池子里算出来的数就是错的，不只是噪声大。
  const tag = blockNumber ? '0x' + BigInt(blockNumber).toString(16) : 'latest';
  if (!balance) return { positions: [], errors: [], balance: 0, blockNumber, partial: false };

  const target = Math.min(balance, MAX_POSITIONS);
  const truncated = balance > target;

  // 2) tokenOfOwnerByIndex 枚举
  const idxRes = await ethCallBatch(NFT, Array.from({ length: target }, (_, i) => SEL.tokenOfOwnerByIndex + w + u256(i)), null, tag);
  const ids = [];
  const errors = [];
  idxRes.forEach((r, i) => {
    if (r && r.result) ids.push(BigInt(r.result).toString());
    else errors.push({ tokenId: `#index${i}`, reason: 'enum-failed' });
  });
  if (truncated) errors.push({ tokenId: `#index${target}`, reason: 'capped', limit: MAX_POSITIONS, returned: target });
  if (!ids.length) return { positions: [], errors, balance, blockNumber, partial: truncated };

  // 3) positions(tokenId) + ownerOf(tokenId) 混批（每个 id 两个调用）
  const tasks = [];
  for (const id of ids) {
    tasks.push({ a: NFT, d: SEL.positions + u256(id), id, kind: 'pos' });
    tasks.push({ a: NFT, d: SEL.ownerOf + u256(id), id, kind: 'own' });
  }
  // tasks 里每个仓位有 **2** 个调用（positions + ownerOf），但界面关心的是**仓位**进度。
  // 曾经直接转发 (done, total)，于是 4,519 个仓位报成 9,038 —— 任何前端都会误读。
  const res = await ethCallBatchMulti(tasks, onProgress ? (d, t) => onProgress(Math.floor(d / 2), Math.floor(t / 2)) : null, tag);

  const ownerLower = owner.toLowerCase();
  const positions = [];
  const byPos = new Map();
  tasks.forEach((t, i) => {
    if (t.kind === 'pos') byPos.set(t.id, res[i]);
  });
  tasks.forEach((t, i) => {
    if (t.kind !== 'own') return;
    const r = res[i];
    const liveOwner = r && r.result ? '0x' + r.result.slice(26).toLowerCase() : null;
    // reason 是**稳定的机器码**，不是给人看的句子 —— 界面自己本地化。
    // （v1 曾在这里写中文，导致英文界面无法渲染。）
    if (!liveOwner) {
      errors.push({ tokenId: t.id, reason: 'burned' });
      return;
    }
    if (liveOwner !== ownerLower) {
      errors.push({ tokenId: t.id, reason: 'transferred' });
      return;
    }
    const p = parsePosition(t.id, byPos.get(t.id) && byPos.get(t.id).result);
    if (!p) { errors.push({ tokenId: t.id, reason: 'parse-failed' }); return; }
    p.owner = liveOwner;
    positions.push(p);
  });

  return { positions, errors, balance, blockNumber, partial: truncated };
}

// ---------------------------------------------------------------------------
// 冻结接口
// ---------------------------------------------------------------------------

/** 该地址持有的全部 V3 仓位（原始数据，含 bigint） */
export async function loadPositions(address) {
  const raw = String(address || '').trim();
  if (!isAddress(raw)) return [];
  const { positions } = await fetchOwned(raw.toLowerCase());
  return positions;
}

/** 代币 USD 价。未知返回 null，**绝不抛异常**。 */
export async function getPrice(tokenAddress) {
  const t = String(tokenAddress || '').trim().toLowerCase();
  if (!isAddress(t)) return null;
  const m = await getTokenPrices([t]);
  const v = m.get(t);
  return typeof v === 'number' ? v : null;
}

/** 数据时间戳。实时查询 → 就是现在。 */
export async function getDataTimestamp() {
  return new Date().toISOString();
}

function emptyTotals() {
  return { usd: 0, count: 0, lockedUsd: 0, unpricedCount: 0 };
}

function failResult(address, reason) {
  return {
    ok: false, address: address || null, reason,
    dataTimestamp: new Date().toISOString(), blockNumber: null,
    rows: [], totals: emptyTotals(),
  };
}

/**
 * 一站式查询：给一个地址，返回**渲染就绪**的结果。
 *
 * @param {string} address
 * @param {{ onProgress?: (done:number, total:number) => void, rpcUrls?: string[] }} [opts]
 * @returns {Promise<object>} 结构见 INTERFACE.md §4
 */
export async function query(address, opts = {}) {
  const raw = String(address || '').trim();
  if (!isAddress(raw)) return failResult(null, 'invalid-address');
  const owner = raw.toLowerCase();
  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;

  let owned;
  try {
    owned = await fetchOwned(owner, { onProgress });
  } catch {
    return failResult(owner, 'rpc-failed');
  }

  const { positions, balance, blockNumber, partial } = owned;
  // 同一个区块标签贯穿全场：positions / symbol / decimals / slot0 / feeGrowthGlobal / ticks
  // 必须都来自同一个区块。只在 latest 上读，繁忙池子里的数就是错的（不只是噪声大）。
  const tag = blockNumber ? '0x' + BigInt(blockNumber).toString(16) : 'latest';
  if (!positions.length) {
    return {
      ok: true, address: owner, dataTimestamp: new Date().toISOString(),
      blockNumber, rows: [], totals: emptyTotals(),
      positionCount: 0, balance: balance || 0,
      degenerateCount: 0, errors: owned.errors || [],
      partial: !!partial, scanned: 0, total: balance || 0,
    };
  }

  const tokens = [...new Set(positions.flatMap((p) => [p.token0, p.token1]))];

  // 报价只取「被引用最多」的前 PRICE_TOKEN_LIMIT 个：DefiLlama 是 GET + 逗号批量，
  // 几千个代币拼出来是几百 KB 的 URL，会被直接拒掉；长尾 spam 代币本来也没有报价。
  // 代币元数据（symbol/decimals）仍然**全量**读 —— decimals 猜错 USD 会差好几个数量级。
  const refCount = new Map();
  for (const p of positions) {
    for (const t of [p.token0, p.token1]) refCount.set(t, (refCount.get(t) || 0) + 1);
  }
  const priceTokens = [...refCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, PRICE_TOKEN_LIMIT)
    .map(([t]) => t);

  // 这三件事互不依赖 —— 串行做等于白等最慢的那一件（实测 18.5s + 20.1s + 2.1s + fetchState）。
  const [metaR, priceR, stateR] = await Promise.allSettled([
    getTokenMetas(tokens, tag),
    priceTokens.length ? getTokenPrices(priceTokens) : Promise.resolve(new Map()),
    fetchState(positions, {
      // 把探针量到的排名交给 kernel —— 它自己不做探测，只会按数组顺序试。
      // 直接传 RPC_URLS 原顺序的话，它就从列表第一个开始试；publicnode 掉队时
      // 要白等一整轮超时才换人。
      rpcUrls: opts.rpcUrls || rankedRpcUrls(),
      concurrency: STATE_CONCURRENCY,
      blockNumber,
      // kernel 默认 15000ms。一个挂死的端点会把整次查询按住 15 秒才肯换人，
      // 而 slot0 / feeGrowthGlobal 的正常 RTT 只有几百毫秒 —— 4 秒没回就该换。
      timeoutMs: 4000,
    }),
  ]);

  if (stateR.status !== 'fulfilled') return failResult(owner, 'rpc-failed');
  const state = stateR.value;
  const metas = metaR.status === 'fulfilled' ? metaR.value : new Map();
  const prices = priceR.status === 'fulfilled' ? priceR.value : new Map();

  const rows = [];
  let usd = 0, lockedUsd = 0, unpricedCount = 0, degenerateCount = 0;

  for (const p of positions) {
    const pool = poolAddress(p.token0, p.token1, p.fee);
    const meta0 = metas.get(p.token0) || { symbol: null, decimals: 18 };
    const meta1 = metas.get(p.token1) || { symbol: null, decimals: 18 };
    const price0 = prices.has(p.token0) ? prices.get(p.token0) : null;
    const price1 = prices.has(p.token1) ? prices.get(p.token1) : null;
    const locked = BURN_ADDRESSES.has((p.owner || '').toLowerCase());

    const r = computeFees(p, state);
    const poolState = state && state.byPool ? state.byPool.get(pool) : null;
    const inRange = poolState ? poolState.tick >= p.tickLower && poolState.tick < p.tickUpper : false;

    if (!r || !r.ok) {
      degenerateCount++;
      rows.push({
        tokenId: p.tokenId, pool, feeTier: p.fee,
        symbol0: meta0.symbol, symbol1: meta1.symbol,
        address0: p.token0, address1: p.token1,
        decimals0: meta0.decimals, decimals1: meta1.decimals,
        amount0: '0', amount1: '0',
        usd0: null, usd1: null, usd: null,
        inRange, locked: false, priceKnown: false,
        degenerate: true,
        reason: (r && r.reason) || 'unavailable',
      });
      unpricedCount++;
      continue;
    }

    // ⚠ amount0/amount1 必须是**原始整数单位**（minimal units）的十进制字符串 ——
    // INTERFACE.md §4 的冻结约定就是「原始单位」，前端拿 decimals 自己换算，
    // 才能做有效位数截断和 dust 界限。曾经这里误返回人类可读小数，
    // 导致前端 groupDigits() 把科学计数法变成 `2.569,381,473e-8`。
    const amount0 = r.fees0.toString();
    const amount1 = r.fees1.toString();
    const n0 = Number(toDecimalString(r.fees0, meta0.decimals));
    const n1 = Number(toDecimalString(r.fees1, meta1.decimals));
    const usd0 = price0 == null ? null : n0 * price0;
    const usd1 = price1 == null ? null : n1 * price1;

    let rowUsd = null;
    let priceKnown = false;
    if (usd0 != null || usd1 != null) {
      rowUsd = (usd0 || 0) + (usd1 || 0);
      priceKnown = true;
    }
    // 两个代币一个都没价 → 这一行不进总额
    if (!priceKnown) unpricedCount++;
    else if (locked) lockedUsd += rowUsd;
    else usd += rowUsd;

    rows.push({
      tokenId: p.tokenId, pool, feeTier: p.fee,
      symbol0: meta0.symbol, symbol1: meta1.symbol,
      address0: p.token0, address1: p.token1,
      decimals0: meta0.decimals, decimals1: meta1.decimals,
      amount0, amount1,
      usd0, usd1, usd: rowUsd,
      inRange, locked: !!locked, priceKnown,
    });
  }

  // 总额大的排前面
  rows.sort((a, b) => (b.usd || 0) - (a.usd || 0));

  return {
    ok: true,
    address: owner,
    dataTimestamp: new Date().toISOString(),
    blockNumber,
    rows,
    totals: { usd, count: rows.length, lockedUsd, unpricedCount },
    positionCount: rows.length,
    balance: balance || rows.length,
    degenerateCount,
    errors: owned.errors || [],
    // 进度 / 完整性字段。界面用 total 渲染「已查询 N / M」——
    // **total 指的是 balanceOf 的原始 NFT 数**，不是 ownerOf 复核后的行数。
    // partial=true 时界面必须写明「这只是部分结果」，绝不能把部分总额说成完整总额。
    partial: !!partial,
    scanned: positions.length,
    total: balance || rows.length,
  };
}

// 供开发时确认这份文件还是 mock
export const IS_MOCK = false;
