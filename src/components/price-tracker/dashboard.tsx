"use client";

import { useState, useEffect, useCallback } from "react";
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

  const fetchConfigs = useCallback(async () => {
    const res = await fetch("/api/price-tracker");
    const data = await res.json();
    setConfigs(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchConfigs();
  }, [fetchConfigs]);

  if (loading) {
    return <div className="text-[13px] text-[#9a9a9a]">Loading...</div>;
  }

  if (configs.length === 0) {
    return (
      <div className="bg-white rounded-xl border p-8 text-center">
        <p className="text-[13px] text-[#9a9a9a]">
          No price scrapers configured.
        </p>
      </div>
    );
  }

  // Normalize all quotes for comparison + cards
  const normalizedQuotes: Map<number, NormalizedQuote> = new Map();
  for (const config of configs) {
    if (config.latestResult?.priceMatrix && config.latestResult.status === "completed") {
      try {
        const raw = JSON.parse(config.latestResult.priceMatrix);
        const normalized = normalizeQuote(
          config.installerId,
          config.companyName,
          config.latestResult.scrapedAt,
          raw
        );
        normalizedQuotes.set(config.installerId, normalized);
      } catch { /* skip invalid data */ }
    }
  }

  return (
    <div className="space-y-4">
      <PriceComparison configs={configs} />

      {configs.map((config) => (
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
