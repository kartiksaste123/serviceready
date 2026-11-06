import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
const B = process.env.E2E_BASE_URL ?? "http://127.0.0.1:5173";
const SHOTS = process.env.E2E_SCREENSHOTS ?? "/tmp/serviceready-e2e";
mkdirSync(SHOTS, { recursive: true });
let failures = 0;
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome",
  args: ["--no-sandbox"],
});
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(`[console] ${m.text()}`);
});
page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
const step = async (name, fn) => {
  try {
    await fn();
    console.log("OK  ", name);
  } catch (e) {
    failures++;
    console.log("FAIL", name, e.message.split("\n")[0]);
    await page
      .screenshot({ path: `${SHOTS}/FAIL-${name.replace(/\W+/g, "_")}.png`, timeout: 5000 })
      .catch(() => {});
  }
};
const go = async (u) => {
  await page.goto(B + u);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(800);
};
const shot = (n) =>
  page.screenshot({
    path: `${SHOTS}/${n}.png`,
    fullPage: true,
    timeout: 5000,
    animations: "disabled",
  });

await step("landing", async () => {
  await go("/");
  await page.getByRole("heading", { level: 1 }).waitFor();
  await shot("01-landing");
});
await step("storefront", async () => {
  await go("/s/maya-rao-studio");
  await page.getByText("Logo design").first().waitFor();
  await shot("02-store");
});
await step("quote dialog validation", async () => {
  await page.getByRole("button", { name: "Request a quote for Logo design" }).click();
  await page.getByRole("button", { name: "Get my quote" }).click();
  await page.getByText("Enter your name.").waitFor();
  await page.getByLabel("Your name").fill("Riya Patel");
  await page.getByLabel("Email").fill("riya@example.com");
  await page.getByLabel("About the project").fill("Logo for my tea shop, minimal style.");
  await page.getByRole("button", { name: "Get my quote" }).click();
  await page.waitForURL(/\/q\//);
  await page.getByText("Secure PayPal checkout").waitFor();
  await shot("03-quote");
});
let quoteUrl = page.url();
await step("pay deposit", async () => {
  await page.getByRole("button", { name: "Pay deposit with PayPal" }).click();
  await page.getByRole("button", { name: "Approve & pay" }).click();
  await page.getByText("Deposit received").waitFor({ timeout: 8000 });
});
await step("reload keeps state", async () => {
  await page.reload();
  await page.getByText("Deposit received").waitFor();
});
await step("client message", async () => {
  await page.getByLabel("Your message").fill("Excited to start!");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page.getByText("Message sent.").waitFor();
});
await step("dashboard", async () => {
  await go("/app");
  await page.getByRole("row", { name: /Riya Patel/ }).waitFor();
  await shot("04-dashboard");
});
await step("filter + search", async () => {
  await page.getByRole("button", { name: /^Balance due/ }).click();
  await page.getByRole("row", { name: /Hannah Brooks/ }).waitFor();
  await page.getByRole("button", { name: /^All/ }).click();
  await page.getByLabel("Search bookings").fill("Riya Patel");
  await page.getByText("Showing 1–1 of 1").waitFor();
});
await step("open booking + deliver", async () => {
  await page.getByRole("row", { name: /Riya Patel/ }).click();
  await page.waitForURL(/\/app\/quotes\//);
  await page.getByRole("button", { name: "Mark delivered & invoice balance" }).click();
  await page.getByRole("button", { name: "Send invoice" }).click();
  await page.getByText("Simulate balance payment").waitFor({ timeout: 8000 });
  await shot("05-detail");
});
await step("run payment check", async () => {
  await page.getByRole("button", { name: "Run payment check" }).click();
  await page.getByText("Waiting for your approval").waitFor({ timeout: 8000 });
});
await step("approve proposal", async () => {
  await page
    .getByRole("button", { name: /Agree, keep waiting|Approve & send/ })
    .first()
    .click();
  await page
    .getByText(/keep waiting|Message sent/)
    .first()
    .waitFor({ timeout: 8000 });
});
await step("simulate balance paid", async () => {
  await page.getByRole("button", { name: "Simulate balance payment" }).click();
  await page.getByText("Paid in full. Nothing left to collect.").waitFor({ timeout: 8000 });
  await page.getByRole("button", { name: "Approve & send" }).click();
});
await step("approvals hannah", async () => {
  await go("/app/approvals");
  await page.getByText("Hannah Brooks").first().waitFor();
  await shot("06-approvals");
  await page.getByRole("button", { name: "Don't send" }).first().click();
  await page.getByRole("tab", { name: "Decided" }).click();
  await page
    .getByText(/Dismissed — nothing was sent|Approved/)
    .first()
    .waitFor();
});
await step("collections", async () => {
  await go("/app/collections");
  await page.getByText("Oldest first", { exact: true }).waitFor();
  await shot("07-collections");
});
await step("log", async () => {
  await go("/app/log");
  await page.getByRole("button", { name: "PayPal", exact: true }).click();
  await page.getByText("PayPal", { exact: true }).last().waitFor();
  await shot("08-log");
});
await step("catalog", async () => {
  await go("/app/catalog");
  await page.getByText("Brand identity kit").waitFor();
  await shot("09-catalog");
});
await step("connect", async () => {
  await go("/app/connect");
  await page.getByText("mcp-remote").waitFor();
  await shot("10-connect");
});
await step("settings validate + save", async () => {
  await go("/app/settings");
  await page.getByLabel("Default deposit (%)").fill("");
  await page.getByText("Use a whole number from 1 to 100.").waitFor();
  await page.getByLabel("Default deposit (%)").fill("40");
  await page.getByRole("radio", { name: /Firm/ }).click();
  await page.getByRole("button", { name: "Save rules" }).click();
  await page.getByText("All changes saved").waitFor({ timeout: 8000 });
  await shot("11-settings");
});
await step("onboard", async () => {
  await go("/onboard");
  await page.getByRole("button", { name: "Load example" }).click();
  await page.getByRole("button", { name: "Structure with AI" }).click();
  await page.getByText(/Review \d+ services/).waitFor({ timeout: 8000 });
  await shot("12-onboard-review");
  const publish = page.getByRole("button", { name: "Approve & publish" });
  if (!(await publish.isDisabled())) throw new Error("publish should be blocked by errors");
  await page.getByRole("button", { name: /Remove Rush surcharge/ }).click();
  await page.getByLabel("Turnaround (days)").first().fill("7");
  await publish.click();
  await page.getByText("Your services are now agent-ready").waitFor({ timeout: 8000 });
});
await step("agent chat", async () => {
  await go("/s/maya-rao-studio");
  await page.getByRole("button", { name: /I want a logo for my bakery/ }).click();
  await page.getByRole("link", { name: /Review & pay deposit/ }).waitFor({ timeout: 8000 });
  await shot("13-chat");
  await page.getByRole("link", { name: /Review & pay deposit/ }).click();
  await page.getByText("Secure PayPal checkout").waitFor();
});
await step("404 quote", async () => {
  await go("/q/nope");
  await page.getByText("Quote not found").waitFor();
});
await step("404 store", async () => {
  await go("/s/nope");
  await page.getByText("Storefront not found").waitFor();
});
await step("404 page", async () => {
  await go("/nope");
  await page.getByText("Page not found").waitFor();
});
await step("reset demo", async () => {
  await go("/app/settings");
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await page.getByRole("button", { name: "Reset demo" }).click();
  await page.getByText("Demo data restored").waitFor();
});
// mobile
const m = await browser.newPage({ viewport: { width: 390, height: 844 } });
m.on("pageerror", (e) => errors.push(`[m pageerror] ${e.message}`));
for (const [n, u] of [
  ["m-landing", "/"],
  ["m-app", "/app"],
  ["m-store", "/s/maya-rao-studio"],
  ["m-detail", "/app/quotes/q_hannah"],
  ["m-q", "/q/q_hannah"],
]) {
  await m.goto(B + u);
  await m.waitForTimeout(1500);
  const ow = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (ow > 0) failures++;
  console.log(ow > 0 ? "FAIL" : "OK  ", n, "overflow", ow);
  await m.screenshot({
    path: `${SHOTS}/${n}.png`,
    fullPage: true,
    timeout: 5000,
    animations: "disabled",
  });
}
console.log("ERRORS:\n" + [...new Set(errors)].join("\n"));
await browser.close();
if (errors.some((e) => e.includes("pageerror") || e.includes("hydrated"))) failures++;
console.log(`Browser smoke: ${failures ? "FAILED" : "PASSED"} (${failures} failures)`);
process.exitCode = failures ? 1 : 0;
