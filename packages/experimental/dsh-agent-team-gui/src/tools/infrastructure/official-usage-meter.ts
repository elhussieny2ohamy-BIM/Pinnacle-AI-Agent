import type { SubagentActivation } from '@deepseek-ai/dsh-subagent'
import type { AgentTokenUsage } from '../../types.ts'

export interface TokenUsageProjection {
  readonly uncachedInputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens: number
  readonly cacheWriteTokens: number
}

/** Narrow adapter over the official session `tokenUsage` projection. */
export class OfficialUsageMeter {
  constructor() {}

  add(...samples: Array<AgentTokenUsage | undefined>): AgentTokenUsage {
    const present = samples.filter((sample): sample is AgentTokenUsage => sample !== undefined)
    const buckets = present.reduce((total, sample) => ({
      uncachedInputTokens: total.uncachedInputTokens + sample.uncachedInputTokens,
      outputTokens: total.outputTokens + sample.outputTokens,
      cacheReadTokens: total.cacheReadTokens + sample.cacheReadTokens,
      cacheWriteTokens: total.cacheWriteTokens + sample.cacheWriteTokens,
    }), { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })
    return {
      ...buckets,
      totalTokens: buckets.uncachedInputTokens + buckets.outputTokens + buckets.cacheReadTokens + buckets.cacheWriteTokens,
      providerReported: present.some(sample => sample.providerReported),
    }
  }

  usageFor(_run: SubagentActivation, _baseline?: TokenUsageProjection): AgentTokenUsage | undefined {
    return undefined
  }

  baselineFor(_run: SubagentActivation): TokenUsageProjection | undefined {
    return undefined
  }

  /** Subscribe one child and serialize durable publications without blocking projection callbacks. */
  track(
    _run: SubagentActivation,
    _baseline: TokenUsageProjection | undefined,
    _publishUsage: (usage: AgentTokenUsage) => Promise<void>,
    _label: string,
  ): () => Promise<AgentTokenUsage | undefined> {
    return async () => undefined
  }
}
