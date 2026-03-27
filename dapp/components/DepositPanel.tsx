'use client'

import { useState, useEffect } from 'react'
import {
  useAccount,
  useReadContracts,
  useWriteContract,
  useWaitForTransactionReceipt,
} from 'wagmi'
import { useWeb3Modal } from '@web3modal/wagmi/react'
import { parseUnits, formatUnits, maxUint256 } from 'viem'
import { ADDRESSES, VAULT_ABI, ERC20_ABI } from '@/lib/contracts'
import { formatAmount, cn } from '@/lib/utils'

type Tab = 'deposit' | 'withdraw'

const vaultContract = { address: ADDRESSES.VAULT, abi: VAULT_ABI } as const
const wflowContract = { address: ADDRESSES.WFLOW, abi: ERC20_ABI } as const

export default function DepositPanel() {
  const { address, isConnected } = useAccount()
  const { open } = useWeb3Modal()
  const [tab, setTab] = useState<Tab>('deposit')
  const [input, setInput] = useState('')

  const amountParsed = (() => {
    try {
      if (!input || isNaN(Number(input))) return 0n
      return parseUnits(input, 18)
    } catch {
      return 0n
    }
  })()

  // ── Read state ──────────────────────────────────────────────────────────────
  const { data, refetch } = useReadContracts({
    contracts: [
      // WFLOW balance of user
      { ...wflowContract, functionName: 'balanceOf', args: address ? [address] : undefined },
      // WFLOW allowance to vault
      { ...wflowContract, functionName: 'allowance', args: address ? [address, ADDRESSES.VAULT] : undefined },
      // axWFLOW share balance of user
      { ...vaultContract, functionName: 'balanceOf', args: address ? [address] : undefined },
      // Preview deposit (shares out)
      { ...vaultContract, functionName: 'previewDeposit', args: amountParsed > 0n ? [amountParsed] : undefined },
      // Preview redeem (assets out)
      { ...vaultContract, functionName: 'previewRedeem', args: amountParsed > 0n ? [amountParsed] : undefined },
    ],
    query: { enabled: !!address },
  })

  const wflowBalance   = (data?.[0].result as bigint | undefined) ?? 0n
  const wflowAllowance = (data?.[1].result as bigint | undefined) ?? 0n
  const shareBalance   = (data?.[2].result as bigint | undefined) ?? 0n
  const previewShares  = (data?.[3].result as bigint | undefined) ?? 0n
  const previewAssets  = (data?.[4].result as bigint | undefined) ?? 0n

  const needsApproval = tab === 'deposit' && amountParsed > 0n && wflowAllowance < amountParsed

  // ── Write hooks ─────────────────────────────────────────────────────────────
  const { writeContract, data: txHash, isPending: isWritePending, reset } = useWriteContract()
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash: txHash })

  // Refetch balances after confirmed tx
  useEffect(() => {
    if (isConfirmed) {
      refetch()
      setInput('')
      reset()
    }
  }, [isConfirmed, refetch, reset])

  // ── Handlers ────────────────────────────────────────────────────────────────
  function handleApprove() {
    writeContract({
      ...wflowContract,
      functionName: 'approve',
      args: [ADDRESSES.VAULT, maxUint256],
    })
  }

  function handleDeposit() {
    if (!address || amountParsed === 0n) return
    writeContract({
      ...vaultContract,
      functionName: 'deposit',
      args: [amountParsed, address],
    })
  }

  function handleWithdraw() {
    if (!address || amountParsed === 0n) return
    writeContract({
      ...vaultContract,
      functionName: 'redeem',
      args: [amountParsed, address, address],
    })
  }

  function setMax() {
    const balance = tab === 'deposit' ? wflowBalance : shareBalance
    setInput(formatUnits(balance, 18))
  }

  // ── Derived display ─────────────────────────────────────────────────────────
  const userBalance = tab === 'deposit' ? wflowBalance : shareBalance
  const balanceLabel = tab === 'deposit' ? 'WFLOW' : 'axWFLOW'
  const previewLabel = tab === 'deposit'
    ? `You receive: ${formatAmount(previewShares)} axWFLOW`
    : `You receive: ${formatAmount(previewAssets)} WFLOW`

  const isBusy = isWritePending || isConfirming
  const isAmountValid = amountParsed > 0n && amountParsed <= userBalance

  function actionButton() {
    if (!isConnected) {
      return (
        <button
          onClick={() => open()}
          className="w-full py-4 rounded-xl font-semibold text-black bg-[#37FF8B] hover:brightness-110 transition-all active:scale-[0.98]"
        >
          Connect Wallet
        </button>
      )
    }

    if (isBusy) {
      return (
        <button
          disabled
          className="w-full py-4 rounded-xl font-semibold text-black bg-[#37FF8B] opacity-60 cursor-not-allowed flex items-center justify-center gap-2"
        >
          <Spinner />
          {isConfirming ? 'Confirming...' : 'Pending...'}
        </button>
      )
    }

    if (tab === 'deposit' && needsApproval) {
      return (
        <button
          onClick={handleApprove}
          disabled={!isAmountValid}
          className={cn(
            'w-full py-4 rounded-xl font-semibold transition-all active:scale-[0.98]',
            isAmountValid
              ? 'text-black bg-[#37FF8B] hover:brightness-110'
              : 'text-[#555] bg-[#1a1a1e] cursor-not-allowed'
          )}
        >
          Approve WFLOW
        </button>
      )
    }

    if (tab === 'deposit') {
      return (
        <button
          onClick={handleDeposit}
          disabled={!isAmountValid}
          className={cn(
            'w-full py-4 rounded-xl font-semibold transition-all active:scale-[0.98]',
            isAmountValid
              ? 'text-black bg-[#37FF8B] hover:brightness-110'
              : 'text-[#555] bg-[#1a1a1e] cursor-not-allowed'
          )}
        >
          Deposit WFLOW
        </button>
      )
    }

    return (
      <button
        onClick={handleWithdraw}
        disabled={!isAmountValid}
        className={cn(
          'w-full py-4 rounded-xl font-semibold transition-all active:scale-[0.98]',
          isAmountValid
            ? 'text-black bg-[#37FF8B] hover:brightness-110'
            : 'text-[#555] bg-[#1a1a1e] cursor-not-allowed'
        )}
      >
        Withdraw WFLOW
      </button>
    )
  }

  return (
    <div className="p-[1.5px] rounded-2xl bg-gradient-to-br from-[#e81cff] to-[#40c9ff] relative">
      {/* ambient glow */}
      <div className="absolute inset-0 blur-2xl bg-gradient-to-br from-[#e81cff] to-[#40c9ff] opacity-15 rounded-2xl pointer-events-none animate-pulse-glow" />

      <div className="relative bg-[#0f0f11] rounded-[14px] p-6">
        {/* Tab row */}
        <div className="flex gap-1 mb-6 bg-[#0a0a0a] rounded-xl p-1">
          {(['deposit', 'withdraw'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => { setTab(t); setInput('') }}
              className={cn(
                'flex-1 py-2.5 text-sm font-semibold rounded-lg capitalize transition-all',
                tab === t
                  ? 'bg-[#37FF8B] text-black'
                  : 'text-[#888] hover:text-white'
              )}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Input */}
        <div className="mb-4">
          <div className="flex justify-between items-center mb-2">
            <label className="text-xs text-[#888] uppercase tracking-widest">
              {tab === 'deposit' ? 'WFLOW to deposit' : 'axWFLOW to redeem'}
            </label>
            {isConnected && (
              <button
                onClick={setMax}
                className="text-xs text-[#37FF8B] hover:brightness-125 transition-all"
              >
                Balance: {formatAmount(userBalance, 18, 4)} Max
              </button>
            )}
          </div>

          {/* Gradient-border input (styled like 4.html) */}
          <div className="relative">
            <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-[#e81cff]/30 to-[#40c9ff]/30 blur-sm" />
            <div className="relative p-[1px] rounded-xl bg-gradient-to-r from-[#e81cff]/50 to-[#40c9ff]/50">
              <input
                type="number"
                min="0"
                step="any"
                placeholder="0.0"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                className="w-full bg-[#0a0a0a] text-white text-xl font-mono rounded-[10px] px-4 py-4 outline-none placeholder-[#333] [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-[#888] font-mono pointer-events-none">
                {balanceLabel}
              </span>
            </div>
          </div>

          {/* Preview */}
          {amountParsed > 0n && (
            <p className="text-xs text-[#555] mt-2 pl-1">{previewLabel}</p>
          )}
        </div>

        {/* User position (when connected + has shares) */}
        {isConnected && shareBalance > 0n && (
          <div className="mb-4 px-4 py-3 rounded-xl bg-[#0a0a0a] border border-[#1a1a1e]">
            <p className="text-xs text-[#888] mb-1">Your position</p>
            <p className="text-white font-mono text-sm">
              {formatAmount(shareBalance)} <span className="text-[#37FF8B]">axWFLOW</span>
            </p>
          </div>
        )}

        {/* CTA */}
        {actionButton()}

        {/* Success notice */}
        {isConfirmed && (
          <p className="mt-3 text-center text-sm text-[#37FF8B]">
            Transaction confirmed.
          </p>
        )}
      </div>
    </div>
  )
}

function Spinner() {
  return (
    <svg className="w-4 h-4 animate-spin-slow" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  )
}
