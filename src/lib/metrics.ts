import { EMPTY_FILTER_VALUE } from '../types';
import type { BarDatum, DailyDatum, UsageEvent } from '../types';

const toDayKey = (ts: string) => {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return 'invalid';
  return date.toISOString().slice(0, 10);
};

export const groupDaily = (events: UsageEvent[]): DailyDatum[] => {
  const map = new Map<string, { users: Set<string>; sessions: Set<string>; events: number }>();
  events.forEach((event) => {
    const day = toDayKey(event.event_ts);
    if (!map.has(day)) {
      map.set(day, { users: new Set(), sessions: new Set(), events: 0 });
    }
    const entry = map.get(day);
    if (!entry) return;
    if (event.user_id) entry.users.add(event.user_id);
    if (event.session_id) entry.sessions.add(event.session_id);
    entry.events += 1;
  });

  return Array.from(map.entries())
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([day, entry]) => ({
      day,
      users: entry.users.size,
      sessions: entry.sessions.size,
      events: entry.events,
    }));
};

export const distinctCount = (events: UsageEvent[], key: keyof UsageEvent): number => {
  const set = new Set<string>();
  events.forEach((event) => {
    const value = event[key];
    if (typeof value === 'string' && value.trim()) set.add(value);
  });
  return set.size;
};

export const buildBarList = (
  events: UsageEvent[],
  key: keyof UsageEvent,
  limit = 6,
  labelFallback = 'Not set'
): BarDatum[] => {
  const counts = new Map<string, { value: number; label: string; isFallback: boolean }>();
  events.forEach((event) => {
    const raw = event[key];
    const hasValue = typeof raw === 'string' && raw.trim();
    const label = hasValue ? raw : labelFallback;
    const valueKey = hasValue ? raw : EMPTY_FILTER_VALUE;
    const entry = counts.get(valueKey) ?? { value: 0, label, isFallback: !hasValue };
    entry.value += 1;
    counts.set(valueKey, entry);
  });

  return Array.from(counts.entries())
    .map(([valueKey, entry]) => ({
      key: valueKey,
      label: entry.label,
      value: entry.value,
      isFallback: entry.isFallback,
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
};

export const buildDistinctUserBarList = (
  events: UsageEvent[],
  key: keyof UsageEvent,
  limit = 6,
  labelFallback = 'Not set'
): BarDatum[] => {
  const map = new Map<string, { label: string; users: Set<string>; isFallback: boolean }>();
  events.forEach((event) => {
    const raw = event[key];
    const hasValue = typeof raw === 'string' && raw.trim();
    const label = hasValue ? raw : labelFallback;
    const valueKey = hasValue ? raw : EMPTY_FILTER_VALUE;
    if (!map.has(valueKey)) {
      map.set(valueKey, { label, users: new Set(), isFallback: !hasValue });
    }
    if (event.user_id) map.get(valueKey)?.users.add(event.user_id);
  });

  return Array.from(map.entries())
    .map(([valueKey, entry]) => ({
      key: valueKey,
      label: entry.label,
      value: entry.users.size,
      isFallback: entry.isFallback,
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
};

export const computeSessionStats = (events: UsageEvent[]) => {
  const sessions = new Map<string, { start: number; end: number; userId: string | null }>();
  events.forEach((event) => {
    if (!event.session_id) return;
    const time = new Date(event.event_ts).getTime();
    if (!Number.isFinite(time)) return;
    const existing = sessions.get(event.session_id);
    if (!existing) {
      sessions.set(event.session_id, { start: time, end: time, userId: event.user_id || null });
      return;
    }
    existing.start = Math.min(existing.start, time);
    existing.end = Math.max(existing.end, time);
  });

  const durations = Array.from(sessions.values())
    .map((s) => Math.max(0, s.end - s.start) / 1000)
    .filter((v) => Number.isFinite(v));

  const totalDuration = durations.reduce((sum, v) => sum + v, 0);
  const avgDuration = durations.length ? totalDuration / durations.length : 0;

  return {
    sessionCount: sessions.size,
    avgDurationSeconds: avgDuration,
  };
};

export const computeSuccessRate = (events: UsageEvent[]) => {
  const withFlag = events.filter((event) => typeof event.success === 'boolean');
  if (!withFlag.length) return { successRate: null, errorRate: null };
  const successCount = withFlag.filter((event) => event.success).length;
  return {
    successRate: successCount / withFlag.length,
    errorRate: 1 - successCount / withFlag.length,
  };
};

export const extractNumericProperty = (events: UsageEvent[], key: string) => {
  const values: number[] = [];
  events.forEach((event) => {
    const properties = event.properties as Record<string, unknown> | null;
    if (!properties) return;
    const value = properties[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      values.push(value);
    }
  });
  if (!values.length) return null;
  const total = values.reduce((sum, v) => sum + v, 0);
  return total / values.length;
};

export const extractTopProperty = (events: UsageEvent[], key: string, limit = 6): BarDatum[] => {
  const counts = new Map<string, number>();
  events.forEach((event) => {
    const properties = event.properties as Record<string, unknown> | null;
    if (!properties) return;
    const raw = properties[key];
    if (typeof raw !== 'string' || !raw.trim()) return;
    counts.set(raw, (counts.get(raw) || 0) + 1);
  });

  return Array.from(counts.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
};

export const filterByDateRange = (events: UsageEvent[], start: Date, end: Date) => {
  const startMs = start.getTime();
  const endMs = end.getTime();
  return events.filter((event) => {
    const time = new Date(event.event_ts).getTime();
    return Number.isFinite(time) && time >= startMs && time <= endMs;
  });
};
