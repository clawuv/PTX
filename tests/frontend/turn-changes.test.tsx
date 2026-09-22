// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { clearTurnChangesStoreForTests, resetTurnChangesMemoryForTests, useTurnChanges, type TurnChangesInput } from '../../src/hooks/useTurnChanges'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

function Harness({ input }: { input: TurnChangesInput }) {
  const records = useTurnChanges(input)
  return <div data-testid="records">{JSON.stringify(records)}</div>
}

let container: HTMLDivElement
let root: Root
const render = (input: TurnChangesInput) => {
  root.render(<Harness input={input} />)
}
/** Unmount and mount a fresh hook instance, as after an app restart. */
const remount = async () => {
  await act(async () => root.unmount())
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
}

beforeEach(() => {
  clearTurnChangesStoreForTests()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

const files = (entries: Array<[string, number, number]>) => entries.map(([path, additions, deletions]) => ({ path, status: 'M', additions, deletions, staged: false }))
const records = () => JSON.parse(container.querySelector('[data-testid="records"]')!.textContent ?? '[]') as Array<{ key: string; messageId: string; files: Array<{ path: string; additions: number; deletions: number }> }>

describe('useTurnChanges', () => {
  it('records the delta of a finished turn, anchored to the assistant message', async () => {
    const base: TurnChangesInput = { files: files([['a.txt', 1, 0]]), active: false, anchorId: 'm1', enabled: true, resetKey: 's1' }
    await act(async () => render(base))
    await act(async () => render({ ...base, active: true }))
    await act(async () => render({ ...base, active: true, files: files([['a.txt', 1, 0], ['b.ts', 4, 2]]) }))
    await act(async () => render({ ...base, active: false, files: files([['a.txt', 1, 0], ['b.ts', 4, 2]]) }))
    const [record] = records()
    expect(record.messageId).toBe('m1')
    // a.txt did not change during the turn; only b.ts counts.
    expect(record.files).toEqual([{ path: 'b.ts', status: 'M', staged: false, additions: 4, deletions: 2 }])
  })

  it('skips the record when the turn changed nothing', async () => {
    const base: TurnChangesInput = { files: files([['a.txt', 1, 0]]), active: false, anchorId: 'm1', enabled: true, resetKey: 's1' }
    await act(async () => render(base))
    await act(async () => render({ ...base, active: true }))
    await act(async () => render({ ...base, active: false }))
    expect(records()).toEqual([])
  })

  it('keeps edits made between turns out of the next turn delta', async () => {
    const base: TurnChangesInput = { files: files([['a.txt', 1, 0]]), active: false, anchorId: 'm1', enabled: true, resetKey: 's1' }
    await act(async () => render(base))
    // The user edits a file while idle; the baseline absorbs it.
    await act(async () => render({ ...base, files: files([['a.txt', 6, 2]]) }))
    await act(async () => render({ ...base, active: true, files: files([['a.txt', 6, 2]]) }))
    await act(async () => render({ ...base, active: false, files: files([['a.txt', 6, 2]]) }))
    expect(records()).toEqual([])
  })

  it('counts new files even without line stats', async () => {
    const base: TurnChangesInput = { files: [], active: false, anchorId: 'm1', enabled: true, resetKey: 's1' }
    await act(async () => render(base))
    await act(async () => render({ ...base, active: true, files: [{ path: 'new.txt', status: '??', additions: 0, deletions: 0, staged: false }] }))
    await act(async () => render({ ...base, active: false, files: [{ path: 'new.txt', status: '??', additions: 0, deletions: 0, staged: false }] }))
    expect(records()).toHaveLength(1)
    expect(records()[0].files).toEqual([{ path: 'new.txt', status: '??', staged: false, additions: 0, deletions: 0 }])
  })

  it('accumulates one record per changing turn and keeps ledgers separate across session switches', async () => {
    const base: TurnChangesInput = { files: files([['a.txt', 1, 0]]), active: false, anchorId: 'm1', enabled: true, resetKey: 's1' }
    await act(async () => render(base))
    await act(async () => render({ ...base, active: true }))
    await act(async () => render({ ...base, active: false, files: files([['a.txt', 2, 0]]) }))
    await act(async () => render({ ...base, anchorId: 'm2', active: true }))
    await act(async () => render({ ...base, anchorId: 'm2', active: false, files: files([['a.txt', 3, 1]]) }))
    const all = records()
    expect(all).toHaveLength(2)
    expect(all[0]).toMatchObject({ messageId: 'm1', files: [{ path: 'a.txt', additions: 1, deletions: 0 }] })
    expect(all[1]).toMatchObject({ messageId: 'm2', files: [{ path: 'a.txt', additions: 1, deletions: 1 }] })

    // Another session starts with its own empty ledger...
    await act(async () => render({ ...base, resetKey: 's2', files: files([['a.txt', 3, 1]]) }))
    expect(records()).toEqual([])
    // ...and switching back restores the first session's history.
    await act(async () => render({ ...base, resetKey: 's1', files: files([['a.txt', 3, 1]]) }))
    expect(records()).toHaveLength(2)
  })

  it('restores the ledger after an app restart via the persisted store', async () => {
    const base: TurnChangesInput = { files: files([['a.txt', 1, 0]]), active: false, anchorId: 'm1', enabled: true, resetKey: 's1' }
    await act(async () => render(base))
    await act(async () => render({ ...base, active: true }))
    await act(async () => render({ ...base, active: false, files: files([['a.txt', 2, 1]]) }))
    expect(JSON.parse(window.localStorage.getItem('prime-work.turn-changes') ?? '{}').version).toBe(1)

    // A restart starts from empty memory and rehydrates from localStorage.
    resetTurnChangesMemoryForTests()
    await act(async () => remount())
    await act(async () => render(base))
    const restored = records()
    expect(restored).toHaveLength(1)
    expect(restored[0]).toMatchObject({ messageId: 'm1', files: [{ path: 'a.txt', additions: 1, deletions: 1 }] })
    // The next record continues the restored ledger's key sequence.
    await act(async () => render({ ...base, anchorId: 'm2', active: true }))
    await act(async () => render({ ...base, anchorId: 'm2', active: false, files: files([['a.txt', 4, 1]]) }))
    expect(records()).toHaveLength(2)
    expect(records()[1].key).toBe('turn-2')
  })

  it('records nothing while the setting is disabled', async () => {
    const base: TurnChangesInput = { files: files([['a.txt', 1, 0]]), active: false, anchorId: 'm1', enabled: false, resetKey: 's1' }
    await act(async () => render(base))
    await act(async () => render({ ...base, active: true }))
    await act(async () => render({ ...base, active: false, files: files([['a.txt', 5, 0]]) }))
    expect(records()).toEqual([])
  })
})
