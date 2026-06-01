"use client";

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Play,
  Loader2,
  ExternalLink,
  TrendingUp,
  TrendingDown,
} from "lucide-react";
import { toast } from "sonner";

interface BatteryOption {
  tier?: string;
  model?: string;
  name?: string;
  capacityKwh: number | string | null;
  totalPrice?: number;
  price?: number;
  monthlySavings?: string | null;
}

interface PanelPricePoint {
  panelCount: number;
  systemKw: string;
  totalPrice: number;
}

interface PriceMatrix {
  panelModel: string | null;
  panelWarrantyYears: number | null;
  recommendedPanelCount: number | null;
  panelOnlyPrice: number | null;
  pricePerPanel: number | null;
  totalPrice?: number | null;
  originalTotalPrice?: number | null;
  annualSavings?: number | null;
  monthlySavings?: number | null;
  panelPricePoints?: PanelPricePoint[];
  batteryOptions: BatteryOption[];
  panelOptions?: Array<{ name: string; pricePerUnit: number | null }>;
  includedExtras: string[];
}

interface ScrapeResult {
  id: number;
  installerId: number;
  status: string;
  postcode: string;
  panelOnlyPrice: number | null;
  recommendedPrice: number | null;
  pricePerPanel: number | null;
  recommendedPanelCount: number | null;
  panelModel: string | null;
  priceMatrix: string | null;
  screenshotPath: string | null;
  errorLog: string | null;
  scrapedAt: string;
}

export function InstallerPriceTracker({
  installerId,
  calculatorUrl,
  initialResults,
}: {
  installerId: number;
  calculatorUrl: string;
  initialResults: ScrapeResult[];
}) {
  const [results, setResults] = useState<ScrapeResult[]>(initialResults);
  const [scraping, setScraping] = useState(false);

  const latest = results[0] ?? null;
  const previous = results[1] ?? null;
  const matrix: PriceMatrix | null = latest?.priceMatrix
    ? JSON.parse(latest.priceMatrix)
    : null;

  const runScrape = useCallback(async () => {
    setScraping(true);
    toast.info("Scraping prices — this takes 1-2 minutes...");

    try {
      const res = await fetch("/api/price-tracker/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ installerId }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Scrape failed");
      }

      toast.success("Price scrape completed!");

      // Refresh results
      const histRes = await fetch(`/api/price-tracker/results?installerId=${installerId}&limit=10`);
      const histData = await histRes.json();
      setResults(histData.map((d: { result: ScrapeResult }) => d.result));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Scrape failed");
    } finally {
      setScraping(false);
    }
  }, [installerId]);

  // Calculate price change from previous scrape
  const priceChange = latest?.panelOnlyPrice && previous?.panelOnlyPrice
    ? latest.panelOnlyPrice - previous.panelOnlyPrice
    : null;

  return (
    <div className="space-y-4">
      {/* Header with scrape button */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <a
            href={calculatorUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[12px] text-blue-500 hover:underline flex items-center gap-1"
          >
            Online Calculator <ExternalLink className="h-3 w-3" />
          </a>
          {latest && (
            <span className="text-[11px] text-[#9a9a9a]">
              Last scraped{" "}
              {new Date(latest.scrapedAt).toLocaleDateString("en-GB", {
                day: "numeric",
                month: "short",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          )}
        </div>
        <Button
          size="sm"
          onClick={runScrape}
          disabled={scraping}
          className="gap-1.5"
        >
          {scraping ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Scraping...
            </>
          ) : (
            <>
              <Play className="h-3.5 w-3.5" />
              Scrape Now
            </>
          )}
        </Button>
      </div>

      {/* No data state */}
      {!latest && (
        <div className="bg-white rounded-2xl border border-[#ebebeb] p-6 text-center">
          <p className="text-[13px] text-[#9a9a9a]">
            No price data yet. Click "Scrape Now" to fetch live pricing.
          </p>
        </div>
      )}

      {/* Latest result */}
      {latest?.status === "completed" && matrix && (
        <>
          {/* Key metrics */}
          <div className="grid grid-cols-4 gap-3">
            <div className="bg-white rounded-2xl border border-[#ebebeb] p-4 shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
              <p className="text-[11px] text-[#9a9a9a] uppercase tracking-wider mb-1">Panel Only</p>
              <div className="flex items-baseline gap-1.5">
                <p className="text-[18px] font-semibold text-[#1D1D1D]">
                  {matrix.panelOnlyPrice ? `£${matrix.panelOnlyPrice.toLocaleString()}` : "—"}
                </p>
                {priceChange !== null && priceChange !== 0 && (
                  <span className={`flex items-center gap-0.5 text-[11px] font-medium ${priceChange > 0 ? "text-red-500" : "text-emerald-500"}`}>
                    {priceChange > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                    {priceChange > 0 ? "+" : ""}£{Math.abs(priceChange)}
                  </span>
                )}
              </div>
            </div>
            <div className="bg-white rounded-2xl border border-[#ebebeb] p-4 shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
              <p className="text-[11px] text-[#9a9a9a] uppercase tracking-wider mb-1">Per Panel</p>
              <p className="text-[18px] font-semibold text-[#1D1D1D]">
                {matrix.pricePerPanel ? `£${matrix.pricePerPanel}` : "—"}
              </p>
            </div>
            <div className="bg-white rounded-2xl border border-[#ebebeb] p-4 shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
              <p className="text-[11px] text-[#9a9a9a] uppercase tracking-wider mb-1">Recommended</p>
              <p className="text-[18px] font-semibold text-[#1D1D1D]">
                {matrix.recommendedPanelCount ? `${matrix.recommendedPanelCount} panels` : "—"}
              </p>
            </div>
            <div className="bg-white rounded-2xl border border-[#ebebeb] p-4 shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
              <p className="text-[11px] text-[#9a9a9a] uppercase tracking-wider mb-1">Panel Model</p>
              <p className="text-[13px] font-medium text-[#1D1D1D] truncate">
                {matrix.panelModel || "—"}
              </p>
              {matrix.panelWarrantyYears && (
                <p className="text-[11px] text-[#9a9a9a]">{matrix.panelWarrantyYears}yr warranty</p>
              )}
            </div>
          </div>

          {/* Battery options */}
          {matrix.batteryOptions.length > 0 && (
            <div className="bg-white rounded-2xl border border-[#ebebeb] p-5 shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
              <p className="text-[12px] font-semibold text-[#8a8a8a] uppercase tracking-[0.08em] mb-3">Battery Options</p>
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-[11px] text-[#9a9a9a] uppercase tracking-wider">
                    <th className="text-left py-1.5 pr-3 font-medium">Tier</th>
                    <th className="text-left py-1.5 pr-3 font-medium">Battery</th>
                    <th className="text-right py-1.5 pr-3 font-medium">Capacity</th>
                    <th className="text-right py-1.5 pr-3 font-medium">Battery Price</th>
                    <th className="text-right py-1.5 pr-3 font-medium">System Total</th>
                  </tr>
                </thead>
                <tbody>
                  {matrix.batteryOptions.map((b, i) => {
                    const batteryPrice = b.totalPrice ?? b.price ?? 0;
                    const bName = b.model || b.name || "—";
                    const bCap = b.capacityKwh ?? "—";
                    const bundleDiscount = (matrix.originalTotalPrice && matrix.totalPrice)
                      ? matrix.originalTotalPrice - matrix.totalPrice
                      : 0;
                    const systemTotal = matrix.panelOnlyPrice
                      ? matrix.panelOnlyPrice + batteryPrice - bundleDiscount
                      : null;
                    return (
                    <tr key={i} className="border-t border-[#f3f3f3]">
                      <td className="py-2 pr-3 font-medium text-[#1D1D1D]">{bName}</td>
                      <td className="py-2 pr-3 text-right text-[#7a7a7a]">{bCap} kWh</td>
                      <td className="py-2 pr-3 text-right text-[#9a9a9a]">
                        £{batteryPrice.toLocaleString()}
                      </td>
                      <td className="py-2 pr-3 text-right font-semibold text-[#1D1D1D]">
                        {systemTotal ? `£${systemTotal.toLocaleString()}` : "—"}
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Panel price points */}
          {(matrix.panelPricePoints ?? []).length > 0 && (
            <div className="bg-white rounded-2xl border border-[#ebebeb] p-5 shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
              <p className="text-[12px] font-semibold text-[#8a8a8a] uppercase tracking-[0.08em] mb-3">Panel Price Points</p>
              <div className="flex flex-wrap gap-2">
                {[...(matrix.panelPricePoints ?? [])]
                  .sort((a, b) => a.panelCount - b.panelCount)
                  .map((p, i) => (
                    <div
                      key={i}
                      className={`rounded-xl border px-3 py-2 text-center ${
                        p.panelCount === matrix.recommendedPanelCount
                          ? "border-emerald-200 bg-emerald-50"
                          : "border-[#ebebeb] bg-white"
                      }`}
                    >
                      <p className="text-[14px] font-semibold text-[#1D1D1D]">{p.panelCount}</p>
                      <p className="text-[10px] text-[#9a9a9a]">{p.systemKw}</p>
                      <p className="text-[12px] font-medium text-[#1D1D1D] mt-0.5">
                        £{(p.totalPrice ?? 0).toLocaleString()}
                      </p>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* Included extras */}
          {matrix.includedExtras?.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {matrix.includedExtras.map((extra, i) => (
                <Badge key={i} variant="secondary" className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200/60">
                  {extra}
                </Badge>
              ))}
            </div>
          )}
        </>
      )}

      {/* Error state */}
      {latest?.status === "failed" && (
        <div className="bg-white rounded-2xl border border-red-200 p-4">
          <p className="text-[13px] text-red-500">Last scrape failed: {latest.errorLog}</p>
        </div>
      )}

      {/* History */}
      {results.length > 1 && (
        <div className="bg-white rounded-2xl border border-[#ebebeb] p-5 shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
          <p className="text-[12px] font-semibold text-[#8a8a8a] uppercase tracking-[0.08em] mb-3">Price History</p>
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-[11px] text-[#9a9a9a] uppercase tracking-wider">
                <th className="text-left py-1.5 pr-3 font-medium">Date</th>
                <th className="text-left py-1.5 pr-3 font-medium">Status</th>
                <th className="text-right py-1.5 pr-3 font-medium">Panel Only</th>
                <th className="text-right py-1.5 pr-3 font-medium">Per Panel</th>
                <th className="text-right py-1.5 pr-3 font-medium">Change</th>
              </tr>
            </thead>
            <tbody>
              {results.map((result, i) => {
                const prev = results[i + 1];
                const change = result.panelOnlyPrice && prev?.panelOnlyPrice
                  ? result.panelOnlyPrice - prev.panelOnlyPrice
                  : null;
                return (
                  <tr key={result.id} className="border-t border-[#f3f3f3]">
                    <td className="py-1.5 pr-3 text-[#7a7a7a]">
                      {new Date(result.scrapedAt).toLocaleDateString("en-GB", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </td>
                    <td className="py-1.5 pr-3">
                      <Badge
                        variant="secondary"
                        className={`text-[10px] ${
                          result.status === "completed"
                            ? "bg-emerald-50 text-emerald-600"
                            : "bg-red-50 text-red-600"
                        }`}
                      >
                        {result.status}
                      </Badge>
                    </td>
                    <td className="py-1.5 pr-3 text-right font-medium text-[#1D1D1D]">
                      {result.panelOnlyPrice ? `£${result.panelOnlyPrice.toLocaleString()}` : "—"}
                    </td>
                    <td className="py-1.5 pr-3 text-right text-[#7a7a7a]">
                      {result.pricePerPanel ? `£${result.pricePerPanel}` : "—"}
                    </td>
                    <td className="py-1.5 pr-3 text-right">
                      {change !== null && change !== 0 ? (
                        <span className={change > 0 ? "text-red-500" : "text-emerald-500"}>
                          {change > 0 ? "+" : ""}£{Math.abs(change)}
                        </span>
                      ) : (
                        <span className="text-[#d0d0d0]">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
