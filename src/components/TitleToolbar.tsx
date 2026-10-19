import { ArrowLeft, ArrowRight, PanelLeft, Search } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ApplicationMenuCommand, ApplicationMenuName } from '@/types/api'
import { useI18n, type MessageKey } from '@/lib/i18n'
import { shortcutLabel } from '@/lib/platform-shortcuts'
import { AppUpdateButton } from './AppUpdateButton'
import type { AppUpdateState } from '@/types/api'
import { IconButton } from './ui'
import type { ReactNode } from 'react'

interface MenuEntry {
  label: MessageKey
  accelerator?: string
  /** Runs on the focused WebContents through the bounded menu-command channel. */
  command?: ApplicationMenuCommand
  /** Renderer-side action instead of a main-process command. */
  run?(): void
}

interface MenuSeparator {
  separator: true
}

type MenuRow = MenuEntry | MenuSeparator

const isSeparator = (row: MenuRow): row is MenuSeparator => 'separator' in row

/** Replica menus mirror the native application menu; accelerators stay live through the installed native menu. */
const MENUS: ReadonlyArray<{ name: ApplicationMenuName; key: MessageKey; rows: ReadonlyArray<MenuRow> }> = [
  { name: 'file', key: 'menu.file', rows: [{ label: 'menu.quit', run: () => { void window.ptx?.app.close() } }] },
  { name: 'edit', key: 'menu.edit', rows: [
    { label: 'menu.undo', accelerator: 'Ctrl+Z', command: 'undo' },
    { label: 'menu.redo', accelerator: 'Ctrl+Y', command: 'redo' },
    { separator: true },
    { label: 'menu.cut', accelerator: 'Ctrl+X', command: 'cut' },
    { label: 'menu.copy', accelerator: 'Ctrl+C', command: 'copy' },
    { label: 'menu.paste', accelerator: 'Ctrl+V', command: 'paste' },
    { separator: true },
    { label: 'menu.selectAll', accelerator: 'Ctrl+A', command: 'selectAll' },
  ] },
  { name: 'view', key: 'menu.view', rows: [
    { label: 'menu.reload', accelerator: 'Ctrl+R', command: 'reload' },
    { label: 'menu.forceReload', accelerator: 'Ctrl+Shift+R', command: 'forceReload' },
    { label: 'menu.toggleDevTools', accelerator: 'Ctrl+Shift+I', command: 'toggleDevTools' },
    { separator: true },
    { label: 'menu.resetZoom', accelerator: 'Ctrl+0', command: 'resetZoom' },
    { label: 'menu.zoomIn', accelerator: 'Ctrl+=', command: 'zoomIn' },
    { label: 'menu.zoomOut', accelerator: 'Ctrl+-', command: 'zoomOut' },
    { separator: true },
    { label: 'menu.toggleFullscreen', accelerator: 'F11', command: 'toggleFullscreen' },
  ] },
  { name: 'help', key: 'menu.help', rows: [{ label: 'menu.checkForUpdates', run: () => { void window.ptx?.updates.check() } }] },
]

function MinimizeGlyph() {
  return <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M1 6h10" stroke="currentColor" strokeWidth="1.1" /></svg>
}
function MaximizeGlyph() {
  return <svg width="11" height="11" viewBox="0 0 11 11" aria-hidden="true"><rect x="0.6" y="0.6" width="9.8" height="9.8" rx="1" stroke="currentColor" strokeWidth="1.1" fill="none" /></svg>
}
function CloseGlyph() {
  return <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M1.5 1.5l9 9m0-9-9 9" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" /></svg>
}

interface TitleToolbarProps {
  onToggleSidebar(): void
  onToggleSearch(): void
  searchOpen: boolean
  updateState?: AppUpdateState
  onUpdateAction?(): void | Promise<void>
  platform?: NodeJS.Platform
  /** macOS: session actions rendered into the strip's right end, inside the drag region so they stay clickable. */
  sessionActions?: ReactNode
  /** Session/view history navigation for the back/forward arrows; the arrows stay decorative without them. */
  onBack?(): void
  onForward?(): void
  canBack?: boolean
  canForward?: boolean
}

/** The replica chrome: a full-width title strip with the sidebar toggle, history arrows, menus, and window controls. */
export function TitleToolbar({ onToggleSidebar, onToggleSearch, searchOpen, updateState = { phase: 'unsupported' }, onUpdateAction, platform = 'darwin', sessionActions, onBack, onForward, canBack = false, canForward = false }: TitleToolbarProps) {
  const { t } = useI18n()
  const sidebarShortcut = shortcutLabel(platform, ['Primary', 'B'])
  const drawWindowControls = platform === 'win32' || platform === 'linux'
  // Classic menu-bar behavior: click opens a menu, then hovering another title opens it in turn.
  const [openMenu, setOpenMenu] = useState<ApplicationMenuName | null>(null)
  const navRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (!openMenu) return
    const onPointerDown = (event: PointerEvent) => {
      if (!navRef.current?.contains(event.target as Node)) setOpenMenu(null)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenMenu(null)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [openMenu])

  const runEntry = (entry: MenuEntry) => {
    setOpenMenu(null)
    if (entry.command) void window.ptx?.app.menuCommand(entry.command).catch(() => undefined)
    else entry.run?.()
  }

  return (
    <header className="title-toolbar drag-region">
      {platform === 'darwin' ? <div className="traffic-light-clearance traffic-light-clearance--toolbar" aria-hidden="true" /> : null}
      <div className="title-toolbar__nav no-drag">
        <IconButton label={t('shellui.toggleSidebar', { shortcut: sidebarShortcut })} onClick={onToggleSidebar}><PanelLeft size={16} /></IconButton>
        <IconButton label={t('sidebar.search')} onClick={onToggleSearch} aria-expanded={searchOpen} className="title-toolbar__search"><Search size={16} /></IconButton>
        {/* The slot reserves the update icon's 26px cell (win32) so the menus never shift when an update appears. */}
        <span className="title-toolbar__update-slot"><AppUpdateButton updateState={updateState} onUpdateAction={onUpdateAction} /></span>
        {platform === 'darwin' || platform === 'win32' ? (
          <span className="titlebar-arrows">
            <button type="button" className="titlebar-arrow" disabled={!canBack} aria-label={t('shellui.navigateBack')} data-tooltip={t('shellui.navigateBack')} onClick={onBack}>
              <ArrowLeft size={15} />
            </button>
            <button type="button" className="titlebar-arrow" disabled={!canForward} aria-label={t('shellui.navigateForward')} data-tooltip={t('shellui.navigateForward')} onClick={onForward}>
              <ArrowRight size={15} />
            </button>
          </span>
        ) : null}
      </div>
      {sessionActions}
      {platform === 'win32' ? <nav ref={navRef} className="titlebar-menus no-drag" aria-label={t('shellui.appMenu')}>
        {MENUS.map(({ name, key, rows }) => (
          <div key={name} className="titlebar-menu-wrap">
            <button
              type="button"
              className={`titlebar-menu${openMenu === name ? ' is-open' : ''}`}
              aria-haspopup="menu"
              aria-expanded={openMenu === name}
              onClick={() => setOpenMenu((current) => current === name ? null : name)}
              onMouseEnter={() => { if (openMenu && openMenu !== name) setOpenMenu(name) }}
            >{t(key)}</button>
            {openMenu === name ? (
              <div className="titlebar-menu-popup no-drag" role="menu" aria-label={t(key)}>
                {rows.map((row, index) => isSeparator(row)
                  ? <div key={`sep-${index}`} className="titlebar-menu-separator" aria-hidden="true" />
                  : (
                    <button key={String(row.label)} type="button" role="menuitem" className="titlebar-menu-item" onClick={() => runEntry(row)}>
                      <span>{t(row.label)}</span>
                      {row.accelerator ? <kbd>{row.accelerator}</kbd> : null}
                    </button>
                  ))}
              </div>
            ) : null}
          </div>
        ))}
      </nav> : null}
      {drawWindowControls ? <div className="titlebar-controls no-drag">
        <button type="button" className="titlebar-control" aria-label={t('shellui.minimizeWindow')} data-tooltip={t('shellui.minimizeWindow')} onClick={() => { void window.ptx?.app.minimize() }}><MinimizeGlyph /></button>
        <button type="button" className="titlebar-control" aria-label={t('shellui.maximizeWindow')} data-tooltip={t('shellui.maximizeWindow')} onClick={() => { void window.ptx?.app.toggleMaximize() }}><MaximizeGlyph /></button>
        <button type="button" className="titlebar-control titlebar-control--close" aria-label={t('shellui.closeWindow')} data-tooltip={t('shellui.closeWindow')} onClick={() => { void window.ptx?.app.close() }}><CloseGlyph /></button>
      </div> : null}
    </header>
  )
}
