// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Sidebar } from '../../src/components/Sidebar'
import { sessionAttentionSignature } from '../../src/app/session-attention'
import type { ProjectRecord, SessionRecord } from '../../src/types/api'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const project: ProjectRecord = {
  id: 'project', harness: 'prime', name: 'Project', path: '/project', folders: ['/project'], primaryFolder: '/project',
  pinned: false, createdAt: '2026-01-01T00:00:00.000Z', lastOpenedAt: '2026-01-01T00:00:00.000Z', sessionCount: 1,
}
const session: SessionRecord = {
  id: 'session', harness: 'prime', filePath: '/sessions/session.jsonl', projectPath: '/project', title: 'Session',
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', status: 'idle', depth: 0,
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

async function press(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}
async function rightClick(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }))
  })
}

describe('sidebar project context menu', () => {
  it('requires confirmation before downloading and restarting an available update', async () => {
    const onUpdateAction = vi.fn()
    await act(async () => {
      root.render(
        <Sidebar
          projects={[project]} sessions={[session]} activeView="session" updateState={{ phase: 'available', version: '0.2.0' }} onUpdateAction={onUpdateAction}
          onSelectProject={noop} onSelectSession={noop} onNavigate={noop} onNewSession={noop} onAddProject={noop} onRemoveProject={noop}
          onOpenPalette={noop} onRenameSession={async () => undefined} onArchiveSession={async () => undefined}
        />,
      )
    })

    const update = container.querySelector('.sidebar__footer .sidebar-update')
    const settings = container.querySelector('.sidebar__footer button[title="Settings"]')
    expect(update).not.toBeNull()
    expect(update?.nextElementSibling).toBe(settings)
    expect(update?.textContent).toContain('Download 0.2.0')
    expect(update?.querySelector('.lucide-download')).not.toBeNull()
    await press(update!)
    expect(onUpdateAction).not.toHaveBeenCalled()
    expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain('Download and Restart Ptx?')

    const yes = [...document.body.querySelectorAll<HTMLButtonElement>('.modal__footer button')].find((button) => button.textContent === 'Yes')
    expect(yes).toBeDefined()
    await press(yes!)
    expect(onUpdateAction).toHaveBeenCalledOnce()
  })

  it('keeps the release control hidden when no update is available', async () => {
    await act(async () => {
      root.render(
        <Sidebar
          projects={[project]} sessions={[session]} activeView="session" updateState={{ phase: 'not-available' }}
          onSelectProject={noop} onSelectSession={noop} onNavigate={noop} onNewSession={noop} onAddProject={noop} onRemoveProject={noop}
          onOpenPalette={noop} onRenameSession={async () => undefined} onArchiveSession={async () => undefined}
        />,
      )
    })

    expect(container.querySelector('.sidebar__footer .sidebar-update')).toBeNull()
    expect(container.querySelector('.sidebar__footer button[title="Settings"]')).not.toBeNull()
  })

  it('copies the exact session UUID from the session context menu', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    await act(async () => {
      root.render(
        <Sidebar
          projects={[project]} sessions={[session]} activeView="session"
          onSelectProject={noop} onSelectSession={noop} onNavigate={noop} onNewSession={noop} onAddProject={noop} onRemoveProject={noop}
          onOpenPalette={noop} onRenameSession={async () => undefined} onArchiveSession={async () => undefined}
        />,
      )
    })

    await rightClick(container.querySelector('.session-row')!)
    const copy = [...document.body.querySelectorAll('[aria-label="Session options"] button')].find((button) => button.textContent?.includes('Copy session UUID'))
    expect(copy).toBeDefined()
    await press(copy!)
    expect(writeText).toHaveBeenCalledWith(session.id)
  })

  it('offers a confirmed remove action without deleting the project folder', async () => {
    const onRemoveProject = vi.fn()
    await act(async () => {
      root.render(
        <Sidebar
          projects={[project]}
          sessions={[session]}
          activeView="session"
          onSelectProject={noop}
          onSelectSession={noop}
          onNavigate={noop}
          onNewSession={noop}
          onAddProject={noop}
          onRemoveProject={onRemoveProject}
          onOpenPalette={noop}
          onRenameSession={async () => undefined}
          onArchiveSession={async () => undefined}
        />,
      )
    })

    await rightClick(container.querySelector('.project-row')!)
    const menu = container.querySelector('[aria-label="Project options for Project"]')
    expect(menu).not.toBeNull()
    const remove = [...menu!.querySelectorAll('button')].find((button) => button.textContent?.includes('Remove project'))
    expect(remove).toBeDefined()
    await press(remove!)

    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull()
    expect(document.body.textContent).toContain('The folder and saved sessions will not be deleted.')
    await press(document.body.querySelector('.modal .button--danger')!)
    expect(onRemoveProject).toHaveBeenCalledOnce()
    expect(onRemoveProject).toHaveBeenCalledWith(project)
  })

  it('uses notebook icons for new sessions and a folder-plus icon for projects', async () => {
    await act(async () => {
      root.render(
        <Sidebar
          projects={[project]}
          sessions={[session]}
          activeView="session"
          onSelectProject={noop}
          onSelectSession={noop}
          onNavigate={noop}
          onNewSession={noop}
          onAddProject={noop}
          onRemoveProject={noop}
          onOpenPalette={noop}
          onRenameSession={async () => undefined}
          onArchiveSession={async () => undefined}
        />,
      )
    })

    expect(container.querySelector('.sidebar__primary .lucide-notebook-pen')).not.toBeNull()
    expect(container.querySelector('.project-row__new-session .lucide-notebook-pen')).not.toBeNull()
    expect(container.querySelector('.sidebar__section-heading .lucide-plus')).not.toBeNull()
    expect(container.querySelector('.sidebar__primary button[title="New session (⌘N)"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="New session in Project"][title="New session in Project"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="Add project"][title="Add project"]')).not.toBeNull()
  })

  it('shows Linux shortcut names on Linux', async () => {
    await act(async () => {
      root.render(
        <Sidebar
          platform="linux"
          projects={[project]}
          sessions={[session]}
          activeView="session"
          onSelectProject={noop}
          onSelectSession={noop}
          onNavigate={noop}
          onNewSession={noop}
          onAddProject={noop}
          onRemoveProject={noop}
          onOpenPalette={noop}
          onRenameSession={async () => undefined}
          onArchiveSession={async () => undefined}
        />,
      )
    })

    expect(container.querySelector('.sidebar__primary button[title="New session (Ctrl+N)"]')).not.toBeNull()
    // The collapse affordances were removed: the sidebar stays visible and only Ctrl+B toggles it.
    expect(container.querySelector('[aria-label="Hide sidebar (Ctrl+B)"]')).toBeNull()
    expect(container.textContent).not.toContain('⌘')
  })
})

describe('sidebar archive confirmation', () => {
  it('requires a second click and cancels when clicking elsewhere', async () => {
    const onArchiveSession = vi.fn(async () => undefined)
    await act(async () => {
      root.render(
        <Sidebar
          projects={[project]}
          sessions={[session]}
          activeView="session"
          onSelectProject={noop}
          onSelectSession={noop}
          onNavigate={noop}
          onNewSession={noop}
          onAddProject={noop}
          onRemoveProject={noop}
          onOpenPalette={noop}
          onRenameSession={async () => undefined}
          onArchiveSession={onArchiveSession}
        />,
      )
    })

    const more = container.querySelector('[aria-label="Session options for Session"]')
    expect(more).not.toBeNull()
    await press(more!)

    const archive = document.body.querySelector('.session-row__menu button:last-child')
    expect(archive).not.toBeNull()
    expect(archive?.textContent).toContain('Archive')
    await press(archive!)
    expect(onArchiveSession).toHaveBeenCalledOnce()
    expect(onArchiveSession).toHaveBeenCalledWith(session)
  })
})

describe('sidebar session notifications', () => {
  it('marks a waiting session without using the selection state', async () => {
    const waitingSession = { ...session, status: 'waiting' as const }
    const props = {
      projects: [project],
      sessions: [waitingSession],
      activeView: 'session' as const,
      onSelectProject: noop,
      onSelectSession: noop,
      onNavigate: noop,
      onNewSession: noop,
      onAddProject: noop,
      onRemoveProject: noop,
      onOpenPalette: noop,
      onRenameSession: async () => undefined,
      onArchiveSession: async () => undefined,
    }
    await act(async () => { root.render(<Sidebar {...props} />) })

    expect(container.querySelector('.session-row-wrap')?.classList.contains('has-attention')).toBe(true)
    expect(container.querySelector('.session-row-wrap')?.classList.contains('is-selected')).toBe(false)
    expect(container.querySelector('.session-status-mark--waiting')).not.toBeNull()
  })

  it('mutes an acknowledged failed session without changing its failed status', async () => {
    const failedSession = { ...session, status: 'failed' as const }
    const props = {
      projects: [project],
      sessions: [failedSession],
      activeView: 'session' as const,
      onSelectProject: noop,
      onSelectSession: noop,
      onNavigate: noop,
      onNewSession: noop,
      onAddProject: noop,
      onRemoveProject: noop,
      onOpenPalette: noop,
      onRenameSession: async () => undefined,
      onArchiveSession: async () => undefined,
    }
    await act(async () => { root.render(<Sidebar {...props} />) })

    expect(container.querySelector('.session-row-wrap')?.classList.contains('has-attention')).toBe(true)

    const signature = sessionAttentionSignature(failedSession)!
    await act(async () => { root.render(<Sidebar {...props} clearedAttention={{ [failedSession.id]: signature }} />) })
    expect(container.querySelector('.session-row-wrap')?.classList.contains('has-attention')).toBe(false)
    expect(container.querySelector('.session-status-mark--failed')?.getAttribute('title')).toBe('Failed — notification cleared')
  })
})
