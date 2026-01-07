# BH Tracker Analytics

Usage analytics dashboard for Supabase `usage_events` data.

## Quick start

1. Install dependencies

```
npm install
```

2. Configure env

```
cp .env.example .env.local
```

Edit `.env.local` with your Supabase project values:

```
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

3. Run the app

```
npm run dev
```

## Database setup

- `sql/usage_events.sql` creates the `usage_events` table, indexes, and admin-only RLS policy.
- The policy expects `public.is_admin(auth.uid())` to exist. If you do not have it, add a function backed by a `profiles` table (example included in the SQL file).

## Docs

- `docs/event_catalog.md` : full event list + properties
- `docs/metrics_catalog.md` : metrics catalog and segmentation map
- `docs/query_templates.md` : starter SQL templates

## Notes

- The dashboard uses `event_ts` as the official timestamp.
- The app reads with anon key + RLS. Log in as admin to query.
