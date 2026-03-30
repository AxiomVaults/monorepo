import type { Metadata } from 'next'
import Navbar from '@/components/Navbar'
import { ADDRESSES } from '@/lib/contracts'

export const metadata: Metadata = {
  title: 'Docs — Axiom Vault',
  description:
    'How Axiom Vault works, how to interact with the ERC-4626 contract programmatically, and upcoming integrations.',
}

export default function DocsPage() {
  return (
    <main className="min-h-screen bg-[#0a0a0a] text-white">
      <Navbar />

      {/* Grid bg */}
      <div className="fixed inset-0 bg-grid opacity-100 pointer-events-none" />
      <div className="fixed top-[-200px] left-1/2 -translate-x-1/2 w-[600px] h-[600px] rounded-full bg-[#e81cff]/5 blur-3xl pointer-events-none" />

      <div className="relative mx-auto max-w-4xl px-4 sm:px-6 pt-28 pb-24">
        {/* Header */}
        <div className="mb-14">
          <p className="text-xs text-[#555] uppercase tracking-widest mb-3">Documentation</p>
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight mb-4">
            Axiom <span className="text-gradient">Vault</span>
          </h1>
          <p className="text-[#888] text-lg max-w-2xl leading-relaxed">
            A Flow-native ERC-4626 vault that automates yield through ankrFLOW spread
            capture and liquid staking. Deposit WFLOW, receive axWFLOW shares, earn.
          </p>
        </div>

        {/* TOC */}
        <nav className="mb-14 p-[1.5px] rounded-2xl bg-gradient-to-br from-[#e81cff]/30 to-[#40c9ff]/30">
          <div className="bg-[#0f0f11] rounded-[14px] px-6 py-5">
            <p className="text-xs text-[#555] uppercase tracking-widest mb-4">Contents</p>
            <ol className="space-y-2 text-sm">
              {[
                ['#how-it-works',    '1. How it works'],
                ['#contracts',       '2. Contracts'],
                ['#abi-reference',   '3. ABI reference'],
                ['#code-examples',   '4. Code examples'],
                ['#integrations',    '5. Upcoming integrations'],
              ].map(([href, label]) => (
                <li key={href}>
                  <a
                    href={href}
                    className="text-[#888] hover:text-[#37FF8B] transition-colors"
                  >
                    {label}
                  </a>
                </li>
              ))}
            </ol>
          </div>
        </nav>

        {/* ─── Section 1: How it works ─────────────────────────────────────── */}
        <Section id="how-it-works" title="1. How it works">
          <p className="text-[#aaa] leading-relaxed mb-6">
            Axiom Vault is a single-asset ERC-4626 vault. Deposit WFLOW, receive{' '}
            <Code>axWFLOW</Code> shares. Yield accrues into the share price — no
            claiming, no compounding transactions. Redeem anytime for WFLOW plus
            accumulated yield.
          </p>

          <H3>Primary yield: Eisen aggregator routing</H3>
          <p className="text-[#aaa] leading-relaxed mb-4">
            On PunchSwap, ankrFLOW regularly trades at a deficit below its redemption
            value. Sellers push the price below what the underlying is actually worth
            via Ankr&apos;s protocol. We looked at 18 months of on-chain data and found a
            spread above 50 bps in 35% of weeks, averaging 243 bps during those
            windows. The yield source was sitting there untouched.
          </p>
          <p className="text-[#aaa] leading-relaxed mb-4">
            The vault captures this by implementing a{' '}
            <strong className="text-white">UniV2-compatible swap interface</strong> —
            the same factory/pair standard that every DEX aggregator already knows how
            to talk to.{' '}
            <ExternalLink href="https://eisen.finance">Eisen</ExternalLink>, Flow
            EVM&apos;s leading aggregator, scans for UniV2 factories to build its routing
            graph. When it finds <Code>AxiomFactory</Code>, it reads the pair, reads
            the reserves, and adds the vault as a venue — no partnership, no
            whitelisting, no integration work required on either side.
          </p>
          <p className="text-[#aaa] leading-relaxed mb-6">
            From that point on, whenever a trader routes an ankrFLOW/WFLOW swap
            through Eisen and our venue offers the best price, the trade lands in the
            vault. The vault receives ankrFLOW at the discount, redeems it at par
            through Ankr&apos;s staking protocol, and the profit lands in{' '}
            <Code>totalAssets</Code> — which raises the axWFLOW share price for all
            depositors. Revenue scales with swap volume routed through the vault, not
            just TVL.
          </p>

          <H3>How the Eisen routing works technically</H3>
          <p className="text-[#aaa] leading-relaxed mb-3">
            Eisen discovers the vault by calling{' '}
            <Code>AxiomFactory.getPair(WFLOW, ankrFLOW)</Code>, which returns{' '}
            <Code>AxiomUniV2Pair</Code>. The pair exposes:
          </p>
          <ul className="space-y-2 mb-6 ml-4">
            {[
              { fn: 'token0() / token1()', desc: 'Returns WFLOW and ankrFLOW — standard pair tokens.' },
              { fn: 'getReserves()', desc: 'Returns virtual reserves computed from vault liquidity and the configured discount. The spot price Eisen reads reflects the 20 bps discount we offer on ankrFLOW. No real reserves are held in the pair contract.' },
              { fn: 'swap(amount0Out, 0, to, data)', desc: 'The standard UniV2 swap call. Routes through AxiomVenue.swapRedeemableForBase(), which pulls WFLOW from the vault to pay the trader and forwards the received ankrFLOW to the redemption adapter.' },
            ].map(({ fn, desc }) => (
              <li key={fn} className="flex items-start gap-3 text-sm text-[#aaa]">
                <span className="text-[#37FF8B] shrink-0 mt-0.5">›</span>
                <span><Code>{fn}</Code> — {desc}</span>
              </li>
            ))}
          </ul>
          <p className="text-[#aaa] leading-relaxed mb-6">
            The K invariant is not enforced — the vault is not an AMM. Virtual
            reserves exist purely so aggregators can read a price. For large trades,
            use <Code>AxiomVenue.swapExactTokensForTokens()</Code> directly for
            exact pricing.
          </p>

          <H3>Secondary yield: idle capital adapters</H3>
          <p className="text-[#aaa] leading-relaxed mb-4">
            Between Eisen-routed swaps, capital sitting idle in the vault earns yield
            through four on-chain adapters managed by{' '}
            <Code>MultiStrategyManager</Code>. A keeper bot reads live APYs and calls{' '}
            <Code>autoRebalance()</Code> to shift weight to whichever adapter is
            paying most.
          </p>
          <div className="overflow-x-auto mb-6">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-[#1a1a1e]">
                  <th className="text-left text-[#555] font-normal py-2 pr-4">Adapter</th>
                  <th className="text-left text-[#555] font-normal py-2 pr-4">Strategy</th>
                  <th className="text-left text-[#555] font-normal py-2">APY</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1a1a1e]">
                {[
                  { name: 'AnkrMOREYieldAdapter', strategy: 'Stake WFLOW -> ankrFLOW, supply to MORE Markets as collateral, borrow WFLOW at 60% LTV. Leveraged staking spread in a single loop.', apy: '~12%' },
                  { name: 'AnkrYieldAdapter', strategy: 'Plain ankrFLOW liquid staking. No leverage. Exit via PunchSwap at any time.', apy: '~7%' },
                  { name: 'MORELendingAdapter', strategy: 'Supply WFLOW directly to MORE Markets lending pool. No price risk, fully liquid.', apy: '~2-6%' },
                  { name: 'PunchSwapLPAdapter', strategy: 'Provide ankrFLOW/WFLOW liquidity on PunchSwap V2. Earns swap fees from volume keeping the peg tight.', apy: '~4-11%' },
                ].map((row) => (
                  <tr key={row.name}>
                    <td className="py-3 pr-4 font-mono text-xs text-[#37FF8B] align-top">{row.name}</td>
                    <td className="py-3 pr-4 text-[#aaa] align-top">{row.strategy}</td>
                    <td className="py-3 text-[#888] align-top whitespace-nowrap">{row.apy}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <H3>User flow</H3>
          <StepList steps={[
            { n: '01', title: 'Deposit',   body: 'Call deposit(assets, receiver). Vault mints axWFLOW shares proportional to your WFLOW. Share price starts at ~1:1 and rises as yield accrues.' },
            { n: '02', title: 'Routing',   body: 'Eisen routes ankrFLOW/WFLOW swaps through the vault automatically. Each trade that lands here captures the spread between PunchSwap price and Ankr redemption value. Profit goes into totalAssets.' },
            { n: '03', title: 'Idle yield', body: 'Capital not being used for active swaps is allocated across the four adapters. The keeper rebalances to the highest-yield adapter based on live APY reads.' },
            { n: '04', title: 'Withdraw',  body: 'Call redeem(shares, receiver, owner) at any time. Vault burns axWFLOW, calculates WFLOW equivalent at current share price, and transfers to you. 10% reserve buffer ensures instant liquidity.' },
          ]} />

          <H3>Reserve buffer</H3>
          <p className="text-[#aaa] leading-relaxed">
            10% of vault assets are kept as idle WFLOW at all times. This covers
            withdrawals and incoming swap payments without waiting on staking redemption
            queues.
          </p>
        </Section>

        {/* ─── Section 2: Contracts ─────────────────────────────────────────── */}
        <Section id="contracts" title="2. Contracts">
          <p className="text-[#aaa] leading-relaxed mb-6">
            All contracts are deployed on{' '}
            <ExternalLink href="https://flowscan.io">Flow EVM</ExternalLink>{' '}
            (chain 747). Token addresses are fixture mainnet addresses.
            Axiom contract addresses will update after mainnet deployment.
          </p>

          <ContractTable rows={[
            { name: 'AxiomVault',           addr: ADDRESSES.VAULT,     note: 'ERC-4626 vault — deposit / withdraw here' },
            { name: 'WFLOW',                addr: ADDRESSES.WFLOW,     note: 'Deposit asset / withdrawal asset' },
            { name: 'ankrFLOW',             addr: ADDRESSES.ANKR_FLOW, note: 'Yield-bearing LST; vault holds this during strategy' },
            { name: 'PunchSwap pair',        addr: '0x442aE0F33d66F617AF9106e797fc251B574aEdb3', note: 'ankrFLOW/WFLOW DEX pair monitored for spread' },
            { name: 'Ankr Staking',         addr: '0xfe8189a3016cb6a3668b8ccdac520ce572d4287a', note: 'Ankr native staking contract' },
          ]} />
        </Section>

        {/* ─── Section 3: ABI reference ─────────────────────────────────────── */}
        <Section id="abi-reference" title="3. ABI reference">
          <p className="text-[#aaa] leading-relaxed mb-6">
            AxiomVault is fully ERC-4626 compliant. These are the functions you need
            for deposits, withdrawals, and position reads.
          </p>

          <FnTable rows={[
            { sig: 'deposit(uint256 assets, address receiver) → uint256 shares',       dir: 'write', desc: 'Deposit WFLOW, receive axWFLOW shares. Requires prior ERC-20 approve.' },
            { sig: 'redeem(uint256 shares, address receiver, address owner) → uint256 assets', dir: 'write', desc: 'Burn shares, receive WFLOW. Use owner = your address for own position.' },
            { sig: 'withdraw(uint256 assets, address receiver, address owner) → uint256 shares', dir: 'write', desc: 'Request exact WFLOW amount out; burns the required shares.' },
            { sig: 'previewDeposit(uint256 assets) → uint256 shares',                  dir: 'read',  desc: 'Quote: how many axWFLOW you get for a given WFLOW input. Read before depositing.' },
            { sig: 'previewRedeem(uint256 shares) → uint256 assets',                   dir: 'read',  desc: 'Quote: how much WFLOW you get for a given share amount.' },
            { sig: 'convertToAssets(uint256 shares) → uint256',                        dir: 'read',  desc: 'Current share price expressed as WFLOW per 1e18 shares.' },
            { sig: 'totalAssets() → uint256',                                          dir: 'read',  desc: 'Total WFLOW under management (on-hand + deployed + pending redemption).' },
            { sig: 'balanceOf(address) → uint256',                                     dir: 'read',  desc: 'Your axWFLOW share balance.' },
            { sig: 'maxDeposit(address) → uint256',                                    dir: 'read',  desc: 'Returns remaining capacity before the vault cap is reached (0 = uncapped).' },
          ]} />
        </Section>

        {/* ─── Section 4: Code examples ────────────────────────────────────── */}
        <Section id="code-examples" title="4. Code examples">
          <p className="text-[#888] text-sm mb-6">
            Examples use <ExternalLink href="https://viem.sh">viem</ExternalLink> v2
            and assume Flow EVM (chain 747).
          </p>

          <CodeExample
            title="Read share price + TVL"
            lang="ts"
            code={`import { createPublicClient, http, parseUnits } from 'viem'
import { flowEVM } from './chain'   // chain 747

const VAULT = '${ADDRESSES.VAULT}'

const client = createPublicClient({
  chain: flowEVM,
  transport: http('https://mainnet.evm.nodes.onflow.org'),
})

const VAULT_ABI = [
  { name: 'totalAssets',      type: 'function', stateMutability: 'view', inputs: [],                                    outputs: [{ type: 'uint256' }] },
  { name: 'convertToAssets',  type: 'function', stateMutability: 'view', inputs: [{ name: 'shares', type: 'uint256' }], outputs: [{ type: 'uint256' }] },
] as const

const [tvl, sharePrice] = await client.multicall({
  contracts: [
    { address: VAULT, abi: VAULT_ABI, functionName: 'totalAssets' },
    { address: VAULT, abi: VAULT_ABI, functionName: 'convertToAssets',
      args: [parseUnits('1', 18)] },   // price of 1 axWFLOW in WFLOW
  ]
})

console.log('TVL (WFLOW):', tvl.result)
console.log('Share price:', sharePrice.result)  // e.g. 1_023_000_000_000_000_000n`}
          />

          <CodeExample
            title="Approve + deposit"
            lang="ts"
            code={`import { createWalletClient, createPublicClient, http, parseUnits } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { flowEVM } from './chain'

const VAULT  = '${ADDRESSES.VAULT}'
const WFLOW  = '${ADDRESSES.WFLOW}'
const AMOUNT = parseUnits('100', 18)   // 100 WFLOW

const account    = privateKeyToAccount('0xYOUR_KEY')
const wallet     = createWalletClient({ account, chain: flowEVM, transport: http() })
const publicClient = createPublicClient({ chain: flowEVM, transport: http() })

const ERC20_ABI = [
  { name: 'approve', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
    outputs: [{ type: 'bool' }] },
] as const

const VAULT_ABI = [
  { name: 'deposit', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: 'assets', type: 'uint256' }, { name: 'receiver', type: 'address' }],
    outputs: [{ type: 'uint256' }] },
] as const

// 1. Approve vault to spend WFLOW
const approveTx = await wallet.writeContract({
  address: WFLOW, abi: ERC20_ABI,
  functionName: 'approve', args: [VAULT, AMOUNT],
})
await publicClient.waitForTransactionReceipt({ hash: approveTx })

// 2. Deposit — receiver = your address
const depositTx = await wallet.writeContract({
  address: VAULT, abi: VAULT_ABI,
  functionName: 'deposit', args: [AMOUNT, account.address],
})
const receipt = await publicClient.waitForTransactionReceipt({ hash: depositTx })
console.log('Deposited. Tx:', receipt.transactionHash)`}
          />

          <CodeExample
            title="Redeem shares"
            lang="ts"
            code={`// sharesAmount = your axWFLOW balance (from balanceOf or a saved value)
const sharesAmount = parseUnits('95', 18)

const VAULT_ABI = [
  { name: 'redeem', type: 'function', stateMutability: 'nonpayable',
    inputs: [
      { name: 'shares',   type: 'uint256' },
      { name: 'receiver', type: 'address' },
      { name: 'owner',    type: 'address' },
    ],
    outputs: [{ type: 'uint256' }] },
] as const

const redeemTx = await wallet.writeContract({
  address: VAULT, abi: VAULT_ABI,
  functionName: 'redeem',
  args: [sharesAmount, account.address, account.address],
})
const receipt = await publicClient.waitForTransactionReceipt({ hash: redeemTx })
console.log('Redeemed. WFLOW returned in tx:', receipt.transactionHash)`}
          />

          <CodeExample
            title="Monitor your position (polling)"
            lang="ts"
            code={`// Poll every block to track position value
const VAULT_ABI = [
  { name: 'balanceOf',       type: 'function', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'convertToAssets', type: 'function', stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [{ type: 'uint256' }] },
] as const

const watchPosition = () =>
  publicClient.watchBlocks({
    onBlock: async () => {
      const [shares, assets] = await publicClient.multicall({
        contracts: [
          { address: VAULT, abi: VAULT_ABI, functionName: 'balanceOf', args: [account.address] },
          { address: VAULT, abi: VAULT_ABI, functionName: 'convertToAssets', args: [shares ?? 0n] },
        ],
      })
      console.log('Shares:', shares.result, '| WFLOW value:', assets.result)
    },
  })

const unwatch = watchPosition()
// call unwatch() to stop`}
          />
        </Section>

        {/* ─── Section 5: Upcoming integrations ────────────────────────────── */}
        <Section id="integrations" title="5. Upcoming integrations">
          <p className="text-[#aaa] leading-relaxed mb-8">
            axWFLOW is designed to be composable. Planned integrations expand the
            utility of your vault position without requiring you to move capital.
          </p>

          <div className="space-y-5">
            <IntegrationCard
              tag="Next"
              title="axWFLOW as collateral on MORE Markets"
              body="axWFLOW will be listed as a collateral asset on MORE Markets. You deposit WFLOW into Axiom Vault, receive axWFLOW shares (which appreciate over time), supply those shares to MORE Markets, borrow WFLOW, and deposit again. The loop amplifies your yield exposure. The vault's reserve buffer ensures borrow positions don't touch illiquid staking queues."
              href="https://www.more.markets/"
              linkLabel="MORE Markets"
            />
            <IntegrationCard
              tag="Planned"
              title="axWFLOW liquidity token — transferable LST receipt"
              body="axWFLOW becomes a first-class transferable liquid staking token on Flow. Any protocol can accept it as collateral, include it in liquidity pools, or build products on top of it. The share price is monotonically increasing, making it a clean LST primitive for the Flow DeFi stack."
            />
            <IntegrationCard
              tag="Planned"
              title="Multi-asset vaults via AxiomFactory"
              body="The AxiomFactory contract can deploy identical vault instances for other Flow LSTs (stFLOW, etc.). Each vault runs the same spread-capture strategy autonomously. A shared StrategyManager can route capital across vaults based on whichever spread is widest at a given time."
            />
            <IntegrationCard
              tag="Research"
              title="Structured yield tranches"
              body="Senior tranche: fixed-rate return, backed by vault yield. Junior tranche: residual yield above the fixed rate, higher upside during high-spread periods. Tranches are issued as separate ERC-20 tokens, tradeable independently. Built on top of the existing vault without changes to the core contract."
            />
          </div>
        </Section>

        {/* Footer */}
        <footer className="mt-16 pt-8 border-t border-[#1a1a1e] flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-[#555]">
          <p>Axiom Vault &mdash; Flow EVM (Chain 747)</p>
          <div className="flex gap-4">
            <a href="/" className="hover:text-[#888] transition-colors">App</a>
            <a
              href={`https://flowscan.io/address/${ADDRESSES.VAULT}`}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-[#888] transition-colors"
            >
              Contract
            </a>
            <a href="/roadmap" className="hover:text-[#888] transition-colors">Roadmap</a>
          </div>
        </footer>
      </div>
    </main>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="mb-16 scroll-mt-24">
      <h2 className="text-2xl font-bold mb-6 text-white">{title}</h2>
      {children}
    </section>
  )
}

function H3({ children }: { children: React.ReactNode }) {
  return <h3 className="text-base font-semibold text-white mb-3 mt-6">{children}</h3>
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="text-[#37FF8B] bg-[#0f0f11] border border-[#1a1a1e] px-1.5 py-0.5 rounded text-[0.85em] font-mono">
      {children}
    </code>
  )
}

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer"
      className="text-[#37FF8B] hover:brightness-125 transition-all underline underline-offset-2">
      {children}
    </a>
  )
}

function StepList({ steps }: { steps: { n: string; title: string; body: string }[] }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 my-6">
      {steps.map((s) => (
        <div key={s.n} className="p-[1.5px] rounded-xl bg-gradient-to-br from-[#e81cff]/30 to-[#40c9ff]/30">
          <div className="bg-[#0f0f11] rounded-[10px] px-5 py-4 h-full">
            <div className="flex items-center gap-3 mb-2">
              <span className="text-xs font-mono text-[#37FF8B]">{s.n}</span>
              <span className="text-sm font-semibold text-white">{s.title}</span>
            </div>
            <p className="text-xs text-[#888] leading-relaxed">{s.body}</p>
          </div>
        </div>
      ))}
    </div>
  )
}

function ContractTable({ rows }: {
  rows: { name: string; addr: string; note: string }[]
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-[#1a1a1e]">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[#1a1a1e] bg-[#0f0f11]">
            <th className="text-left px-5 py-3 text-xs text-[#555] uppercase tracking-widest font-normal">Contract</th>
            <th className="text-left px-5 py-3 text-xs text-[#555] uppercase tracking-widest font-normal">Address</th>
            <th className="text-left px-5 py-3 text-xs text-[#555] uppercase tracking-widest font-normal hidden md:table-cell">Note</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.addr} className={`border-b border-[#1a1a1e] ${i % 2 === 0 ? 'bg-[#0a0a0a]' : 'bg-[#0f0f11]'}`}>
              <td className="px-5 py-3.5 text-white font-medium whitespace-nowrap">{r.name}</td>
              <td className="px-5 py-3.5">
                <a
                  href={`https://flowscan.io/address/${r.addr}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-xs text-[#37FF8B] hover:brightness-125 transition-all"
                >
                  {r.addr.slice(0, 10)}...{r.addr.slice(-6)}
                </a>
              </td>
              <td className="px-5 py-3.5 text-[#888] text-xs hidden md:table-cell">{r.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function FnTable({ rows }: { rows: { sig: string; dir: 'read' | 'write'; desc: string }[] }) {
  return (
    <div className="space-y-3">
      {rows.map((r) => (
        <div key={r.sig} className="p-[1px] rounded-xl border border-[#1a1a1e] bg-[#0f0f11]">
          <div className="px-5 py-4">
            <div className="flex flex-wrap items-center gap-3 mb-1.5">
              <code className="text-xs font-mono text-white break-all">{r.sig}</code>
              <span className={`shrink-0 text-[10px] px-2 py-0.5 rounded-full font-mono uppercase tracking-wider
                ${r.dir === 'read'
                  ? 'bg-[#1a1a1e] text-[#40c9ff]'
                  : 'bg-[#1a1a1e] text-[#e81cff]'}`}>
                {r.dir}
              </span>
            </div>
            <p className="text-xs text-[#888] leading-relaxed">{r.desc}</p>
          </div>
        </div>
      ))}
    </div>
  )
}

function CodeExample({
  title,
  lang,
  code,
}: {
  title: string
  lang: string
  code: string
}) {
  return (
    <div className="mb-8">
      <p className="text-sm font-semibold text-white mb-3">{title}</p>
      <div className="relative rounded-xl overflow-hidden border border-[#1a1a1e]">
        <div className="flex items-center justify-between px-5 py-2.5 bg-[#0f0f11] border-b border-[#1a1a1e]">
          <span className="text-xs text-[#555] font-mono">{lang}</span>
          <div className="flex gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-[#1a1a1e]" />
            <span className="w-2.5 h-2.5 rounded-full bg-[#1a1a1e]" />
            <span className="w-2.5 h-2.5 rounded-full bg-[#1a1a1e]" />
          </div>
        </div>
        <pre className="bg-[#050505] px-5 py-5 overflow-x-auto text-xs leading-relaxed font-mono text-[#ccc]">
          <code>{code}</code>
        </pre>
      </div>
    </div>
  )
}

function IntegrationCard({
  tag,
  title,
  body,
  href,
  linkLabel,
}: {
  tag: string
  title: string
  body: string
  href?: string
  linkLabel?: string
}) {
  const tagColor =
    tag === 'Next'    ? 'bg-[#37FF8B]/10 text-[#37FF8B]' :
    tag === 'Planned' ? 'bg-[#40c9ff]/10 text-[#40c9ff]' :
                        'bg-[#e81cff]/10 text-[#e81cff]'

  return (
    <div className="p-[1.5px] rounded-2xl bg-gradient-to-br from-[#e81cff]/25 to-[#40c9ff]/25">
      <div className="bg-[#0f0f11] rounded-[14px] px-6 py-5">
        <div className="flex items-center gap-3 mb-3">
          <span className={`text-[10px] font-mono uppercase tracking-widest px-2.5 py-1 rounded-full ${tagColor}`}>
            {tag}
          </span>
          <h3 className="text-sm font-semibold text-white">{title}</h3>
        </div>
        <p className="text-sm text-[#888] leading-relaxed">{body}</p>
        {href && linkLabel && (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 mt-3 text-xs text-[#37FF8B] hover:brightness-125 transition-all"
          >
            {linkLabel} ↗
          </a>
        )}
      </div>
    </div>
  )
}
