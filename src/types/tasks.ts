import type { AgentThinkingLevel, GitStatus, HarnessId, TranscriptMessage } from './api'

export const TASK_STATUSES = ['draft', 'running', 'waiting', 'review', 'failed', 'accepted'] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]
export interface TaskInput {
  projectId: string
  harness: HarnessId
  cwd: string
  model: string
  thinking?: AgentThinkingLevel
  title: string
  goal: string
  acceptance: string
}
export interface TaskTransition {
  status: TaskStatus
  at: string
  note?: string
}
export interface DevelopmentTask extends TaskInput {
  id: string
  projectName: string
  status: TaskStatus
  createdAt: string
  updatedAt: string
  runtimeId?: string
  sessionFile?: string
  sessionId?: string
  error?: string
  history: TaskTransition[]
}
export interface TaskTemplate {
  id: string
  name: string
  goal: string
  acceptance: string
}
export interface TaskEvidence {
  capturedAt: string
  git: GitStatus
  messages: TranscriptMessage[]
}
export interface TasksApi {
  list(): Promise<DevelopmentTask[]>
  create(input: TaskInput): Promise<DevelopmentTask>
  start(id: string): Promise<DevelopmentTask>
  stop(id: string): Promise<DevelopmentTask>
  accept(id: string): Promise<DevelopmentTask>
  revise(id: string, instructions: string): Promise<DevelopmentTask>
  evidence(id: string): Promise<TaskEvidence>
  templates(): Promise<TaskTemplate[]>
  saveTemplate(input: Omit<TaskTemplate, 'id'>): Promise<TaskTemplate>
  deleteTemplate(id: string): Promise<void>
}
