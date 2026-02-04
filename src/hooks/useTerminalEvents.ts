import { useEffect, useState } from 'react';
import { getTerminalSupabaseClient, hasTerminalSupabaseConfig } from '../lib/supabase';
import { EMPTY_FILTER_VALUE } from '../types';
import type { DateRange, TerminalEvent, TerminalFilters } from '../types';

const SELECT_FIELDS = [
  'id',
  'event_ts',
  'event_name',
  'feature',
  'action',
  'success',
  'user_id',
  'session_id',
  'ticker',
  'response_mode',
  'duration_ms',
  'token_count',
  'phase',
  'error_message',
  'properties',
  'device_type',
  'browser',
  'os',
].join(',');

const toUtcRange = (range: DateRange) => {
  const startIso = `${range.start}T00:00:00.000Z`;
  const endIso = `${range.end}T23:59:59.999Z`;
  return { startIso, endIso };
};

const applyFilter = (query: any, column: string, value: string) => {
  if (!value) return query;
  if (value === EMPTY_FILTER_VALUE) return query.is(column, null);
  return query.eq(column, value);
};

const applyFilters = (query: any, filters: TerminalFilters) => {
  query = applyFilter(query, 'ticker', filters.ticker);
  query = applyFilter(query, 'response_mode', filters.responseMode);
  query = applyFilter(query, 'event_name', filters.eventName);
  query = applyFilter(query, 'phase', filters.phase);
  query = applyFilter(query, 'device_type', filters.deviceType);
  query = applyFilter(query, 'browser', filters.browser);
  query = applyFilter(query, 'os', filters.os);
  return query;
};

export const useTerminalEvents = (
  range: DateRange,
  filters: TerminalFilters,
  enabled = true,
  refreshKey = 0
) => {
  const [events, setEvents] = useState<TerminalEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);

  useEffect(() => {
    const client = getTerminalSupabaseClient();
    if (!enabled || !hasTerminalSupabaseConfig || !client || !range.start || !range.end) return;
    let cancelled = false;

    const fetchEvents = async () => {
      setLoading(true);
      setError(null);
      setTruncated(false);

      const { startIso, endIso } = toUtcRange(range);
      const pageSize = 1000;
      const maxRows = 200000;
      const maxConcurrency = 4;
      const maxPages = Math.ceil(maxRows / pageSize);
      const pageResults: TerminalEvent[][] = [];
      let nextPage = 0;
      let done = false;

      const fetchPage = async (pageIndex: number) => {
        const from = pageIndex * pageSize;
        const to = Math.min(from + pageSize - 1, maxRows - 1);

        let query = client
          .from('terminal_events')
          .select(SELECT_FIELDS)
          .gte('event_ts', startIso)
          .lte('event_ts', endIso)
          .order('event_ts', { ascending: true })
          .range(from, to);

        query = applyFilters(query, filters);

        const { data, error: queryError } = await query;
        return { data: ((data ?? []) as unknown) as TerminalEvent[], error: queryError, pageIndex };
      };

      while (!done && nextPage < maxPages && !cancelled) {
        const batchPages: number[] = [];

        while (batchPages.length < maxConcurrency && nextPage < maxPages) {
          batchPages.push(nextPage);
          nextPage += 1;
        }

        const batchResults = await Promise.all(batchPages.map((pageIndex) => fetchPage(pageIndex)));
        if (cancelled) break;

        for (const result of batchResults) {
          if (result.error) {
            setError(result.error.message || 'Failed to load terminal events');
            done = true;
            break;
          }
          pageResults[result.pageIndex] = result.data;
          if (result.data.length < pageSize) {
            done = true;
          }
        }
      }

      if (!cancelled) {
        const all = pageResults.flat();
        if (all.length >= maxRows) {
          setTruncated(true);
        }
        setEvents(all);
        setLoading(false);
      }
    };

    fetchEvents();

    return () => {
      cancelled = true;
    };
  }, [range.start, range.end, filters, enabled, refreshKey]);

  return { events, loading, error, truncated };
};
