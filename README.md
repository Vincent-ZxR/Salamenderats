# Squadrats (static)

Compute squadrats (zoom-14 tiles) and squadratinhos (zoom-17 tiles) from your Strava archive or GPX/FIT/TCX files. No backend: files are parsed in the browser and never uploaded.

## Use

```
npm install
npm run dev      # local development
npm run build    # outputs dist/, deploy as a static site
npm test
```

1. Pick who you are (Grégoire, Hugo, Thomas or Vincent), then drop your Strava archive (`.zip`) or GPX / FIT / TCX files (`.gz` accepted). Importing again merges new activities into your existing map.
2. Your map and stats (squadrats, Übersquadrat, Yard, squadratinhos, Übersquadratinho, Yardinho) appear on your card. Click an Über/Yard row to zoom on it.

Imported tiles are saved in the browser's local storage, so each person only sees their own data on their own device. Sharing maps between devices would need a small backend.

## Deploy

It is a plain static Vite site, so any static host works (Vercel, Cloudflare Pages, GitHub Pages): build command `npm run build`, output directory `dist`.

## Notes

- Squadrats are zoom-14 Web Mercator tiles, squadratinhos are zoom-17 tiles. Only zoom-17 tiles are stored; zoom-14 is derived.
- Tracks are interpolated between points so fast segments don't skip tiles; gaps over 40 zoom-17 tiles are ignored.
- Übersquadrat / Übersquadratinho = largest fully-visited square; Yard / Yardinho = largest connected group (4-neighbour).
- The base map uses the public OpenStreetMap tile server (fine for a few users). Change the source in [src/map.ts](./src/map.ts) for heavier use.
