# Forex Desk

Personal site for NFP, CPI, PPI, PCE and FOMC, plus the smaller prints that lead them.

## Run locally
```
npm install
npm start
```
Open http://localhost:3000

## Render
1. Push this folder to GitHub.
2. New Web Service → connect the repo.
3. Build: `npm install`  Start: `npm start`
4. Render sets `PORT` automatically.

The high-impact calendar is cached for 7 days in `data/calendar.json`. The site serves that file until it is older than a week, then pulls the next 180 days again. The Refresh button forces a new pull. On Render, the Monday 06:00 UTC cron hits `/api/desk?refresh=1` if you set `APP_URL` to your service URL.
