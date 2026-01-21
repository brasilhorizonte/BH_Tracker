import { useEffect, useState } from 'react';
import { getSupabaseClient, hasSupabaseConfig } from '../lib/supabase';
import { EMPTY_FILTER_VALUE, LOVABLE_FILTER_VALUE } from '../types';
import type { DateRange, Filters, UsageEvent } from '../types';

const SELECT_FIELDS = [
  'id',
  'event_ts',
  'event_name',
  'feature',
  'action',
  'success',
  'user_id',
  'session_id',
  'anon_id',
  'plan',
  'subscription_status',
  'billing_period',
  'route',
  'section',
  'device_type',
  'os',
  'browser',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'referrer',
  'landing_page',
  'properties',
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

const applyLovableFilter = (query: any, column: string, value: string) => {
  if (!value) return query;
  if (value === LOVABLE_FILTER_VALUE) return query.ilike(column, '%lovable%');
  return applyFilter(query, column, value);
};

const applyFilters = (query: any, filters: Filters) => {
  query = applyFilter(query, 'plan', filters.plan);
  query = applyFilter(query, 'subscription_status', filters.subscriptionStatus);
  query = applyFilter(query, 'billing_period', filters.billingPeriod);
  query = applyFilter(query, 'action', filters.action);
  query = applyFilter(query, 'route', filters.route);
  query = applyFilter(query, 'section', filters.section);
  query = applyFilter(query, 'feature', filters.feature);
  query = applyFilter(query, 'event_name', filters.eventName);
  query = applyFilter(query, 'device_type', filters.deviceType);
  query = applyFilter(query, 'os', filters.os);
  query = applyFilter(query, 'browser', filters.browser);
  query = applyLovableFilter(query, 'referrer', filters.referrer);
  query = applyLovableFilter(query, 'landing_page', filters.landingPage);
  query = applyFilter(query, 'utm_source', filters.utmSource);
  query = applyFilter(query, 'utm_medium', filters.utmMedium);
  query = applyFilter(query, 'utm_campaign', filters.utmCampaign);
  query = applyFilter(query, 'utm_term', filters.utmTerm);
  query = applyFilter(query, 'utm_content', filters.utmContent);
  return query;
};

export const useUsageEvents = (
  range: DateRange,
  filters: Filters,
  enabled = true,
  refreshKey = 0
) => {
  const [events, setEvents] = useState<UsageEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);

  useEffect(() => {
    const client = getSupabaseClient();
    if (!enabled || !hasSupabaseConfig || !client || !range.start || !range.end) return;
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
      const pageResults: UsageEvent[][] = [];
      let nextPage = 0;
      let done = false;

      const fetchPage = async (pageIndex: number) => {
        const from = pageIndex * pageSize;
        const to = Math.min(from + pageSize - 1, maxRows - 1);

        let query = client
          .from('usage_events')
          .select(SELECT_FIELDS)
          .gte('event_ts', startIso)
          .lte('event_ts', endIso)
          .order('event_ts', { ascending: true })
          .range(from, to);

        query = applyFilters(query, filters);

        const { data, error: queryError } = await query;
        return { data: ((data ?? []) as unknown) as UsageEvent[], error: queryError, pageIndex };
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
            setError(result.error.message || 'Failed to load events');
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
