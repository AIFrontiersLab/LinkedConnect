# LinkedConnect: developer notes

## Commands

| Command | What it does |
|---|---|
| `npm install` | Install dependencies (Node 20+) |
| `npm run build` | Type-check and build the extension into `dist/` |
| `npm test` | Unit tests (Vitest) |
| `npm run typecheck` | TypeScript only |
| `npm run check` | Type-check, tests and build |
| `npm run icons` | Regenerate `public/icons/*.png` |
| `npm run e2e` | Optional browser smoke test (needs Playwright; see below) |

Stack: Manifest V3, TypeScript, React 18, Vite 6, `chrome.storage.local`, a module service worker, `chrome.alarms`, and optional `chrome.notifications`. Everything is bundled locally.

## Architecture

```
src/
  shared/           framework-free domain logic (unit-tested)
    types.ts        data model; date-only (requestSentAt) vs ISO UTC timestamps (*At)
    profileUrl.ts   exact-hostname validation + normalization; duplicate key
    lifecycle.ts    pure status transitions; status is always derived from timestamps
    actions.ts      add/edit/delete/templates/settings operations on a DB copy
    storage.ts      repository: Web Locks + re-read + single atomic write per mutation
    schema.ts       zod validation, defaults, versioned migrations, quarantine of bad records
    reminders.ts    notification planning with persisted dedupe keys; next-alarm time
    selectors.ts    summaries, tab filters, search, sort, "Today" ordering
    templates.ts    starter templates, placeholder rendering, unresolved detection
    csv.ts / backup.ts / demo.ts / time.ts / navigation.ts
  background/serviceWorker.ts   badge, alarms, notifications (stateless; reconciles on every wake)
  ui/               shared React pieces: providers/hooks, dialogs, composer, add form, styles
  popup/            toolbar popup
  dashboard/        full-page dashboard: Today, contact lists, drawer, templates, settings
```

- **One write path.** Every change goes through `Repository.mutate(fn)`. It takes a Web Lock that is shared by the popup, the dashboard and the service worker, re-reads the latest stored document, applies `fn` to a copy, bumps `revision`, and writes the whole document in one `chrome.storage.local.set`. If `fn` throws or the write fails (for example, quota exceeded), the stored data is unchanged and the UI shows the error. All pages subscribe to `chrome.storage.onChanged`, so open windows stay in sync.
- **Schema versioning.** The stored document has `schemaVersion`, and `migrateDatabase` applies step migrations. Invalid records are moved to a `quarantine` list rather than deleted (Settings lets you download them). Unreadable data is copied to a backup key before starting fresh. Data from a newer version is opened read-only.
- **Backup merge rules.** Contacts are matched by normalized profile URL, and the later `updatedAt` wins (ties keep the current record). The current record's id is kept and the imported activities are re-pointed to it. If an imported id collides with a different person, it gets a new id. Activities are de-duplicated by id and by (contact, type, timestamp). Templates are matched by id, and the later `updatedAt` wins. Merge keeps the current settings; Replace uses the backup's settings. Template references in settings that point to missing templates are cleared. Any invalid record rejects the whole file before anything is written.
- **Safety.** Permissions are `storage`, `alarms`, `activeTab` (current tab URL and title, only when you click the icon) and `contextMenus` (right-click items on linkedin.com pages; Chrome passes them only the page or link URL and the text you highlighted), plus optional `notifications`. There are no host permissions, content scripts, `tabs`, cookies, scripting or history permissions. Everything is bundled and nothing loads from remote sources. The CSP is `script-src 'self'`. User text is rendered only as React text nodes (no `dangerouslySetInnerHTML`).

## Tests

`npm test` runs 62 unit tests covering URL validation and normalization (including lookalike domains), duplicate detection, template substitution and unresolved placeholders, status transitions and timestamp consistency, follow-up calculation, unique actionable counts, notification de-duplication and summaries, CSV escaping and formula injection, backup validation and merge/replace, concurrent mutations, write failures and migrations.

`npm run e2e` is optional and needs Playwright with its Chromium. It loads `dist/` into a real Chromium profile and goes through the whole flow: add, reject a lookalike URL, detect a duplicate, restart the browser and check the data persists, mark accepted (green), check Ready to message, compose with missing fields, copy and open the profile (LinkedIn requests are stubbed), mark sent, check the follow-up is due and the badge updates, snooze, load demo data, export CSV, edit notes, back up and restore, view templates, and check dark mode and phone-width layout. Set `PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs` if Playwright isn't installed in this project.

## Manual acceptance checklist (real Chrome)

- [ ] `npm run build`, then Load unpacked `dist/` with no errors on chrome://extensions; the service worker shows as active.
- [ ] Pin the extension; the popup opens with an empty state and no fake contacts.
- [ ] Add a contact from the popup with a URL like `https://uk.linkedin.com/in/someone/?trk=x`; it is saved as `https://www.linkedin.com/in/someone` with a yellow **Request sent** badge.
- [ ] On a LinkedIn profile tab, clicking the icon prefills the URL and name. Typing a company, switching tabs and reopening the popup restores what you typed.
- [ ] On a profile, highlight the name and headline, right-click, choose **Add to LinkedConnect**: the popup opens with URL, name, role and company filled in.
- [ ] Adding the same URL again (in a different case or form) offers **Open existing record** / **Update it**.
- [ ] `https://linkedin.com.evil.com/in/x` and `https://www.linkedin.com/company/x` are rejected.
- [ ] Quit Chrome completely and reopen it; the contact is still there.
- [ ] Dashboard → Pending requests → **Mark accepted** → confirm. The badge turns green, the contact appears in **Ready to message** and in **New since your last review**, and the toolbar badge shows 1.
- [ ] **Prepare message**: copying is disabled while `{{myName}}` etc. are missing; fill them in, then copying is enabled.
- [ ] **Copy + open profile** opens the profile tab; pasting elsewhere gives the message; the status is still **Accepted**.
- [ ] **Mark message sent…** with a reminder a couple of minutes ahead: the status turns blue and the badge drops to 0.
- [ ] Turn on desktop reminders in Settings (the permission prompt appears). When the reminder time passes, one notification appears, the badge shows 1 and the Today view lists the contact. Clicking the notification opens the contact.
- [ ] Snooze 1 day: the follow-up badge clears. **Mark replied**: purple, reminder cleared.
- [ ] Open the popup and the dashboard side by side and make edits in each; neither overwrites the other.
- [ ] Export CSV and open it in Excel: accents and line breaks are intact, and a company of `=1+1` shows as text.
- [ ] Download a backup, delete a contact, restore with **Merge**: the contact and its history return. Importing a non-backup JSON is rejected with no changes.
- [ ] Switch the theme between Auto, Dark and Light, and tab through the dashboard with the keyboard; focus rings stay visible and arrow keys move between tabs.
