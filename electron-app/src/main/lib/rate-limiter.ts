// ─── Per-Token Rate Limiter ───
// Sliding window rate limiting: RPM (requests per minute) + burst (requests per second)

import type { RateLimitConfig } from './types'

interface RateLimitState {
  minuteTimestamps: number[]
  secondTimestamps: number[]
}

export class RateLimiter {
  private state = new Map<string, RateLimitState>()

  /**
   * Check if a request is allowed under the rate limit.
   * @param tokenHash - The SHA-256 hash of the token (identifier)
   * @param config - Rate limit config for this token
   * @returns { allowed, retryAfterMs } - whether the request is allowed
   */
  check(tokenHash: string, config: RateLimitConfig): { allowed: boolean; retryAfterMs: number } {
    const now = Date.now()
    let state = this.state.get(tokenHash)

    if (!state) {
      state = { minuteTimestamps: [], secondTimestamps: [] }
      this.state.set(tokenHash, state)
    }

    // Prune old timestamps
    const oneMinuteAgo = now - 60_000
    const oneSecondAgo = now - 1_000
    state.minuteTimestamps = state.minuteTimestamps.filter((t) => t > oneMinuteAgo)
    state.secondTimestamps = state.secondTimestamps.filter((t) => t > oneSecondAgo)

    // Check burst limit (per second)
    if (state.secondTimestamps.length >= config.burst) {
      const oldest = state.secondTimestamps[0]
      return { allowed: false, retryAfterMs: 1_000 - (now - oldest) }
    }

    // Check RPM limit
    if (state.minuteTimestamps.length >= config.rpm) {
      const oldest = state.minuteTimestamps[0]
      return { allowed: false, retryAfterMs: 60_000 - (now - oldest) }
    }

    // Record this request
    state.minuteTimestamps.push(now)
    state.secondTimestamps.push(now)

    return { allowed: true, retryAfterMs: 0 }
  }

  /**
   * Remove rate limit state for a token (e.g., when revoked).
   */
  remove(tokenHash: string): void {
    this.state.delete(tokenHash)
  }

  /**
   * Clear all rate limit state.
   */
  clear(): void {
    this.state.clear()
  }
}

export const rateLimiter = new RateLimiter()
