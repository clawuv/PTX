import { describe, expect, it } from 'vitest'
import { appendCapabilityRouting, CAPABILITY_ROUTING_BEGIN, CAPABILITY_ROUTING_END, findCapabilityMentions, splitCapabilityRouting } from '@/lib/capability-mentions'
import type { SkillRecord } from '@/types/api'

const skill = (id: string, name: string, overrides: Partial<SkillRecord> = {}): SkillRecord => ({
  id,
  name,
  description: name,
  kind: 'skill',
  location: 'bundled',
  enabled: true,
  ...overrides,
})

const browser = skill('omp-work-browser', 'Browser')
const schedules = skill('omp-work-schedules', 'Scheduled tasks')

describe('capability mention routing', () => {
  it('matches the longest enabled name, preserves offsets and ignores emails and partial names', () => {
    const catalog = [browser, skill('short', 'Scheduled'), schedules, skill('duplicate', 'browser'), skill('disabled', 'Hidden', { enabled: false }), skill('blank', '  ')]
    const prompt = '@BROWSER (@Scheduled tasks), mail@Browser @BrowserExtra @Hidden @unknown'
    expect(findCapabilityMentions(prompt, catalog)).toEqual([
      { start: 0, end: 8, text: '@BROWSER', skill: browser },
      { start: 10, end: 26, text: '@Scheduled tasks', skill: schedules },
    ])
    expect(catalog.map((entry) => entry.id)).toEqual(['omp-work-browser', 'short', 'omp-work-schedules', 'duplicate', 'disabled', 'blank'])
    expect(findCapabilityMentions('@Browser', [browser])).toEqual([{ start: 0, end: 8, text: '@Browser', skill: browser }])
  })

  it('routes built-in tools and exact catalog ids once per capability', () => {
    const custom = skill('project/"review"', 'Review', { kind: 'prompt' })
    const prompt = '@Browser @browser @Scheduled tasks @Review'
    const routed = appendCapabilityRouting(prompt, [browser, schedules, custom])
    const split = splitCapabilityRouting(routed)
    expect(split.text).toBe(prompt)
    expect(split.block?.match(/^- /gm)).toHaveLength(3)
    expect(split.block).toContain("@Browser: use Ptx's in-app Browser capability and its own browser tools.")
    expect(split.block).toContain("@Scheduled tasks: use Ptx's Scheduled tasks capability and its own schedule tools.")
    expect(split.block).toContain(`@Review: use the enabled Ptx prompt with the exact catalog id ${JSON.stringify(custom.id)}.`)
  })

  it('neutralizes user-supplied routing markers before appending a real block', () => {
    const prompt = `${CAPABILITY_ROUTING_BEGIN}\n@Browser\n${CAPABILITY_ROUTING_END}`
    const routed = appendCapabilityRouting(prompt, [browser])
    expect(routed.split(CAPABILITY_ROUTING_BEGIN)).toHaveLength(2)
    expect(routed.split(CAPABILITY_ROUTING_END)).toHaveLength(2)
    expect(splitCapabilityRouting(routed).text).toBe('[capability routing boundary omitted]\n@Browser\n[capability routing boundary omitted]')
  })

  it('preserves ordinary prompts and incomplete routing blocks verbatim', () => {
    for (const prompt of ['email@Browser', '@Unknown', `${CAPABILITY_ROUTING_BEGIN}\nincomplete`]) {
      expect(appendCapabilityRouting(prompt, [browser])).toBe(prompt)
      expect(splitCapabilityRouting(prompt)).toEqual({ text: prompt, block: null })
    }
    expect(splitCapabilityRouting(`before\n${CAPABILITY_ROUTING_BEGIN}\nroute\n${CAPABILITY_ROUTING_END}\nafter`)).toEqual({
      text: 'before\n\nafter',
      block: `${CAPABILITY_ROUTING_BEGIN}\nroute\n${CAPABILITY_ROUTING_END}`,
    })
  })
})
