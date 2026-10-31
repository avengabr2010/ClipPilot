// End-to-end test against a running stack (local Supabase + `next start` + a worker).
//   BASE_URL=http://localhost:3000 MAILPIT_URL=http://127.0.0.1:54324 VIDEO=/path/video.mp4 node tests/e2e/full-flow.mjs
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { loadPlaywright } from "../../scripts/pw.mjs";

const { chromium } = loadPlaywright();
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";
const VIDEO = process.env.VIDEO;
const OWNER = process.env.OWNER_EMAIL ?? "owner@clippilot.local";
const PASSWORD = "Sup3rSecret-pass";
const SHOTS = new URL("./screenshots/", import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });
assert.ok(VIDEO, "set VIDEO=/path/to/video.mp4");

const step = (m) => console.log(`\n▶ ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function confirmLink(email) {
  for (let i = 0; i < 30; i++) {
    const list = await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)).json();
    const msg = list.messages?.[0];
    if (msg) {
      const full = await (await fetch(`${MAILPIT}/api/v1/message/${msg.ID}`)).json();
      const m = /(https?:\/\/[^\s"<>]+\/auth\/v1\/verify[^\s"<>]+)/.exec(full.Text || full.HTML);
      if (m) return m[1].replace(/&amp;/g, "&");
    }
    await sleep(1000);
  }
  throw new Error(`no confirmation e-mail for ${email}`);
}

async function signupAndVerify(page, email) {
  await page.goto(`${BASE}/signup`);
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.check('input[name="terms"]');
  await page.click('button[type="submit"]');
  await page.waitForURL(/check-email/);
  const link = await confirmLink(email);
  await page.goto(link);
  await page.waitForURL(/\/dashboard/, { timeout: 20000 });
}

const browser = await chromium.launch();
try {
  // ---------------------------------------------------------------- OWNER
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.error("  [pageerror]", e.message));

  step("Owner signs up and verifies e-mail");
  await signupAndVerify(page, OWNER);
  await page.screenshot({ path: `${SHOTS}owner-dashboard.png` });
  assert.ok(await page.getByText("Propriétaire · Premium illimité").isVisible(), "owner badge visible");
  assert.ok(await page.getByRole("link", { name: /Administration/ }).first().isVisible(), "admin link visible");

  step("Owner imports a real video");
  await page.goto(`${BASE}/create`);
  await page.waitForLoadState("networkidle");
  await page.setInputFiles('input[type="file"]', VIDEO);
  await page.getByRole("button", { name: /Générer \d+ clip/ }).waitFor();
  await page.getByRole("button", { name: "1080p" }).click();
  await page.getByRole("button", { name: "3", exact: true }).click();
  await page.getByRole("button", { name: /Karaoké/ }).click();
  await page.screenshot({ path: `${SHOTS}create-settings.png` });
  await page.getByRole("button", { name: /Générer 3 clips/ }).click();
  await page.waitForURL(/\/projects\/[0-9a-f-]{36}/, { timeout: 120000 });
  const projectUrl = page.url();
  console.log("  project:", projectUrl);

  step("Waiting for the worker to analyse and render");
  let ready = 0;
  for (let i = 0; i < 90; i++) {
    await sleep(4000);
    await page.reload();
    const failed = await page.getByText("Échec").count();
    if (failed) throw new Error("processing failed: " + (await page.locator("text=/Échec|échoué/").first().textContent()));
    const done = (await page.getByRole("progressbar").count()) === 0 && (await page.getByText("Prêt", { exact: true }).count()) > 0;
    ready = new Set(await page.locator('a[href^="/clips/"]:has(img)').evaluateAll((els) => els.map((e) => e.getAttribute("href")))).size;
    if (done && ready > 0) break;
  }
  // A ~60 s transcript only fits two non-overlapping 30-45 s clips: we ask for 3, the engine must not invent a third.
  assert.ok(ready >= 2 && ready <= 3, `clips with thumbnails: ${ready}`);
  await page.screenshot({ path: `${SHOTS}project-ready.png`, fullPage: true });

  step("Owner edits a clip and re-exports in 1:1");
  await page.locator('a[href^="/clips/"]').first().click();
  await page.waitForURL(/\/clips\//);
  await page.getByRole("tab", { name: /Format/ }).click();
  await page.getByRole("button", { name: "1:1", exact: true }).click();
  await page.getByRole("tab", { name: /Analyse/ }).click();
  assert.ok(await page.getByText("Détail du score").isVisible(), "virality breakdown visible for owner");
  await page.screenshot({ path: `${SHOTS}editor.png` });
  await page.getByRole("button", { name: /Réexporter/ }).click();
  await page.getByText(/Export lancé/).waitFor({ timeout: 15000 });
  const clipUrl = page.url();
  const clipId = clipUrl.split("/").pop();
  let exportInfo = "";
  for (let i = 0; i < 60; i++) {
    await sleep(3000);
    await page.goto(clipUrl);
    exportInfo = (await page.locator("text=/Export actuel/").textContent().catch(() => "")) ?? "";
    if (exportInfo.includes("1080×1080")) break;
  }
  assert.match(exportInfo, /1080×1080/, "re-export is square 1080p");

  step("Download the MP4");
  const res = await page.request.get(`${BASE}/api/clips/${clipId}/download`, { maxRedirects: 0 });
  assert.equal(res.status(), 302);
  const file = await fetch(res.headers()["location"]);
  assert.equal(file.status, 200);
  const bytes = (await file.arrayBuffer()).byteLength;
  assert.ok(bytes > 50_000, `mp4 size ${bytes}`);
  console.log(`  downloaded ${bytes} bytes`);

  step("Admin panel");
  await page.goto(`${BASE}/admin`);
  await page.getByText("Clips générés").waitFor();
  await page.screenshot({ path: `${SHOTS}admin.png`, fullPage: true });

  // ---------------------------------------------------------------- USER
  step("A regular user cannot see owner data nor escalate");
  const uctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const upage = await uctx.newPage();
  const userEmail = `user-${Date.now()}@clippilot.local`;
  await signupAndVerify(upage, userEmail);
  await upage.screenshot({ path: `${SHOTS}user-dashboard-mobile.png`, fullPage: true });
  assert.ok(await upage.getByText("Offre Free").count() >= 0);
  await upage.goto(`${BASE}/admin`);
  await upage.waitForURL(/\/dashboard/);
  const r1 = await upage.request.get(`${BASE}/api/clips/${clipId}/download`, { maxRedirects: 0 });
  assert.equal(r1.status(), 404, "other user's clip is invisible");
  const me = await upage.evaluate(async () => (await fetch("/api/health")).ok);
  assert.ok(me);
  const r2 = await upage.request.put(`${BASE}/api/admin/flags/billing`, { data: { enabled: true }, headers: { origin: BASE } });
  assert.equal(r2.status(), 403, "user cannot call admin API");
  const r3 = await upage.request.get(`${BASE}/clips/${clipId}`);
  assert.equal(r3.status(), 404, "editor of someone else's clip is 404");

  step("Free quota is enforced server-side");
  const r4 = await upage.request.post(`${BASE}/api/videos`, {
    headers: { origin: BASE },
    data: { filename: "long.mp4", size: 1000000, type: "video/mp4", durationSeconds: 3600,
      settings: { duration: "30-45", clipCount: 3, aspect: "9:16", resolution: 720, language: "fr", style: "dynamic", subtitlePreset: "classic", subtitlesEnabled: true, smartCrop: false } },
  });
  assert.equal(r4.status(), 400, "60 min video refused on Free (max 30 min)");
  const r5 = await upage.request.post(`${BASE}/api/videos`, {
    headers: { origin: BASE },
    data: { filename: "a.mp4", size: 1000000, type: "video/mp4", durationSeconds: 60,
      settings: { duration: "30-45", clipCount: 3, aspect: "9:16", resolution: 1080, language: "fr", style: "dynamic", subtitlePreset: "classic", subtitlesEnabled: true, smartCrop: false } },
  });
  assert.equal(r5.status(), 403, "1080p refused on Free");
  const r6 = await upage.request.post(`${BASE}/api/videos`, {
    headers: { origin: BASE },
    data: { filename: "a.mp4", size: 1000000, type: "video/mp4", durationSeconds: 60,
      settings: { duration: "30-45", clipCount: 3, aspect: "9:16", resolution: 720, language: "fr", style: "dynamic", subtitlePreset: "karaoke", subtitlesEnabled: true, smartCrop: false } },
  });
  assert.equal(r6.status(), 403, "Creator template refused on Free");

  console.log("\n✅ End-to-end flow passed");
} finally {
  await browser.close();
}
