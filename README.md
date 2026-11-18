# conferences.arcaneward.com

A static dashboard (plain HTML/CSS/JS, nothing to build) that tracks my talk submissions, the conferences I follow, and which CFPs to apply to next.

- **Submissions** come from `data/submissions.json`, which is generated from my spreadsheet.
- **The conference list** comes from [also-here/Conferences](https://github.com/also-here/Conferences) (The Chicago Speakers Guild). The page fetches that README live on every load, so updates show up without a redeploy. If GitHub can't be reached, it falls back to the snapshot in `data/also-here-README.md`.
- **Following** covers every conference I've submitted to, every conference added through the form, anything listed in `data/following.json` (e.g. `["DEF CON", "SO-CON"]`), and anything I star on the page (stars are saved per browser).

## Adding entries from the site

Click **+ Add** in the header, **+ Track a conference** in the Following section, or **Update** on any submission row.

1. Fill in the form and click **Save to GitHub**.
2. GitHub opens in a new tab with a new file in `data/entries/`, already filled in. Click **Commit changes**.
3. The entry shows on the dashboard right away, marked *not committed*, and the marker clears after the commit. The page reads `data/entries/` through the GitHub API, so no Pages rebuild is needed (GitHub's cache can add about a minute).

What each kind of entry does:

- **Talk submission** files (`*-talk-*.json`) add a row to the log, the stats, and Pending.
- **Update** files have the same format plus a `replaces` key. The new file takes the place of the row it updates, whether that row came from the spreadsheet or from an earlier entry.
- **Conference** files (`*-conf-*.json`) follow that conference. Any dates, CFP window, or travel details you enter replace the guild list's values on this dashboard. A conference that isn't in the guild list gets added, and it shows up in **Apply next** when its CFP is open.

To fix or delete an entry, use the **edit** badge next to it, which opens the file on GitHub. Anyone else who uses the form just gets GitHub's "fork this repo" prompt, because only you can commit here.

The spreadsheet import below still works and can be mixed with form entries.

## Updating submissions from the spreadsheet

```bash
python3 -m venv .venv && .venv/bin/pip install openpyxl
.venv/bin/python scripts/build_submissions.py ~/Downloads/Submissions.xlsx
git commit -am "Update submissions" && git push
```

The script groups variants of the same talk title (see `TALK_ALIASES`) and parses free-text dates like "June 27-28 2025" or "Mid APR 2025".

Conference names are matched between the spreadsheet and the guild list by a normalized key. Add pairs to `ALIAS` in `app.js` when a name doesn't line up (for example `secretcon4 → secretcon`).

## How "Apply next" ranks things

Each candidate must have a CFP that is open now or opens within 90 days, and I must not already have a submission in for that edition. Points come from:

| Signal | Effect |
|---|---|
| CFP open now / closes within 3 weeks | +40 / +15 more |
| Covers travel (`Yes`) / partial (`Yes*`, `Yes?`) | +15 / +10 |
| In the guild's Midwest list | +12 |
| Accepted there before | +18 |
| Past denials there, no acceptances | −3 each (max −12) |
| Starred as active by the guild | +6 |
| Dates projected from last year | −5 |

When a listed edition has already happened, the page assumes next year's falls on the same dates (marked **est.**). When no CFP open date is listed, it assumes the window opens about 90 days before it closes.

Pitch suggestions are talks I've sent 3+ times in the last year and haven't already sent to that conference, ranked by smoothed acceptance rate.

`?today=YYYY-MM-DD` in the URL overrides the date, which helps when checking the rankings.

## Local preview

```bash
python3 -m http.server 8765
```

## Hosting

This is a GitHub Pages site with its own repo. `CNAME` holds `conferences.arcaneward.com`. DNS needs a `CNAME` record from `conferences` to `basicallyabidoof.github.io`.
