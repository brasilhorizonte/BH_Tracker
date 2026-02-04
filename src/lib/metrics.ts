import { EMPTY_FILTER_VALUE } from '../types';
import type {
  BarDatum,
  DailyDatum,
  UsageEvent,
  TerminalEvent,
  TerminalDailyDatum,
  TerminalStats,
  AgentPhaseStats
} from '../types';

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

// ============================================================================
// Terminal Events Metrics
// ============================================================================

/**
 * Agrupa eventos de terminal por dia
 */
export const groupTerminalDaily = (events: TerminalEvent[]): TerminalDailyDatum[] => {
  const map = new Map<string, { messages: number; users: Set<string>; sessions: Set<string> }>();

  events.forEach((event) => {
    const day = toDayKey(event.event_ts);
    if (!map.has(day)) {
      map.set(day, { messages: 0, users: new Set(), sessions: new Set() });
    }
    const entry = map.get(day);
    if (!entry) return;

    if (event.event_name === 'terminal_message_send') {
      entry.messages += 1;
    }
    if (event.user_id) entry.users.add(event.user_id);
    if (event.session_id) entry.sessions.add(event.session_id);
  });

  return Array.from(map.entries())
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([day, entry]) => ({
      day,
      messages: entry.messages,
      users: entry.users.size,
      sessions: entry.sessions.size,
    }));
};

/**
 * Calcula estatísticas gerais do terminal
 */
export const computeTerminalStats = (events: TerminalEvent[]): TerminalStats => {
  const messageEvents = events.filter((e) => e.event_name === 'terminal_message_send');
  const answerDoneEvents = events.filter((e) => e.event_name === 'terminal_agent_answer_done');

  const users = new Set<string>();
  const tickers = new Set<string>();
  const sessions = new Set<string>();

  events.forEach((event) => {
    if (event.user_id) users.add(event.user_id);
    if (event.ticker) tickers.add(event.ticker);
    if (event.session_id) sessions.add(event.session_id);
  });

  // Calcular duração média das respostas
  const durations = answerDoneEvents
    .map((e) => e.duration_ms)
    .filter((d): d is number => typeof d === 'number' && Number.isFinite(d));

  const avgDurationMs = durations.length
    ? durations.reduce((sum, d) => sum + d, 0) / durations.length
    : 0;

  // Calcular taxa de sucesso
  const eventsWithSuccess = events.filter((e) => typeof e.success === 'boolean');
  const successCount = eventsWithSuccess.filter((e) => e.success).length;
  const successRate = eventsWithSuccess.length ? successCount / eventsWithSuccess.length : 1;

  return {
    totalMessages: messageEvents.length,
    uniqueUsers: users.size,
    uniqueTickers: tickers.size,
    uniqueSessions: sessions.size,
    avgDurationMs,
    successRate,
  };
};

/**
 * Constrói distribuição de tickers
 */
export const buildTickerDistribution = (
  events: TerminalEvent[],
  limit = 10
): BarDatum[] => {
  const counts = new Map<string, number>();

  events
    .filter((e) => e.event_name === 'terminal_message_send' && e.ticker)
    .forEach((event) => {
      const ticker = event.ticker!;
      counts.set(ticker, (counts.get(ticker) || 0) + 1);
    });

  return Array.from(counts.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
};

/**
 * Constrói distribuição de modos de resposta
 */
export const buildModeDistribution = (events: TerminalEvent[]): BarDatum[] => {
  const counts = new Map<string, number>();

  events
    .filter((e) => e.event_name === 'terminal_message_send' && e.response_mode)
    .forEach((event) => {
      const mode = event.response_mode!;
      counts.set(mode, (counts.get(mode) || 0) + 1);
    });

  return Array.from(counts.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);
};

/**
 * Calcula estatísticas por fase do agente
 */
export const computeAgentPhaseStats = (events: TerminalEvent[]): AgentPhaseStats => {
  // Agrupa eventos por sessão para calcular tempos de cada fase
  const sessionEvents = new Map<string, TerminalEvent[]>();

  events.forEach((event) => {
    if (!event.session_id) return;
    const existing = sessionEvents.get(event.session_id) || [];
    existing.push(event);
    sessionEvents.set(event.session_id, existing);
  });

  // Calcula duração média baseada nos eventos de answer_done
  const answerDoneEvents = events.filter((e) => e.event_name === 'terminal_agent_answer_done');

  const durations = answerDoneEvents
    .map((e) => e.duration_ms)
    .filter((d): d is number => typeof d === 'number' && Number.isFinite(d));

  const avgTotal = durations.length
    ? durations.reduce((sum, d) => sum + d, 0) / durations.length
    : 0;

  // Estimativa de fases (proporção típica baseada em observações)
  // Planning: ~10%, Execution: ~60%, Answering: ~30%
  const planCount = events.filter((e) => e.event_name === 'terminal_agent_plan_ready').length;
  const taskEndCount = events.filter((e) => e.event_name === 'terminal_agent_task_end').length;
  const answerCount = answerDoneEvents.length;

  return {
    planning: {
      avg: Math.round(avgTotal * 0.1),
      count: planCount,
    },
    execution: {
      avg: Math.round(avgTotal * 0.6),
      count: taskEndCount,
    },
    answering: {
      avg: Math.round(avgTotal * 0.3),
      count: answerCount,
    },
  };
};

/**
 * Constrói lista de erros por tipo
 */
export const buildTerminalErrorList = (
  events: TerminalEvent[],
  limit = 10
): BarDatum[] => {
  const counts = new Map<string, number>();

  events
    .filter((e) => e.success === false && e.error_message)
    .forEach((event) => {
      const error = event.error_message!;
      counts.set(error, (counts.get(error) || 0) + 1);
    });

  return Array.from(counts.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
};

/**
 * Calcula taxa de erro por fase
 */
export const computeErrorRateByPhase = (events: TerminalEvent[]): BarDatum[] => {
  const phaseErrors = new Map<string, { errors: number; total: number }>();

  events.forEach((event) => {
    if (!event.phase) return;
    const existing = phaseErrors.get(event.phase) || { errors: 0, total: 0 };
    existing.total += 1;
    if (event.success === false) {
      existing.errors += 1;
    }
    phaseErrors.set(event.phase, existing);
  });

  return Array.from(phaseErrors.entries())
    .map(([label, data]) => ({
      label,
      value: data.total > 0 ? Math.round((data.errors / data.total) * 100) : 0,
      title: `${data.errors}/${data.total} errors`,
    }))
    .sort((a, b) => b.value - a.value);
};

/**
 * Conta eventos únicos de terminal por campo
 */
export const terminalDistinctCount = (
  events: TerminalEvent[],
  key: keyof TerminalEvent
): number => {
  const set = new Set<string>();
  events.forEach((event) => {
    const value = event[key];
    if (typeof value === 'string' && value.trim()) set.add(value);
  });
  return set.size;
};

/**
 * Constrói lista de barras para terminal events
 */
export const buildTerminalBarList = (
  events: TerminalEvent[],
  key: keyof TerminalEvent,
  limit = 6,
  labelFallback = 'Not set'
): BarDatum[] => {
  const counts = new Map<string, { value: number; label: string; isFallback: boolean }>();

  events.forEach((event) => {
    const raw = event[key];
    const hasValue = typeof raw === 'string' && raw.trim();
    const label = hasValue ? String(raw) : labelFallback;
    const valueKey = hasValue ? String(raw) : EMPTY_FILTER_VALUE;
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
