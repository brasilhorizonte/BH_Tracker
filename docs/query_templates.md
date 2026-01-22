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

## Report title mapping (de/para)

```sql
create table if not exists public.report_catalog (
  report_id text primary key,
  report_title text not null,
  updated_at timestamptz not null default now()
);
```

```sql
insert into public.report_catalog (report_id, report_title)
values
  ('rep_123', 'Relatorio Macro - 2024'),
  ('rep_456', 'Fundos Imobiliarios - Janeiro')
on conflict (report_id) do update
set report_title = excluded.report_title,
    updated_at = now();
```

## Top report downloads (by title via mapping)

```sql
select
  coalesce(rc.report_title, 'Untitled') as report_title,
  count(*) as events
from public.usage_events ue
left join public.report_catalog rc
  on rc.report_id = ue.properties->>'report_id'
where ue.event_name = 'report_download'
group by 1
order by 2 desc
limit 10;
```

## Top content downloads (by title)

```sql
select
  coalesce(
    properties->>'content_name',
    properties->>'content_title',
    properties->>'title',
    'Untitled'
  ) as content_title,
  count(*) as events
from public.usage_events
where event_name = 'content_download'
group by 1
order by 2 desc
limit 10;
```
