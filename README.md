# Singapore Shared Map

A private-by-link Singapore map for two people to share, edit, and revisit together. The app supports:

- map-based place creation with custom pins
- bundled Singapore place search without a runtime geocoding API
- Singapore-wide search without an expiring app token
- shared notes, ratings, visited stickers, and photos
- anonymous access through a workspace link
- Supabase realtime sync when configured
- local demo mode when Supabase env vars are missing

## Stack

- React + Vite
- MapLibre GL JS
- OpenFreeMap tiles
- Supabase Free for auth, database, storage, and realtime
- Cloudflare Pages friendly static build

## Local run

```bash
npm install
npm run dev
```

If `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are not set, the app falls back to local demo mode and stores data in browser local storage.

## Environment

Create `.env.local`:

```bash
VITE_SUPABASE_URL=your-project-url
VITE_SUPABASE_ANON_KEY=your-anon-key
```

## Supabase setup

1. Create a Supabase project.
2. Run the SQL in [supabase/schema.sql](/c:/Users/davin/Desktop/self learning/zhining/supabase/schema.sql).
3. Create a public storage bucket named `place-photos`.
4. Insert a workspace row:

```sql
insert into public.workspaces (slug, share_key)
values ('singapore-shared', 'replace-with-a-secret-key');
```

5. Open the app at:

```text
/map/singapore-shared?key=replace-with-a-secret-key
```

## Notes

- The search UI uses public OpenStreetMap geocoding only when the user submits a search, then caches results locally to reduce repeat lookups.
- Image uploads are compressed client-side before being sent to Supabase.
- The current privacy model is link-based: anyone with the share link can collaborate.
