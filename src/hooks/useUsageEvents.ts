import { useEffect, useState } from 'react';
import { getSupabaseClient, hasSupabaseConfig } from '../lib/supabase';
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
  'properties',
].join(',');

const toUtcRange = (range: DateRange) => {
  const startIso = `${range.start}T00:00:00.000Z`;
  const endIso = `${range.end}T23:59:59.999Z`;
  return { startIso, endIso };
};

const applyFilters = (query: any, filters: Filters) => {
  if (filters.plan) query = query.eq('plan', filters.plan);
  if (filters.subscriptionStatus) query = query.eq('subscription_status', filters.subscriptionStatus);
  if (filters.billingPeriod) query = query.eq('billing_period', filters.billingPeriod);
  if (filters.route) query = query.eq('route', filters.route);
  if (filters.section) query = query.eq('section', filters.section);
  if (filters.feature) query = query.eq('feature', filters.feature);
  if (filters.eventName) query = query.eq('event_name', filters.eventName);
  if (filters.deviceType) query = query.eq('device_type', filters.deviceType);
  if (filters.os) query = query.eq('os', filters.os);
  if (filters.browser) query = query.eq('browser', filters.browser);
  if (filters.utmSource) query = query.eq('utm_source', filters.utmSource);
  if (filters.utmMedium) query = query.eq('utm_medium', filters.utmMedium);
  if (filters.utmCampaign) query = query.eq('utm_campaign', filters.utmCampaign);
  return query;
};

export const useUsageEvents = (range: DateRange, filters: Filters, enabled = true) => {
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
      let from = 0;
      const all: UsageEvent[] = [];

      while (true) {
        let query = client
          .from('usage_events')
          .select(SELECT_FIELDS)
          .gte('event_ts', startIso)
          .lte('event_ts', endIso)
          .order('event_ts', { ascending: true })
          .range(from, from + pageSize - 1);

        query = applyFilters(query, filters);

        const { data, error: queryError } = await query;
        if (queryError) {
          setError(queryError.message || 'Failed to load events');
          break;
        }
        const rows = ((data ?? []) as unknown) as UsageEvent[];
        all.push(...rows);

        if (rows.length < pageSize) break;
        if (all.length >= maxRows) {
          setTruncated(true);
          break;
        }
        from += pageSize;
      }

      if (!cancelled) {
        setEvents(all);
        setLoading(false);
      }
    };

    fetchEvents();

    return () => {
      cancelled = true;
    };
  }, [range.start, range.end, filters, enabled]);

  return { events, loading, error, truncated };
};
