# Squadrats (static)

Compute squadrats (zoom-14 tiles) and squadratinhos (zoom-17 tiles) from your Strava archive or GPX/FIT/TCX files. No backend: files are parsed in the browser and never uploaded.

## Use

```
npm install
npm run dev      # local development
npm run build    # outputs dist/, deploy as a static site
npm test
```

1. Pick who you are (Hugo, Thomas or Vincent), then drop your Strava archive (`.zip`) or GPX / FIT / TCX files (`.gz` accepted). Importing again merges new activities into your existing map.
2. Your map and stats (squadrats, Übersquadrat, Yard, squadratinhos, Übersquadratinho, Yardinho) appear on your card. Click an Über/Yard row to zoom on it.

Imported tiles are saved in the browser's local storage. With Supabase configured (below), each import is also shared: everyone sees everyone's maps and stats, and open pages update live.

## Shared sync with Supabase

1. Create a free project at supabase.com.
2. In **SQL Editor**, run [supabase/schema.sql](./supabase/schema.sql) after changing `CHANGE_ME` to a group passcode of your choice.
3. In **Project Settings → API**, copy the project URL and the `anon` public key.
4. On Vercel (**Project → Settings → Environment Variables**) add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, then redeploy. For local development, copy `.env.example` to `.env.local` and fill it in.
5. Share the passcode with your friends. The app asks for it the first time someone shares a map, then remembers it in that browser.

Everyone can read all maps, but writes only go through the `save_map` function, which checks the passcode. Without these variables the app works in local-only mode.

## Deploy

It is a plain static Vite site, so any static host works (Vercel, Cloudflare Pages, GitHub Pages): build command `npm run build`, output directory `dist`.

## Notes

- Squadrats are zoom-14 Web Mercator tiles, squadratinhos are zoom-17 tiles. Only zoom-17 tiles are stored; zoom-14 is derived.
- Tracks are interpolated between points so fast segments don't skip tiles; gaps over 5 zoom-17 tiles (about 1 km) are treated as GPS dropouts and ignored. Tick "Replace my existing map" when re-importing to discard previously imported tiles.
- Übersquadrat / Übersquadratinho = largest fully-visited square; Yard / Yardinho = largest 4-connected group of visited tiles whose north, east, south, and west neighbours are also visited.
- The base map uses the public OpenStreetMap tile server (fine for a few users). Visited-country boundaries are loaded from the public geo-countries GeoJSON dataset. Change the sources in [src/map.ts](./src/map.ts) for heavier use.
