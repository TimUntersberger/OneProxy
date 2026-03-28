# OneProxy

OneProxy is an Angular 21 + Angular Material app for managing proxy card assets in a user's Google Drive.

## Local Development

Install dependencies and start the dev server:

```bash
npm install
npm start
```

The app runs at `http://localhost:4200/`.

## Builds

Standard production build:

```bash
npm run build
```

GitHub Pages build:

```bash
npm run build:pages
```

## GitHub Pages

The repository includes [`.github/workflows/pages.yml`](/c:/Users/timun/Desktop/workspace/github/OneProxy/.github/workflows/pages.yml), which:

- installs dependencies with `npm ci`
- builds the Angular app with the repository base path
- uploads `dist/oneproxy/browser`
- deploys it to GitHub Pages

Before the first deployment:

1. Push the repo to GitHub.
2. Make sure the branch you want to deploy is set as the repository default branch in GitHub.
3. In GitHub, open `Settings` -> `Pages`.
4. Set `Source` to `GitHub Actions`.

The workflow is configured for a project site path like `/OneProxy/`. If the repository name changes, the workflow uses the current repository name automatically.
