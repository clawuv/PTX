import { useEffect, useRef, useState } from 'react'
import type { GitStatus } from '@/types/api'

export interface TurnChangesFile {
  path: string
  status: string
  staged: boolean
  additions: number
  deletions: number
}

export interface TurnChanges {
  /** Stable React key, unique within the session. */
  key: string
  /** Grouped transcript message this summary is anchored to. */
  messageId: string
  files: TurnChangesFile[]
}

export interface TurnChangesInput {
  /** Live working-tree status for the active session's project. */
  files: GitStatus['files']
  /** True while a harness turn runs; the baseline freezes for its duration. */
  active: boolean
  /** Grouped id of the latest assistant message; the anchor for the next record. */
  anchorId?: string
  /** The settings toggle; disabled turns record nothing. */
  enabled: boolean
  /** Session identity; changing it swaps the displayed ledger. */
  resetKey: string
}

type FileCounts = Map<string, { additions: number; deletions: number }>

function statusCounts(files: GitStatus['files']): FileCounts {
  return new Map(files.map((file) => [file.path, { additions: file.additions, deletions: file.deletions }]))
}

function diffTurn(baseline: FileCounts, current: GitStatus['files']): TurnChangesFile[] {
  const files: TurnChangesFile[] = []
  for (const file of current) {
    const previous = baseline.get(file.path)
    const additions = Math.max(0, file.additions - (previous?.additions ?? 0))
    const deletions = Math.max(0, file.deletions - (previous?.deletions ?? 0))
    if (!previous || additions > 0 || deletions > 0) files.push({ path: file.path, status: file.status, staged: file.staged, additions, deletions })
  }
  return files
}

/** The ledger keeps the newest records only, so the next key continues past the highest surviving ordinal. */
function highestRecordOrdinal(records: TurnChanges[]): number {
  let max = 0
  for (const record of records) {
    const match = /^turn-(\d+)$/.exec(record.key)
    if (match) max = Math.max(max, Number(match[1]))
  }
  return max
}

/**
 * Session-keyed storage for per-turn change records. The in-memory map keeps
 * every session's ledger for the renderer's lifetime, so switching sessions
 * swaps the displayed history instead of discarding it; localStorage mirrors
 * the map so records also survive a renderer reload or app restart. Both
 * layers are bounded: stale sessions age out from the front.
 */
const LEDGER_STORAGE_KEY = 'prime-work.turn-changes'
const LEDGER_STORAGE_VERSION = 1
const MAX_RECORDS_PER_LEDGER = 50
const MAX_LEDGERS = 100

const ledgerMemory = new Map<string, TurnChanges[]>()
let ledgersHydrated = false

function isTurnChangesRecord(value: unknown): value is TurnChanges {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Partial<TurnChanges>
  return typeof record.key === 'string'
    && typeof record.messageId === 'string'
    && Array.isArray(record.files)
    && record.files.every((file) => typeof file.path === 'string' && typeof file.status === 'string' && typeof file.staged === 'boolean' && typeof file.additions === 'number' && typeof file.deletions === 'number')
}

function hydrateLedgers(): void {
  ledgersHydrated = true
  if (typeof window === 'undefined') return
  let parsed: unknown
  try {
    parsed = JSON.parse(window.localStorage.getItem(LEDGER_STORAGE_KEY) ?? '{}')
  } catch {
    return
  }
  if (typeof parsed !== 'object' || parsed === null) return
  const stored = parsed as { version?: unknown; ledgers?: unknown }
  if (stored.version !== LEDGER_STORAGE_VERSION || typeof stored.ledgers !== 'object' || stored.ledgers === null) return
  const entries = Object.entries(stored.ledgers)
  for (const [key, value] of entries.slice(-MAX_LEDGERS)) {
    if (!Array.isArray(value)) continue
    const records = value.filter(isTurnChangesRecord).slice(-MAX_RECORDS_PER_LEDGER)
    if (records.length) ledgerMemory.set(key, records)
  }
}

export function loadTurnChanges(resetKey: string): TurnChanges[] {
  if (!ledgersHydrated) hydrateLedgers()
  return ledgerMemory.get(resetKey) ?? []
}

export function saveTurnChanges(resetKey: string, records: TurnChanges[]): void {
  ledgerMemory.delete(resetKey)
  ledgerMemory.set(resetKey, records.slice(-MAX_RECORDS_PER_LEDGER))
  while (ledgerMemory.size > MAX_LEDGERS) {
    const oldest = ledgerMemory.keys().next().value
    if (oldest === undefined) break
    ledgerMemory.delete(oldest)
  }
  if (typeof window === 'undefined') return
  try {
    const ledgers: Record<string, TurnChanges[]> = {}
    for (const [key, stored] of ledgerMemory) ledgers[key] = stored
    window.localStorage.setItem(LEDGER_STORAGE_KEY, JSON.stringify({ version: LEDGER_STORAGE_VERSION, ledgers }))
  } catch {
    // Quota or serialization failures only cost restart persistence.
  }
}

/** Test-only: drop in-memory ledgers; localStorage survives so the next load re-hydrates, as after an app restart. */
export function resetTurnChangesMemoryForTests(): void {
  ledgerMemory.clear()
  ledgersHydrated = false
}

/** Test-only: wipe the whole ledger store, memory and localStorage. */
export function clearTurnChangesStoreForTests(): void {
  ledgerMemory.clear()
  ledgersHydrated = false
  if (typeof window !== 'undefined') window.localStorage.removeItem(LEDGER_STORAGE_KEY)
}

/**
 * Ledger of per-turn file changes. While no turn runs, the baseline keeps
 * tracking the working tree so edits made outside the agent never count
 * against a turn. When a turn ends, the delta against that frozen baseline is
 * appended as a summary record anchored to the turn's final assistant
 * message. Records live in the session-keyed store, not in the read-only
 * session JSONL, so they survive switching sessions and renderer restarts.
 */
export function useTurnChanges({ files, active, anchorId, enabled, resetKey }: TurnChangesInput): TurnChanges[] {
  const [records, setRecords] = useState<TurnChanges[]>(() => loadTurnChanges(resetKey))
  const filesRef = useRef(files)
  const enabledRef = useRef(enabled)
  const anchorRef = useRef(anchorId)
  const baselineRef = useRef<FileCounts | null>(null)
  const activeRef = useRef(active)
  const pendingEndRef = useRef(false)
  const counterRef = useRef(highestRecordOrdinal(records))
  const recordsRef = useRef(records)
  /** The ledger a pending turn end belongs to; only the reset effect retargets it. */
  const ownerKeyRef = useRef(resetKey)

  filesRef.current = files
  enabledRef.current = enabled
  anchorRef.current = anchorId
  recordsRef.current = records

  /** Close the ended turn against the freshest known status. */
  const consumeEnd = () => {
    if (!pendingEndRef.current) return
    pendingEndRef.current = false
    const baseline = baselineRef.current
    const current = filesRef.current
    baselineRef.current = statusCounts(current)
    if (baseline === null) return
    const turnFiles = diffTurn(baseline, current)
    const anchor = anchorRef.current
    if (!enabledRef.current || !anchor || turnFiles.length === 0) return
    counterRef.current += 1
    const next = [...recordsRef.current, { key: `turn-${counterRef.current}`, messageId: anchor, files: turnFiles }]
    recordsRef.current = next
    saveTurnChanges(ownerKeyRef.current, next)
    setRecords(next)
  }

  useEffect(() => {
    const restored = loadTurnChanges(resetKey)
    recordsRef.current = restored
    ownerKeyRef.current = resetKey
    counterRef.current = highestRecordOrdinal(restored)
    setRecords(restored)
    baselineRef.current = null
    pendingEndRef.current = false
  }, [resetKey])

  useEffect(() => {
    const wasActive = activeRef.current
    activeRef.current = active
    if (wasActive && !active) {
      pendingEndRef.current = true
      // The session-status transition normally triggers a git refresh whose
      // arrival consumes the turn end; the timer closes it with the freshest
      // known status when no further refresh arrives.
      const timer = window.setTimeout(consumeEnd, 1_200)
      return () => window.clearTimeout(timer)
    }
    // A newly started turn closes the ended turn's window for good.
    if (!wasActive && active) pendingEndRef.current = false
  }, [active])

  useEffect(() => {
    if (baselineRef.current === null) {
      baselineRef.current = statusCounts(files)
      return
    }
    if (pendingEndRef.current) {
      consumeEnd()
      return
    }
    if (!activeRef.current) baselineRef.current = statusCounts(files)
  }, [files])

  return records
}
