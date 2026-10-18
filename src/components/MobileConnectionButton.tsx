import { Smartphone } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useI18n } from '@/lib/i18n'

export function MobileConnectionButton({ onClick }: { onClick(): void }) {
  const { t } = useI18n()
  const [connected, setConnected] = useState(false)
  useEffect(() => {
    let active = true
    let pending = false
    const refresh = async () => {
      if (pending) return
      pending = true
      try {
        const status = await window.ptx.feishu.status()
        if (active) setConnected(status.enabled && status.connection === 'connected')
      } catch { if (active) setConnected(false) }
      finally { pending = false }
    }
    void refresh()
    const timer = setInterval(() => { void refresh() }, 3000)
    return () => { active = false; clearInterval(timer) }
  }, [])
  const label = t(connected ? 'sidebar.mobileConnected' : 'sidebar.mobileSoon')
  return <button type="button" className={`sidebar__mobile${connected ? ' sidebar__mobile--connected' : ''}`} onClick={onClick} data-tooltip={label} aria-label={label}><Smartphone size={16} /></button>
}
