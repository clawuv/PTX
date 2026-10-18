// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChangesCard } from '../../src/components/ChangesCard'
import { ChangesPanel } from '../../src/components/inspector/ChangesPanel'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

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
  Reflect.deleteProperty(window, 'ptx')
  vi.restoreAllMocks()
})

describe('ChangesPanel status states', () => {
  it('renders the no-repository state without an error banner', async () => {
    await act(async () => {
      root.render(<ChangesPanel cwd="/project" git={{ isRepo: false, files: [], error: 'Not a Git repository' }} onRefreshGit={vi.fn()} />)
    })
    expect(container.textContent).toContain('No Git repository')
    expect(container.textContent).not.toContain('Git status unavailable')
  })

  it('renders a distinct failure state with retry when the repo exists but status failed', async () => {
    const onRefreshGit = vi.fn()
    await act(async () => {
      root.render(<ChangesPanel cwd="/project" git={{ isRepo: true, files: [], error: 'Git status timed out; the result is unknown' }} onRefreshGit={onRefreshGit} />)
    })
    expect(container.textContent).toContain('Git status unavailable')
    expect(container.textContent).toContain('Git status timed out')
    expect(container.textContent).not.toContain('No Git repository')
    act(() => { container.querySelector('button')!.click() })
    expect(onRefreshGit).toHaveBeenCalledTimes(1)
  })
  it('expands the changed-file list and opens the inspector from the review action', async () => {
    const onOpenChanges = vi.fn()
    await act(async () => {
      root.render(<ChangesCard cwd="/project" git={{ isRepo: true, files: [
        { path: 'file.txt', status: 'M', staged: false, additions: 1, deletions: 0 },
        { path: 'src/App.tsx', status: 'A', staged: false, additions: 4, deletions: 2 },
      ] }} onOpenChanges={onOpenChanges} />)
    })
    expect(container.textContent).not.toContain('src/App.tsx')

    act(() => { container.querySelector<HTMLButtonElement>('.changes-card__expand')!.click() })
    const list = container.querySelector('.changes-card__files')!
    expect(list.textContent).toContain('file.txt')
    expect(list.textContent).toContain('src/App.tsx')

    const byText = (label: string) => [...container.querySelectorAll<HTMLButtonElement>('.changes-card__summary button')].find((button) => button.textContent?.trim() === label)!
    act(() => { byText('Review code').click() })
    expect(onOpenChanges).toHaveBeenCalledTimes(1)
  })

  it('restores every changed file through the undo confirmation', async () => {
    const restore = vi.fn(async () => true)
    Object.defineProperty(window, 'ptx', { configurable: true, value: { git: { restore } } })
    const onRefreshGit = vi.fn(async () => undefined)
    await act(async () => {
      root.render(<ChangesCard cwd="/project" git={{ isRepo: true, files: [
        { path: 'file.txt', status: 'M', staged: false, additions: 1, deletions: 0 },
        { path: 'other.txt', status: 'M', staged: true, additions: 2, deletions: 1 },
      ] }} onOpenChanges={vi.fn()} onRefreshGit={onRefreshGit} />)
      await Promise.resolve()
    })

    act(() => {
      [...container.querySelectorAll<HTMLButtonElement>('.changes-card__undo')].find((button) => button.textContent?.includes('Undo changes'))!.click()
    })
    expect(document.body.textContent).toContain('This discards the staged and unstaged changes')

    await act(async () => {
      [...document.body.querySelectorAll<HTMLButtonElement>('.modal__footer button')].find((button) => button.textContent?.trim() === 'Undo changes')!.click()
      await Promise.resolve()
    })
    expect(restore).toHaveBeenCalledWith('/project', ['file.txt', 'other.txt'])
    expect(onRefreshGit).toHaveBeenCalledTimes(1)
  })

  it('keeps the undo action unavailable for read-only workspaces', async () => {
    await act(async () => {
      root.render(<ChangesCard git={{ isRepo: true, files: [{ path: 'file.txt', status: 'M', staged: false, additions: 1, deletions: 0 }] }} readOnly onOpenChanges={vi.fn()} />)
    })
    expect(container.querySelector<HTMLButtonElement>('.changes-card__undo')!.disabled).toBe(true)
  })

  it('confirms undoing the selected file before restoring it', async () => {
    const restore = vi.fn(async () => true)
    const diff = vi.fn(async () => ({ path: 'file.txt', staged: false, text: '', truncated: false }))
    Object.defineProperty(window, 'ptx', { configurable: true, value: { git: { diff, restore } } })
    const onRefreshGit = vi.fn(async () => undefined)

    await act(async () => {
      root.render(<ChangesPanel cwd="/project" git={{ isRepo: true, files: [{ path: 'file.txt', status: 'M', staged: false, additions: 1, deletions: 0 }] }} onRefreshGit={onRefreshGit} />)
      await Promise.resolve()
    })
    act(() => {
      [...container.querySelectorAll<HTMLButtonElement>('.diff-header button')].find((button) => button.textContent?.includes('Undo'))!.click()
    })
    expect(document.body.textContent).toContain('This discards the staged and unstaged changes')

    await act(async () => {
      [...document.body.querySelectorAll<HTMLButtonElement>('.modal__footer button')].find((button) => button.textContent === 'Undo')!.click()
      await Promise.resolve()
    })
    expect(restore).toHaveBeenCalledWith('/project', ['file.txt'])
    expect(onRefreshGit).toHaveBeenCalledTimes(1)
  })

  it('lists unpushed commits behind the ahead label and undoes one on demand', async () => {
    const aheadCommits = vi.fn(async () => [
      { hash: 'abc1234567890abcdef', subject: 'second', date: '2026-10-18T10:00:00+08:00' },
      { hash: 'def1234567890abcdef', subject: 'first', date: '2026-10-18T09:00:00+08:00' },
    ])
    const undoCommit = vi.fn(async () => ({ ok: true, output: '' }))
    Object.defineProperty(window, 'ptx', { configurable: true, value: { git: { aheadCommits, undoCommit } } })
    const onRefreshGit = vi.fn(async () => undefined)

    await act(async () => {
      root.render(<ChangesPanel cwd="/project" git={{ isRepo: true, branch: 'main', ahead: 2, files: [] }} onRefreshGit={onRefreshGit} />)
      await Promise.resolve()
    })

    const aheadToggle = [...container.querySelectorAll<HTMLButtonElement>('button')].find((candidate) => candidate.textContent === '2 ahead')!
    await act(async () => { aheadToggle.click(); await Promise.resolve() })
    expect(aheadCommits).toHaveBeenCalledWith('/project')
    expect(container.textContent).toContain('second')
    expect(container.textContent).toContain('abc1234')

    const undo = [...container.querySelectorAll<HTMLButtonElement>('.ahead-popover button')].find((candidate) => candidate.textContent === 'Undo')!
    await act(async () => { undo.click(); await Promise.resolve() })
    expect(undoCommit).toHaveBeenCalledWith('/project', 'abc1234567890abcdef')
    expect(onRefreshGit).toHaveBeenCalledTimes(1)
    expect(container.textContent).not.toContain('second')
  })

  it('commits the listed files with a generated message through the commit dialog', async () => {
    const diff = vi.fn(async () => ({ path: 'file.txt', staged: false, text: '', truncated: false }))
    const stage = vi.fn(async () => true)
    const commit = vi.fn(async () => ({ ok: true, output: '' }))
    Object.defineProperty(window, 'ptx', { configurable: true, value: { git: { diff, stage, commit } } })
    const onRefreshGit = vi.fn(async () => undefined)

    await act(async () => {
      root.render(<ChangesPanel cwd="/project" git={{ isRepo: true, files: [
        { path: 'file.txt', status: 'M', staged: false, additions: 1, deletions: 0 },
        { path: 'other.txt', status: 'M', staged: false, additions: 2, deletions: 1 },
      ] }} onRefreshGit={onRefreshGit} />)
      await Promise.resolve()
    })

    const button = (label: string) => [...container.querySelectorAll<HTMLButtonElement>('button')].find((candidate) => candidate.textContent?.trim() === label)!
    expect(button('Commit').disabled).toBe(false)
    act(() => { button('Commit').click() })
    act(() => { [...document.body.querySelectorAll<HTMLButtonElement>('button')].find((candidate) => candidate.textContent?.includes('Generate summary'))!.click() })
    await act(async () => {
      [...document.body.querySelectorAll<HTMLButtonElement>('.modal__footer button')].find((candidate) => candidate.textContent === 'Commit changes')!.click()
      await Promise.resolve()
    })
    expect(stage).toHaveBeenCalledWith('/project', ['file.txt', 'other.txt'])
    expect(commit).toHaveBeenCalledWith('/project', 'Update file.txt and other.txt')
    expect(onRefreshGit).toHaveBeenCalledTimes(1)
  })

  it('disables mutating controls and offers an explicit grant for read-only projects', async () => {
    const onGrantProject = vi.fn(async () => undefined)
    const git = {
      isRepo: true,
      branch: 'main',
      files: [
        { path: 'file.txt', status: 'M', staged: false, additions: 1, deletions: 0 },
        { path: 'staged.txt', status: 'M', staged: true, additions: 1, deletions: 0 },
      ],
    }

    await act(async () => {
      root.render(<ChangesPanel git={git} readOnly onGrantProject={onGrantProject} onRefreshGit={vi.fn()} />)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(container.textContent).toContain('read-only because it was discovered from session history')
    const button = (label: string) => [...container.querySelectorAll<HTMLButtonElement>('button')].find((candidate) => candidate.textContent?.trim() === label)!
    expect(button('Stage').disabled).toBe(true)
    expect(button('Stage all').disabled).toBe(true)
    expect(button('Undo').disabled).toBe(true)
    expect(button('Commit').disabled).toBe(true)
    await act(async () => { button('Add project').click(); await Promise.resolve() })
    expect(onGrantProject).toHaveBeenCalledTimes(1)

    act(() => { button('Staged').click() })
    expect(button('Unstage').disabled).toBe(true)
    expect(button('Unstage all').disabled).toBe(true)
  })

  it('keeps mutating controls enabled for persisted projects', async () => {
    const git = {
      isRepo: true,
      branch: 'main',
      files: [
        { path: 'file.txt', status: 'M', staged: false, additions: 1, deletions: 0 },
        { path: 'staged.txt', status: 'M', staged: true, additions: 1, deletions: 0 },
      ],
    }

    await act(async () => {
      root.render(<ChangesPanel git={git} onRefreshGit={vi.fn()} />)
      await Promise.resolve()
      await Promise.resolve()
    })

    const button = (label: string) => [...container.querySelectorAll<HTMLButtonElement>('button')].find((candidate) => candidate.textContent?.trim() === label)!
    expect(button('Stage').disabled).toBe(false)
    expect(button('Stage all').disabled).toBe(false)
    expect(button('Undo').disabled).toBe(false)
    expect(button('Commit').disabled).toBe(false)
    act(() => { button('Staged').click() })
    expect(button('Unstage').disabled).toBe(false)
    expect(button('Unstage all').disabled).toBe(false)
  })
})
