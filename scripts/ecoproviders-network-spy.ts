/**
 * Spy on Eco Providers' solar quote form network requests to find pricing API endpoints.
 * Run with: set -a && source .env.local && set +a && npx tsx scripts/ecoproviders-network-spy.ts
 *
 * Navigates through the WordPress quote form, fills in details, and captures
 * all XHR/fetch requests — especially wp-admin/admin-ajax.php calls.
 */

import { chromium } from "playwright";

const POSTCODE = "PR1 0AS";
const CONTACT = {
  title: "Mrs",
  firstName: "Sarah",
  lastName: "Mitchell",
  email: "sarah.mitchell2847@gmail.com",
  phone: "07482391057",
};

async function main() {
  const browser = await chromium.launch({ headless: false, slowMo: 150 });
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
    timestamp: number;
  }> = [];

  page.on("response", async (response) => {
    const url = response.url();
    const request = response.request();

    // Skip static assets, analytics, images, fonts, tracking
    const skipPatterns = [
      ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".webp",
      ".woff", ".woff2", ".ttf", ".eot",
      ".css",
      "google-analytics", "googletagmanager", "gtag", "ga.js",
      "facebook.com", "fbevents", "fb.com",
      "doubleclick", "googlesyndication",
      "hotjar", "clarity.ms",
      "fonts.googleapis", "fonts.gstatic",
      "gravatar.com",
      "maps.googleapis",
      "recaptcha",
      "gstatic.com/recaptcha",
      "hubspot.com",
      "hs-analytics",
      "hs-scripts",
      "hsforms",
      "stripe.com",
      "trustpilot.com",
    ];

    if (skipPatterns.some((p) => url.includes(p))) {
      return;
    }

    // Also skip JS files unless they're from ecoproviders and look like API endpoints
    if (url.endsWith(".js") && !url.includes("admin-ajax")) {
      return;
    }

    let body: string | null = null;
    try {
      body = await response.text();
    } catch {
      /* can't read body */
    }

    apiCalls.push({
      url,
      method: request.method(),
      postData: request.postData() || null,
      responseStatus: response.status(),
      responseBody: body ? body.slice(0, 2000) : null,
      timestamp: Date.now(),
    });

    // Log interesting calls in real-time
    if (url.includes("admin-ajax.php") || url.includes("submit.php") || url.includes("/api/")) {
      console.log(`\n>>> ${request.method()} ${url}`);
      if (request.postData()) {
        console.log(`    POST body: ${request.postData()?.slice(0, 500)}`);
      }
      console.log(`    Status: ${response.status()}`);
      if (body) {
        console.log(`    Response: ${body.slice(0, 500)}`);
      }
    }
  });

  // ==== Step 1: Navigate ====
  console.log("1. Navigating to Eco Providers solar quote form...\n");
  await page.goto("https://www.ecoproviders.co.uk/solar-fixed-quote-form/", {
    waitUntil: "domcontentloaded",
  });
  await page.waitForTimeout(3000);

  // ==== Step 2: Dismiss cookie banner ====
  console.log("2. Dismissing cookie banner...\n");
  const cookieBtn = page.locator("#hs-eu-confirmation-button").first();
  if (await cookieBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await cookieBtn.click();
    console.log("   Dismissed HubSpot cookie banner.");
    await page.waitForTimeout(1000);
  } else {
    // Try generic
    for (const sel of ['button:has-text("Accept")', 'button:has-text("Accept All")']) {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 1000 }).catch(() => false)) {
        await btn.click();
        console.log(`   Clicked: ${sel}`);
        await page.waitForTimeout(1000);
        break;
      }
    }
  }

  // ==== Step 3: Fill postcode ====
  console.log("3. Filling postcode...\n");
  const postcodeInput = page.locator('input[name="postcode"]');
  await postcodeInput.fill(POSTCODE);
  await page.waitForTimeout(1000);

  // The form has a "Select address" dropdown that auto-populates after postcode entry.
  // Wait for the address dropdown to populate
  console.log("   Waiting for address dropdown to populate...\n");
  await page.waitForTimeout(2000);

  // Look at the address select
  const addressSelect = page.locator('select').first();
  const addressOptions = await page.evaluate(() => {
    const selects = document.querySelectorAll("select");
    const results: string[] = [];
    selects.forEach((sel, i) => {
      const opts = Array.from(sel.options).map((o) => `value="${o.value}" text="${o.text}"`);
      results.push(`Select ${i} (id=${sel.id}, name=${sel.name}): ${opts.length} options`);
      opts.forEach((o) => results.push(`  ${o}`));
    });
    return results.join("\n");
  });
  console.log("   Address selects found:");
  console.log(addressOptions);

  // The postcode lookup might need the "postcodeNxt" button click or the address appears automatically
  // Let's check if there's an address selection dropdown
  // From the screenshot, there's a "Select address" dropdown
  // Let's look for it and select the first real address
  const addrDropdown = page.locator('select:visible').first();
  if (await addrDropdown.isVisible({ timeout: 2000 }).catch(() => false)) {
    // Wait for options to load (they might be loaded via AJAX)
    await page.waitForTimeout(2000);

    const optionCount = await addrDropdown.locator("option").count();
    console.log(`   Address dropdown has ${optionCount} options`);

    if (optionCount > 1) {
      // Select the first non-placeholder option
      await addrDropdown.selectOption({ index: 1 });
      console.log("   Selected first address");
      await page.waitForTimeout(2000);
    } else {
      // Maybe the dropdown gets populated after some trigger
      // Check if there's a "Find address" or search button
      const findBtn = page.locator('button:has-text("Find"), button:has-text("Search"), button:has-text("Look up")').first();
      if (await findBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
        await findBtn.click();
        console.log("   Clicked Find/Search button");
        await page.waitForTimeout(3000);
      }

      // Try selecting again
      const newOptionCount = await addrDropdown.locator("option").count();
      console.log(`   After search, dropdown has ${newOptionCount} options`);
      if (newOptionCount > 1) {
        await addrDropdown.selectOption({ index: 1 });
        console.log("   Selected first address after search");
        await page.waitForTimeout(2000);
      }
    }
  }

  await page.screenshot({ path: "/tmp/ecoproviders-after-address.png" });

  // Check if Next button is now enabled
  const nextBtn = page.locator("#postcodeNxt");
  const isEnabled = await nextBtn.evaluate((el) => !(el as HTMLButtonElement).disabled).catch(() => false);
  console.log(`   Next button enabled: ${isEnabled}`);

  if (!isEnabled) {
    // Debug: what's the current state of the form?
    const formState = await page.evaluate(() => {
      const form = document.getElementById("solar-form") as HTMLFormElement;
      if (!form) return "Form not found";
      const data = new FormData(form);
      const entries: string[] = [];
      data.forEach((value, key) => entries.push(`${key}=${value}`));
      return entries.join("\n");
    });
    console.log("   Current form state:");
    console.log(formState);

    // Try force-clicking the Next button
    console.log("   Attempting force-click on Next...");
    await nextBtn.evaluate((el) => {
      (el as HTMLButtonElement).disabled = false;
      (el as HTMLElement).click();
    });
    await page.waitForTimeout(2000);
  } else {
    // Click Next normally
    await nextBtn.click();
    await page.waitForTimeout(2000);
  }

  await page.screenshot({ path: "/tmp/ecoproviders-step3.png" });

  // ==== Step 4: Roof type and material ====
  console.log("\n4. Selecting roof type and material...\n");

  // Check what's visible now
  const currentStep = await page.evaluate(() => {
    const visible: string[] = [];
    document.querySelectorAll("input, select, button, label, h1, h2, h3, h4, p").forEach((el) => {
      const htmlEl = el as HTMLElement;
      if (htmlEl.offsetParent !== null && htmlEl.innerText?.trim()) {
        const tag = el.tagName.toLowerCase();
        const type = el.getAttribute("type") || "";
        const name = el.getAttribute("name") || "";
        const value = el.getAttribute("value") || "";
        const text = htmlEl.innerText?.slice(0, 100) || "";
        visible.push(`<${tag}> type="${type}" name="${name}" value="${value}" "${text}"`);
      }
    });
    return visible.join("\n");
  });
  console.log("   Visible elements:");
  console.log(currentStep);

  // Select "Pitched" roof type - it's a radio button
  try {
    // Click the label that contains "Pitched"
    const pitched = page.locator('label:has-text("Pitched")').first();
    if (await pitched.isVisible({ timeout: 3000 }).catch(() => false)) {
      await pitched.click();
      console.log("   Clicked Pitched label");
    } else {
      // Try clicking the radio directly
      await page.evaluate(() => {
        const radios = document.querySelectorAll('input[name="roof_type"]');
        radios.forEach((r) => {
          const label = r.parentElement?.textContent?.trim() || "";
          if (label.toLowerCase().includes("pitched")) {
            (r as HTMLInputElement).checked = true;
            r.dispatchEvent(new Event("change", { bubbles: true }));
          }
        });
      });
      console.log("   Set Pitched via JS");
    }
    await page.waitForTimeout(1000);
  } catch (e) {
    console.log("   Failed to select Pitched:", e);
  }

  // Click Next to go to material selection
  const allNextBtns = await page.locator("#nextBtn").all();
  for (const btn of allNextBtns) {
    if (await btn.isVisible({ timeout: 500 }).catch(() => false)) {
      const disabled = await btn.evaluate((el) => (el as HTMLButtonElement).disabled);
      console.log(`   Found visible nextBtn, disabled=${disabled}`);
      if (!disabled) {
        await btn.click();
        console.log("   Clicked nextBtn");
        await page.waitForTimeout(1500);
        break;
      } else {
        // Force click
        await btn.evaluate((el) => {
          (el as HTMLButtonElement).disabled = false;
          (el as HTMLElement).click();
        });
        console.log("   Force-clicked nextBtn");
        await page.waitForTimeout(1500);
        break;
      }
    }
  }

  await page.screenshot({ path: "/tmp/ecoproviders-step4-after-rooftype.png" });

  // Now select "Concrete" material
  console.log("\n   Selecting roof material...");
  const step4Elements = await page.evaluate(() => {
    const visible: string[] = [];
    document.querySelectorAll("input, select, label, h2, h3, p").forEach((el) => {
      const htmlEl = el as HTMLElement;
      if (htmlEl.offsetParent !== null) {
        const tag = el.tagName.toLowerCase();
        const type = el.getAttribute("type") || "";
        const name = el.getAttribute("name") || "";
        const value = el.getAttribute("value") || "";
        const text = htmlEl.innerText?.slice(0, 100) || "";
        visible.push(`<${tag}> type="${type}" name="${name}" value="${value}" "${text}"`);
      }
    });
    return visible.join("\n");
  });
  console.log(step4Elements);

  try {
    const concrete = page.locator('label:has-text("Concrete")').first();
    if (await concrete.isVisible({ timeout: 3000 }).catch(() => false)) {
      await concrete.click();
      console.log("   Clicked Concrete label");
    } else {
      await page.evaluate(() => {
        const radios = document.querySelectorAll('input[name="roof_made_of"]');
        radios.forEach((r) => {
          const label = r.parentElement?.textContent?.trim() || "";
          if (label.toLowerCase().includes("concrete")) {
            (r as HTMLInputElement).checked = true;
            r.dispatchEvent(new Event("change", { bubbles: true }));
          }
        });
      });
      console.log("   Set Concrete via JS");
    }
    await page.waitForTimeout(1000);
  } catch (e) {
    console.log("   Failed to select Concrete:", e);
  }

  // Click Next
  const nextBtns2 = await page.locator("#nextBtn").all();
  for (const btn of nextBtns2) {
    if (await btn.isVisible({ timeout: 500 }).catch(() => false)) {
      await btn.click().catch(() => btn.evaluate((el) => (el as HTMLElement).click()));
      console.log("   Clicked nextBtn after material");
      await page.waitForTimeout(1500);
      break;
    }
  }

  await page.screenshot({ path: "/tmp/ecoproviders-step4-after-material.png" });

  // ==== Step 5: Contact details ====
  console.log("\n5. Filling contact details...\n");
  await page.waitForTimeout(1000);

  const step5Elements = await page.evaluate(() => {
    const visible: string[] = [];
    document.querySelectorAll("input, select, label, h2, h3, button").forEach((el) => {
      const htmlEl = el as HTMLElement;
      if (htmlEl.offsetParent !== null) {
        const tag = el.tagName.toLowerCase();
        const type = el.getAttribute("type") || "";
        const name = el.getAttribute("name") || "";
        const placeholder = el.getAttribute("placeholder") || "";
        const text = htmlEl.innerText?.slice(0, 60) || "";
        visible.push(`<${tag}> type="${type}" name="${name}" placeholder="${placeholder}" "${text}"`);
      }
    });
    return visible.join("\n");
  });
  console.log("   Current visible elements:");
  console.log(step5Elements);

  // Fill title
  const salutation = page.locator('#salutation, select[name="salutation"]').first();
  if (await salutation.isVisible({ timeout: 2000 }).catch(() => false)) {
    await salutation.selectOption({ label: CONTACT.title });
    console.log("   Selected title: Mrs");
    await page.waitForTimeout(500);
  }

  // Fill first name
  const firstName = page.locator('input[name="first_name"]').first();
  if (await firstName.isVisible({ timeout: 2000 }).catch(() => false)) {
    await firstName.fill(CONTACT.firstName);
    console.log("   Filled first name");
  }

  // Fill last name
  const lastName = page.locator('input[name="last_name"]').first();
  if (await lastName.isVisible({ timeout: 2000 }).catch(() => false)) {
    await lastName.fill(CONTACT.lastName);
    console.log("   Filled last name");
  }

  // Fill email
  const email = page.locator('input[name="email"], input[type="email"]').first();
  if (await email.isVisible({ timeout: 2000 }).catch(() => false)) {
    await email.fill(CONTACT.email);
    console.log("   Filled email");
  }

  // Fill phone
  const phone = page.locator('input[name="telephone"], input[type="tel"]').first();
  if (await phone.isVisible({ timeout: 2000 }).catch(() => false)) {
    await phone.fill(CONTACT.phone);
    console.log("   Filled phone");
  }

  await page.screenshot({ path: "/tmp/ecoproviders-step5-contact.png" });

  // ==== Step 6: Electricity usage ====
  console.log("\n6. Selecting electricity usage...\n");

  // This might be on the same page or the next one
  // First check if it's visible
  let foundMedium = false;
  const mediumLabel = page.locator('label:has-text("Medium")').first();
  if (await mediumLabel.isVisible({ timeout: 1000 }).catch(() => false)) {
    await mediumLabel.click();
    console.log("   Clicked Medium label");
    foundMedium = true;
    await page.waitForTimeout(1000);
  }

  if (!foundMedium) {
    // Click Next to get to usage page first
    const nextBtns3 = await page.locator("#nextBtn").all();
    for (const btn of nextBtns3) {
      if (await btn.isVisible({ timeout: 500 }).catch(() => false)) {
        await btn.click().catch(() => btn.evaluate((el) => (el as HTMLElement).click()));
        console.log("   Clicked nextBtn to get to usage page");
        await page.waitForTimeout(2000);
        break;
      }
    }

    await page.screenshot({ path: "/tmp/ecoproviders-step6-pre-usage.png" });

    // Now look for Medium
    const step6Elements = await page.evaluate(() => {
      const visible: string[] = [];
      document.querySelectorAll("input, select, label, h2, h3, button, div, span").forEach((el) => {
        const htmlEl = el as HTMLElement;
        if (htmlEl.offsetParent !== null) {
          const tag = el.tagName.toLowerCase();
          const type = el.getAttribute("type") || "";
          const name = el.getAttribute("name") || "";
          const text = htmlEl.innerText?.slice(0, 80) || "";
          if (name || type === "radio" || type === "submit" || tag === "h2" || tag === "h3" || text.toLowerCase().includes("usage") || text.toLowerCase().includes("medium") || text.toLowerCase().includes("electricity")) {
            visible.push(`<${tag}> type="${type}" name="${name}" "${text}"`);
          }
        }
      });
      return visible.join("\n");
    });
    console.log("   Visible elements:");
    console.log(step6Elements);

    // Try clicking Medium
    const mediumLabel2 = page.locator('label:has-text("Medium")').first();
    if (await mediumLabel2.isVisible({ timeout: 2000 }).catch(() => false)) {
      await mediumLabel2.click();
      console.log("   Clicked Medium label");
      foundMedium = true;
    } else {
      // Try via JS
      await page.evaluate(() => {
        const radios = document.querySelectorAll('input[name="electricity_usage"]');
        radios.forEach((r) => {
          const val = (r as HTMLInputElement).value.toLowerCase();
          const label = r.parentElement?.textContent?.trim().toLowerCase() || "";
          if (val.includes("medium") || label.includes("medium")) {
            (r as HTMLInputElement).checked = true;
            r.dispatchEvent(new Event("change", { bubbles: true }));
            r.dispatchEvent(new Event("input", { bubbles: true }));
          }
        });
      });
      console.log("   Set Medium via JS");
      foundMedium = true;
    }
    await page.waitForTimeout(1000);
  }

  // Click Next
  const nextBtns4 = await page.locator("#nextBtn").all();
  for (const btn of nextBtns4) {
    if (await btn.isVisible({ timeout: 500 }).catch(() => false)) {
      await btn.click().catch(() => btn.evaluate((el) => (el as HTMLElement).click()));
      console.log("   Clicked nextBtn after usage");
      await page.waitForTimeout(3000);
      break;
    }
  }

  await page.screenshot({ path: "/tmp/ecoproviders-step6-after-usage.png" });

  // ==== Step 7: Wait for pricing ====
  console.log("\n7. Waiting for pricing to appear...\n");

  // Check what's on screen now
  for (let i = 0; i < 20; i++) {
    const currentElements = await page.evaluate(() => {
      const visible: string[] = [];
      document.querySelectorAll("h1, h2, h3, h4, p, span, div, input, button").forEach((el) => {
        const htmlEl = el as HTMLElement;
        if (htmlEl.offsetParent !== null) {
          const text = htmlEl.innerText?.trim().slice(0, 100) || "";
          const id = el.id || "";
          const name = el.getAttribute("name") || "";
          if (
            text.includes("£") ||
            text.toLowerCase().includes("price") ||
            text.toLowerCase().includes("quote") ||
            text.toLowerCase().includes("cost") ||
            text.toLowerCase().includes("panel") ||
            text.toLowerCase().includes("package") ||
            text.toLowerCase().includes("total") ||
            id.includes("Cost") ||
            id.includes("price") ||
            id.includes("panel") ||
            name.includes("panel") ||
            name.includes("cost")
          ) {
            visible.push(`<${el.tagName.toLowerCase()} id="${id}" name="${name}"> "${text.slice(0, 150)}"`);
          }
        }
      });
      return visible;
    });

    if (currentElements.length > 0) {
      console.log("   Pricing elements found!");
      currentElements.forEach((el) => console.log(`   ${el}`));
      break;
    }

    // Also try clicking any remaining Next/Submit buttons
    if (i === 5 || i === 10) {
      const btns = await page.locator("#nextBtn, #reserve, button[type='submit'], input[type='submit']").all();
      for (const btn of btns) {
        if (await btn.isVisible({ timeout: 300 }).catch(() => false)) {
          const text = await btn.evaluate((el) => el.textContent?.trim() || el.id);
          console.log(`   Clicking visible button: ${text}`);
          await btn.click().catch(() => btn.evaluate((el) => (el as HTMLElement).click()));
          await page.waitForTimeout(2000);
        }
      }
    }

    await page.waitForTimeout(1000);
  }

  await page.screenshot({ path: "/tmp/ecoproviders-step7-pricing.png" });

  // Get a broader view of what we're seeing
  const pageText = await page.evaluate(() => document.body.innerText);
  console.log("\n   Page text (first 3000 chars):");
  console.log(pageText.slice(0, 3000));

  // Also check hidden pricing fields
  const hiddenFields = await page.evaluate(() => {
    const fields: string[] = [];
    document.querySelectorAll("input[type='hidden'], input#totalCost, input#totalSavings, input#panelCount, input#final_cost, input#final_products").forEach((el) => {
      const inp = el as HTMLInputElement;
      fields.push(`${inp.id || inp.name}: "${inp.value}"`);
    });
    return fields;
  });
  console.log("\n   Hidden/pricing fields:");
  hiddenFields.forEach((f) => console.log(`   ${f}`));

  // Check for any window/global state
  const windowState = await page.evaluate(() => {
    const interesting: Record<string, string> = {};
    for (const key of Object.keys(window)) {
      if (
        key.startsWith("__") ||
        key.includes("state") ||
        key.includes("store") ||
        key.includes("data") ||
        key.includes("quote") ||
        key.includes("price") ||
        key.includes("config") ||
        key.includes("wp") ||
        key.includes("ajax") ||
        key.includes("solar") ||
        key.includes("eco")
      ) {
        try {
          const val = JSON.stringify((window as any)[key]);
          if (val && val.length > 2 && val.length < 5000) {
            interesting[key] = val.slice(0, 1000);
          }
        } catch {
          /* can't serialize */
        }
      }
    }
    return interesting;
  });

  // ==== Print final results ====
  console.log("\n\n========================================");
  console.log("=== ALL API/AJAX CALLS (filtered) ===");
  console.log("========================================\n");

  const ecoProvidersCalls = apiCalls.filter((c) => c.url.includes("ecoproviders.co.uk"));
  const adminAjaxCalls = apiCalls.filter((c) => c.url.includes("admin-ajax.php"));
  const otherCalls = apiCalls.filter((c) => !c.url.includes("ecoproviders.co.uk"));

  console.log(`--- EcoProviders.co.uk calls (${ecoProvidersCalls.length}) ---\n`);
  for (const call of ecoProvidersCalls) {
    console.log(`${call.method} ${call.url}`);
    if (call.postData) {
      console.log(`  POST body: ${call.postData.slice(0, 1000)}`);
    }
    if (call.responseBody) {
      const isPricing =
        call.responseBody.toLowerCase().includes("price") ||
        call.responseBody.includes("£") ||
        call.responseBody.toLowerCase().includes("quote") ||
        call.responseBody.toLowerCase().includes("cost") ||
        call.responseBody.toLowerCase().includes("panel") ||
        call.responseBody.toLowerCase().includes("battery") ||
        call.responseBody.toLowerCase().includes("kwh") ||
        call.responseBody.toLowerCase().includes("kwp");

      if (isPricing) {
        console.log(`  *** LIKELY PRICING DATA ***`);
      }
      if (call.url.includes("admin-ajax.php")) {
        console.log(`  *** WP ADMIN-AJAX ***`);
      }
      console.log(`  Response (${call.responseStatus}): ${call.responseBody.slice(0, 2000)}`);
    } else {
      console.log(`  Response (${call.responseStatus}): [no body]`);
    }
    console.log();
  }

  if (adminAjaxCalls.length > 0) {
    console.log(`\n--- ADMIN-AJAX CALLS DETAIL (${adminAjaxCalls.length}) ---\n`);
    for (const call of adminAjaxCalls) {
      console.log(`${call.method} ${call.url}`);
      console.log(`  POST body: ${call.postData || "[none]"}`);
      console.log(`  Response (${call.responseStatus}): ${call.responseBody?.slice(0, 2000) || "[none]"}`);
      console.log();
    }
  }

  console.log(`\n--- Other calls (${otherCalls.length}) ---\n`);
  for (const call of otherCalls) {
    console.log(`${call.method} ${call.url.slice(0, 200)}`);
    if (call.postData) {
      console.log(`  POST body: ${call.postData.slice(0, 300)}`);
    }
    console.log(`  Status: ${call.responseStatus}`);
    console.log();
  }

  console.log("\n--- Window/global state ---\n");
  for (const [key, val] of Object.entries(windowState)) {
    console.log(`${key}: ${val}`);
  }

  console.log(`\n\nSUMMARY`);
  console.log(`Total API calls captured: ${apiCalls.length}`);
  console.log(`EcoProviders calls: ${ecoProvidersCalls.length}`);
  console.log(`admin-ajax.php calls: ${adminAjaxCalls.length}`);

  console.log("\nDone. Closing in 10 seconds...");
  await new Promise((r) => setTimeout(r, 10000));
  await browser.close();
}

main().catch(console.error);
