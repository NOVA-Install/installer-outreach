/**
 * Spy on Boxt configurator network requests to find pricing API endpoints.
 * Run with: npx tsx scripts/boxt-network-spy.ts
 *
 * Navigates through the quiz, enters a postcode, and captures all XHR/fetch
 * requests to find the backend API that returns pricing data.
 */

import { chromium } from "playwright";

const POSTCODE = "HG1 2ER";

async function main() {
  const browser = await chromium.launch({ headless: false, slowMo: 100 });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    locale: "en-GB",
    timezoneId: "Europe/London",
  });
  const page = await context.newPage();

  // Capture ALL network requests
  const apiCalls: Array<{
    url: string;
    method: string;
    postData: string | null;
    responseStatus: number | null;
    responseBody: string | null;
  }> = [];

  page.on("response", async (response) => {
    const url = response.url();
    const request = response.request();

    // Skip static assets, analytics, images, fonts
    if (
      url.includes("google") ||
      url.includes("analytics") ||
      url.includes("posthog") ||
      url.includes("intercom") ||
      url.includes("sentry") ||
      url.includes("hotjar") ||
      url.includes(".png") ||
      url.includes(".jpg") ||
      url.includes(".svg") ||
      url.includes(".woff") ||
      url.includes(".css") ||
      url.includes(".js") ||
      url.includes("onetrust") ||
      url.includes("trustpilot") ||
      url.includes("maps.googleapis")
    ) {
      return;
    }

    let body: string | null = null;
    try {
      body = await response.text();
    } catch { /* can't read body */ }

    apiCalls.push({
      url,
      method: request.method(),
      postData: request.postData() || null,
      responseStatus: response.status(),
      responseBody: body ? body.slice(0, 2000) : null,
    });
  });

  console.log("Navigating to Boxt configurator...\n");
  await page.goto("https://app.boxt.co.uk/solar/configurator", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);

  // Dismiss cookies
  const reject = page.locator('button:has-text("Reject All")').first();
  if (await reject.isVisible({ timeout: 3000 }).catch(() => false)) {
    await reject.click();
    await page.waitForTimeout(1000);
  }

  // Q1-Q4
  for (const answer of ["Yes", "Pitched", "Medium", "Lower energy bills"]) {
    for (const tag of ["h1", "h2", "h3", "h4", ""]) {
      const sel = tag ? `${tag}:has-text("${answer}")` : `text="${answer}"`;
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
        await el.click();
        await page.waitForTimeout(2000);
        break;
      }
    }
  }

  // Enter postcode
  const postcodeInput = page.locator('input[placeholder*="postcode" i], input[type="text"]').first();
  await postcodeInput.waitFor({ state: "visible", timeout: 10000 });
  await postcodeInput.fill(POSTCODE);
  await page.waitForTimeout(500);
  await page.click('button:has-text("Search"), button[type="submit"]', { timeout: 5000 });
  await page.waitForTimeout(3000);

  // Select first non-flat address
  await page.evaluate(() => {
    const buttons = document.querySelectorAll("button");
    for (const btn of buttons) {
      const text = btn.textContent?.trim() || "";
      if (text.includes(",") && !text.toLowerCase().includes("flat") && text.length > 10) {
        btn.click();
        return;
      }
    }
  });
  await page.waitForTimeout(1000);

  // Confirm
  await page.click('button:has-text("Confirm address")', { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(5000);

  // Handle flat modal if present
  const flatModal = page.locator('text="Are you in a flat?"');
  if (await flatModal.isVisible({ timeout: 3000 }).catch(() => false)) {
    await page.evaluate(() => {
      const allEls = document.querySelectorAll("*");
      for (const el of allEls) {
        const t = Array.from(el.childNodes).filter(n => n.nodeType === Node.TEXT_NODE).map(n => n.textContent?.trim()).join("");
        if (t === "Detached") {
          let c = el.parentElement;
          for (let i = 0; i < 8 && c; i++) {
            const r = c.querySelector('input[type="radio"]') as HTMLInputElement | null;
            if (r) {
              const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "checked")?.set;
              if (s) s.call(r, true); else r.checked = true;
              r.dispatchEvent(new Event("input", { bubbles: true }));
              r.dispatchEvent(new Event("change", { bubbles: true }));
              c.click();
              return;
            }
            c = c.parentElement;
          }
        }
      }
    });
    await page.waitForTimeout(1000);
    const updateBtn = page.locator('button:has-text("Update")').last();
    const box = await updateBtn.boundingBox();
    if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(5000);
  }

  // Wait for "View solar quote"
  for (let i = 0; i < 60; i++) {
    const btn = page.locator('button:has-text("View solar quote")').first();
    if (await btn.isVisible({ timeout: 500 }).catch(() => false)) {
      await page.click('button:has-text("View solar quote")', { timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(5000);
      break;
    }
    await page.waitForTimeout(1000);
  }

  // Now on configurator page — wait a moment for any lazy API calls
  await page.waitForTimeout(3000);

  // Also check for __NEXT_DATA__ and React state
  const nextData = await page.evaluate(() => {
    const el = document.getElementById("__NEXT_DATA__");
    return el ? el.textContent?.slice(0, 3000) : null;
  });

  const windowKeys = await page.evaluate(() => {
    const interesting: Record<string, string> = {};
    for (const key of Object.keys(window)) {
      if (key.startsWith("__") || key.includes("state") || key.includes("store") || key.includes("redux")) {
        try {
          interesting[key] = JSON.stringify((window as any)[key]).slice(0, 500);
        } catch { /* can't serialize */ }
      }
    }
    return interesting;
  });

  // Print results
  console.log("\n=== API CALLS (filtered) ===\n");
  for (const call of apiCalls) {
    console.log(`${call.method} ${call.url}`);
    if (call.postData) console.log(`  POST body: ${call.postData.slice(0, 500)}`);
    if (call.responseBody) {
      // Check if response contains pricing data
      if (
        call.responseBody.includes("price") ||
        call.responseBody.includes("panel") ||
        call.responseBody.includes("battery") ||
        call.responseBody.includes("quote") ||
        call.responseBody.includes("cost")
      ) {
        console.log(`  *** PRICING DATA ***`);
        console.log(`  Response (${call.responseStatus}): ${call.responseBody.slice(0, 1000)}`);
      } else {
        console.log(`  Response (${call.responseStatus}): ${call.responseBody.slice(0, 200)}`);
      }
    }
    console.log();
  }

  console.log("\n=== __NEXT_DATA__ ===\n");
  console.log(nextData?.slice(0, 2000) || "Not found");

  console.log("\n=== Window state keys ===\n");
  for (const [key, val] of Object.entries(windowKeys)) {
    console.log(`${key}: ${val}`);
  }

  console.log("\nDone. Closing in 10 seconds...");
  await new Promise((r) => setTimeout(r, 10000));
  await browser.close();
}

main().catch(console.error);
