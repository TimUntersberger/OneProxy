# OneProxy - Project Plan

## Project Summary

OneProxy is a personal web app for managing One Piece card proxy files.

## Decisions Made

* **Project name:** OneProxy
* **Storage approach:** Store proxy files and app data directly in the user's own Google Drive.
* **Primary format for planning:** Keep project decisions and planning in this `PLAN.md` file and update it whenever a new decision is made.
* **Frontend stack:** Angular 21 + Angular Material + TypeScript

## Current Product Direction

Build OneProxy as a personal proxy file manager for One Piece cards with:

* Grid-based library UI where each item primarily shows the card image
* Search field at the top
* Filter dropdowns for narrowing results
* Google login
* Google Drive-based storage
* Upload, organize, search, and edit proxy metadata
* Static web app deployment if feasible
* Each proxy entry represents a small group of related files, not just a single image

## Tentative Architecture

* **Frontend:** Angular 21 single-page application
* **UI framework:** Angular Material for app structure and controls
* **Hosting candidate:** GitHub Pages
* **Storage:** Dedicated folder in the user's Google Drive
* **Metadata storage:** App metadata stored inside Google Drive as app-managed files

## Current Technical Direction

Build OneProxy as a browser-based Angular app using Angular Material for layout, forms, dialogs, menus, and other standard UI primitives.

Use Angular Material as the component foundation, but keep the proxy grid and card presentation custom so the app feels like a focused media library rather than a generic admin dashboard.

Treat the initial implementation as a feasibility spike first:

* Prove Google login in the browser
* Prove Google Drive access with the intended permissions
* Create or locate the `/OneProxy/` folder in Drive
* Read and write a minimal `index.json`
* Confirm this works cleanly with a static deployment model before committing to GitHub Pages as the final host

## Proposed Google Drive Structure

```text
/OneProxy/
  index.json
  /items/
    /<item-id>/
      main.png|jpg
      source.afphoto
      foil-1.png|jpg
      foil-2.png|jpg
      foil-3.png|jpg
      preview.jpg
```

Notes:

* Each proxy item is stored in its own folder.
* The main PNG/JPG is the primary rendered proxy image.
* The Affinity Photo file is stored alongside it as the editable source.
* Additional PNG/JPG files are stored as foil/layer assets.
* A small `preview.jpg` is generated from the main image for fast grid display.

## Initial Metadata Direction

Use a central `index.json` file in Google Drive to track uploaded proxy files and their metadata.

Keep the metadata intentionally minimal.

Minimal proposed metadata fields:

* id
* name
* tags

Notes:

* `id` is the stable item identifier and also maps to the item's Drive folder name.
* `name` is the human-readable card/proxy name.
* `tags` is a small array used for search/filtering, such as set, color, type, or deck labels when needed.
* The app should not store individual file IDs in `index.json` unless later proven necessary.
* File discovery should come from the item folder contents using expected filenames and conventions.
* The grid should use a generated small `preview.jpg` derived from the main image for performance, instead of loading the full-size print image into the grid.
* Other display data should be fetched from Google Drive on demand only if needed.

Initial `index.json` shape for the spike:

```json
{
  "version": 1,
  "items": []
}
```

Each item entry should follow:

```json
{
  "id": "string",
  "name": "string",
  "tags": ["string"]
}
```

## Open Questions

* Exact Google auth flow and Drive permissions
* Whether GitHub Pages should be the final hosting choice after the auth and Drive spike
* How `index.json` should be updated when files are added, renamed, or changed
* Final MVP feature list order after the feasibility spike

## First Implementation Steps

1. Scaffold the Angular 21 app and add Angular Material.
2. Build a minimal app shell with a top bar and an empty library view.
3. Implement Google sign-in and verify the browser can access the user's OneProxy folder in Google Drive.
4. Define and document the exact `index.json` structure and item file conventions in this plan.
5. Load items from Drive and render a basic preview grid with search by `name` and `tags`.
