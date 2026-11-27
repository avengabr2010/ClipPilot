// Responsive check: loads pages at 5 viewport sizes, fails on horizontal overflow,
// saves screenshots. Optional login for app pages: E2E_EMAIL / E2E_PASSWORD.
//   BASE_URL=http://localhost:3000 node tests/e2e/responsive.mjs
import { mkdirSync } from "node:fs";
import { loadPlaywright } from "../../scripts/pw.mjs";

const { chromium } = loadPlaywright();
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const SHOTS = new URL("./screenshots/responsive/", import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

const VIEWPORTS = [
  ["iphone-se", 320, 568, true],
  ["iphone-14", 390, 844, true],
  ["android", 412, 915, true],
  ["ipad", 820, 1180, true],
  ["desktop", 1440, 900, false],
];
const PUBLIC = ["/", "/features", "/pricing", "/faq", "/login", "/signup", "/forgot-password", "/legal/terms", "/legal/privacy"];
const APP = ["/dashboard", "/create", "/projects", "/clips", "/billing", "/settings", "/admin"];

const browser = await chromium.launch();
const failures = [];
for (const [name, width, height, mobile] of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile });
  const page = await ctx.newPage();
  let pages = PUBLIC;
  if (process.env.E2E_EMAIL && process.env.E2E_PASSWORD) {
    await page.goto(`${BASE}/login`);
    await page.fill("#email", process.env.E2E_EMAIL);
    await page.fill("#password", process.env.E2E_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL(/dashboard/);
    pages = [...PUBLIC.filter((p) => !["/login", "/signup"].includes(p)), ...APP];
  }
  for (const path of pages) {
    await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    const file = `${name}${path.replace(/\//g, "_") || "_home"}.png`;
    await page.screenshot({ path: SHOTS + file, fullPage: true });
    const ok = overflow <= 1;
    if (!ok) failures.push(`${name} ${path}: ${overflow}px horizontal overflow`);
    console.log(`${ok ? "ok  " : "FAIL"} ${name.padEnd(10)} ${path}${ok ? "" : ` (+${overflow}px)`}`);
  }
  await ctx.close();
}
await browser.close();
if (failures.length) {
  console.error("\n" + failures.join("\n"));
  process.exit(1);
}
console.log("\n✅ No horizontal overflow");
