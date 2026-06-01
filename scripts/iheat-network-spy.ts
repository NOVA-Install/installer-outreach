/**
 * Spy on iHeat solar quote network requests to find pricing API endpoints.
 * Run with: npx tsx scripts/iheat-network-spy.ts
 *
 * Navigates through the solar quote flow, enters a postcode, answers all
 * questions, and captures every XHR/fetch request to discover backend APIs
 * that return pricing or package data.
 */

import { chromium } from "playwright";

const POSTCODE = "HG1 2ER";

interface ApiCall {
  url: string;
  method: string;
  postData: string | null;
  responseStatus: number | null;
  responseBody: string | null;
  contentType: string | null;
  timestamp: number;
}

async function main() {
  const browser = await chromium.launch({ headless: false, slowMo: 80 });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    locale: "en-GB",
    timezoneId: "Europe/London",
  });
  const page = await context.newPage();

  const apiCalls: ApiCall[] = [];

  // Capture ALL network responses
  page.on("response", async (response) => {
    const url = response.url();
    const request = response.request();

    // Skip static assets, analytics, tracking, images, fonts, scripts, stylesheets
    const skipPatterns = [
      ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".webp",
      ".woff", ".woff2", ".ttf", ".eot",
      ".css", ".js", ".map",
      "google-analytics", "googletagmanager", "gtag", "gtm",
      "analytics", "posthog", "hotjar", "sentry", "intercom",
      "onetrust", "cookiebot", "trustpilot",
      "facebook", "fbevents", "doubleclick", "adsense",
      "maps.googleapis.com/maps",
      "fonts.googleapis", "fonts.gstatic",
      "clarity.ms", "bing.com", "baidu",
    ];

    if (skipPatterns.some((p) => url.toLowerCase().includes(p))) return;

    let body: string | null = null;
    let contentType: string | null = null;
    try {
      contentType = response.headers()["content-type"] || null;
      body = await response.text();
    } catch {
      /* can't read body for some responses */
    }

    // For iheat API endpoints returning JSON, capture full body (up to 50KB)
    const isIheatApi = url.includes("iheat.co.uk/api");
    const limit = isIheatApi ? 50000 : 5000;

    apiCalls.push({
      url,
      method: request.method(),
      postData: request.postData() || null,
      responseStatus: response.status(),
      responseBody: body ? body.slice(0, limit) : null,
      contentType,
      timestamp: Date.now(),
    });
  });

  // === Step 1: Navigate to iHeat solar quote ===
  console.log("=== Step 1: Navigating to iHeat solar quote ===\n");
  await page.goto("https://iheat.co.uk/quote/solar", {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  await page.waitForTimeout(3000);

  // === Step 2: Dismiss cookies ===
  console.log("=== Step 2: Dismissing cookies ===\n");
  for (const text of ["Deny", "Allow selection", "Reject All", "Reject"]) {
    const btn = page.locator(`button:has-text("${text}")`).first();
    if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await btn.click().catch(() => {});
      console.log(`  Clicked: "${text}"`);
      break;
    }
  }
  await page.waitForTimeout(1500);

  // === Step 3: Enter postcode ===
  console.log("=== Step 3: Entering postcode ===\n");
  const addressInput = page
    .locator('input[placeholder*="Start typing"]')
    .first();
  await addressInput.waitFor({ state: "visible", timeout: 10000 });
  await addressInput.fill(POSTCODE);
  console.log(`  Typed: "${POSTCODE}"`);
  await page.waitForTimeout(2500);

  // === Step 4: Click first address suggestion containing "HG1" ===
  console.log("=== Step 4: Selecting address suggestion ===\n");
  const suggestion = page.locator(`text=/HG1/`).first();
  if (await suggestion.isVisible({ timeout: 5000 }).catch(() => false)) {
    const text = await suggestion.textContent();
    console.log(`  Clicking suggestion: "${text}"`);
    await suggestion.click();
  } else {
    console.log("  WARNING: No address suggestion found, trying fallback...");
    // Fallback: look in any visible dropdown
    const anyAddr = page.locator('li, [role="option"], [class*="suggestion"]').first();
    if (await anyAddr.isVisible({ timeout: 3000 }).catch(() => false)) {
      await anyAddr.click();
    }
  }
  await page.waitForTimeout(3000);

  // === Step 5: Click Continue on map page ===
  console.log("=== Step 5: Clicking Continue on map page ===\n");
  const contBox = await page.evaluate(() => {
    for (const btn of document.querySelectorAll("button")) {
      if (btn.textContent?.trim() === "Continue") {
        const r = btn.getBoundingClientRect();
        if (r.height > 0 && r.width > 0) {
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        }
      }
    }
    return null;
  });
  if (contBox) {
    console.log(`  Continue button at (${contBox.x}, ${contBox.y})`);
    await page.mouse.click(contBox.x, contBox.y);
  } else {
    console.log("  WARNING: Continue button not found, trying locator...");
    await page
      .locator('button:has-text("Continue")')
      .first()
      .click({ timeout: 5000 })
      .catch(() => console.log("  Failed to click Continue"));
  }
  await page.waitForTimeout(3000);

  // === Step 6: Click through quiz answers ===
  const quizAnswers = [
    "Homeowner",      // Are you a homeowner?
    "Detached",       // Property type
    "Within 3 months", // How soon?
    "No",             // Know your usage?
    "3-4",            // Number of people
    "No",             // Electric vehicle?
    "Half the day",   // Time at home
    "No",             // Bird protection?
  ];

  for (let i = 0; i < quizAnswers.length; i++) {
    const answer = quizAnswers[i];
    // Check if we've already reached results
    if (page.url().includes("/results")) {
      console.log(`  Already on results page, skipping remaining questions.`);
      break;
    }

    console.log(`=== Step 6.${i + 1}: Clicking "${answer}" ===`);

    // Get current question heading
    const heading = await page.evaluate(() => {
      const els = document.querySelectorAll("h1, h2, h3");
      for (const el of els) {
        const r = el.getBoundingClientRect();
        if (r.height > 0 && r.y > 50) return el.textContent?.trim();
      }
      return null;
    });
    console.log(`  Question: ${heading || "unknown"}`);

    // Try to click the answer card
    const clicked = await clickCard(page, answer);
    console.log(`  Clicked: ${clicked}`);
    await page.waitForTimeout(2500);
  }

  // === Wait for results page ===
  console.log("\n=== Waiting for results page ===\n");
  for (let i = 0; i < 30; i++) {
    if (page.url().includes("/results")) break;
    await page.waitForTimeout(1000);
  }
  console.log(`  Final URL: ${page.url()}`);
  await page.waitForTimeout(5000);

  // Dismiss "Save your quote" popup if present
  const dismissBtn = page.locator('text="Continue without saving"');
  if (await dismissBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await dismissBtn.click().catch(() => {});
    console.log("  Dismissed 'Save your quote' popup");
    await page.waitForTimeout(2000);
  }

  // Wait a bit more for any lazy-loaded API calls
  await page.waitForTimeout(3000);

  // === Check __NEXT_DATA__ ===
  const nextData = await page.evaluate(() => {
    const el = document.getElementById("__NEXT_DATA__");
    return el ? el.textContent : null;
  });

  // === Check window state ===
  const windowState = await page.evaluate(() => {
    const interesting: Record<string, string> = {};
    for (const key of Object.keys(window)) {
      if (
        key.startsWith("__") ||
        key.includes("state") ||
        key.includes("store") ||
        key.includes("redux") ||
        key.includes("data") ||
        key.includes("quote") ||
        key.includes("price")
      ) {
        try {
          interesting[key] = JSON.stringify((window as any)[key]).slice(0, 1000);
        } catch {
          /* can't serialize */
        }
      }
    }
    return interesting;
  });

  // === Print ALL captured API calls ===
  console.log("\n" + "=".repeat(80));
  console.log("=== ALL CAPTURED NETWORK REQUESTS ===");
  console.log("=".repeat(80) + "\n");

  // Separate into pricing-related and other
  const pricingKeywords = [
    "price", "cost", "total", "quote", "package", "panel", "battery",
    "solar", "saving", "tariff", "kwh", "kw", "inverter", "install",
    "payment", "finance", "monthly", "annual",
  ];

  const pricingCalls: ApiCall[] = [];
  const otherCalls: ApiCall[] = [];

  for (const call of apiCalls) {
    const combined = `${call.url} ${call.postData || ""} ${call.responseBody || ""}`.toLowerCase();
    const hasPricing = pricingKeywords.some((kw) => combined.includes(kw));
    if (hasPricing) {
      pricingCalls.push(call);
    } else {
      otherCalls.push(call);
    }
  }

  console.log(`Total API calls captured: ${apiCalls.length}`);
  console.log(`Pricing-related calls: ${pricingCalls.length}`);
  console.log(`Other calls: ${otherCalls.length}\n`);

  // Print pricing calls first (with full details)
  if (pricingCalls.length > 0) {
    console.log("\n" + "=".repeat(80));
    console.log("*** PRICING / QUOTE RELATED API CALLS ***");
    console.log("=".repeat(80) + "\n");

    for (const call of pricingCalls) {
      console.log(`${call.method} ${call.url}`);
      console.log(`  Content-Type: ${call.contentType}`);
      console.log(`  Status: ${call.responseStatus}`);
      if (call.postData) {
        console.log(`  POST body: ${call.postData}`);
      }
      if (call.responseBody) {
        // Try to pretty-print JSON
        try {
          const parsed = JSON.parse(call.responseBody);
          console.log(`  Response JSON:\n${JSON.stringify(parsed, null, 2).slice(0, 20000)}`);
        } catch {
          console.log(`  Response body: ${call.responseBody.slice(0, 10000)}`);
        }
      }
      console.log();
    }
  }

  // Print all other calls (condensed)
  console.log("\n" + "=".repeat(80));
  console.log("=== OTHER API CALLS ===");
  console.log("=".repeat(80) + "\n");

  for (const call of otherCalls) {
    console.log(`${call.method} ${call.url}`);
    console.log(`  Content-Type: ${call.contentType}`);
    console.log(`  Status: ${call.responseStatus}`);
    if (call.postData) {
      console.log(`  POST body: ${call.postData.slice(0, 500)}`);
    }
    if (call.responseBody) {
      // For JSON responses, show a summary
      try {
        const parsed = JSON.parse(call.responseBody);
        const keys = Object.keys(parsed);
        console.log(`  Response JSON keys: [${keys.join(", ")}]`);
        console.log(`  Response preview: ${JSON.stringify(parsed).slice(0, 500)}`);
      } catch {
        console.log(`  Response preview: ${call.responseBody.slice(0, 300)}`);
      }
    }
    console.log();
  }

  // Print __NEXT_DATA__ if found
  if (nextData) {
    console.log("\n" + "=".repeat(80));
    console.log("=== __NEXT_DATA__ ===");
    console.log("=".repeat(80) + "\n");
    try {
      const parsed = JSON.parse(nextData);
      console.log(JSON.stringify(parsed, null, 2).slice(0, 5000));
    } catch {
      console.log(nextData.slice(0, 5000));
    }
  }

  // Print window state
  if (Object.keys(windowState).length > 0) {
    console.log("\n" + "=".repeat(80));
    console.log("=== WINDOW STATE ===");
    console.log("=".repeat(80) + "\n");
    for (const [key, val] of Object.entries(windowState)) {
      console.log(`${key}: ${val}`);
    }
  }

  // === Summary of iheat.co.uk domain calls ===
  console.log("\n" + "=".repeat(80));
  console.log("=== IHEAT DOMAIN CALLS ONLY ===");
  console.log("=".repeat(80) + "\n");

  const iheatCalls = apiCalls.filter((c) =>
    c.url.toLowerCase().includes("iheat")
  );
  console.log(`iHeat domain calls: ${iheatCalls.length}\n`);
  for (const call of iheatCalls) {
    console.log(`${call.method} ${call.url}`);
    console.log(`  Status: ${call.responseStatus} | Content-Type: ${call.contentType}`);
    if (call.postData) console.log(`  POST: ${call.postData}`);
    if (call.responseBody) {
      try {
        const parsed = JSON.parse(call.responseBody);
        console.log(`  Response:\n${JSON.stringify(parsed, null, 2).slice(0, 20000)}`);
      } catch {
        console.log(`  Response: ${call.responseBody.slice(0, 10000)}`);
      }
    }
    console.log();
  }

  console.log("\nDone. Browser closing in 10 seconds...");
  await new Promise((r) => setTimeout(r, 10000));
  await browser.close();
}

/** Click a card option by finding the div with exact text match and clicking at its center */
async function clickCard(page: any, text: string): Promise<boolean> {
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const cards = page.locator("div").filter({ hasText: new RegExp(`^${escaped}$`) });
  const count = await cards.count();

  for (let i = count - 1; i >= 0; i--) {
    const card = cards.nth(i);
    if (await card.isVisible({ timeout: 300 }).catch(() => false)) {
      const box = await card.boundingBox();
      if (box && box.height > 40) {
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        return true;
      }
    }
  }

  // Fallback: getByText with force
  try {
    await page.getByText(text, { exact: true }).last().click({ force: true, timeout: 2000 });
    return true;
  } catch {
    return false;
  }
}

main().catch(console.error);
