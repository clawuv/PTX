// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { Sidebar } from '../../src/components/Sidebar'
import type { ProjectRecord, SessionRecord } from '../../src/types/api'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const draining: ProjectRecord = {
  id: 'draining', harness: 'pi', name: 'draining', path: 'E:\\Go\\src\\draining', folders: ['E:\\Go\\src\\draining'], primaryFolder: 'E:\\Go\\src\\draining',
  pinned: false, createdAt: '2026-01-01T00:00:00.000Z', lastOpenedAt: '2026-01-01T00:00:00.000Z', sessionCount: 1,
}
const ptx: ProjectRecord = {
  id: 'pi-studio', harness: 'pi', name: 'pi-studio', path: 'E:\\pi-studio', folders: ['E:\\pi-studio'], primaryFolder: 'E:\\pi-studio',
  pinned: false, createdAt: '2026-01-01T00:00:00.000Z', lastOpenedAt: '2026-01-01T00:00:00.000Z', sessionCount: 1,
}
const sessionA: SessionRecord = {
  id: 'a-pi-studio', harness: 'pi', filePath: '/sessions/a.jsonl', projectPath: 'E:\\pi-studio', title: '菜单和内容出现了两个',
  createdAt: '2026-09-03T02:10:55.817Z', updatedAt: '2026-09-03T02:10:55.817Z', status: 'idle', depth: 0,
}
const sessionB: SessionRecord = {
  id: 'b-draining', harness: 'pi', filePath: '/sessions/b.jsonl', projectPath: 'E:\\Go\\src\\draining', title: '原周期变更接口',
  createdAt: '2026-09-03T02:40:18.495Z', updatedAt: '2026-09-03T02:40:18.495Z', status: 'idle', depth: 0,
}
const sessionC: SessionRecord = {
  id: 'c-unassigned', harness: 'pi', filePath: '/sessions/c.jsonl', projectPath: 'E:\\elsewhere', title: '未归属项目的会话',
  createdAt: '2026-09-03T01:00:00.000Z', updatedAt: '2026-09-03T01:00:00.000Z', status: 'idle', depth: 0,
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  window.localStorage.clear()
  vi.restoreAllMocks()
})

const noop = () => undefined

function Harness({ initialSessionId }: { initialSessionId?: string }) {
  const [activeSessionId, setActiveSessionId] = useState<string | undefined>(initialSessionId)
  return (
    <Sidebar
      projects={[draining, ptx]}
      sessions={[sessionA, sessionB, sessionC]}
      activeSessionId={activeSessionId}
      activeView="session"
      onSelectProject={noop}
      onSelectSession={(session) => setActiveSessionId(session.id)}
      onNavigate={noop}
      onNewSession={noop}
      onAddProject={noop}
      onRemoveProject={noop}
      onOpenPalette={noop}
      onRenameSession={async () => undefined}
      onArchiveSession={async () => undefined}
    />
  )
}

async function press(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

const rowByTitle = (title: string) => {
  const node = [...container.querySelectorAll('.session-row .session-row__title')].find((item) => item.textContent === title)
  return node!.closest('.session-row')!
}

const selectedTitles = () => [...container.querySelectorAll('.session-row-wrap.is-selected .session-row__title')].map((node) => node.textContent)

describe('sidebar session selection across projects', () => {
  it('keeps the restored session highlighted and moves the highlight to a session in another project', async () => {
    await act(async () => { root.render(<Harness initialSessionId={sessionA.id} />) })
    // A session restored at startup (no row click yet) must still show its selection.
    expect(selectedTitles()).toEqual([sessionA.title])

    await press(rowByTitle(sessionB.title))
    expect(selectedTitles()).toEqual([sessionB.title])
  })

  it('highlights a recent-section session after activating it', async () => {
    await act(async () => { root.render(<Harness initialSessionId={sessionA.id} />) })

    await press(rowByTitle(sessionC.title))
    expect(selectedTitles()).toEqual([sessionC.title])
  })
})
