import { chromium, type Browser, type Page, type BrowserContext } from "playwright";
import path from "path";
import fs from "fs/promises";

export interface ScraperResult {
  success: boolean;
  platform: string;
  rawData: Record<string, unknown> | null;
  screenshotPath: string | null;
  error: string | null;
}

export interface PropertyInput {
  address: string;
  postcode: string;
  propertyType?: string;
  bedrooms?: number;
  roofOrientation?: string;
  roofType?: string;
  annualElectricityUsage?: number;
  currentElectricityBill?: number;
  [key: string]: unknown;
}

const SCREENSHOT_DIR = path.join(process.cwd(), "tmp", "mystery-shopping-screenshots");

let browserInstance: Browser | null = null;

export async function getBrowser(): Promise<Browser> {
  if (browserInstance?.isConnected()) return browserInstance;
  browserInstance = await chromium.launch({
    headless: false,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
    ],
  });
  return browserInstance;
}

export async function closeBrowser(): Promise<void> {
  if (browserInstance?.isConnected()) {
    await browserInstance.close();
    browserInstance = null;
  }
}

export async function createContext(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({
    viewport: { width: 1280, height: 900 },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    locale: "en-GB",
    timezoneId: "Europe/London",
  });
}

export async function takeScreenshot(
  page: Page,
  name: string
): Promise<string> {
  await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
  const filename = `${name}-${Date.now()}.png`;
  const filepath = path.join(SCREENSHOT_DIR, filename);
  await page.screenshot({ path: filepath, fullPage: true });
  return filepath;
}

/**
 * Navigate to a page and wait for it to settle.
 * Handles cookie consent banners by clicking common accept buttons.
 */
export async function navigateAndSettle(
  page: Page,
  url: string,
  options?: { timeout?: number }
): Promise<void> {
  await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: options?.timeout ?? 30000,
  });

  // Try to dismiss cookie consent (best effort)
  try {
    const cookieSelectors = [
      'button:has-text("Accept")',
      'button:has-text("Accept All")',
      'button:has-text("Accept all")',
      'button:has-text("I agree")',
      'button:has-text("Got it")',
      '[id*="cookie"] button',
      '[class*="cookie"] button',
      '[id*="consent"] button',
    ];
    for (const sel of cookieSelectors) {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await btn.click();
        break;
      }
    }
  } catch {
    // Cookie banner dismissal is best-effort
  }

  // Wait for network to settle
  await page.waitForLoadState("networkidle").catch(() => {});
}

/**
 * Extract text content from the visible page, useful for AI parsing.
 */
export async function getPageText(page: Page): Promise<string> {
  return page.evaluate(() => {
    return document.body.innerText || "";
  });
}

/**
 * Try to find a calculator iframe and switch context to it.
 * Returns the frame's page if found, or null.
 */
export async function findCalculatorFrame(
  page: Page,
  platformHints: string[]
): Promise<Page | null> {
  const frames = page.frames();
  for (const frame of frames) {
    const url = frame.url().toLowerCase();
    if (platformHints.some((hint) => url.includes(hint))) {
      // Return the frame as a FrameLocator doesn't expose page-like API
      // Instead, we interact via the frame directly
      return null; // Callers should use page.frameLocator() instead
    }
  }
  return null;
}
