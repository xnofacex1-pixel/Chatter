import { fail } from './http.js';

const buckets = new Map();

// Periodically drop stale buckets so the map cannot grow unbounded.
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now && bucket.hits.length === 0) buckets.delete(key);
  }
}, 60_000).unref?.();

/**
 * Simple in-memory sliding-window limiter. Enough for a single Chatter node;
 * swap for a shared store when the platform runs on multiple instances.
 */
export function rateLimit({ windowMs, max, keyPrefix = 'rl', message = 'Too many attempts. Please wait a moment and try again.' }) {
  return (req, res, next) => {
    const identifier = req.rateLimitKey || req.ip || req.socket?.remoteAddress || 'unknown';
    const key = `${keyPrefix}:${identifier}`;
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { hits: [], resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.hits = bucket.hits.filter((time) => now - time < windowMs);
    if (bucket.hits.length >= max) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.set('Retry-After', String(retryAfter));
      return next(Object.assign(new Error(message), { status: 429, code: 'rate_limited', retryAfter }));
    }
    bucket.hits.push(now);
    res.set('X-RateLimit-Limit', String(max));
    res.set('X-RateLimit-Remaining', String(Math.max(0, max - bucket.hits.length)));
    next();
  };
}

/** Count a failed attempt against a key without consuming a request slot. */
export function recordFailure(key) {
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { hits: [], resetAt: now + 60_000 };
    buckets.set(key, bucket);
  }
  bucket.hits.push(now);
}

export function requireRateLimitKey(factory) {
  return (req, _res, next) => {
    req.rateLimitKey = factory(req);
    next();
  };
}

export const resetRateLimits = () => buckets.clear();
export const assert = (condition, status, code, message) => {
  if (!condition) fail(status, code, message);
};
