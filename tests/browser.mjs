import { chromium } from "@playwright/test";
import assert from "node:assert/strict";

const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--enable-webgl", "--ignore-gpu-blocklist"],
});
const errors = [];
const pages = [];
const url = process.env.TEST_URL || "http://127.0.0.1:5173";
const timerPattern = /^\d{2}:\d{2}\.\d{3}$/;
const challenges = [
  { id: "0", difficulty: "Easy", title: "Suspended Disbelief", objectives: "6 OBJECTIVES" },
  { id: "1", difficulty: "Medium", title: "Freight Expectations", objectives: "8 OBJECTIVES" },
  { id: "2", difficulty: "Difficult", title: "The Coordination Tax", objectives: "9 OBJECTIVES" },
];

async function open(viewport = { width: 1440, height: 900 }, options = {}) {
  const page = await browser.newPage({ viewport, ...options });
  pages.push(page);
  page.on("pageerror", error => errors.push(error.message));
  // Closing Vite's HMR socket makes this deterministic without masking the app's DB socket.
  await page.routeWebSocket(socketUrl => socketUrl.port === "5173", socket => socket.close());
  await page.goto(url);
  await page.locator("canvas").waitFor();
  return page;
}

async function selectChallenge(page, challenge) {
  await page.locator(`[data-home-challenge="${challenge.id}"]`).click();
  assert.equal(
    await page.locator(`[data-home-challenge="${challenge.id}"]`).getAttribute("aria-pressed"),
    "true",
  );
  assert.equal(
    await page.locator(`[data-lobby-challenge="${challenge.id}"]`).getAttribute("aria-pressed"),
    "true",
  );
  assert.equal(await page.locator("#course-difficulty").textContent(), challenge.difficulty);
  assert.equal(await page.locator("#course-title").textContent(), challenge.title);
  assert.equal(await page.locator("#course-count").textContent(), challenge.objectives);
}

try {
  const page = await open();

  assert.equal(await page.locator("[data-home-challenge]").count(), 3);
  assert.deepEqual(
    await page.locator("[data-home-challenge] .difficulty").allTextContents(),
    challenges.map(challenge => challenge.difficulty),
  );

  assert.equal(await page.locator("[data-role]").count(), 5);
  assert.deepEqual(
    await page.locator("[data-role] b").allTextContents(),
    ["Left Hand", "Right Hand", "Torso", "Left Leg", "Right Leg"],
  );
  assert.deepEqual(
    await page.locator("[id^=pilot-]").allTextContents(),
    ["AI IN SOLO PRACTICE", "AI IN SOLO PRACTICE", "AI IN SOLO PRACTICE", "AI IN SOLO PRACTICE", "YOU CONTROL THIS"],
  );
  assert.match(await page.locator(".dock-heading b").textContent(), /PICK YOUR PART/);
  assert.match(await page.locator(".dock-heading span").textContent(), /every other part with AI/i);
  await page.locator('[data-home-crew="3"]').click();
  assert.equal(await page.locator("[data-role]").count(), 3);
  assert.deepEqual(
    await page.locator("[data-role] b").allTextContents(),
    ["Arms", "Torso", "Legs"],
  );
  assert.deepEqual(
    await page.locator("#part option").allTextContents(),
    ["Arms", "Torso", "Legs"],
  );

  const visualSignatures = [];
  for (const challenge of challenges) {
    await selectChallenge(page, challenge);
    visualSignatures.push(await page.evaluate(() => ({
      title: document.querySelector("#course-title").textContent,
      environment: document.querySelector("#course-meta").textContent,
      accent: getComputedStyle(document.documentElement).getPropertyValue("--challenge").trim(),
    })));
  }
  assert.equal(new Set(visualSignatures.map(item => item.title)).size, 3);
  assert.equal(new Set(visualSignatures.map(item => item.environment)).size, 3);
  assert.equal(new Set(visualSignatures.map(item => item.accent)).size, 3);

  await selectChallenge(page, challenges[1]);
  await page.locator('[data-role="1"]').click();
  await page.locator("#practice").click();
  await page.waitForFunction(() => document.body.classList.contains("playing"));
  assert.equal(await page.locator("body").getAttribute("data-challenge"), "1");
  assert.equal(await page.locator("#mode-label").textContent(), "MEDIUM / 3-PILOT PRACTICE");
  assert.equal(await page.locator("[data-role]:disabled").count(), 3);
  assert.deepEqual(
    await page.locator("[id^=pilot-]").allTextContents(),
    ["AI CONTROLLED", "YOU CONTROL THIS", "AI CONTROLLED"],
  );
  assert.equal(await page.locator(".dock-heading b").textContent(), "SOLO PRACTICE · YOUR PART");
  assert.match(await page.locator("#instruction").textContent(), /^Torso/);
  await page.waitForTimeout(150);
  assert.match(await page.locator("#timer").textContent(), timerPattern);
  assert.match(await page.locator("#objective-title").textContent(), /^1 \/ 8/);
  assert.equal(await page.locator("#sync-announcement").getAttribute("aria-live"), "assertive");
  assert.equal(await page.locator("#sync-announcement").getAttribute("aria-atomic"), "true");
  await page.screenshot({ path: "test-results/challenge-medium-three-player.png" });
  await page.locator("#exit").click();

  for (const challenge of [challenges[0], challenges[2]]) {
    await selectChallenge(page, challenge);
    await page.locator("#practice").click();
    await page.waitForFunction(expected => document.body.dataset.challenge === expected, challenge.id);
    assert.match(await page.locator("#timer").textContent(), timerPattern);
    await page.locator("#exit").click();
  }

  await page.locator('[data-home-crew="5"]').click();
  assert.equal(await page.locator("[data-role]").count(), 5);
  assert.deepEqual(
    await page.locator("[data-role] b").allTextContents(),
    ["Left Hand", "Right Hand", "Torso", "Left Leg", "Right Leg"],
  );

  await page.locator("#leaders").click();
  assert.deepEqual(
    await page.locator("[data-leader-crew]").allTextContents(),
    ["3-player records", "5-player records"],
  );
  assert.deepEqual(
    await page.locator("[data-leader-challenge]").allTextContents(),
    ["Easy", "Medium", "Difficult"],
  );
  await page.locator('[data-leader-crew="3"]').click();
  await page.locator('[data-leader-challenge="2"]').click();
  assert.equal(await page.locator('[data-leader-crew="3"]').getAttribute("aria-selected"), "true");
  assert.equal(await page.locator('[data-leader-challenge="2"]').getAttribute("aria-selected"), "true");
  assert.match(await page.locator("#leader-description").textContent(), /3-player Difficult records/);
  await page.locator('[data-close="leader-dialog"]').click();

  const mobile = await open({ width: 390, height: 844 });
  await mobile.locator('[data-home-crew="5"]').click();
  await mobile.locator('[data-home-challenge="2"]').click();
  await mobile.locator('[data-role="2"]').click();
  await mobile.locator("#practice").click();
  assert.equal(await mobile.locator("body").getAttribute("data-challenge"), "2");
  assert.equal(await mobile.locator("#objective-panel").isVisible(), true);
  assert.match(await mobile.locator("#timer").textContent(), timerPattern);
  assert.equal(await mobile.locator(".touch .grab").textContent(), "BRACE");
  assert.equal(
    await mobile.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
    false,
  );
  await mobile.screenshot({ path: "test-results/challenge-difficult-five-player-mobile.png" });

  const touchBox = await mobile.locator(".touch .grab").boundingBox();
  assert.ok(touchBox, "mobile action control is not laid out");
  await mobile.mouse.move(touchBox.x + touchBox.width / 2, touchBox.y + touchBox.height / 2);
  await mobile.mouse.down();
  await mobile.waitForFunction(() => document.querySelector("#role-feedback").textContent.includes("BRACED"));
  await mobile.mouse.up();

  const touchTablet = await open({ width: 900, height: 600 }, { hasTouch: true });
  await touchTablet.locator('[data-home-crew="3"]').click();
  await touchTablet.locator('[data-role="1"]').click();
  await touchTablet.locator("#practice").click();
  await touchTablet.waitForFunction(() => document.body.classList.contains("playing"));
  assert.equal(await touchTablet.evaluate(() => matchMedia("(any-pointer: coarse)").matches), true);
  assert.equal(await touchTablet.locator(".touch").isVisible(), true);
  const touchLayout = await touchTablet.locator(".touch button").evaluateAll(buttons =>
    buttons.map(button => {
      const box = button.getBoundingClientRect();
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height };
    }),
  );
  assert.equal(touchLayout.length, 5);
  assert.ok(touchLayout.every(box => box.width >= 44 && box.height >= 44), "coarse-pointer controls must meet the touch target floor");
  assert.ok(touchLayout.every((box, index) => index === 0 || touchLayout[index - 1].right <= box.left), "coarse-pointer controls must not overlap");
  assert.ok(touchLayout.every(box => box.top >= 0 && box.bottom <= 600), "coarse-pointer controls must remain inside the viewport");
  assert.match(await touchTablet.locator(".touch").ariaSnapshot(), /group "Touch controls"/);

  const actionControl = touchTablet.locator(".touch .grab");
  const leftControl = touchTablet.locator('.touch [data-key="a"]');
  const actionBox = await actionControl.boundingBox();
  assert.ok(actionBox, "action control is not laid out");
  await touchTablet.mouse.move(actionBox.x + actionBox.width / 2, actionBox.y + actionBox.height / 2);
  await touchTablet.mouse.down();
  try {
    await touchTablet.waitForFunction(() => document.querySelector("#role-feedback")?.textContent?.includes("BRACED"));
    await leftControl.focus();
    await touchTablet.waitForTimeout(80);
    assert.equal((await touchTablet.locator("#role-feedback").textContent()).includes("BRACED"), true);
  } finally {
    await touchTablet.mouse.up();
  }
  await touchTablet.waitForFunction(() => !document.querySelector("#role-feedback")?.textContent?.includes("BRACED"));

  await actionControl.focus();
  await touchTablet.keyboard.down("Enter");
  try {
    await touchTablet.waitForFunction(() => document.querySelector("#role-feedback")?.textContent?.includes("BRACED"));
  } finally {
    await touchTablet.keyboard.up("Enter");
  }
  await touchTablet.waitForTimeout(100);
  assert.equal((await touchTablet.locator("#role-feedback").textContent()).includes("BRACED"), false);

  await actionControl.focus();
  await touchTablet.keyboard.down("Enter");
  try {
    await touchTablet.waitForFunction(() => document.querySelector("#role-feedback")?.textContent?.includes("BRACED"));
    await leftControl.focus();
    await touchTablet.waitForFunction(() => !document.querySelector("#role-feedback")?.textContent?.includes("BRACED"));
  } finally {
    await touchTablet.keyboard.up("Enter");
  }

  await leftControl.focus();
  await touchTablet.keyboard.down("Space");
  try {
    await touchTablet.waitForTimeout(80);
    assert.equal((await touchTablet.locator("#role-feedback").textContent()).includes("BRACED"), false);
  } finally {
    await touchTablet.keyboard.up("Space");
  }

  await actionControl.evaluate(button => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 0 }));
  });
  await touchTablet.waitForFunction(() => document.querySelector("#role-feedback")?.textContent?.includes("BRACED"));
  await touchTablet.waitForFunction(() => !document.querySelector("#role-feedback")?.textContent?.includes("BRACED"));

  assert.deepEqual(errors, []);
  console.log(
    "PASS: three distinct challenges, three/five-player role mappings, mode-specific practice, millisecond timer, segmented leaderboards, and responsive mobile/coarse-pointer controls.",
  );
} finally {
  await browser.close();
}
