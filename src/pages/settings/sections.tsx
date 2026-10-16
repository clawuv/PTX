import { AudioLines, Bot, Boxes, Folder, Info, LockKeyhole, PawPrint, Settings2, Sun, Terminal } from 'lucide-react'
import type { ComponentType } from 'react'
import { BrowserGlobe } from '@/components/ui'
import type { MessageKey } from '@/lib/i18n'
import type { SettingsSection } from './contracts'

export interface SettingsSectionDescriptor {
  id: SettingsSection
  label: MessageKey
  icon: ComponentType<{ size?: number }>
}

export interface SettingsSectionGroup {
  /** Micro heading shown above the group in the settings navs. */
  label: MessageKey
  sections: readonly SettingsSectionDescriptor[]
}

/** Shared by the settings page nav and the sidebar's settings mode. */
export const SETTINGS_SECTION_GROUPS: readonly SettingsSectionGroup[] = [
  {
    label: 'settings.group.workspace',
    sections: [
      { id: 'general', label: 'settings.general', icon: Settings2 },
      { id: 'appearance', label: 'settings.appearance', icon: Sun },
      { id: 'projects', label: 'nav.projects', icon: Folder },
      { id: 'agent', label: 'settings.harness', icon: Bot },
      { id: 'providers', label: 'settings.providers', icon: Boxes },
    ],
  },
  {
    label: 'settings.group.features',
    sections: [
      { id: 'voice', label: 'settings.voice', icon: AudioLines },
      { id: 'pets', label: 'settings.pets', icon: PawPrint },
      { id: 'browser', label: 'settings.browser', icon: BrowserGlobe },
      { id: 'terminal', label: 'settings.terminal', icon: Terminal },
    ],
  },
  {
    label: 'settings.group.system',
    sections: [
      { id: 'privacy', label: 'settings.privacy', icon: LockKeyhole },
      { id: 'about', label: 'settings.about', icon: Info },
    ],
  },
]

export const SETTINGS_SECTIONS: readonly SettingsSectionDescriptor[] = SETTINGS_SECTION_GROUPS.flatMap((group) => group.sections)
