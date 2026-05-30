import { inngest } from "./client";
import { db } from "@/lib/db";
import {
  mysteryShopCampaigns,
  mysteryShopTargets,
  installers,
  websiteQuality,
} from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";

// ── Scrape Calculators ──────────────────────────────────────────
// Event-triggered: processes all calculator targets for a campaign

export const scrapeCalculators = inngest.createFunction(
  {
    id: "mystery-shop-scrape-calculators",
    retries: 2,
    triggers: [{ event: "mystery-shopping/scrape-calculators" }],
  },
  async ({ event, step }) => {
    const campaignId = event.data.campaignId as number;

    // Mark campaign as running
    await step.run("mark-running", () =>
      db
        .update(mysteryShopCampaigns)
        .set({ status: "running", startedAt: new Date().toISOString() })
        .where(eq(mysteryShopCampaigns.id, campaignId))
    );

    let totalProcessed = 0;
    let totalErrors = 0;
    let batch = 0;

    while (batch < 100) {
      const result = await step.run(`calc-batch-${batch}`, async () => {
        const { processCalculatorBatch } = await import(
          "@/lib/mystery-shopping/calculator-scraper"
        );
        return processCalculatorBatch(campaignId, 5);
      });

      totalProcessed += result.processed;
      totalErrors += result.errors;

      await step.run(`update-progress-${batch}`, () =>
        db
          .update(mysteryShopCampaigns)
          .set({
            processedTargets: totalProcessed,
            errorCount: totalErrors,
          })
          .where(eq(mysteryShopCampaigns.id, campaignId))
      );

      if (result.remaining <= 0) break;
      batch++;

      // Brief pause between batches to avoid overwhelming target websites
      await step.sleep("batch-pause", "5s");
    }

    // Mark campaign as completed
    await step.run("mark-completed", () =>
      db
        .update(mysteryShopCampaigns)
        .set({
          status: "completed",
          completedAt: new Date().toISOString(),
          processedTargets: totalProcessed,
          errorCount: totalErrors,
        })
        .where(eq(mysteryShopCampaigns.id, campaignId))
    );

    // Trigger AI parsing for any successful scrapes
    await step.sendEvent("trigger-parsing", {
      name: "mystery-shopping/parse-quotes",
      data: {},
    });

    return { campaignId, totalProcessed, totalErrors, batches: batch + 1 };
  }
);

// ── Parse Quotes ──────────────────────────────────────────
// Processes targets that have raw response data but haven't been parsed yet

export const parseQuotes = inngest.createFunction(
  {
    id: "mystery-shop-parse-quotes",
    retries: 2,
    triggers: [{ event: "mystery-shopping/parse-quotes" }],
  },
  async ({ step }) => {
    let totalProcessed = 0;
    let totalErrors = 0;
    let batch = 0;

    while (batch < 50) {
      const result = await step.run(`parse-batch-${batch}`, async () => {
        const { parseQuoteBatch } = await import(
          "@/lib/mystery-shopping/quote-parser"
        );
        return parseQuoteBatch(5);
      });

      totalProcessed += result.processed;
      totalErrors += result.errors;

      if (result.remaining <= 0) break;
      batch++;

      // Rate limit AI calls
      await step.sleep("parse-pause", "2s");
    }

    return { totalProcessed, totalErrors, batches: batch + 1 };
  }
);

// ── Create Campaign Targets ──────────────────────────────────────────
// When a campaign is started, this function creates target rows for each
// eligible installer based on the campaign's zone configuration

export const createCampaignTargets = inngest.createFunction(
  {
    id: "mystery-shop-create-targets",
    retries: 1,
    triggers: [{ event: "mystery-shopping/create-targets" }],
  },
  async ({ event, step }) => {
    const campaignId = event.data.campaignId as number;
    const categories = (event.data.categories as string[]) || ["calculator"];

    const targetCount = await step.run("create-targets", async () => {
      const { findCalculatorInstallers } = await import(
        "@/lib/mystery-shopping/calculator-scraper"
      );

      // Get campaign to check zone filter
      const [campaign] = await db
        .select()
        .from(mysteryShopCampaigns)
        .where(eq(mysteryShopCampaigns.id, campaignId));

      if (!campaign) throw new Error("Campaign not found");

      const zones = campaign.zones ? JSON.parse(campaign.zones) : undefined;

      let created = 0;

      if (categories.includes("calculator")) {
        const calculatorInstallers = await findCalculatorInstallers({ zones });

        // Create target rows
        for (const inst of calculatorInstallers) {
          await db
            .insert(mysteryShopTargets)
            .values({
              campaignId,
              installerId: inst.installerId,
              category: "calculator",
            })
            .onConflictDoNothing();
          created++;
        }
      }

      // Update campaign totals
      await db
        .update(mysteryShopCampaigns)
        .set({ totalTargets: created })
        .where(eq(mysteryShopCampaigns.id, campaignId));

      return created;
    });

    // Auto-start scraping
    await step.sendEvent("start-scraping", {
      name: "mystery-shopping/scrape-calculators",
      data: { campaignId },
    });

    return { campaignId, targetCount };
  }
);

// Export all mystery shopping functions
export const mysteryShoppingFunctions = [
  scrapeCalculators,
  parseQuotes,
  createCampaignTargets,
];
