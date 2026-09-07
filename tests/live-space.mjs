import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(
    process.env.TEST_URL || "https://sankalphs-singularity.static.hf.space/",
  );
  await page.locator("canvas").waitFor();
  await page.locator("#leaders").click();
  await page.waitForFunction(
    () =>
      document.querySelector("#connection").textContent ===
      "SPACETIMEDB CONNECTED",
  );
  assert.doesNotMatch(
    await page.locator("#leader-list").textContent(),
    /Connecting|Unable/,
  );
  await page.locator('[data-close="leader-dialog"]').click();
  assert.equal(await page.locator("[data-role]").count(), 5);
  await page.locator('[data-role="2"]').click();
  await page.locator("#practice").click();
  await page.keyboard.down(" ");
  await page
    .locator("#finish-dialog")
    .waitFor({ state: "visible", timeout: 60000 });
  await page.keyboard.up(" ");
  assert.match(await page.locator("#finish-label").textContent(), /UNRANKED/);
  await page.screenshot({ path: "test-results/live-finish.png" });
  assert.deepEqual(errors, []);
  console.log(
    "PASS: production assets, live SpacetimeDB connection, shared leaderboard, full solo course completion, no page errors.",
  );
} finally {
  await browser.close();
}
