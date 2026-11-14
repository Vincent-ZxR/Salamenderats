# Squadrats (static)

Compute squadrats (zoom-14 tiles) and squadratinhos (zoom-17 tiles) from your Strava archive or GPX/FIT/TCX files. Files are parsed in the browser and are not uploaded. If Supabase is configured, visited tiles and their first-visit dates are synced to your account.

## Use

```
npm install
npm run dev      # local development
npm run build    # outputs dist/, deploy as a static site
npm test
```

1. With shared sync configured, create an account, confirm your email if required, sign in, and choose a unique username. Without Supabase, pick a local player instead.
2. Drop your Strava archive (`.zip`) or GPX / FIT / TCX files (`.gz` accepted). Importing again merges new activities into your map.
3. Send a friend request using their username. They must accept it before either of you can see the other's map. Either person can remove the friendship.
4. Your map and stats (squadrats, Übersquadrat, Yard, squadratinhos, Übersquadratinho, Yardinho) appear on your card. Click an Über/Yard row to zoom on it.
5. Use **Square planner** to pick a player, tile type, and target size (1–100). Suggest a square to find the position with the most visited tiles anywhere in that player's map. Missing tiles are orange; place the square on the map or use the buttons or keyboard arrows (while the planner or map is focused) to move it one tile at a time. The count updates when that player's map changes. This does not calculate a route or account for accessibility.

Your own imported tiles are saved in browser local storage. With Supabase configured (below), they are also shared only with accepted friends. Updates are checked on focus and every 30 seconds.

## Shared sync with Supabase

1. Create a Supabase project, or back up your existing project before migrating.
2. In **SQL Editor**, run [supabase/accounts.sql](./supabase/accounts.sql). This revokes API access to the old public maps and shared-passcode function, but keeps the old table for the project administrator. Existing deployed versions will no longer be able to sync. Do not run the obsolete `schema.sql` or `allow-seb.sql`.
3. Enable email/password sign-in in **Authentication → Providers**. Configure the site URL and allowed redirect URLs for your deployed site in **Authentication → URL Configuration**. Configure email confirmation and a suitable email provider and rate limits for your deployment.
4. In **Project Settings → API**, copy the project URL and the `anon` public key. Never put the service-role key in the application.
5. On Vercel (**Project → Settings → Environment Variables**) add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, then redeploy. For local development, copy `.env.example` to `.env.local` and fill it in.
6. Each existing user creates their own account and reimports their files. Old maps and local caches are not automatically assigned to accounts. Send and accept friend requests to share again.

The database checks the signed-in user and accepted friendship for every shared-map read. Direct API access to the map and friendship tables is disabled. Usernames are discoverable by people who know them; do not use sensitive information in a username. A username cannot currently be changed, and password recovery and self-service account deletion are not yet available in the app.

**Privacy:** the old shared maps were publicly readable until the migration is applied; it cannot undo previous access or erase copies already downloaded. Removing a friend stops future database reads immediately but cannot erase data they have already seen or saved. An open page refreshes its displayed friends on focus or within 30 seconds while online. Local storage remains on the device after sign-out, including any legacy caches; use a trusted device and clear site data when appropriate. The base-map provider receives requests for the viewed map area.

After signing in, the first remote read must succeed before importing, to avoid replacing an existing map with an incomplete one. If sharing fails after an import, the imported map remains on the importing browser and is retried on subsequent syncs. It is not available to friends until sharing succeeds. Imports lost from browser storage before this protection was installed need to be imported again.
Avoid importing at the same time on multiple devices: concurrent saves can overwrite one another.

## Deploy

It is a plain static Vite site, so any static host works (Vercel, Cloudflare Pages, GitHub Pages): build command `npm run build`, output directory `dist`.

## Notes

- Squadrats are zoom-14 Web Mercator tiles, squadratinhos are zoom-17 tiles. Only zoom-17 tiles are stored; zoom-14 is derived.
- Tracks are interpolated between points so fast segments don't skip tiles; gaps over 5 zoom-17 tiles (about 1 km) are treated as GPS dropouts and ignored. Tick "Replace my existing map" when re-importing to discard previously imported tiles.
- Übersquadrat / Übersquadratinho = largest fully-visited square; Yard / Yardinho = largest 4-connected group of visited tiles whose north, east, south, and west neighbours are also visited.
- The base map uses the public OpenStreetMap tile server (fine for a few users). Change the source in [src/map.ts](./src/map.ts) for heavier use.
