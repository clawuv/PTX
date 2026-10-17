import type { MessagePart } from '../../../src/types/api'
import { isRecord } from '../validation'

export interface ToolSummary { name: string; status: 'running' | 'done' | 'failed' }
export interface ReplyCard { text: string; tools: ToolSummary[] }

export function boundedCardText(text: string): string {
  const chars = Array.from(text)
  return chars.length <= 8000 ? text : `${chars.slice(0, 8000).join('')}\n\n内容较长，完整回复请在电脑查看。`
}

export function toolPanel(tools: ToolSummary[]) {
  return {
    tag: 'collapsible_panel', element_id: 'tools', expanded: false,
    header: { title: { tag: 'plain_text', content: `工具调用 · ${tools.length}${tools.length === 50 ? '+' : ''}` } },
    elements: [{ tag: 'markdown', content: tools.length ? tools.slice(0, 50).map((tool) => {
      const name = tool.name.replace(/[^\p{L}\p{N}_. -]/gu, '').slice(0, 80) || '工具'
      return `${name} · ${{ running: '执行中', done: '已完成', failed: '失败' }[tool.status]}`
    }).join('\n') : '暂无工具调用' }],
  }
}

export function cardJson(reply: ReplyCard, streaming: boolean) {
  return {
    schema: '2.0',
    config: { update_multi: true, streaming_mode: streaming, summary: { content: 'PTX 会话回复' } },
    body: { elements: [
      { tag: 'markdown', element_id: 'answer', content: boundedCardText(reply.text) || (streaming ? '正在处理…' : '本轮已结束，无文字回复。') },
      ...(reply.tools.length || streaming ? [toolPanel(reply.tools)] : []),
    ] },
  }
}

export function summarizeTools(parts: MessagePart[]): ToolSummary[] {
  const tools: ToolSummary[] = []
  for (const part of parts) {
    if (part.type === 'toolCall' && tools.length < 50) tools.push({ name: part.name, status: 'running' })
    if (part.type === 'toolResult') {
      const tool = [...tools].reverse().find((candidate) => candidate.status === 'running' && (!part.name || candidate.name === part.name))
      if (tool) tool.status = part.isError ? 'failed' : part.streaming ? 'running' : 'done'
    }
  }
  return tools
}

/** Captures only public answer text and tool names/status, never tool payloads or reasoning. */
export class LiveReply {
  private text = ''
  private tools = new Map<string, ToolSummary>()
  revision = 0
  finalizing = false

  apply(event: Record<string, unknown>): void {
    if (event.type === 'message_start' && isRecord(event.message) && event.message.role === 'assistant' && this.text) this.text = boundedCardText(`${this.text}\n\n`)
    if (event.type === 'message_update') {
      const delta = isRecord(event.assistantMessageEvent) ? event.assistantMessageEvent : event.delta
      if (isRecord(delta) && delta.type === 'text_delta' && typeof delta.delta === 'string') {
        this.text = boundedCardText(this.text + delta.delta)
        this.revision++
      }
    }
    if (event.type === 'tool_execution_start' || event.type === 'tool_execution_end') {
      const name = typeof event.toolName === 'string' ? event.toolName.slice(0, 80) : '工具'
      const id = typeof event.toolCallId === 'string' ? event.toolCallId : name
      if (this.tools.has(id) || this.tools.size < 50) {
        this.tools.set(id, { name, status: event.type === 'tool_execution_start' ? 'running' : event.isError === true ? 'failed' : 'done' })
        this.revision++
      }
    }
  }

  snapshot(): ReplyCard { return { text: this.text, tools: [...this.tools.values()].map((tool) => ({ ...tool })) } }
}
