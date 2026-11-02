// Fixed-window counters kept in memory. Good enough to stop a runaway client
// from spending the owner's money; a restart simply resets them.
const windows = new Map();

export function allow(key, limit, windowMs = 60 * 60 * 1000) {
  const now = Date.now();
  if (windows.size > 50000) {
    for (const [name, entry] of windows) if (entry.resetAt <= now) windows.delete(name);
  }
  const entry = windows.get(key);
  if (!entry || entry.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  entry.count += 1;
  return entry.count <= limit;
}
