# Query templates

## DAU

```sql
select
  date_trunc('day', event_ts) as day,
  count(distinct user_id) as dau
from public.usage_events
group by 1
order by 1;
```

## Sessions per user

```sql
select
  count(distinct session_id)::numeric / nullif(count(distinct user_id), 0) as sessions_per_user
from public.usage_events;
```

## Success rate for a specific event

```sql
select
  count(*) filter (where success) * 1.0 / nullif(count(*), 0) as success_rate
from public.usage_events
where event_name = 'analysis_run';
```

## Active users by plan

```sql
select
  plan,
  count(distinct user_id) as active_users
from public.usage_events
group by 1
order by 2 desc;
```

## Top routes

```sql
select
  route,
  count(*) as events
from public.usage_events
where route is not null
group by 1
order by 2 desc
limit 10;
```

## Error codes (from properties)

```sql
select
  properties->>'error_code' as error_code,
  count(*) as errors
from public.usage_events
where properties ? 'error_code'
  and properties->>'error_code' is not null
group by 1
order by 2 desc
limit 10;
```
