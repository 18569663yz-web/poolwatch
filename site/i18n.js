// v3fees/site/i18n.js
// Owner: frontend-dev.
//
// Every string on the page lives here. The English column of the copy table in
// V3手续费工具_开发计划.md §3.2 is reproduced verbatim — do not reword it here,
// and do not move it back into app.js.
//
// English is the default language on purpose. Auto-detecting from the browser
// locale would mean two people opening the same shared link see different
// pages, and shared links matter for this tool.

export const LANGS = ['en', 'zh'];
const STORAGE_KEY = 'v3fees.lang';

export const STRINGS = {
  en: {
    'lang.self': 'English',
    'page.title': 'Unclaimed Uniswap V3 fees',

    // ---- top of page
    'tip.label': 'Tip (optional)',
    'tip.note': 'The tool is free and takes no cut. Address to be published.',
    'tip.addrnote': 'This is the only address the tool controls.',
    'tip.copied': 'copied',
    'tip.never': 'This tool will never DM you, never ask for a seed phrase, and never send you a claim link.',

    'nav.fees': 'Fees',
    'nav.method': 'Method',
    'nav.github': 'GitHub',

    'eyebrow': 'Unclaimed Uniswap V3 fees',
    'h1': 'Are your LP fees still sitting in the pool?',
    'lede': 'Half-finished withdrawals, positions abandoned after going out of range, NFTs sold before collecting — the fees never left.',

    // The network-wide figure. `stat.value` is fixed copy, not a live number —
    // app.js never rewrites it when a query runs. Only a new measurement changes
    // it, together with the date inside `stat.note`.
    'stat.label': 'Unclaimed Uniswap V3 fees, Ethereum mainnet',
    'stat.value': '$38,384,084',
    'stat.scope': 'Every address combined — this is a network-wide measurement, not your balance. Your own lookup is below.',
    'stat.note': 'At least — the floor provable from pool balances alone (90 major-token pools, 2026-09-28). A full pass over all 71,818 pools puts the total near $53M.',

    'addrLabel': 'Ethereum address',
    'placeholder': '0x... or ENS',
    'check': 'Check',
    'checking': 'Reading your positions from the chain…',
    'checking.slow': 'This address holds a lot of positions. Reading them one by one…',
    'checking.progress': 'Reading positions from the chain — {done} of {total}',
    'checking.reading': 'Found {n} positions. Now reading each pool and pricing it — for an address this large that takes minutes.',

    'trust': 'Read-only. No wallet connection, no signatures. Ethereum mainnet.',
    'privacy': "We don't log or store the addresses you check.",

    // ---- states
    'rpcError': "Couldn't reach the network. Try again.",
    'rpcErrorHint': 'Your browser talks to public Ethereum RPC endpoints directly. They rate-limit, and they fail. Nothing was sent to a server of ours, because there is not one.',
    'retry': 'Try again',
    'empty': 'No V3 positions with uncollected fees for this address. If you never provided liquidity on Uniswap V3, this is expected.',
    'emptyHint': 'This covers Uniswap V3 on Ethereum mainnet, and only positions whose NFT you still hold. Other chains, v2 LP tokens and positions held inside smart contracts are not included.',

    'err.empty': 'Enter an address to check.',
    'err.invalid': "That does not look like an Ethereum address. It should be 0x followed by 40 hex characters.",
    'err.ens': 'ENS names are not resolved yet. Paste the 0x address.',
    'err.adapter': 'The lookup module failed to load. If you opened this page as a local file, open it over http instead.',

    // ---- result
    'res.one': '{n} position has uncollected fees',
    'res.many': '{n} positions have uncollected fees',
    'res.total': 'Collectable',
    'res.alsoLocked': 'A further {usd} is locked in positions nobody can ever collect.',
    'res.noneRead': 'No readable fees were found for this address.',
    'res.skipped': '{n} positions could not be read while the query ran.',
    'res.skippedOne': '1 position could not be read while the query ran.',
    'res.skippedIds': 'Skipped:',
    'res.skippedMore': '+{n} more not listed',
    // Shown instead of the error list when the per-query cap was hit: the result
    // is incomplete, so the headline number is only a lower bound.
    'res.partial': 'This query stopped early: {total} position NFTs were found and {scanned} of them were read, so the total below is a lower bound.',
    // Machine codes reported by the adapter. They are never printed raw.
    'reason.burned': 'NFT burned',
    'reason.transferred': 'moved during the query',
    'reason.enum-failed': 'the NFT list could not be read',
    'reason.parse-failed': 'onchain values unreadable',
    'reason.other': 'reason not reported',
    'res.degenerate': '{n} positions hold onchain values that can no longer be read. They are left out of the table instead of being shown as wrong numbers.',
    'res.degenerateOne': '1 position holds onchain values that can no longer be read. It is left out of the table instead of being shown as a wrong number.',
    'res.etherscan': 'Etherscan',
    'res.thPosition': 'Position',
    'res.thPool': 'Pool',
    'res.thUncollected': 'Uncollected',
    'res.inRange': 'in range',
    'res.outOfRange': 'out of range',
    'res.usdNone': 'no price feed',
    'res.showAll': 'Show all {n} positions',
    'res.showAllLocked': 'Show all {n} uncollectable positions',
    'res.showing': 'Rendering {done} of {total}…',
    'res.lowerBoundOne': 'Lower bound: one position holds a token with no reliable price, so it is left out of the total.',
    'res.lowerBoundMany': 'Lower bound: {n} positions hold tokens with no reliable price, so they are left out of the total.',
    // Replaces the dollar total entirely when not one claimable row could be
    // priced. "≥ $0.00" would be true and would read as "nothing to collect".
    'res.unpricedAll': 'Prices are unavailable right now, so these fees cannot be valued in dollars. The token amounts below are exact.',
    'res.uniTitle': "Open this position on Uniswap's official interface",
    'res.uniTitleLocked': 'Permanently uncollectable — no link',

    'lock.headOne': '1 position is permanently uncollectable',
    'lock.headMany': '{n} positions are permanently uncollectable',
    'lock.tag': 'burnt',
    'lock.note': 'The NFT for these positions sits in the burn address 0x000000000000000000000000000000000000dEaD. Nobody can ever collect them. They are not counted in the total above.',
    'lock.value': 'They hold an estimated {usd} that nobody can ever collect.',

    'cta.collect': 'Collect on Uniswap',
    'cta.note': "Collecting always goes through Uniswap's official page and pays 100% to your own wallet. We never take a cut.",

    'meta.dataTime': "Amounts as of {time}. Fees keep accruing — you'll likely collect slightly more.",
    'meta.block': 'Block {n}',
    'meta.scanned': 'Read {scanned} of the {total} position NFTs this address holds.',
    'meta.balance': 'The address holds {n} Uniswap V3 position NFTs on mainnet.',
    'meta.usd': 'USD values are estimates. Token amounts are exact.',

    'copy.copy': 'copy',
    'copy.done': 'copied',

    // ---- sections
    'how.title': 'How to collect',
    'how.s1': 'Enter a public address above. That is all the tool ever asks for.',
    'how.s2': "Open the position on Uniswap's own interface with the link beside it.",
    'how.s3': 'Press Collect there and sign with your own wallet. The fees go straight to that wallet.',
    'how.note1': "Collecting always goes through Uniswap's official page and pays 100% to your own wallet. We never take a cut.",
    'how.note2': 'One collect takes everything. Uniswap settles the fees still accruing inside the pool at the same moment, so a single transaction is enough — you do not need to decrease liquidity first.',

    'safety.title': 'Safety',
    'safety.lead': 'Money that nobody has claimed attracts people who want to take it. Three rules cover almost every attack:',
    'safety.r1': 'Never share a seed phrase or private key. No tool, and no member of any team, will ever need it.',
    'safety.r2': 'Never approve a contract to "unlock" or "release" fees. Collecting is an ordinary transaction you sign yourself, on Uniswap.',
    'safety.r3': 'No one will message you first with a claim link. If someone DMs you about this page, it is not us.',
    'safety.dm': 'We will never DM you first, never ask for a seed phrase, and never send claim links.',
    'safety.clone': 'Anyone can copy a website. A clone of this page exists only to get a signature out of you. This tool never asks you to connect a wallet, so if any page built to look like it does, close the tab. Check the address bar first.',

    'tipsec.title': 'Tip (optional)',
    'tipsec.body': 'There is no account, no paywall and no cut. If this page found you money and you feel like sending something back, the address at the very top of this page is the only one the tool controls.',
    'tipsec.body2': 'Sending a tip is never required to see or collect your own fees. Nothing about the result changes if you skip it.',

    // The Method section is supplied verbatim by the lead in v3fees/METHOD.md.
    // Do not reword, shorten, or reorder it here — the limitations list in
    // particular is the strongest trust material on the page, so it stays whole.
    // Bodies are block text: blank line separates paragraphs, a line starting
    // with ``` opens a code block, `-`/`1.` lines become lists, and inline
    // `code` / **bold** are rendered by rich.js.
    'method.title': 'Method',
    'method.intro': 'This tool answers one question: how much in Uniswap V3 liquidity fees is sitting uncollected in a wallet you can name. You paste an address. We read the chain. Nothing else.',

    'method.total.title': 'The number at the top of this page',
    'method.total.body': [
      'One figure on this site does not belong to any wallet: the $38,384,084 at the top of the page is the total Uniswap V3 liquidity fees left uncollected across Ethereum mainnet, measured on **2026-09-28**. It is a static snapshot, not a live chain read, and it is not your balance.',
      '',
      'We only claim what the pools themselves can prove. For 90 major-token pools we take the token balances the pool reports and subtract the principal that its liquidity providers are still owed (`pool balance − recomputed principal`). Every pool in that set is measured one by one — there is no sampling and no extrapolation.',
      '',
      '- Anything that cannot be proven from on-chain data is left out rather than estimated.',
      '- The other ~71,000 pools are not counted at all.',
      '- Both omissions can only move the true figure up, which is why the headline number is a **floor**: at least $38,384,084.',
      '',
      'For scale: a full pass over all 71,818 pools puts the total near $53,319,511. That pass leans on more assumptions, so the page headlines the smaller number that is harder to argue with.',
      '',
      'Snapshot date: **2026-09-28**. The figure does not change between snapshots. The balance you see after looking up an address is a different measurement — computed from the chain live, for that address only. The two are never the same number.',
    ].join('\n'),
    'method.formula.title': 'Where the number comes from',
    'method.formula.body': [
      'Every Uniswap V3 liquidity position is an ERC-721 NFT held by the `NonfungiblePositionManager` contract at `0xC36442b4a4522E871399CD717aBDD847Ab11FE88`. The NFT records your liquidity and your price range. It does **not** record the fees you have earned, and it does not pay them to you.',
      '',
      'To find your positions we call `balanceOf` and `tokenOfOwnerByIndex` on that contract — the standard ERC-721 enumeration interface.',
      '',
      "For each position we recompute the fees from the pool's live state:",
      '',
      '```',
      'feeGrowthInside = cumulative fees per unit of liquidity, inside your range',
      'fees = liquidity × (feeGrowthInside_now − feeGrowthInside_at_your_last_update) / 2^128',
      'total = fees + tokensOwed',
      '```',
      '',
      '`tokensOwed` is the amount already moved aside by a `decreaseLiquidity` call. Everything else is still accruing in the pool and has to be recomputed.',
      '',
      '**Pool state we read**: `slot0` (current tick), `feeGrowthGlobal0X128`, `feeGrowthGlobal1X128`, `ticks(tickLower)`, `ticks(tickUpper)`.'
    ].join('\n'),

    'method.stuck.title': 'Why the money gets stuck',
    'method.stuck.body': [
      '1. **You removed liquidity but never collected.** Exiting a V3 position is two transactions: `decreaseLiquidity`, then `collect`. Plenty of people stop after the first one.',
      '2. **Your position fell out of range and you stopped looking.** The fees keep accruing whether or not the position is in range — but only while it is in range does the counter move quickly.',
      '3. **You sold or transferred the NFT without collecting first.** The fees belonged to whoever held the NFT at the moment of collection. If you sold it, they went with it.'
    ].join('\n'),

    'method.reads.title': 'What we read, and what we never do',
    'method.reads.body': [
      'We call exactly these, all read-only, all `eth_call`:',
      '`balanceOf` · `tokenOfOwnerByIndex` · `positions` · `ownerOf` · `slot0` · `feeGrowthGlobal0X128` · `feeGrowthGlobal1X128` · `ticks` · `symbol` · `decimals`',
      '',
      'We never:',
      '- ask you to connect a wallet',
      '- ask for a signature',
      '- ask for a seed phrase or private key',
      '- send a transaction',
      '- store, log, or share the address you searched',
      '',
      'Every one of these calls goes from your browser directly to a public RPC endpoint. We run no server that could see them. We do not know who you are or what you searched.'
    ].join('\n'),

    'method.limits.title': 'Limitations — please read these',
    'method.limits.body': [
      '- This covers Uniswap V3 and its forks on **Ethereum mainnet only**. Other chains are not in yet.',
      '- It covers positions whose NFT **you still hold**. If you transferred or sold it, the right to collect went with it — correctly.',
      '- Positions whose NFT sits in the burn address `0x…dead` can never be collected. We show them, marked, and exclude them from the total.',
      '- USD figures are estimates from DefiLlama spot prices. Tokens with no available price are left out of the total, which makes the total a **lower bound**.',
      '- Fees accrue every block. A figure that was correct when the page loaded drifts upward.',
      "- Uniswap V3 stores each position's fee delta in 128 bits. For a small number of very old, very large positions that value overflows on-chain and is meaningless. We detect those and mark them instead of printing a fake number.",
      '- A V3 pool treats every position sharing the same `(contract, tickLower, tickUpper)` range as **one shared balance**, and applies `floor()` only once, at the pool level. We compute each position on its own. So the figure we show is the **mathematical entitlement**, while `collect()` pays `min(entitlement, pool balance)` — which can be a few wei less. Across 2,000+ position-by-position comparisons against a live `collect()` call, the gap was always in that direction (we never under-report), never more than **6 wei**, and never visible: the displayed amount is identical to eight decimal places. We report the entitlement rather than the payout because modelling the pool\'s rounding would cost one extra on-chain read per position, to recover a few wei.',
      '- This is a read-only tool. It cannot collect on your behalf, and it never will.'
    ].join('\n'),

    'method.collect.title': 'Collecting',
    'method.collect.body': [
      'We do not collect for you. Collection happens in the official interface:',
      '',
      '**app.uniswap.org → Pools → your position → Collect**',
      '',
      'That transaction pays you directly. We take nothing. There is no need to trust us, because nothing about the recovery path passes through us.',
      '',
      'If anyone ever DMs you offering to collect for you, they are stealing from you. Nobody needs your seed phrase to collect your own fees.'
    ].join('\n'),

    'method.verify.title': 'Verifying this yourself',
    'method.verify.body': [
      '`positions(tokenId)` and `collect(tokenId, recipient, amount0Max, amount1Max)` are both public. Calling `collect` on a position returns the exact amount owed — it is the ground truth we test against.',
      '',
      'Our computation reproduces `collect` exactly, to the wei. The one caveat is the shared pool balance (see Limitations): we report the mathematical entitlement of a position, and `collect` pays `min(entitlement, what the pool can pay)`. Account for that minimum and the two agree with zero difference. Positions you can check: `154097`, `31847`, `137280`, `62348`, `41320`.',
      '',
      'If our number and `collect` ever disagree, `collect` is right and we are wrong. Tell us.'
    ].join('\n'),

    'method.freshness': 'Chain reads are live on every query. Prices are cached for 5 minutes. This page is not affiliated with Uniswap Labs.',

    'foot.how': 'How to collect',
    'foot.safety': 'Safety',
    'foot.tip': 'Tip (optional)',
    'foot.method': 'Method',
    'foot.chain': 'Ethereum mainnet · Uniswap V3',
    'foot.asof': 'data as of',
    'foot.independent': 'Independent onchain research.',
    'foot.source': 'No cookies. No analytics. No wallet connection. No server of ours.',
  },

  zh: {
    'lang.self': '中文',
    'page.title': '未领取的 Uniswap V3 手续费',

    'tip.label': '打赏（可选）',
    'tip.note': '工具免费，不抽成。地址待公布。',
    'tip.addrnote': '这是这个工具唯一持有的地址。',
    'tip.copied': '已复制',
    'tip.never': '本工具永远不会私信你、不会要助记词、不会给你发领取链接。',

    'nav.fees': '查询',
    'nav.method': '方法',
    'nav.github': 'GitHub',

    'eyebrow': '未领取的 Uniswap V3 手续费',
    'h1': '你的 LP 手续费还在池子里吗？',
    'lede': '撤仓只做了一半、仓位出了区间就忘了、NFT 卖掉了但手续费没先领——钱一直都还在。',

    'stat.label': '以太坊主网未领取的 Uniswap V3 手续费',
    'stat.value': '$38,384,084',
    'stat.scope': '所有地址合计 —— 这是一个全网测量值，不是你的余额。你自己的查询在下方。',
    'stat.note': '至少 —— 这是仅凭池内余额就能证明的下限（90 个主流代币池，2026-09-28）。对全部 71,818 个池子做全量统计约为 5300 万美元。',

    'addrLabel': '以太坊地址',
    'placeholder': '0x... 或 ENS 域名',
    'check': '查询',
    'checking': '正在从链上读取你的仓位…',
    'checking.slow': '这个地址仓位较多，正在逐个读取…',
    'checking.progress': '正在从链上读取仓位 —— {done} / {total} 次合约读取',
    'checking.reading': '找到 {n} 个仓位，正在逐个读取池子状态并报价——地址很大时要几分钟。',

    'trust': '只读。不连钱包，不签名。以太坊主网。',
    'privacy': '我们不记录、不存储你查询的地址。',

    'rpcError': '连不上网络，请重试。',
    'rpcErrorHint': '你的浏览器直接访问公共以太坊 RPC 节点。它们会限流，也会挂掉。没有任何数据经过我们的服务器——因为根本没有服务器。',
    'retry': '重试',
    'empty': '这个地址没有未领取的 V3 手续费。如果你从没在 Uniswap V3 上做过 LP，这是正常的。',
    'emptyHint': '只覆盖以太坊主网的 Uniswap V3，而且只覆盖 NFT 仍在你手上的仓位。其他链、v2 的 LP 代币、以及存放在合约里的仓位都不在覆盖范围内。',

    'err.empty': '请输入要查询的地址。',
    'err.invalid': '这不像一个以太坊地址。应该是 0x 加 40 位十六进制字符。',
    'err.ens': '暂不支持 ENS 域名解析，请粘贴 0x 地址。',
    'err.adapter': '查询模块加载失败。如果你是直接用本地文件打开的，请改用 http 打开。',

    'res.one': '{n} 个仓位还有未领手续费',
    'res.many': '{n} 个仓位还有未领手续费',
    'res.total': '可领取',
    'res.alsoLocked': '另有 {usd} 锁在没人能领走的仓位里。',
    'res.noneRead': '这个地址上没读出任何可领取的手续费。',
    'res.skipped': '读取过程中有 {n} 个仓位读不出来。',
    'res.skippedOne': '读取过程中有 1 个仓位读不出来。',
    'res.skippedIds': '已跳过：',
    'res.skippedMore': '另有 {n} 个未列出',
    // 命中单次查询上限时用它替代错误列表：结果是残缺的，所以上面的总额只是下界。
    'res.partial': '本次查询提前停止：共找到 {total} 个仓位 NFT，只读取了其中 {scanned} 个，因此下面的总额是下界。',
    'reason.burned': 'NFT 已销毁',
    'reason.transferred': '查询期间被转走',
    'reason.enum-failed': 'NFT 列表读不出来',
    'reason.parse-failed': '链上数值读不出来',
    'reason.other': '未报告原因',
    'res.degenerate': '{n} 个仓位的链上数值已经读不出来。它们没有列进表格，以免显示错误数字。',
    'res.degenerateOne': '有 1 个仓位的链上数值已经读不出来。它没有列进表格，以免显示错误数字。',
    'res.etherscan': 'Etherscan',
    'res.thPosition': '仓位',
    'res.thPool': '池子',
    'res.thUncollected': '未领',
    'res.inRange': '在区间内',
    'res.outOfRange': '已出区间',
    'res.usdNone': '无价格',
    'res.showAll': '显示全部 {n} 个仓位',
    'res.showAllLocked': '显示全部 {n} 个无法领取的仓位',
    'res.showing': '正在渲染 {done} / {total}…',
    'res.lowerBoundOne': '这是下界：有 1 个仓位持有的代币没有可靠价格，未计入合计。',
    'res.lowerBoundMany': '这是下界：有 {n} 个仓位持有的代币没有可靠价格，未计入合计。',
    'res.unpricedAll': '暂时拿不到报价，这些手续费无法折算成美元。下面的代币数量是准确的。',
    'res.uniTitle': '在 Uniswap 官方界面打开这个仓位',
    'res.uniTitleLocked': '永久无法领取——不给链接',

    'lock.headOne': '有 1 个仓位永久无法领取',
    'lock.headMany': '有 {n} 个仓位永久无法领取',
    'lock.tag': '已销毁',
    'lock.note': '这些仓位的 NFT 在销毁地址 0x000000000000000000000000000000000000dEaD 手里，永远没有人能领走。它们不计入上面的合计。',
    'lock.value': '它们身上压着大约 {usd}，没有人能领走。',

    'cta.collect': '去 Uniswap 领取',
    'cta.note': '领取永远走 Uniswap 官方页面，100% 进你自己的钱包。我们一分不抽。',

    'meta.dataTime': '金额截至 {time}。手续费仍在累积，实际领取会略多。',
    'meta.block': '区块 {n}',
    'meta.scanned': '读取了该地址持有的 {total} 个仓位 NFT 中的 {scanned} 个。',
    'meta.balance': '该地址在主网上持有 {n} 个 Uniswap V3 仓位 NFT。',
    'meta.usd': 'USD 是估算值，代币数额是精确值。',

    'copy.copy': '复制',
    'copy.done': '已复制',

    'how.title': '怎么领',
    'how.s1': '在上面填一个公开地址。这个工具只会问这一件事。',
    'how.s2': '点旁边的链接，在 Uniswap 官方界面打开这个仓位。',
    'how.s3': '在那里点 Collect，用你自己的钱包签名。手续费直接进那个钱包。',
    'how.note1': '领取永远走 Uniswap 官方页面，100% 进你自己的钱包。我们一分不抽。',
    'how.note2': '一次领取就能全部拿到。Uniswap 在同一次交易里就会把池子里正在累积的部分结算掉，所以不需要先撤流动性。',

    'safety.title': '安全提示',
    'safety.lead': '没人领的钱会招来想拿走它的人。下面三条规则能挡住几乎所有攻击：',
    'safety.r1': '永远不要交出助记词或私钥。没有任何工具、也没有任何人需要它。',
    'safety.r2': '永远不要为了「解锁」「释放」手续费去授权某个合约。领取就是你自己签的一笔普通交易，在 Uniswap 上。',
    'safety.r3': '不会有人主动私信给你领取链接。如果有人因为这个页面来找你，那不是我们。',
    'safety.dm': '我们永远不会主动私信你，不会要助记词，也不会发任何领取链接。',
    'safety.clone': '网站谁都能抄。仿冒这个页面的站，唯一目的就是骗你签一笔东西。这个工具从不要求你连接钱包——如果哪个长得像它的页面要求了，直接关掉标签页。先看地址栏。',

    'tipsec.title': '打赏（可选）',
    'tipsec.body': '没有账号、没有付费墙、不抽成。如果这个页面帮你找到了钱，你也想回一点，页面最上面那个地址是这个工具唯一持有的地址。',
    'tipsec.body2': '打赏从来不是查看或领取你自己手续费的前提。不给，结果不会有任何变化。',

    'method.title': '方法',
    'method.intro': '这个工具只回答一个问题：某个地址在 Uniswap V3 里，有多少手续费还没领。你贴一个地址，我们读链。仅此而已。',

    'method.total.title': '页面顶部那个数字',
    'method.total.body': [
      '本站有一个数字不属于任何钱包：页面顶部的 $38,384,084，是截至 **2026-09-28**、以太坊主网上全部未领取的 Uniswap V3 流动性手续费。它是一个静态快照，不是实时链上读取，也不是你的余额。',
      '',
      '我们只声称池子自身能证明的部分：对 90 个主流代币池，取池子自己报出的代币余额，再减去仍需归还给流动性提供者的本金（`池子余额 − 重算本金`）。这个集合里的池子逐一测量 —— 不抽样，也不外推。',
      '',
      '- 凡是无法从链上数据证明的，一律不计，而不是估一个数。',
      '- 其余约 7 万个池子完全没有计入。',
      '- 这两处舍弃只会让真实数字更大，所以头条数字是一个**下限**：至少 $38,384,084。',
      '',
      '作为量级参考：对全部 71,818 个池子做全量统计约为 $53,319,511。那套统计依赖更多假设，所以页面头条放的是那个更小、也更难被反驳的数字。',
      '',
      '快照日：**2026-09-28**。这个数字在两次快照之间不会变。你查询某个地址后看到的余额是另一个测量 —— 它是对该地址实时从链上算出来的，两者永远不是同一个数。',
    ].join('\n'),
    'method.formula.title': '这个数字是怎么来的',
    'method.formula.body': [
      '每一个 Uniswap V3 流动性仓位都是一枚 ERC-721 NFT，由 `0xC36442b4a4522E871399CD717aBDD847Ab11FE88` 这个 `NonfungiblePositionManager` 合约持有。NFT 记录你的流动性和价格区间，**不**记录你已经赚到的手续费，也不会自动付给你。',
      '',
      '要找到你的仓位，我们调这个合约的 `balanceOf` 和 `tokenOfOwnerByIndex` —— 就是 ERC-721 标准的枚举接口。',
      '',
      '对每个仓位，我们从池子的实时状态重算手续费：',
      '',
      '```',
      'feeGrowthInside = 你的区间内，每单位流动性累计到的手续费',
      'fees = liquidity × (当前的 feeGrowthInside − 你上次更新时的 feeGrowthInside) / 2^128',
      '合计 = fees + tokensOwed',
      '```',
      '',
      '`tokensOwed` 是调过 `decreaseLiquidity` 之后已经划出来的部分。其余仍在池子里累积，必须重算。',
      '',
      '**我们读的池子状态**：`slot0`（当前 tick）、`feeGrowthGlobal0X128`、`feeGrowthGlobal1X128`、`ticks(tickLower)`、`ticks(tickUpper)`。'
    ].join('\n'),

    'method.stuck.title': '钱为什么会被忘在里面',
    'method.stuck.body': [
      '1. **你撤了流动性，但没领。** 退出 V3 仓位是两笔交易：先 `decreaseLiquidity`，再 `collect`。很多人做到第一步就停了。',
      '2. **仓位跑出了区间，你就没再看它。** 手续费一直在累积 —— 但只要不在区间内，计数器就走得很慢。',
      '3. **你卖掉或转走了 NFT，却没先领。** 谁在领取那一刻持有 NFT，手续费就归谁。你卖了，它就跟着走了。'
    ].join('\n'),

    'method.reads.title': '我们读什么，以及我们永远不做什么',
    'method.reads.body': [
      '我们只调这些，全部只读，全部是 `eth_call`：',
      '`balanceOf` · `tokenOfOwnerByIndex` · `positions` · `ownerOf` · `slot0` · `feeGrowthGlobal0X128` · `feeGrowthGlobal1X128` · `ticks` · `symbol` · `decimals`',
      '',
      '我们永远不：',
      '- 让你连钱包',
      '- 要你签名',
      '- 要助记词或私钥',
      '- 发交易',
      '- 存储、记录或分享你查的地址',
      '',
      '上述每一次调用，都是从你的浏览器直接发往公共 RPC 节点。我们没有服务器能看到它们。我们不知道你是谁，也不知道你查了什么。'
    ].join('\n'),

    'method.limits.title': '局限 —— 请务必读完',
    'method.limits.body': [
      '- 目前只覆盖 **以太坊主网** 上的 Uniswap V3 及其分叉。其他链还没有。',
      '- 只覆盖 NFT **仍在你手上**的仓位。如果你转走或卖掉了，领取权就跟着走了 —— 这是对的。',
      '- NFT 落在销毁地址 `0x…dead` 上的仓位永远领不回来。我们会显示它们并标记，但不计入总额。',
      '- USD 金额是按 DefiLlama 现货价估算的。没有报价的代币不计入总额，所以总额是**下界**。',
      '- 手续费每个区块都在累积。页面打开时正确的数字，之后会往上飘。',
      '- Uniswap V3 用 128 位存每个仓位的手续费增量。极少数又老又大的仓位，这个值在链上会溢出、没有意义。我们会识别并标记，而不是印一个假数字。',
      '- V3 的池子把**同一个 `(合约, tickLower, tickUpper)` 区间**里的所有仓位当成**一个共享余额**，`floor()` 只在池子这一层做一次；我们是逐仓计算的。所以我们显示的是**数学权益**，而 `collect()` 实付的是 `min(权益, 池子余额)` —— 可能少几个 wei。在 2,000+ 次与链上 `collect()` 的逐仓对拍里，这个差永远是同一个方向（我们从不少报），最大 **6 wei**，而且看不出来：显示的金额在 8 位小数上完全相同。我们选择报权益而不是实付额，因为要为池子的取整建模，就得给每个仓位多读一次链，只为换回几个 wei。',
      '- 这是一个只读工具。它不能替你领取，也永远不会。'
    ].join('\n'),

    'method.collect.title': '怎么领',
    'method.collect.body': [
      '我们不替你领。领取在官方界面完成：',
      '',
      '**app.uniswap.org → Pools → 你的仓位 → Collect**',
      '',
      '那笔交易直接把钱付给你。我们一分不拿。你不需要信任我们，因为这条领取路径完全不经过我们。',
      '',
      '如果有人私信你说可以帮你领，那是在偷你的钱。领自己的手续费，任何人都不需要你的助记词。'
    ].join('\n'),

    'method.verify.title': '如何自己验证',
    'method.verify.body': [
      '`positions(tokenId)` 和 `collect(tokenId, recipient, amount0Max, amount1Max)` 都是公开函数。对某个仓位调 `collect`，返回的就是它确切欠你的金额 —— 这是我们用来对拍的**真值**。',
      '',
      '我们的计算结果与 `collect` 完全一致，精确到 wei。唯一要说明的是池子的共享余额（见「局限」）：我们报的是仓位的**数学权益**，而 `collect` 支付的是 `min(权益, 池子能付的)`。把这个上限算进去，两边零差异。可以自己验的仓位：`154097`、`31847`、`137280`、`62348`、`41320`。',
      '',
      '如果我们的数字和 `collect` 对不上，`collect` 是对的，我们是错的。请告诉我们。'
    ].join('\n'),

    'method.freshness': '链上读取每次查询都实时。报价缓存 5 分钟。本页与 Uniswap Labs 没有关联。',

    'foot.how': '怎么领',
    'foot.safety': '安全提示',
    'foot.tip': '打赏（可选）',
    'foot.method': '方法',
    'foot.chain': '以太坊主网 · Uniswap V3',
    'foot.asof': '数据截至',
    'foot.independent': '独立的链上研究。',
    'foot.source': '没有 cookie，没有统计，不连钱包，没有我们的服务器。',
  },
};

/** Interpolate {name} placeholders. Missing values are left visible on purpose. */
export function t(lang, key, vars) {
  const table = STRINGS[lang] || STRINGS.en;
  let s = table[key];
  if (s === undefined) s = STRINGS.en[key];
  if (s === undefined) return key;
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, name) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : m);
}

/** English is the default; ?lang= wins, then the stored choice. */
export function detectLang() {
  try {
    const q = new URLSearchParams(location.search).get('lang');
    if (q && LANGS.indexOf(q.slice(0, 2)) !== -1) return q.slice(0, 2);
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && LANGS.indexOf(stored) !== -1) return stored;
  } catch (_) { /* private mode, file://, whatever — English is fine */ }
  return 'en';
}

export function rememberLang(lang) {
  try { localStorage.setItem(STORAGE_KEY, lang); } catch (_) { /* ignore */ }
}

export function htmlLang(lang) {
  return lang === 'zh' ? 'zh-Hans' : 'en';
}
