/**
 * Spy on MakeMyHouseGreen network requests to find pricing/quote API endpoints.
 * Run with: set -a && source .env.local && set +a && npx tsx scripts/mmhg-network-spy.ts
 *
 * Flow:
 *  1. /details?postcode=HG1+2ER embeds Typeform MEQgnPLV with postcode_2 param
 *  2. Typeform skips postcode Q (already filled) and shows property type first
 *  3. Questions: property type → why interested → what to achieve → more Qs → submit
 *  4. After Typeform completes, redirect to platform.makemyhousegreen.com/process_typef
 */

import { chromium, type Page, type Frame } from "playwright";

const POSTCODE = "HG1 2ER";

interface CapturedCall {
  url: string;
  method: string;
  postData: string | null;
  responseStatus: number | null;
  responseBody: string | null;
  timestamp: number;
}

const NOISE_PATTERNS = [
  ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".webp", ".avif",
  ".woff", ".woff2", ".ttf", ".eot", ".otf",
  ".css", ".map",
  "google-analytics", "googletagmanager", "gtag/", "ga.js", "ga-audiences",
  "analytics.google", "region1.analytics",
  "posthog", "segment.io", "mixpanel",
  "intercom", "crisp.chat", "drift", "hubspot", "hscollectedforms",
  "hs-scripts", "hs-banner", "hsadspixel",
  "sentry", "bugsnag",
  "hotjar", "clarity.ms",
  "onetrust", "cookiebot", "trustarc", "consentcdn",
  "trustpilot",
  "facebook.com", "fbevents", "connect.facebook",
  "doubleclick", "googlesyndication", "bing.net", "bat.bing",
  "fonts.googleapis", "fonts.gstatic",
  "maps.googleapis",
  "cdn.jsdelivr", "unpkg.com", "cdnjs.cloudflare",
  "recaptcha", "hcaptcha",
  "stripe.com/v3",
  "youtube.com", "ytimg", "ytembeds",
  "reddit.com", "pixel-config", "redditstatic",
  "pdscrb.com",
  "webfont.js",
  "cdn.prod.website-files.com",
  "jnn-pa.googleapis",
  "d3e54v103j8qbb.cloudfront.net",
  "utt.impactcdn.com",
  "d34r8q7sht0t9k.cloudfront.net",
  "google.com/pagead", "google.co.uk/pagead",
  "google.com/rmkt", "google.com/js/",
  "hubapi.com",
  "renderer-assets.typeform.com",
  "embed.typeform.com/embed",
  "images.typeform.com",
  "tracking.typeform.com",
];

const INTERESTING_DOMAINS = [
  "makemyhousegreen.com",
  "platform.makemyhousegreen.com",
  "app.makemyhousegreen.com",
  "api.makemyhousegreen.com",
  "form.typeform.com",
];

function isNoise(url: string): boolean {
  const lower = url.toLowerCase();
  return NOISE_PATTERNS.some((p) => lower.includes(p));
}

function isInteresting(url: string): boolean {
  return INTERESTING_DOMAINS.some((d) => url.includes(d));
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const browser = await chromium.launch({ headless: false, slowMo: 40 });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    locale: "en-GB",
    timezoneId: "Europe/London",
  });

  const page = await context.newPage();
  const apiCalls: CapturedCall[] = [];
  const urlHistory: string[] = [];

  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) {
      urlHistory.push(frame.url());
      console.log(`  [NAV] ${frame.url()}`);
    }
  });

  page.on("response", async (response) => {
    const url = response.url();
    if (isNoise(url)) return;

    const request = response.request();
    const interesting = isInteresting(url);

    let body: string | null = null;
    if (interesting) {
      try { body = await response.text(); } catch {}
    }

    apiCalls.push({
      url,
      method: request.method(),
      postData: request.postData() || null,
      responseStatus: response.status(),
      responseBody: body ? body.slice(0, 2000) : null,
      timestamp: Date.now(),
    });

    // Log non-asset API calls
    if (interesting && !url.includes(".js") && !url.includes(".css") && !url.includes("xa5e8du3i6yd")) {
      console.log(`  [API] ${request.method()} ${url.slice(0, 140)} => ${response.status()}`);
    }
  });

  // ─── STEP 1: Navigate to /details with postcode ───
  console.log("\n=== STEP 1: Navigate to details page ===\n");
  await page.goto(`https://makemyhousegreen.com/details?postcode=${encodeURIComponent(POSTCODE)}`, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  await sleep(5000);

  // Dismiss cookies via JS
  await page.evaluate(() => {
    const links = document.querySelectorAll("a");
    for (const link of links) {
      if (link.textContent?.trim() === "OK" && link.href.includes("javascript:void")) {
        link.click();
        return;
      }
    }
  });
  await sleep(1000);

  // ─── STEP 2: Find Typeform iframe ───
  console.log("\n=== STEP 2: Find Typeform iframe ===\n");
  await page.waitForSelector('iframe[src*="typeform.com"]', { timeout: 15000 }).catch(() => null);
  await sleep(3000);

  let typeformFrame: Frame | null = null;
  for (const frame of page.frames()) {
    if (frame.url().includes("form.typeform.com")) {
      typeformFrame = frame;
      console.log(`  Found Typeform: ${frame.url().slice(0, 100)}...`);
      break;
    }
  }

  if (!typeformFrame) {
    console.log("  ERROR: Typeform not found!");
    await printResults(apiCalls, urlHistory, page);
    await browser.close();
    return;
  }

  // ─── STEP 3: Fill Typeform using keyboard shortcuts ───
  // Typeform uses keyboard shortcuts: A/B/C/D/E/F/G for choices, Enter to confirm
  // The form shows one question at a time and scrolls to the active one
  console.log("\n=== STEP 3: Fill Typeform via keyboard ===\n");

  // The postcode is pre-filled from URL param. First visible Q is property type.
  // Q1: Property type — "Multi storey house" is option B
  console.log("  Q1: Property type -> pressing B (Multi storey house)");
  await typeformFrame.locator("body").press("b");
  await sleep(2000);

  // After selecting, need to press Enter or click OK to advance
  // Try pressing Enter
  await typeformFrame.locator("body").press("Enter");
  await sleep(3000);

  // Q2: "Why are you most interested in solar?" — multi-select
  // Options: A=save money, B=help environment, C=upgrade house, D=protect against price rises
  // Select A (save money) then press Enter/OK to continue
  console.log("  Q2: Why interested -> pressing A (save money)");
  await typeformFrame.locator("body").press("a");
  await sleep(1000);
  // For multi-select, press Enter/OK to submit
  await typeformFrame.locator("body").press("Enter");
  await sleep(3000);

  // Q3: "What do you want to achieve right now?"
  // A=know if solar is suitable, B=see future savings, C=get a price/quote quickly
  // D=get solar designs, E=get answers, F=find best installer
  console.log("  Q3: What to achieve -> pressing C (get a price/quote quickly)");
  await typeformFrame.locator("body").press("c").catch(() => console.log("    (frame may have navigated)"));
  await sleep(1000);
  await typeformFrame.locator("body").press("Enter").catch(() => console.log("    (frame may have navigated)"));
  await sleep(5000);

  // ─── STEP 4: Continue answering remaining questions ───
  console.log("\n=== STEP 4: Continue answering questions ===\n");

  // Check if we already got redirected (short forms may do this after Q3)
  if (page.url().includes("platform.makemyhousegreen") || page.url().includes("process_typef")) {
    console.log(`  Already redirected to platform: ${page.url()}`);
  }

  for (let round = 0; round < 15; round++) {
    await sleep(1500);

    // Check if we've been redirected
    if (page.url().includes("platform.makemyhousegreen") || page.url().includes("process_typef")) {
      console.log(`  Redirected to platform: ${page.url()}`);
      break;
    }

    // Check if the typeform frame is still accessible
    const frameStillAlive = await typeformFrame!.evaluate(() => true).catch(() => false);
    if (!frameStillAlive) {
      console.log("  Typeform frame no longer accessible (probably redirected)");
      break;
    }

    // Read current question from the Typeform
    const currentContent = await typeformFrame!.evaluate(() => {
      // Find the currently visible/active question block
      const blocks = document.querySelectorAll('[data-qa*="block"]');
      for (const block of blocks) {
        const rect = (block as HTMLElement).getBoundingClientRect();
        // Check if block is in viewport
        if (rect.top >= -50 && rect.top < 600 && rect.height > 50) {
          return {
            text: block.textContent?.slice(0, 500) || "",
            hasInput: !!block.querySelector('input:not([type="hidden"])'),
            inputType: block.querySelector('input:not([type="hidden"])')?.getAttribute("type") || null,
            hasChoices: !!block.querySelector('[data-qa*="choice"]'),
            choiceCount: block.querySelectorAll('[data-qa*="choice"]').length,
            hasSubmit: !!block.querySelector('button[type="submit"]'),
          };
        }
      }
      // Fallback: return full body text
      return {
        text: document.body.innerText?.slice(0, 500) || "",
        hasInput: !!document.querySelector('input[type="text"]:not([tabindex="-1"])'),
        inputType: null,
        hasChoices: false,
        choiceCount: 0,
        hasSubmit: !!document.querySelector('button[type="submit"]'),
      };
    }).catch(() => ({
      text: "", hasInput: false, inputType: null, hasChoices: false, choiceCount: 0, hasSubmit: false,
    }));

    const lower = currentContent.text.toLowerCase();
    console.log(`  Round ${round + 4}: ${currentContent.text.slice(0, 150)}`);
    console.log(`    hasInput=${currentContent.hasInput} hasChoices=${currentContent.hasChoices}(${currentContent.choiceCount}) hasSubmit=${currentContent.hasSubmit}`);

    if (lower.includes("thank") || lower.includes("complete") || lower.includes("redirecting") || lower.includes("we'll be in touch")) {
      console.log("  Form appears complete!");
      break;
    }

    // Handle text input questions
    if (currentContent.hasInput) {
      const input = typeformFrame!.locator('input[type="text"]:visible, input[type="email"]:visible, input[type="tel"]:visible, input[type="number"]:visible').first();
      if (await input.isVisible({ timeout: 2000 }).catch(() => false)) {
        if (lower.includes("email")) {
          console.log("    Entering email");
          await input.pressSequentially("test@example.com", { delay: 30 });
        } else if (lower.includes("phone") || lower.includes("number") || lower.includes("mobile")) {
          console.log("    Entering phone");
          await input.pressSequentially("07700900123", { delay: 30 });
        } else if (lower.includes("name")) {
          if (lower.includes("first") || lower.includes("your name")) {
            console.log("    Entering name");
            await input.pressSequentially("Test", { delay: 30 });
          } else {
            console.log("    Entering surname");
            await input.pressSequentially("User", { delay: 30 });
          }
        } else if (lower.includes("postcode")) {
          console.log("    Entering postcode");
          await input.pressSequentially(POSTCODE, { delay: 30 });
        } else {
          console.log("    Unknown text input, entering generic value");
          await input.pressSequentially("Test", { delay: 30 });
        }
        await sleep(500);
        await typeformFrame!.locator("body").press("Enter");
        await sleep(3000);
        continue;
      }
    }

    // Handle choice questions via keyboard
    if (currentContent.hasChoices && currentContent.choiceCount > 0) {
      // Default: pick option A unless we can match a better one
      if (lower.includes("electricity") || lower.includes("spend") || lower.includes("bill") || lower.includes("energy cost")) {
        // Try to find the £60-120 option — need to check which letter it is
        const choices = await typeformFrame!.evaluate(() => {
          const els = document.querySelectorAll('[data-qa*="choice"]');
          return Array.from(els)
            .filter(el => (el as HTMLElement).offsetHeight > 0 && (el as HTMLElement).getBoundingClientRect().top < 600)
            .map(el => el.textContent?.trim().slice(0, 80));
        }).catch(() => []);
        console.log(`    Electricity choices: ${JSON.stringify(choices)}`);

        // Find which option contains £60-120 or similar
        let letterIdx = 0; // default to A
        for (let i = 0; i < choices.length; i++) {
          const c = choices[i] || "";
          if (c.includes("£60") || c.includes("60") || c.includes("£61") || c.includes("Medium") || c.includes("£50")) {
            letterIdx = i;
            break;
          }
        }
        const letter = String.fromCharCode(97 + letterIdx); // a, b, c, etc.
        console.log(`    Selecting: ${letter.toUpperCase()} (index ${letterIdx})`);
        await typeformFrame!.locator("body").press(letter);
        await sleep(1000);
      } else if (lower.includes("property") || lower.includes("type of")) {
        console.log("    Selecting: B (Multi storey house)");
        await typeformFrame!.locator("body").press("b");
        await sleep(1000);
      } else {
        console.log("    Selecting: A (first option)");
        await typeformFrame!.locator("body").press("a");
        await sleep(1000);
      }

      // Press Enter to confirm
      await typeformFrame!.locator("body").press("Enter");
      await sleep(3000);
      continue;
    }

    // Handle submit button
    if (currentContent.hasSubmit) {
      console.log("    Clicking submit button");
      const submitBtn = typeformFrame!.locator('button[type="submit"]').first();
      await submitBtn.click({ timeout: 5000 }).catch(async () => {
        // Fallback: press Enter
        await typeformFrame!.locator("body").press("Enter");
      });
      await sleep(5000);
      continue;
    }

    // Nothing found — try pressing Enter to see if we can advance
    console.log("    No actionable element, pressing Enter");
    await typeformFrame!.locator("body").press("Enter").catch(() => {});
    await sleep(2000);
  }

  // ─── STEP 5: Wait for redirect to platform ───
  console.log("\n=== STEP 5: Wait for redirect to platform ===\n");

  for (let i = 0; i < 30; i++) {
    const currentUrl = page.url();
    if (currentUrl.includes("platform.makemyhousegreen") || currentUrl.includes("process_typef")) {
      console.log(`  Redirected to: ${currentUrl}`);
      await sleep(10000); // Wait for platform API calls
      break;
    }

    // Also check if the Typeform is showing a redirect/thank you
    const tfText = await typeformFrame?.evaluate(() => document.body?.innerText?.slice(0, 300) || "").catch(() => "");
    if (tfText && (tfText.includes("redirect") || tfText.includes("thank you"))) {
      console.log(`  Typeform completed: ${tfText.slice(0, 200)}`);
    }

    await sleep(1000);
  }

  console.log(`\n  Final URL: ${page.url()}`);

  // If on platform, capture page content
  if (page.url().includes("platform.makemyhousegreen")) {
    await sleep(5000);
    const platformText = await page.evaluate(() => document.body.innerText.slice(0, 3000));
    console.log("\n  Platform page text:", platformText.slice(0, 2000));
  }

  // ─── PRINT RESULTS ───
  await printResults(apiCalls, urlHistory, page);

  console.log("\nClosing in 10 seconds...");
  await sleep(10000);
  await browser.close();
}

async function printResults(apiCalls: CapturedCall[], urlHistory: string[], page: Page) {
  console.log("\n" + "=".repeat(80));
  console.log("=== CAPTURED API CALLS — FULL REPORT ===");
  console.log("=".repeat(80) + "\n");

  const interestingCalls = apiCalls.filter((c) => isInteresting(c.url));

  // Filter to only meaningful calls (not JS/CSS/GTM)
  const meaningfulCalls = interestingCalls.filter(c => {
    if (c.url.includes("xa5e8du3i6yd")) return false; // GTM
    if (c.responseBody?.startsWith("!function") || c.responseBody?.startsWith("/*! Build")) return false; // JS
    if (c.responseBody?.startsWith("<!DOCTYPE") || c.responseBody?.startsWith("<html")) return false; // HTML
    return true;
  });

  const htmlPages = interestingCalls.filter(c =>
    c.responseBody?.startsWith("<!DOCTYPE") || c.responseBody?.startsWith("<html")
  );

  console.log(`Total captured: ${apiCalls.length} | Interesting: ${interestingCalls.length} | Meaningful API: ${meaningfulCalls.length}\n`);

  console.log("─── API CALLS (excluding HTML pages, JS/CSS, GTM) ───\n");
  for (const call of meaningfulCalls) {
    console.log(`${call.method} ${call.url}`);
    console.log(`  Status: ${call.responseStatus}`);
    if (call.postData) console.log(`  Request body: ${call.postData.slice(0, 1000)}`);
    if (call.responseBody) {
      const lc = call.responseBody.toLowerCase();
      const isPricing = ["price","panel","battery","quote","cost","kwh","tariff","saving","install","solar","£","gbp","annual","generation","payback","roi","system_size","carbon","address","postcode"].some(k => lc.includes(k));
      if (isPricing) console.log(`  *** LIKELY PRICING/QUOTE/ADDRESS DATA ***`);
      console.log(`  Response body:\n${call.responseBody.slice(0, 2000)}`);
    }
    console.log();
  }

  console.log("─── HTML PAGE LOADS ───\n");
  for (const call of htmlPages) {
    console.log(`  ${call.method} ${call.url}  => ${call.responseStatus}`);
  }

  console.log("\n─── URL HISTORY ───\n");
  for (const url of urlHistory) console.log(`  ${url}`);

  console.log(`\n  Final URL: ${page.url()}`);
}

main().catch(console.error);
