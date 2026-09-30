// 极简 JSON-RPC 客户端：eth_call 批量读 + 端点降级 + 429 退避重试。
// 零依赖（只用 fetch / AbortController，浏览器与 Node 18+ 都有）。

/** 函数选择器（与 ethers Interface 对拍过，见 test/selectors.test.mjs） */
export const SELECTORS = {
  slot0: '0x3850c7bd',
  feeGrowthGlobal0X128: '0xf3058399',
  feeGrowthGlobal1X128: '0x46141319',
  ticks: '0xf30dba93',
  ownerOf: '0x6352211e',
  tokenOfOwnerByIndex: '0x2f745c59',
  positions: '0x99fbab88',
  poolPositions: '0x514ea4bf', // pool.positions(bytes32)
  collect: '0xfc6f7865', // collect((uint256,address,uint128,uint128))
  getPool: '0x1698ee82',
  balanceOf: '0x70a08231',
  totalSupply: '0x18160ddd',
};

// 已知不支持 JSON-RPC batch 的端点（返回 HTTP 500 / 非数组）。仅作初始提示，
// 运行时会根据实际响应自动降级（见 RpcPool）。
const BATCH_HOSTILE = [/(^|\.)1rpc\.io$/i, /(^|\.)drpc\.org$/i];

// ---------------- ABI 编解码（只覆盖本项目用到的静态类型） ----------------

export function strip0x(h) {
  return h.startsWith('0x') || h.startsWith('0X') ? h.slice(2) : h;
}

/** 取第 i 个 32 字节字（hex，不带 0x） */
export function word(data, i) {
  return strip0x(data).slice(i * 64, (i + 1) * 64);
}

export function wordCount(data) {
  return strip0x(data).length / 64;
}

export function decodeUint(w) {
  return BigInt('0x' + strip0x(w));
}

/** 有符号解码：ABI 返回的是 256-bit 补码（符号已扩展） */
export function decodeInt(w) {
  const v = BigInt('0x' + strip0x(w));
  return v >= 1n << 255n ? v - (1n << 256n) : v;
}

export function decodeAddress(w) {
  return '0x' + strip0x(w).slice(24).toLowerCase();
}

export function encodeUint(v) {
  const b = BigInt(v);
  if (b < 0n) throw new Error('encodeUint: 负数');
  return b.toString(16).padStart(64, '0');
}

/** int24 等有符号整数的 ABI 编码（256-bit 补码） */
export function encodeInt(v) {
  const M = (1n << 256n) - 1n;
  return (BigInt(v) & M).toString(16).padStart(64, '0');
}

export function encodeAddress(a) {
  const h = strip0x(String(a)).toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(h)) throw new Error(`encodeAddress: 非法地址 ${a}`);
  return h.padStart(64, '0');
}

/** 拼 calldata：selector + 每个 32 字节参数 */
export function calldata(selector, ...words) {
  return selector + words.join('');
}

// ---------------- HTTP 层 ----------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function rpcErrText(err) {
  if (!err) return 'unknown';
  const m = err.data && typeof err.data === 'object' ? err.data.message : err.message;
  return String(m || err.code || JSON.stringify(err)).slice(0, 200);
}

// 端点级（而非该次调用语义上的）故障特征：配额耗尽 / 限流 / 不支持。
// 命中时不能把这一批逐项标失败就算了，必须冷却该端点并换端点重试。
const PROVIDER_ERR_RE =
  /(rate.?limit|usage limit|too many requests|quota|throttl|capacity|exceeded|upgrade|api.?key|unauthoriz|forbidden|not supported|unsupported|disabled|ip limit|limit reached|plan)/i;

function looksProviderLevel(text) {
  return PROVIDER_ERR_RE.test(String(text || ''));
}

/**
 * 多端点 JSON-RPC 池。按 batchSize 分组、concurrency 并发、
 * 429/5xx 退避重试；不支持 batch 的端点自动降级为单发。
 */
export class RpcPool {
  constructor(urls, { timeoutMs = 15000, maxRetries = 8, signal = null, backoffMs = null } = {}) {
    if (!Array.isArray(urls) || urls.length === 0) throw new Error('rpcUrls 不能为空');
    this.timeoutMs = timeoutMs;
    this.maxRetries = Math.max(1, maxRetries);
    this.signal = signal;
    // 退避基数。生产用默认值（普通错误 250ms / 端点级故障 3s）；测试可传 1 让它跑得动。
    this.backoffMs = backoffMs;
    this.cursor = 0;
    this.endpoints = urls.map((url) => {
      let hostile = false;
      try {
        hostile = BATCH_HOSTILE.some((re) => re.test(new URL(url).hostname));
      } catch {
        hostile = true; // URL 都解析不了，别指望它
      }
      return { url, batch: !hostile, coolingUntil: 0, fails: 0 };
    });
  }

  /** 退避时长（端点级故障退得更久，避免把配额耗尽的端点一直打） */
  waitMs(attempt, provider) {
    const base = this.backoffMs ?? (provider ? 1000 : 250);
    const cap = this.backoffMs ? this.backoffMs * 4 : 8000;
    const jitter = this.backoffMs ? 0 : Math.floor(Math.random() * 250);
    return Math.min(cap, base * (attempt + 1)) + jitter;
  }

  /**
   * 惩罚一个端点：冷却它、记一次失败。
   * **关键**：只要还有别的健康端点，就立刻换端点重试、一秒都不等 —— 之前无论怎样都
   * `await sleep(wait)`，端点一被限流就一路干等，端到端能拖到十几分钟。
   * 只有全池都在冷却时才睡（睡到最早解冻的那个为止）。
   */
  async penalize(ep, attempt, provider) {
    const hold = this.waitMs(attempt, provider);
    ep.coolingUntil = Date.now() + hold;
    ep.fails++;
    const now = Date.now();
    if (this.endpoints.some((x) => x !== ep && x.coolingUntil <= now)) return;
    let wait = hold;
    for (const x of this.endpoints) if (x !== ep) wait = Math.min(wait, x.coolingUntil - now);
    await sleep(Math.max(50, wait));
  }

  /** 轮询挑一个没在冷却期的端点；全在冷却就挑最早解冻的。
   *  preferBatch=true 时（多请求分组）优先能走 batch 的端点：单发通道一次一个，
   *  100 个仓位要 100 次往返，既慢又更容易撞限流。fails 少的优先。 */
  pick(preferBatch = false) {
    const now = Date.now();
    const ready = [];
    for (let i = 0; i < this.endpoints.length; i++) {
      const idx = (this.cursor + i) % this.endpoints.length;
      const ep = this.endpoints[idx];
      if (ep.coolingUntil <= now) ready.push({ ep, idx });
    }
    if (ready.length === 0) {
      let best = this.endpoints[0];
      for (const ep of this.endpoints) if (ep.coolingUntil < best.coolingUntil) best = ep;
      return best;
    }
    const batchOK = ready.filter((r) => r.ep.batch);
    const cands = preferBatch && batchOK.length ? batchOK : ready;
    cands.sort((a, b) => a.ep.fails - b.ep.fails); // 稳定排序：fails 相同保持游标顺序
    const chosen = cands[0];
    this.cursor = (chosen.idx + 1) % this.endpoints.length;
    return chosen.ep;
  }

  async post(ep, body) {
    if (this.signal && this.signal.aborted) throw abortError();
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort();
    if (this.signal) this.signal.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await fetch(ep.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      const text = await res.text();
      if (!res.ok) {
        const e = new Error(`HTTP ${res.status} ${text.slice(0, 100)}`);
        e.status = res.status;
        e.provider = res.status === 429 || res.status === 403 || res.status === 401 || looksProviderLevel(text);
        throw e;
      }
      try {
        return JSON.parse(text);
      } catch {
        const e = new Error(`响应不是 JSON：${text.slice(0, 100)}`);
        e.status = 0;
        e.batchUnsupported = true;
        throw e;
      }
    } finally {
      clearTimeout(timer);
      if (this.signal) this.signal.removeEventListener('abort', onAbort);
    }
  }

  async callBatchOnce(ep, jobs) {
    const body = jobs.map((j, i) => ({ jsonrpc: '2.0', id: i + 1, method: 'eth_call', params: j.params }));
    const json = await this.post(ep, body);
    if (!Array.isArray(json)) {
      // 注意区分两种「不是数组」：真的是单发端点（永久降级），
      // 还是端点用单个 error 信封回绝了整批（限流/额度）——后者不能永久关掉 batch 能力，
      // 否则最好的 batch 端点会因为一次限流被降级成 100 次串行单发。
      const errObj = json && typeof json === 'object' ? json.error : null;
      const text = errObj ? rpcErrText(errObj) : '';
      if (errObj && looksProviderLevel(text)) {
        const e = new Error(`batch 被端点拒绝：${text}`);
        e.provider = true;
        throw e;
      }
      const e = new Error(errObj ? `batch 端点报错：${text}` : '端点不支持 batch（响应不是数组）');
      e.batchUnsupported = true;
      throw e;
    }
    const byId = new Map();
    for (const r of json) if (r && typeof r === 'object') byId.set(r.id, r);
    return jobs.map((_, i) => {
      const r = byId.get(i + 1);
      if (!r) return { ok: false, reason: 'no-response', provider: true };
      if (r.error) {
        const t = rpcErrText(r.error);
        return { ok: false, reason: t, provider: looksProviderLevel(t) };
      }
      if (typeof r.result !== 'string') return { ok: false, reason: 'bad-result', provider: true };
      return { ok: true, result: r.result };
    });
  }

  async callOne(ep, job) {
    const json = await this.post(ep, { jsonrpc: '2.0', id: 1, method: 'eth_call', params: job.params });
    const r = Array.isArray(json) ? json[0] : json;
    if (!r) return { ok: false, reason: 'no-response', provider: true };
    if (r.error) {
      const t = rpcErrText(r.error);
      return { ok: false, reason: t, provider: looksProviderLevel(t) };
    }
    if (typeof r.result !== 'string') return { ok: false, reason: 'bad-result', provider: true };
    return { ok: true, result: r.result };
  }

  async execOn(ep, jobs) {
    if (ep.batch) {
      try {
        return await this.callBatchOnce(ep, jobs);
      } catch (e) {
        if (e.batchUnsupported || e.status === 400 || e.status === 405 || e.status === 500) {
          ep.batch = false; // 永久降级为单发
        } else {
          throw e;
        }
      }
    }
    const out = [];
    for (const j of jobs) out.push(await this.callOne(ep, j));
    return out;
  }

  async execWithRetry(jobs) {
    let last;
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      if (this.signal && this.signal.aborted) throw abortError();
      const ep = this.pick(jobs.length > 1);
      let res;
      try {
        res = await this.execOn(ep, jobs);
      } catch (e) {
        if (e.name === 'AbortError' && this.signal && this.signal.aborted) throw e;
        last = e;
        await this.penalize(ep, attempt, e.provider);
        continue;
      }
      // 逐项 error 不是异常，但整批大面积报「配额/限流/不支持」时是端点级故障，
      // 必须冷却它、换端点重试 —— 否则调用方会拿到一整片假的失败。
      const bad = res.filter((r) => !r || !r.ok);
      const providerBad = bad.filter((r) => r && r.provider).length;
      const endpointLevel =
        providerBad > 0 && (providerBad >= Math.max(1, Math.ceil(res.length / 2)) || bad.length === res.length);
      if (!endpointLevel) return res;
      last = new Error(
        bad.length === res.length ? `整组失败：${bad[0] && bad[0].reason}` : `端点异常（${providerBad}/${res.length} 项）`,
      );
      await this.penalize(ep, attempt, true);
    }
    throw new Error(`RPC 重试 ${this.maxRetries} 次仍失败：${String(last && last.message).slice(0, 160)}`);
  }

  /** 单发任意方法（eth_blockNumber / eth_call 之类），带端点轮换与退避 */
  async request(method, params = []) {
    let last;
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      if (this.signal && this.signal.aborted) throw abortError();
      const ep = this.pick();
      try {
        const json = await this.post(ep, { jsonrpc: '2.0', id: 1, method, params });
        const r = Array.isArray(json) ? json[0] : json;
        if (r && r.error) {
          const t = rpcErrText(r.error);
          const e = new Error(`${method}: ${t}`);
          e.provider = looksProviderLevel(t);
          throw e;
        }
        if (!r || r.result === undefined) throw new Error(`${method}: 空响应`);
        return r.result;
      } catch (e) {
        last = e;
        const wait = this.waitMs(attempt, e.provider);
        ep.coolingUntil = Date.now() + wait;
        ep.fails++;
        await sleep(wait);
      }
    }
    throw new Error(`${method} 重试 ${this.maxRetries} 次仍失败：${String(last && last.message).slice(0, 160)}`);
  }

  /** 分批并发跑完所有 job，返回与 jobs 等长、逐项 {ok,result|reason} 的数组；整组失败则整组 null */
  async run(jobs, { batchSize = 100, concurrency = 3, onProgress = null } = {}) {
    const out = new Array(jobs.length).fill(null);
    if (!jobs.length) return out;
    const size = Math.max(1, batchSize | 0);
    const groups = [];
    for (let s = 0; s < jobs.length; s += size) groups.push(s);
    let next = 0;
    let done = 0;
    const worker = async () => {
      for (;;) {
        const gi = next++;
        if (gi >= groups.length) return;
        const s = groups[gi];
        const n = Math.min(size, jobs.length - s);
        let res;
        try {
          res = await this.execWithRetry(jobs.slice(s, s + n));
        } catch {
          res = new Array(n).fill(null); // 该组整体失败，逐项留 null，由上层记错误
        }
        for (let i = 0; i < n; i++) out[s + i] = res[i];
        done++;
        if (onProgress) {
          try {
            onProgress({ done, total: groups.length });
          } catch {
            /* 进度回调不能影响主流程 */
          }
        }
      }
    };
    const lanes = Math.min(Math.max(1, concurrency | 0), groups.length);
    await Promise.all(Array.from({ length: lanes }, worker));
    return out;
  }
}

function abortError() {
  const e = new Error('已取消');
  e.name = 'AbortError';
  return e;
}
