# Ten Years Production Laos

Website for tenyearsproductionlaos.com — a small Node/Express app that serves
static files from `public/`.

## Run locally

```bash
npm install
npm start
# open http://localhost:3000
```

## Edit the site

All content lives in `public/`:

- `public/index.html` — page content
- `public/styles.css` — styling

## Deploy

Hosted on Railway. Railway runs `npm start` and injects `PORT` automatically.
Pushing to the connected GitHub repo triggers a new deploy.
