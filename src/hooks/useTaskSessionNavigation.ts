import { useCallback, useEffect, useState } from 'react'
import type { HarnessId, ProjectRecord, PtxApi, SessionRecord } from '@/types/api'
import { findProjectForSession } from '@/lib/workspace'

/** Wait for the destination harness's project catalog before activating its session. */
export function useTaskSessionNavigation({ bridge, harness, projects, selectHarness, selectSession, reportError }: {
  bridge: PtxApi | null; harness: HarnessId; projects: ProjectRecord[]
  selectHarness(harness: HarnessId): void; selectSession(session: SessionRecord): Promise<void>; reportError(error: unknown): void
}) {
  const [pending, setPending] = useState<SessionRecord | null>(null)
  const open = useCallback((file: string, destination: HarnessId) => {
    if (!bridge) return
    void bridge.sessions.list(undefined, true, destination, true).then((sessions) => {
      const session = sessions.find((item) => item.filePath === file && item.harness === destination)
      if (!session) throw new Error('Task session is not available in its harness catalog')
      setPending(session)
      if (destination !== harness) selectHarness(destination)
    }).catch(reportError)
  }, [bridge, harness, selectHarness, reportError])
  useEffect(() => {
    if (!pending || pending.harness !== harness || !findProjectForSession(projects.filter((project) => project.harness === harness), pending)) return
    setPending(null)
    void selectSession(pending).catch(reportError)
  }, [pending, harness, projects, selectSession, reportError])
  return open
}
