// Optional end-to-end smoke test: drives the built extension (dist/) in Playwright Chromium.
// Usage: npm run build && PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node scripts/e2e-smoke.mjs
// (or install playwright locally and omit PLAYWRIGHT_MODULE). LinkedIn requests are stubbed.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const EXT = new URL("../dist", import.meta.url).pathname;
const OUT = mkdtempSync(join(tmpdir(), "lmc-e2e-"));
console.log("artifacts:", OUT);
const userDataDir = mkdtempSync(join(OUT, "profile-"));
const log = (...a) => console.log("•", ...a);
let failures = 0;
const check = (cond, msg) => { if (cond) log("PASS", msg); else { failures++; console.log("✗ FAIL", msg); } };

async function launch() {
  const ctx = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    headless: true,
    viewport: { width: 1280, height: 900 },
    acceptDownloads: true,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  // Never hit LinkedIn from tests.
  await ctx.route(/linkedin\.com/, (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<h1>stub profile</h1>" }));
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent("serviceworker");
  const id = sw.url().split("/")[2];
  return { ctx, sw, id };
}

const errors = [];
// Screenshots for docs: hide transient toasts so they don't cover the UI.
async function shot(page, name, opts = {}) {
  const tag = await page.addStyleTag({ content: ".toasts{display:none!important}" });
  await page.screenshot({ path: join(OUT, name), ...opts });
  await tag.evaluate((el) => el.remove());
}
function watch(page, name) {
  page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && errors.push(`${name} console: ${m.text()}`));
}

let { ctx, sw, id } = await launch();
log("extension id", id);
const badge = async () => sw.evaluate(() => chrome.action.getBadgeText({}));

// --- Popup: add a contact ---
let popup = await ctx.newPage();
watch(popup, "popup");
await popup.setViewportSize({ width: 400, height: 600 });
await popup.goto(`chrome-extension://${id}/popup.html`);
await popup.getByText("Nothing needs attention").waitFor();
await shot(popup, "01-popup-empty.png");

// Invalid / lookalike URL is rejected
await popup.getByLabel("LinkedIn profile URL").fill("https://linkedin.com.evil.com/in/jane");
await popup.getByLabel("Full name").fill("Jane Doe");
await popup.getByRole("button", { name: "Save connection" }).click();
check(await popup.getByText("The link must be on linkedin.com.").isVisible(), "lookalike domain rejected");

await popup.getByLabel("LinkedIn profile URL").fill("https://uk.linkedin.com/in/Jane-Doe-123/?trk=x#y");
await popup.getByLabel("Company").fill("=Acme, Inc.");
await popup.getByLabel("Role / title").fill("VP Engineering");
await popup.getByLabel("Category").selectOption("HIRING_LEADER");
await popup.getByLabel("Why I connected").fill("you lead the platform team");
await popup.getByRole("button", { name: "Save connection" }).click();
await popup.getByText("is now tracked as").waitFor();
check(await popup.locator(".notice-success .badge-REQUEST_SENT").isVisible(), "saved with Request sent badge");
await shot(popup, "02-popup-saved.png");

// Duplicate detection
await popup.getByLabel("LinkedIn profile URL").fill("linkedin.com/in/jane-doe-123");
await popup.getByLabel("Full name").fill("Jane D");
await popup.getByRole("button", { name: "Save connection" }).click();
await popup.getByText("is already tracked").waitFor();
check(await popup.getByRole("button", { name: "Open existing record" }).isVisible(), "duplicate offers open/update");
await shot(popup, "03-popup-duplicate.png");
// Unsaved entry survives the popup closing
await popup.getByLabel("LinkedIn profile URL").fill("linkedin.com/in/draft-person");
await popup.getByLabel("Full name").fill("Draft Person");
await popup.getByLabel("Company").fill("Draft Co");
await popup.waitForTimeout(400);
await popup.close();
popup = await ctx.newPage();
await popup.setViewportSize({ width: 400, height: 600 });
await popup.goto(`chrome-extension://${id}/popup.html`);
await popup.getByText("Restored what you were typing.").waitFor();
check((await popup.getByLabel("Company").inputValue()) === "Draft Co", "unsaved form restored after popup closes");
await popup.getByRole("button", { name: "Clear form" }).click();
await popup.waitForTimeout(400);
await popup.close();

// Right-click hand-off (the menu itself can't be clicked from Playwright, so simulate its output)
await sw.evaluate(() => chrome.storage.session.set({ "lmc:pendingPrefill": {
  profileUrl: "https://www.linkedin.com/in/riley-sel", titleName: "Riley Sel",
  selectionText: "Riley Sel She/Her · 2nd Head of Data @ Northwind Northwind Stanford University San Francisco Bay Area · Contact info 500+ connections", createdAt: Date.now() } }));
popup = await ctx.newPage();
await popup.setViewportSize({ width: 400, height: 600 });
await popup.goto(`chrome-extension://${id}/popup.html`);
await popup.getByText("Filled from the text you selected").waitFor();
check((await popup.getByLabel("LinkedIn profile URL").inputValue()) === "https://www.linkedin.com/in/riley-sel"
  && (await popup.getByLabel("Full name").inputValue()) === "Riley Sel"
  && (await popup.getByLabel("Role / title").inputValue()) === "Head of Data"
  && (await popup.getByLabel("Company").inputValue()) === "Northwind"
  && (await popup.getByLabel("Category").inputValue()) === "HIRING_LEADER", "right-click run-on selection fills URL, name, role, company, category");
await shot(popup, "03b-popup-selection.png");
await popup.getByRole("button", { name: "Clear form" }).click();

// Paste box
await popup.getByText("Paste profile text to fill name, role and company").click();
await popup.getByLabel("Profile text").fill("Sam Paste (He/Him) · 1st\nRecruiter at Initech | Hiring\nAustin, Texas\nContact info");
check((await popup.getByLabel("Full name").inputValue()) === "Sam Paste"
  && (await popup.getByLabel("Role / title").inputValue()) === "Recruiter"
  && (await popup.getByLabel("Company").inputValue()) === "Initech"
  && (await popup.getByLabel("Category").inputValue()) === "RECRUITER", "paste box fills name, role, company, category");
await popup.getByRole("button", { name: "Clear form" }).click();
await popup.waitForTimeout(400);
await popup.close();

// Dashboard fallback route opens the Add form with the hand-off
await sw.evaluate(() => chrome.storage.session.set({ "lmc:pendingPrefill": {
  profileUrl: "https://www.linkedin.com/in/dash-sel", titleName: "", selectionText: "", createdAt: Date.now() } }));
const addPage = await ctx.newPage();
await addPage.goto(`chrome-extension://${id}/dashboard.html#/add`);
await addPage.getByRole("dialog", { name: "Add connection" }).waitFor();
await addPage.waitForTimeout(500);
check((await addPage.getByLabel("LinkedIn profile URL").inputValue()) === "https://www.linkedin.com/in/dash-sel", "dashboard #/add fallback receives hand-off");
await addPage.close();

// Hand-off that lands after the popup has already opened
popup = await ctx.newPage();
await popup.setViewportSize({ width: 400, height: 600 });
await popup.goto(`chrome-extension://${id}/popup.html`);
await popup.waitForTimeout(800);
await sw.evaluate(() => chrome.storage.session.set({ "lmc:pendingPrefill": {
  profileUrl: "https://www.linkedin.com/in/late-person", titleName: "Late Person",
  selectionText: "Late Person · 2nd Talent Partner at Globex", createdAt: Date.now() } }));
await popup.getByText("Filled from the text you selected").waitFor();
check((await popup.getByLabel("Company").inputValue()) === "Globex", "late right-click hand-off still fills the form");
await popup.waitForTimeout(400); // let the unsaved-entry draft save
await popup.close();
// "Use highlighted text as company" adds to the entry in progress
await sw.evaluate(() => chrome.storage.session.set({ "lmc:pendingPrefill": {
  profileUrl: "https://www.linkedin.com/in/late-person", titleName: "Late Person",
  selectionText: "Kappes 'n' Beans", createdAt: Date.now(), field: "company" } }));
popup = await ctx.newPage();
await popup.setViewportSize({ width: 400, height: 600 });
await popup.goto(`chrome-extension://${id}/popup.html`);
await popup.getByText("Company set from the text you highlighted.").waitFor();
check((await popup.getByLabel("Company").inputValue()) === "Kappes 'n' Beans"
  && (await popup.getByLabel("Role / title").inputValue()) === "Talent Partner", "company-only hand-off keeps the rest of the entry");
await popup.getByRole("button", { name: "Clear form" }).click();
await popup.waitForTimeout(400);
await popup.close();

// --- Restart browser: data persists ---
await ctx.close();
({ ctx, sw, id } = await launch());
const stored = await sw.evaluate(async () => (await chrome.storage.local.get("lmc:db"))["lmc:db"]);
check(stored?.contacts?.length === 1 && stored.contacts[0].normalizedProfileUrl === "https://www.linkedin.com/in/jane-doe-123", "contact persisted across restart with normalized URL");

// --- Dashboard: mark accepted ---
const dash = await ctx.newPage();
watch(dash, "dashboard");
await dash.goto(`chrome-extension://${id}/dashboard.html#/pending`);
await dash.getByRole("button", { name: "Mark Jane Doe accepted" }).click();
await dash.getByRole("dialog", { name: "Confirm acceptance" }).waitFor();
await dash.getByRole("button", { name: "Confirm accepted" }).click();
await dash.getByText("marked as accepted").waitFor();
await dash.goto(`chrome-extension://${id}/dashboard.html#/ready`);
await dash.locator("table.contacts .badge-ACCEPTED").first().waitFor();
const green = await dash.locator("table.contacts .badge-ACCEPTED").first().evaluate((el) => getComputedStyle(el).backgroundColor);
check(green === "rgb(220, 252, 231)", `accepted badge is green (${green})`);
check(await dash.getByRole("cell", { name: "Jane Doe VP Engineering" }).isVisible(), "Jane appears in Ready to message");
await new Promise((r) => setTimeout(r, 500));
check((await badge()) === "1", `toolbar badge counts ready contact (${await badge()})`);
await shot(dash, "04-dashboard-ready.png", { fullPage: true });

// --- Composer ---
await dash.getByRole("button", { name: "Prepare message for Jane Doe" }).click();
const composer = dash.getByRole("dialog", { name: "Message Jane Doe" });
await composer.waitFor();
check(await composer.getByRole("button", { name: "Copy message", exact: true }).isDisabled(), "copy blocked while placeholders unresolved");
await composer.getByText(/Fill in \d+ missing field/).waitFor();
await shot(dash, "05-composer-missing.png");
for (const [label, value] of [["My name (Settings)", "Sam Lee"], ["My title (Settings)", "Principal Architect"], ["My company (Settings)", "Initech"]]) {
  const input = composer.getByLabel(label);
  if (await input.count()) {
    await input.fill(value);
    await input.press("Enter");
    await dash.waitForTimeout(250);
  }
}
await composer.getByText("All placeholders are filled in.").waitFor();
await shot(dash, "05b-composer-ready.png");
const draft = await composer.getByLabel("Your message (editable)").inputValue();
check(draft.startsWith("Hi Jane, thanks for accepting") && draft.includes("Sam Lee"), "draft personalized");
const pagePromise = ctx.waitForEvent("page", { timeout: 5000 }).catch(() => null);
await composer.getByRole("button", { name: "Copy + open profile" }).click();
const profileTab = await pagePromise;
if (profileTab) {
  await profileTab.waitForLoadState();
  check(profileTab.url() === "https://www.linkedin.com/in/jane-doe-123", `profile opened (${profileTab.url()})`);
  check(await dash.getByText("Message copied").isVisible(), "copy succeeded via Clipboard API");
  const clip = await dash.evaluate(() => navigator.clipboard.readText()).catch((e) => `ERR ${e}`);
  log("clipboard readback:", clip === draft ? "matches draft" : clip.slice(0, 80));
  await profileTab.close();
} else {
  check(await composer.getByText("Chrome didn't allow automatic copying").isVisible(), "clipboard fallback shown when copy refused");
  const [tab2] = await Promise.all([ctx.waitForEvent("page"), composer.getByRole("button", { name: "Open LinkedIn profile" }).click()]);
  check(tab2.url() === "https://www.linkedin.com/in/jane-doe-123", `profile opened (${tab2.url()})`);
  await tab2.close();
}
check((await composer.getByLabel("Your message (editable)").inputValue()) === draft, "draft kept after opening profile");
const st1 = await sw.evaluate(async () => (await chrome.storage.local.get("lmc:db"))["lmc:db"].contacts[0]);
check(st1.lifecycleStatus === "ACCEPTED" && !st1.initialMessageSentAt, "copy/open did not mark as sent");

// --- Mark sent with follow-up in the past (to make it due) ---
await composer.getByRole("button", { name: "Mark message sent…" }).click();
const sent = dash.getByRole("dialog", { name: "Record message sent" });
await sent.waitFor();
const follow = sent.getByLabel(/Follow up on/);
const pastValue = await dash.evaluate(() => {
  const d = new Date(Date.now() - 60_000);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
});
await follow.fill(pastValue);
await sent.getByRole("button", { name: "I sent it" }).click();
await dash.getByText("Recorded: message sent").waitFor();
const st2 = await sw.evaluate(async () => (await chrome.storage.local.get("lmc:db"))["lmc:db"]);
const c2 = st2.contacts[0];
check(c2.lifecycleStatus === "MESSAGE_SENT" && c2.initialMessageSentAt && c2.nextFollowUpAt, "message recorded with follow-up");
check(st2.activities.some((a) => a.activityType === "MESSAGE_SENT" && a.messageText === draft), "activity stores message text");
await dash.waitForTimeout(800);
check((await badge()) === "1", `badge shows due follow-up (${await badge()})`);
await dash.goto(`chrome-extension://${id}/dashboard.html#/today`);
await dash.getByText("Follow-up was due").waitFor();
check(await dash.locator(".badge-DUE").first().isVisible(), "Today shows follow-up due");
await shot(dash, "06-today-due.png", { fullPage: true });

// Snooze clears due state
await dash.getByRole("button", { name: "Snooze Jane Doe three days" }).click();
await dash.getByText("You're all caught up").waitFor();
await dash.waitForTimeout(800);
check((await badge()) === "", `badge cleared after snooze ('${await badge()}')`);

// --- Demo data + popup attention ---
await dash.goto(`chrome-extension://${id}/dashboard.html#/settings`);
await dash.getByRole("button", { name: "Load demo data" }).click();
await dash.getByText(/Loaded \d+ demo contacts/).waitFor();
await shot(dash, "07-settings.png", { fullPage: true });

// --- CSV export ---
await dash.goto(`chrome-extension://${id}/dashboard.html#/all`);
await dash.locator("table.contacts").waitFor();
await shot(dash, "08-all-contacts.png", { fullPage: true });
const [csvDl] = await Promise.all([dash.waitForEvent("download"), dash.getByRole("button", { name: "Export view (CSV)" }).click()]);
const csvPath = join(OUT, csvDl.suggestedFilename());
await csvDl.saveAs(csvPath);
const csv = readFileSync(csvPath, "utf8");
check(/^linkedconnect-connections-\d{4}-\d{2}-\d{2}\.csv$/.test(csvDl.suggestedFilename()), `csv filename ${csvDl.suggestedFilename()}`);
check(csv.charCodeAt(0) === 0xfeff && csv.includes("\r\n"), "csv has BOM and CRLF");
check(csv.includes(`"'=Acme, Inc."`), "csv neutralizes formula + quotes comma");

// --- Drawer + timeline ---
await dash.getByRole("button", { name: "Details for Jane Doe" }).click();
const drawer = dash.getByRole("dialog", { name: "Jane Doe" });
await drawer.getByText("Message sent (recorded by you)").waitFor();
await drawer.getByRole("textbox", { name: "Notes" }).fill("Met at =SUM(A1) meetup <b>bold</b>");
await drawer.getByRole("button", { name: "Save notes" }).click();
await dash.getByText("Notes saved.").waitFor();
await shot(dash, "09-drawer.png");
await dash.keyboard.press("Escape");

// --- Backup and restore ---
await dash.goto(`chrome-extension://${id}/dashboard.html#/settings`);
const [bk] = await Promise.all([dash.waitForEvent("download"), dash.getByRole("button", { name: "Download backup (JSON)" }).click()]);
const bkPath = join(OUT, bk.suggestedFilename());
await bk.saveAs(bkPath);
const before = await sw.evaluate(async () => (await chrome.storage.local.get("lmc:db"))["lmc:db"]);
// Invalid file is rejected without changes
const badPath = join(OUT, "bad.json");
(await import("node:fs")).writeFileSync(badPath, '{"format":"nope"}');
await dash.getByLabel("Restore from backup").setInputFiles(badPath);
await dash.getByText("Backup rejected").waitFor();
// Delete Jane, then restore by merge
await dash.goto(`chrome-extension://${id}/dashboard.html#/all/contact/${before.contacts[0].id}`);
await dash.getByRole("button", { name: "Delete…" }).click();
await dash.getByRole("button", { name: "Delete permanently" }).click();
await dash.getByText("Jane Doe deleted.").waitFor();
await dash.goto(`chrome-extension://${id}/dashboard.html#/settings`);
await dash.getByLabel("Restore from backup").setInputFiles(bkPath);
const restoreDlg = dash.getByRole("dialog", { name: "Restore backup" });
await restoreDlg.waitFor();
await shot(dash, "10-restore-preview.png");
check(await restoreDlg.getByText(/1 contacts added/).isVisible(), "merge preview shows 1 contact to add");
await restoreDlg.getByRole("button", { name: "Merge backup" }).click();
await dash.getByText(/Merged: 1 added/).waitFor();
const after = await sw.evaluate(async () => (await chrome.storage.local.get("lmc:db"))["lmc:db"]);
check(after.contacts.length === before.contacts.length && after.activities.length === before.activities.length, "backup merge restored contact and history");

// --- Templates & dark mode ---
await dash.goto(`chrome-extension://${id}/dashboard.html#/templates`);
await dash.getByText("Default template by category").waitFor();
await shot(dash, "11-templates.png", { fullPage: true });
await dash.emulateMedia({ colorScheme: "dark" });
await dash.goto(`chrome-extension://${id}/dashboard.html#/today`);
await dash.waitForTimeout(300);
await shot(dash, "12-today-dark.png", { fullPage: true });
await dash.setViewportSize({ width: 390, height: 844 });
await dash.goto(`chrome-extension://${id}/dashboard.html#/all`);
await dash.waitForTimeout(300);
await shot(dash, "13-mobile-all-dark.png", { fullPage: true });
const overflow = await dash.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
check(overflow <= 0, `no horizontal page scroll at phone width (${overflow})`);

popup = await ctx.newPage();
watch(popup, "popup2");
await popup.setViewportSize({ width: 400, height: 600 });
await popup.goto(`chrome-extension://${id}/popup.html`);
await popup.getByText("Needs attention").waitFor();
await popup.waitForTimeout(300);
await shot(popup, "14-popup-attention.png");

check(errors.length === 0, `no page errors (${errors.join(" | ")})`);
await ctx.close();
console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
