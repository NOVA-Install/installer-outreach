/**
 * Spy on Heatable's solar quote form network requests to find pricing API endpoints.
 * Run with: set -a && source .env.local && set +a && npx tsx scripts/heatable-network-spy.ts
 */

import { chromium } from "playwright";

const POSTCODE = "HG1 2ER";

async function main() {
  const browser = await chromium.launch({ headless: false, slowMo: 200 });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    locale: "en-GB",
    timezoneId: "Europe/London",
  });
  const page = await context.newPage();

  // ── Capture ALL network requests ──────────────────────────────────
  const apiCalls: Array<{
    url: string;
    method: string;
    postData: string | null;
    responseStatus: number | null;
    responseBody: string | null;
  }> = [];

  page.on("response", async (response) => {
    const url = response.url();
    if (
      /\.(js|css|png|jpg|jpeg|gif|svg|woff|woff2|ttf|eot|ico|webp|mp4|webm)(\?|$)/i.test(url) ||
      url.includes("google") || url.includes("analytics") || url.includes("gtag") ||
      url.includes("gtm") || url.includes("posthog") || url.includes("intercom") ||
      url.includes("sentry") || url.includes("hotjar") || url.includes("onetrust") ||
      url.includes("trustpilot") || url.includes("cookiebot") || url.includes("facebook") ||
      url.includes("fbevents") || url.includes("doubleclick") || url.includes("bing.com") ||
      url.includes("clarity.ms") || url.includes("segment") || url.includes("hubspot") ||
      url.includes("cloudflareinsights") || url.includes("cdn-cgi") ||
      url.includes("fonts.googleapis") || url.includes("maps.googleapis") ||
      url.includes("cookieyes") || url.includes("mainadv.com") || url.includes("reddit.com") ||
      url.includes("roeye.com") || url.includes("ecs.us-west-2.on.aws")
    ) return;

    const request = response.request();
    let body: string | null = null;
    try { body = await response.text(); } catch { /* */ }

    apiCalls.push({
      url,
      method: request.method(),
      postData: request.postData() || null,
      responseStatus: response.status(),
      responseBody: body ? body.slice(0, 4000) : null,
    });

    // Live log important calls
    if (url.includes("api.heatable") || (url.includes("heatable") && request.method() !== "GET")) {
      console.log(`  [LIVE] ${request.method()} ${url} → ${response.status()}`);
      if (request.postData()) console.log(`         body: ${request.postData()!.slice(0, 200)}`);
      if (body && body.length < 500) console.log(`         resp: ${body}`);
    }
  });

  // ── Helper: nuke cookie banner ────────────────────────────────────
  async function nukeCookies() {
    await page.evaluate(() => {
      // Remove all cookie-related overlays
      document.querySelectorAll('[class*="cky-"], [id*="cookie"], [class*="cookie"]').forEach(el => el.remove());
      // Remove overlay
      document.querySelectorAll('.cky-overlay, [class*="overlay"]').forEach(el => {
        if ((el as HTMLElement).style.position === 'fixed') el.remove();
      });
    }).catch(() => {});
  }

  // ── Step 1: Navigate ──────────────────────────────────────────────
  console.log("Step 1: Navigating to https://heatable.co.uk/solar/quote ...\n");
  await page.goto("https://heatable.co.uk/solar/quote", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2000);

  // ── Step 2: Dismiss cookies ───────────────────────────────────────
  console.log("Step 2: Dismissing cookie banner...");
  // Click Accept All first (the proper way), then nuke remnants
  try {
    await page.locator('.cky-btn-accept').first().click({ timeout: 3000 });
    console.log("  Clicked Accept All");
  } catch {
    console.log("  No cookie Accept button, nuking banner...");
  }
  await page.waitForTimeout(1000);
  await nukeCookies();

  // ── Step 3: Click "See my price online" ───────────────────────────
  console.log('\nStep 3: Clicking "See my price online"...');
  await nukeCookies();
  // The CTA button on the landing page
  const ctaBtn = page.locator('a:has-text("See my price"), button:has-text("See my price")').first();
  await ctaBtn.waitFor({ state: "visible", timeout: 5000 });
  await ctaBtn.click({ force: true });
  console.log("  Clicked! Waiting for quiz page...");

  // Wait for navigation to /solar/quote/{slug}
  await page.waitForURL(/\/solar\/quote\/[a-f0-9]+/, { timeout: 15000 });
  console.log(`  Navigated to: ${page.url()}`);
  await page.waitForTimeout(3000);
  await nukeCookies();

  // ── Quiz: click answer buttons ────────────────────────────────────
  // The answer buttons have class "journey__question-answer-button"
  // Each question auto-advances after clicking an answer

  async function answerQuestion(answerText: string, label: string, waitMs = 3000) {
    console.log(`\n${label}: Looking for "${answerText}"...`);
    await nukeCookies();

    // Get current question heading
    const heading = await page.evaluate(() =>
      document.querySelector("h1, h2")?.textContent?.trim() || "?"
    );
    console.log(`  Question: ${heading}`);

    // Find the answer button by its text content
    // The buttons have class journey__question-answer-button
    const answerBtns = page.locator('.journey__question-answer-button');
    const count = await answerBtns.count();
    console.log(`  Found ${count} answer buttons`);

    let clicked = false;
    for (let i = 0; i < count; i++) {
      const btn = answerBtns.nth(i);
      const text = (await btn.innerText().catch(() => "")).trim();
      console.log(`    [${i}] "${text}"`);
      if (text === answerText) {
        await btn.scrollIntoViewIfNeeded();
        await btn.click({ force: true });
        console.log(`  --> Clicked!`);
        clicked = true;
        break;
      }
    }

    if (!clicked) {
      // Fallback: try getByRole
      console.log("  Trying getByRole fallback...");
      try {
        await page.getByRole("button", { name: answerText, exact: true }).click({ force: true, timeout: 3000 });
        console.log("  --> Clicked via getByRole!");
        clicked = true;
      } catch {
        console.log(`  WARNING: Could not click "${answerText}"`);
      }
    }

    await page.waitForTimeout(waitMs);
    return clicked;
  }

  await answerQuestion("House", "Q1-PropertyType");
  await answerQuestion("Two", "Q2-Floors");
  await answerQuestion("Half the day", "Q3-HomeDuringDay");
  await answerQuestion("No, I don't", "Q4-KnowUsage");
  await answerQuestion("Fairly average", "Q5-UsageLevel");

  // ── Postcode ──────────────────────────────────────────────────────
  console.log(`\nStep 4: Entering postcode "${POSTCODE}"...`);
  await page.waitForTimeout(2000);
  await nukeCookies();

  // Check what question we're on
  const postcodeHeading = await page.evaluate(() =>
    document.querySelector("h1, h2")?.textContent?.trim() || "?"
  );
  console.log(`  Current heading: ${postcodeHeading}`);

  // Find text input (not checkbox/radio/hidden)
  const textInput = page.locator('input[type="text"], input[type="search"], input:not([type])').first();
  try {
    await textInput.waitFor({ state: "visible", timeout: 5000 });
    await textInput.click();
    // Type character by character to trigger autocomplete
    await textInput.fill("");
    await page.keyboard.type(POSTCODE, { delay: 100 });
    console.log(`  Typed postcode`);
    await page.waitForTimeout(3000);

    // Look for address suggestions
    console.log("  Looking for address suggestions...");
    const suggestions = await page.evaluate(() => {
      const items: { text: string; tag: string; cls: string }[] = [];
      document.querySelectorAll('[role="option"], [class*="suggestion"] *, [class*="dropdown"] li, [class*="result"] li, [class*="listbox"] *, ul[class] li').forEach(el => {
        const rect = (el as HTMLElement).getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          items.push({
            text: el.textContent?.trim().slice(0, 100) || "",
            tag: el.tagName,
            cls: el.className?.toString().slice(0, 80) || "",
          });
        }
      });
      return items.filter(i => i.text.length > 3 && !i.text.includes("cookie"));
    });
    console.log(`  Found ${suggestions.length} suggestion candidates:`);
    suggestions.slice(0, 10).forEach((s, i) => console.log(`    [${i}] ${s.tag}.${s.cls}: "${s.text}"`));

    // Click first address-like suggestion
    if (suggestions.length > 0) {
      // Use first visible li or option
      for (const sel of ['[role="option"]', 'li']) {
        const items = page.locator(sel);
        const cnt = await items.count();
        for (let i = 0; i < cnt; i++) {
          const item = items.nth(i);
          if (await item.isVisible().catch(() => false)) {
            const text = await item.textContent().catch(() => "");
            if (text && text.length > 5 && !text.includes("cookie") && !text.includes("Cookie") &&
                !text.includes("Accept") && !text.includes("Show more") &&
                !text.includes("Necessary") && !text.includes("Functional")) {
              await item.click({ force: true });
              console.log(`  Selected: "${text.trim().slice(0, 80)}"`);
              break;
            }
          }
        }
      }
    } else {
      // Try Find address button
      console.log("  No suggestions, looking for Find/Search button...");
      for (const sel of ['button:has-text("Find")', 'button:has-text("Search")', 'button:has-text("Look up")']) {
        try {
          const btn = page.locator(sel).first();
          if (await btn.isVisible({ timeout: 2000 })) {
            await btn.click({ force: true });
            console.log(`  Clicked: ${sel}`);
            await page.waitForTimeout(3000);
            break;
          }
        } catch { /* */ }
      }
    }
  } catch (e) {
    console.log(`  Could not find text input: ${e}`);
  }

  await page.waitForTimeout(3000);

  // ── Final CTA ─────────────────────────────────────────────────────
  console.log('\nStep 5: Looking for final CTA...');
  await nukeCookies();
  for (const sel of [
    'button:has-text("See my price")',
    'button:has-text("Get my price")',
    'button:has-text("Get quote")',
    'button:has-text("Submit")',
    'button:has-text("Continue")',
  ]) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 2000 })) {
        await btn.click({ force: true });
        console.log(`  Clicked: ${sel}`);
        break;
      }
    } catch { /* */ }
  }

  // ── Wait for results ──────────────────────────────────────────────
  console.log("\n  Waiting for pricing data (15s)...");
  await page.waitForTimeout(15000);

  // ── Final page text ───────────────────────────────────────────────
  const finalText = await page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
    const texts: string[] = [];
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const t = node.textContent?.trim();
      if (t && t.length > 1 && t.length < 300) texts.push(t);
    }
    return [...new Set(texts)];
  });

  // ── Print results ─────────────────────────────────────────────────
  console.log("\n\n" + "=".repeat(80));
  console.log("  HEATABLE NETWORK SPY RESULTS");
  console.log("=".repeat(80));
  console.log(`\n  Final URL: ${page.url()}`);
  console.log(`  Total API calls captured: ${apiCalls.length}\n`);

  console.log("─".repeat(80));
  console.log("  ALL HEATABLE / API CALLS");
  console.log("─".repeat(80));

  for (const call of apiCalls) {
    if (call.url.startsWith("blob:")) continue;
    if (call.responseBody?.startsWith("<!DOCTYPE")) continue;
    if (!call.url.includes("heatable")) continue;

    const isPricing = call.responseBody && (
      /price|cost|panel|battery|kwh|kWh|kWp|saving|tariff|solar_design|package|inverter|generation/i.test(call.responseBody)
    );

    // Skip noisy RSC fetches without pricing data
    if (call.url.includes("_rsc=") && !isPricing) continue;

    console.log(`\n  ${call.method} ${call.url}`);
    console.log(`  Status: ${call.responseStatus}`);
    if (call.postData) console.log(`  Request body: ${call.postData.slice(0, 1500)}`);
    if (call.responseBody) {
      if (isPricing) console.log(`  *** LIKELY PRICING/QUOTE DATA ***`);
      console.log(`  Response: ${call.responseBody.slice(0, 2000)}`);
    }
  }

  // Filtered results text
  const filtered = finalText.filter(l =>
    !l.includes("cookie") && !l.includes("Cookie") && !l.includes("privacy") &&
    !l.includes("Privacy") && !l.includes("consent") && !l.includes("Consent") &&
    !l.includes("Advertisement") && !l.includes("Analytics") && !l.includes("Functional") &&
    !l.includes("Performance") && !l.includes("Necessary") && !l.includes("Always Active") &&
    !l.includes("Save Preferences") && !l.includes("Powered by") &&
    !l.includes("self.__next") && !l.includes("$RS") && !l.includes("requestAnimation") &&
    !l.includes("Customise") && !l.includes("Show more") &&
    !l.includes("clarity") && !l.includes("facebook") && !l.includes("Accept")
  );

  console.log("\n\n" + "─".repeat(80));
  console.log("  FINAL PAGE TEXT");
  console.log("─".repeat(80));
  console.log(filtered.join("\n").slice(0, 3000));

  console.log("\n\nDone. Closing in 5s...");
  await new Promise((r) => setTimeout(r, 5000));
  await browser.close();
}

main().catch(console.error);
