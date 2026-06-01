"use client";

import { useState, useMemo } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { normalizeQuote, type NormalizedPackage } from "@/lib/mystery-shopping/normalize-quote";

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
}

interface MatchedQuote {
  installerId: number;
  companyName: string;
  pkg: NormalizedPackage;
  isExactMatch: boolean; // Battery within 1kWh
}

const PANEL_OPTIONS = [4, 6, 8, 10, 12, 14, 16, 18, 20];

const BATTERY_OPTIONS = [
  { label: "No battery", kWh: 0 },
  { label: "5 kWh", kWh: 5 },
  { label: "10 kWh", kWh: 10 },
  { label: "13.5 kWh", kWh: 13.5 },
  { label: "16 kWh", kWh: 16 },
];

export function PriceComparison({ configs }: { configs: ScraperConfig[] }) {
  const [selectedPanels, setSelectedPanels] = useState(10);
  const [selectedBattery, setSelectedBattery] = useState(5);

  // Normalize all quotes
  const normalizedQuotes = useMemo(() => {
    const result: Array<{ installerId: number; companyName: string; quote: ReturnType<typeof normalizeQuote> }> = [];
    for (const config of configs) {
      if (!config.latestResult?.priceMatrix || config.latestResult.status !== "completed") continue;
      try {
        const raw = JSON.parse(config.latestResult.priceMatrix);
        const normalized = normalizeQuote(config.installerId, config.companyName, config.latestResult.scrapedAt, raw);
        result.push({ installerId: config.installerId, companyName: config.companyName, quote: normalized });
      } catch { /* skip */ }
    }
    return result;
  }, [configs]);

  // Find best matching package per installer
  const { exactMatches, similarMatches } = useMemo(() => {
    const exact: MatchedQuote[] = [];
    const similar: MatchedQuote[] = [];

    for (const { installerId, companyName, quote } of normalizedQuotes) {
      // Use priceTable if available for the selected panel count, otherwise use default packages
      let packages = quote.packages;
      if (quote.priceTable[selectedPanels]) {
        packages = quote.priceTable[selectedPanels];
      }

      if (selectedBattery === 0) {
        // Looking for solar-only
        const solarOnly = packages.find((p) => !p.hasBattery);
        if (solarOnly) {
          exact.push({ installerId, companyName, pkg: solarOnly, isExactMatch: true });
        }
      } else {
        // Find best battery match
        const withBattery = packages.filter((p) => p.hasBattery && p.batteryCapacityKwh);

        // Exact: within 1kWh
        const exactCandidates = withBattery
          .filter((p) => Math.abs((p.batteryCapacityKwh || 0) - selectedBattery) <= 1)
          .sort((a, b) => a.systemPrice - b.systemPrice);

        // Similar: within 5kWh but NOT within 1kWh
        const similarCandidates = withBattery
          .filter((p) => {
            const diff = Math.abs((p.batteryCapacityKwh || 0) - selectedBattery);
            return diff > 1 && diff <= 5;
          })
          .sort((a, b) => a.systemPrice - b.systemPrice);

        if (exactCandidates.length > 0) {
          exact.push({ installerId, companyName, pkg: exactCandidates[0], isExactMatch: true });
        } else if (similarCandidates.length > 0) {
          // Only show in similar if NOT already in exact
          similar.push({ installerId, companyName, pkg: similarCandidates[0], isExactMatch: false });
        } else {
          // No match within 5kWh — try cheapest battery as last resort in similar
          const cheapestBat = withBattery.sort((a, b) => a.systemPrice - b.systemPrice)[0];
          if (cheapestBat) {
            similar.push({ installerId, companyName, pkg: cheapestBat, isExactMatch: false });
          }
        }
      }
    }

    exact.sort((a, b) => a.pkg.systemPrice - b.pkg.systemPrice);
    similar.sort((a, b) => a.pkg.systemPrice - b.pkg.systemPrice);

    return { exactMatches: exact, similarMatches: similar };
  }, [normalizedQuotes, selectedPanels, selectedBattery]);

  if (normalizedQuotes.length < 1) return null;

  return (
    <Card className="mb-6">
      <CardHeader className="pb-3">
        <CardTitle className="text-[15px] font-semibold">Price Comparison</CardTitle>
      </CardHeader>
      <CardContent>
        {/* Panel selector */}
        <div className="mb-4">
          <div className="text-[12px] font-medium text-[#9a9a9a] mb-1.5">Number of panels</div>
          <div className="flex flex-wrap gap-1.5">
            {PANEL_OPTIONS.map((n) => (
              <button
                key={n}
                onClick={() => setSelectedPanels(n)}
                className={`rounded-lg border px-3 py-1.5 text-[13px] font-medium transition-colors cursor-pointer ${
                  selectedPanels === n
                    ? "border-blue-300 bg-blue-50 text-blue-700"
                    : "border-[#ebebeb] text-[#7a7a7a] hover:border-[#ccc]"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        {/* Battery selector */}
        <div className="mb-5">
          <div className="text-[12px] font-medium text-[#9a9a9a] mb-1.5">Battery storage</div>
          <div className="flex flex-wrap gap-1.5">
            {BATTERY_OPTIONS.map((opt) => (
              <button
                key={opt.kWh}
                onClick={() => setSelectedBattery(opt.kWh)}
                className={`rounded-lg border px-3 py-1.5 text-[13px] font-medium transition-colors cursor-pointer ${
                  selectedBattery === opt.kWh
                    ? "border-blue-300 bg-blue-50 text-blue-700"
                    : "border-[#ebebeb] text-[#7a7a7a] hover:border-[#ccc]"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Exact matches table */}
        {exactMatches.length === 0 && similarMatches.length === 0 ? (
          <p className="text-[13px] text-[#9a9a9a] py-4">
            No matching quotes. Try a different configuration.
          </p>
        ) : (
          <>
            {exactMatches.length > 0 && (
              <QuoteTable
                quotes={exactMatches}
                selectedBattery={selectedBattery}
                label={selectedBattery === 0 ? "Solar Only" : `Matching quotes (${selectedBattery} kWh ± 1)`}
                showCheapest
              />
            )}

            {similarMatches.length > 0 && (
              <div className="mt-4">
                <QuoteTable
                  quotes={similarMatches}
                  selectedBattery={selectedBattery}
                  label="Similar quotes (different battery size)"
                  showCheapest={exactMatches.length === 0}
                />
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function QuoteTable({
  quotes,
  selectedBattery,
  label,
  showCheapest,
}: {
  quotes: MatchedQuote[];
  selectedBattery: number;
  label: string;
  showCheapest: boolean;
}) {
  return (
    <div>
      <div className="text-[12px] font-medium text-[#9a9a9a] mb-2">{label}</div>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b text-[11px] text-[#9a9a9a] uppercase tracking-wider">
              <th className="text-left py-2 pr-3 font-medium">Installer</th>
              <th className="text-left py-2 pr-3 font-medium">Panel</th>
              <th className="text-right py-2 pr-3 font-medium">Count</th>
              <th className="text-right py-2 pr-3 font-medium">kWp</th>
              {selectedBattery > 0 && <th className="text-left py-2 pr-3 font-medium">Battery</th>}
              {selectedBattery > 0 && <th className="text-right py-2 pr-3 font-medium">kWh</th>}
              <th className="text-right py-2 pr-3 font-medium">System Price</th>
              <th className="text-right py-2 font-medium">Monthly</th>
            </tr>
          </thead>
          <tbody>
            {quotes.map((q, i) => (
              <tr
                key={q.installerId}
                className={`border-b last:border-0 ${showCheapest && i === 0 ? "bg-emerald-50/50" : ""}`}
              >
                <td className="py-2 pr-3">
                  <Link
                    href={`/installers/${q.installerId}`}
                    className="font-medium text-[#1D1D1D] hover:underline"
                  >
                    {q.companyName}
                  </Link>
                  {showCheapest && i === 0 && (
                    <Badge className="ml-1.5 text-[9px] bg-emerald-100 text-emerald-700 border-0">
                      Cheapest
                    </Badge>
                  )}
                </td>
                <td className="py-2 pr-3 text-[12px] text-[#7a7a7a] max-w-[130px]">
                  <div className="truncate">
                    {q.pkg.panelModel ? q.pkg.panelModel.replace(/\(.*\)/, "").trim() : "—"}
                  </div>
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  {q.pkg.panelCount || "—"}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums text-[#7a7a7a]">
                  {q.pkg.systemSizeKw || "—"}
                </td>
                {selectedBattery > 0 && (
                  <td className="py-2 pr-3 text-[12px] text-[#7a7a7a] max-w-[130px]">
                    <div className="truncate">{q.pkg.batteryModel || "—"}</div>
                  </td>
                )}
                {selectedBattery > 0 && (
                  <td className="py-2 pr-3 text-right tabular-nums text-[#7a7a7a]">
                    {q.pkg.batteryCapacityKwh || "—"}
                  </td>
                )}
                <td className="py-2 pr-3 text-right font-semibold text-[#1D1D1D] tabular-nums">
                  £{q.pkg.systemPrice.toLocaleString()}
                </td>
                <td className="py-2 text-right text-[#7a7a7a] tabular-nums">
                  {q.pkg.monthlyPayment ? `£${q.pkg.monthlyPayment}/mo` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
