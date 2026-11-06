// Cron expressions, in this machine's local time: minute hour day-of-month month day-of-week.
// Each field takes *, numbers, ranges, lists and steps (*/15, 1-5, 8,20, 9-17/2); in the last one 0 and 7 are Sunday.
// As in crontab, when both day fields are restricted a day that fits either of them counts.
type Cron = {minute: Set<number>; hour: Set<number>; dom: Set<number>; month: Set<number>; dow: Set<number>; either: boolean};

function field(text: string, min: number, max: number) {
  const out = new Set<number>();
  for (const part of text.split(',')) {
    const m = part.match(/^(?:\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/);
    if (!m) return null;
    const step = m[3] ? Number(m[3]) : 1;
    const from = m[1] ? Number(m[1]) : min;
    const to = !m[1] || m[3] ? (m[2] ? Number(m[2]) : max) : m[2] ? Number(m[2]) : from;
    if (!step || from < min || to > max || from > to) return null;
    for (let i = from; i <= to; i += step) out.add(i);
  }
  return out;
}

export function parseCron(expr: string): Cron | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [minute, hour, dom, month, dow] = [field(parts[0], 0, 59), field(parts[1], 0, 23), field(parts[2], 1, 31), field(parts[3], 1, 12), field(parts[4], 0, 7)];
  if (!minute || !hour || !dom || !month || !dow) return null;
  if (dow.delete(7)) dow.add(0);
  return {minute, hour, dom, month, dow, either: !parts[2].startsWith('*') && !parts[4].startsWith('*')};
}

function dayFits(c: Cron, d: Date) {
  if (!c.month.has(d.getMonth() + 1)) return false;
  const dom = c.dom.has(d.getDate());
  const dow = c.dow.has(d.getDay());
  return c.either ? dom || dow : dom && dow;
}

export function cronMatches(expr: string, d: Date) {
  const c = parseCron(expr);
  return !!c && c.minute.has(d.getMinutes()) && c.hour.has(d.getHours()) && dayFits(c, d);
}

// The next time it fires after `from`; null if the expression is wrong or the date never comes (31 de febrero).
export function nextRun(expr: string, from = new Date()) {
  const c = parseCron(expr);
  if (!c) return null;
  const hours = [...c.hour].sort((a, b) => a - b);
  const minutes = [...c.minute].sort((a, b) => a - b);
  // Five years: the wait for a 29 de febrero.
  for (let i = 0; i < 5 * 366; i++) {
    const day = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i);
    if (!dayFits(c, day)) continue;
    for (const h of hours)
      for (const m of minutes) {
        const t = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m);
        if (t > from) return t;
      }
  }
  return null;
}

// The next n times it runs after `from`, in order (fewer if it stops happening).
export function nextRuns(expr: string, n: number, from = new Date()) {
  const out: Date[] = [];
  for (let t = nextRun(expr, from); t && out.length < n; t = nextRun(expr, t)) out.push(t);
  return out;
}
