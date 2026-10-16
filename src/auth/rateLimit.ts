export const FAILED_LOGIN_WINDOW_MS = 60000;
export const FAILED_LOGIN_MAX = 5;

const failures = new Map<string, number[]>();

function ipKey(ip: string): string {
  return `ip:${ip}`;
}

function emailKey(email: string): string {
  return `email:${email}`;
}

function prune(now: number, key: string): number[] {
  const cutoff = now - FAILED_LOGIN_WINDOW_MS;
  const recent = (failures.get(key) ?? []).filter((t) => t > cutoff);
  if (recent.length === 0) {
    failures.delete(key);
  } else {
    failures.set(key, recent);
  }
  return recent;
}

export function checkRateLimit(ip: string, email: string): boolean {
  const now = Date.now();
  return (
    prune(now, ipKey(ip)).length >= FAILED_LOGIN_MAX ||
    prune(now, emailKey(email)).length >= FAILED_LOGIN_MAX
  );
}

export function recordFailedLogin(ip: string, email: string): void {
  const now = Date.now();
  for (const key of [ipKey(ip), emailKey(email)]) {
    const recent = prune(now, key);
    recent.push(now);
    failures.set(key, recent);
  }
}

export function clearFailedLogins(ip: string, email: string): void {
  failures.delete(ipKey(ip));
  failures.delete(emailKey(email));
}
