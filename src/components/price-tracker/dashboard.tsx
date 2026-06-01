"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Play, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { normalizeQuote, type NormalizedQuote } from "@/lib/mystery-shopping/normalize-quote";
import { PriceComparison } from "./price-comparison";
import { InstallerCard } from "./installer-card";

interface ScrapeResult {
  id: number;
  installerId: number;
  status: string;
  priceMatrix: string | null;
  scrapedAt: string;
}

interface ScraperConfig {
  installerId: number;
  companyName: string;
  calculatorUrl: string;
  latestResult: ScrapeResult | null;
  totalScrapes: number;
}

export function PriceTrackerDashboard() {
  const [configs, setConfigs] = useState<ScraperConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [bulkScraping, setBulkScraping] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ done: 0, total: 0 });

  const fetchConfigs = useCallback(async () => {
    const res = await fetch("/api/price-tracker");
    const data = await res.json();
    setConfigs(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchConfigs();
  }, [fetchConfigs]);

  // Find installers that need scraping (never scraped or >24h old)
  const staleInstallers = configs.filter((c) => {
    if (!c.latestResult?.scrapedAt) return true;
    const age = Date.now() - new Date(c.latestResult.scrapedAt).getTime();
    return age > 24 * 60 * 60 * 1000;
  });

  const scrapeAll = useCallback(async () => {
    if (staleInstallers.length === 0) {
      toast.info("All installers scraped within the last 24 hours");
      return;
    }

    setBulkScraping(true);
    setBulkProgress({ done: 0, total: staleInstallers.length });
    let succeeded = 0;
    let failed = 0;

    for (const config of staleInstallers) {
      try {
        const res = await fetch("/api/price-tracker/scrape", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ installerId: config.installerId }),
        });
        if (res.ok) {
          succeeded++;
        } else {
          failed++;
        }
      } catch {
        failed++;
      }
      setBulkProgress((prev) => ({ ...prev, done: prev.done + 1 }));
    }

    setBulkScraping(false);
    toast.success(`Scraped ${succeeded} installers${failed > 0 ? `, ${failed} failed` : ""}`);
    fetchConfigs();
  }, [staleInstallers, fetchConfigs]);

  if (loading) {
    return <div className="text-[13px] text-[#9a9a9a]">Loading...</div>;
  }

  if (configs.length === 0) {
    return (
      <div className="bg-white rounded-xl border p-8 text-center">
        <p className="text-[13px] text-[#9a9a9a]">No price scrapers configured.</p>
      </div>
    );
  }

  // Normalize all quotes
  const normalizedQuotes: Map<number, NormalizedQuote> = new Map();
  for (const config of configs) {
    if (config.latestResult?.priceMatrix && config.latestResult.status === "completed") {
      try {
        const raw = JSON.parse(config.latestResult.priceMatrix);
        const normalized = normalizeQuote(
          config.installerId, config.companyName, config.latestResult.scrapedAt, raw
        );
        normalizedQuotes.set(config.installerId, normalized);
      } catch { /* skip */ }
    }
  }

  const scrapedCount = configs.filter((c) => c.latestResult?.status === "completed").length;

  return (
    <div className="space-y-4">
      {/* Bulk scrape button */}
      <div className="flex items-center justify-between">
        <div className="text-[13px] text-[#9a9a9a]">
          {scrapedCount} of {configs.length} installers scraped
          {staleInstallers.length > 0 && ` · ${staleInstallers.length} need refreshing`}
        </div>
        <Button
          size="sm"
          onClick={scrapeAll}
          disabled={bulkScraping || staleInstallers.length === 0}
          className="gap-1.5"
        >
          {bulkScraping ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Scraping {bulkProgress.done}/{bulkProgress.total}...
            </>
          ) : (
            <>
              <Play className="h-3.5 w-3.5" />
              {staleInstallers.length === 0
                ? "All up to date"
                : `Scrape All (${staleInstallers.length})`}
            </>
          )}
        </Button>
      </div>

      <PriceComparison configs={configs} />

      {[...configs].sort((a, b) => a.companyName.localeCompare(b.companyName)).map((config) => (
        <InstallerCard
          key={config.installerId}
          installerId={config.installerId}
          companyName={config.companyName}
          calculatorUrl={config.calculatorUrl}
          totalScrapes={config.totalScrapes}
          lastScrapedAt={config.latestResult?.scrapedAt || null}
          quote={normalizedQuotes.get(config.installerId) || null}
          onScrapeComplete={fetchConfigs}
        />
      ))}
    </div>
  );
}
