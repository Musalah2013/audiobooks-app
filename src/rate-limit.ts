// Shared in-memory rate limiter for Cloudflare Workers
// Note: This is per-Worker-instance. For distributed rate limiting, use D1 or KV.

export interface RateLimitEntry {
  count: number;
  resetAt: number;
}

export class RateLimiter {
  private map = new Map<string, RateLimitEntry>();

  constructor(
    private windowMs: number,
    private maxRequests: number,
  ) {}

  check(key: string): { allowed: boolean; retryAfter: number } {
    const now = Date.now();
    const entry = this.map.get(key);
    if (!entry || now > entry.resetAt) {
      this.map.set(key, { count: 1, resetAt: now + this.windowMs });
      return { allowed: true, retryAfter: 0 };
    }
    if (entry.count >= this.maxRequests) {
      return { allowed: false, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
    }
    entry.count += 1;
    return { allowed: true, retryAfter: 0 };
  }

  /** Get client IP from Cloudflare headers with fallback */
  static getClientIP(c: { req: { header: (name: string) => string | undefined } }): string {
    return c.req.header('CF-Connecting-IP')
      ?? c.req.header('X-Forwarded-For')?.split(',')[0]?.trim()
      ?? 'unknown';
  }
}

/** Default rate limiters */
export const loginRateLimiter = new RateLimiter(60_000, 10); // 10 per minute
export const magicLinkRateLimiter = new RateLimiter(60_000, 5); // 5 per minute
export const bootstrapRateLimiter = new RateLimiter(60_000, 3); // 3 per minute
