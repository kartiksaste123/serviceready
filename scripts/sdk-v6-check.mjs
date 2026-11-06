// Headless check: quote page renders PayPal JS SDK v6 button (no PayPal login performed).
import { chromium } from "playwright-core";
const B = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3999";
const ids = process.argv.slice(2);
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome",
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const logs = [];
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
for (const id of ids) {
  const t0 = Date.now();
  await page.goto(`${B}/q/${id}`);
  try {
    await page.getByText(/SDK v[56]/).waitFor({ timeout: 25000 });
    const engine = await page.getByText(/SDK v[56]/).innerText();
    const hasV6 = await page.locator("paypal-button").count();
    console.log(id, "ready in", Date.now() - t0, "ms", engine, "paypal-button:", hasV6);
  } catch (e) {
    console.log(id, "NOT READY", e.message.split("\n")[0]);
  }
  await page.screenshot({ path: `/tmp/q-${id.slice(0, 8)}.png` });
}
console.log(logs.filter((l) => /paypal|error|warn/i.test(l)).slice(0, 15).join("\n"));
await browser.close();
