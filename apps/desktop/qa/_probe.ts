import { chromium } from "playwright-core";
const query = process.argv[2] ?? "reset=1&fixture=dev-machine&onboarded=1&delay=0&pace=0";
const steps = (process.argv[3] ?? "").split("|").filter(Boolean);
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
page.on("console", (m) => { if (m.type() === "error") console.log("[console]", m.text()); });
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
await page.goto(`http://localhost:1461/?${query}`);
const dump = async (label: string) => {
  await page.waitForTimeout(600);
  const text = await page.evaluate(() => document.querySelector(".content")?.textContent ?? document.body.textContent);
  const prim = await page.locator(".button-primary").count();
  const links = await page.locator(".guided-link").count();
  console.log(`--- ${label} [primary=${prim} link=${links}]\n${(text ?? "").slice(0, 700)}`);
};
await dump("landed");
for (const step of steps) {
  const [kind, arg] = step.split(":");
  if (kind === "click") await page.getByRole("button", { name: arg, exact: true }).first().click();
  else if (kind === "wait") await page.waitForTimeout(Number(arg));
  else if (kind === "text") await page.getByText(arg!).first().waitFor({ timeout: 15000 });
  else if (kind === "fill") await page.getByPlaceholder("Paste your licence key").fill(arg!);
  else if (kind === "calls") console.log(JSON.stringify(await page.evaluate(() => (window as unknown as { __talosDemoCalls?: unknown }).__talosDemoCalls)));
  else if (kind === "blur") await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  else if (kind === "focus") await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await dump(step);
}
await browser.close();
