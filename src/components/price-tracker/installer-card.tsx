"use client";

import { useState, useCallback } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Play, Loader2, ExternalLink, Building2 } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import type { NormalizedQuote } from "@/lib/mystery-shopping/normalize-quote";

interface InstallerCardProps {
  installerId: number;
  companyName: string;
  calculatorUrl: string;
  totalScrapes: number;
  lastScrapedAt: string | null;
  quote: NormalizedQuote | null;
  onScrapeComplete: () => void;
}

export function InstallerCard({
  installerId,
  companyName,
  calculatorUrl,
  totalScrapes,
  lastScrapedAt,
  quote,
  onScrapeComplete,
}: InstallerCardProps) {
  const [scraping, setScraping] = useState(false);

  const runScrape = useCallback(async () => {
    setScraping(true);
    toast.info("Scraping started...");
    try {
      const res = await fetch("/api/price-tracker/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ installerId }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Scrape failed");
      toast.success("Scrape completed!");
      onScrapeComplete();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Scrape failed");
    } finally {
      setScraping(false);
    }
  }, [installerId, onScrapeComplete]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CardTitle className="text-[15px] font-semibold">
              <Link href={`/installers/${installerId}`} className="hover:underline">
                {companyName}
              </Link>
            </CardTitle>
            <Link href={`/installers/${installerId}`} className="text-[12px] text-[#9a9a9a] hover:text-[#1D1D1D] flex items-center gap-0.5">
              <Building2 className="h-3 w-3" /> Profile
            </Link>
            <a href={calculatorUrl} target="_blank" rel="noopener noreferrer" className="text-[12px] text-blue-500 hover:underline flex items-center gap-0.5">
              Calculator <ExternalLink className="h-3 w-3" />
            </a>
          </div>
          <div className="flex items-center gap-2">
            {lastScrapedAt && (
              <span className="text-[12px] text-[#9a9a9a]">
                Last: {new Date(lastScrapedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
            <Badge variant="secondary" className="text-[11px]">{totalScrapes} scrapes</Badge>
            <Button size="sm" onClick={runScrape} disabled={scraping} className="gap-1.5">
              {scraping ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Scraping...</> : <><Play className="h-3.5 w-3.5" />Scrape Now</>}
            </Button>
          </div>
        </div>
      </CardHeader>

      {quote && (
        <CardContent className="pt-0 pb-3">
          {/* Summary row */}
          <div className="grid grid-cols-4 gap-3 mb-4">
            <div className="bg-gray-50 rounded-lg p-3">
              <div className="text-[11px] text-[#9a9a9a]">Panel</div>
              <div className="text-[13px] font-medium">{quote.defaultPanelModel || "—"}</div>
              <div className="text-[11px] text-[#9a9a9a]">
                {quote.defaultPanelWattageW ? `${quote.defaultPanelWattageW}W` : ""}
                {quote.defaultPanelCount ? ` × ${quote.defaultPanelCount}` : ""}
                {quote.defaultPanelWattageW && quote.defaultPanelCount
                  ? ` = ${(quote.defaultPanelWattageW * quote.defaultPanelCount / 1000).toFixed(1)}kWp`
                  : ""}
              </div>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <div className="text-[11px] text-[#9a9a9a]">Panels Only</div>
              <div className="text-[16px] font-semibold">
                {quote.panelOnlyPrice ? `£${quote.panelOnlyPrice.toLocaleString()}` : "—"}
              </div>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <div className="text-[11px] text-[#9a9a9a]">Cheapest System</div>
              <div className="text-[16px] font-semibold">
                {quote.packages.length > 0 ? `£${quote.packages[0].systemPrice.toLocaleString()}` : "—"}
              </div>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <div className="text-[11px] text-[#9a9a9a]">Packages</div>
              <div className="text-[16px] font-semibold">{quote.packages.length}</div>
              <div className="text-[11px] text-[#9a9a9a]">
                {quote.packages.filter((p) => p.hasBattery).length} with battery
              </div>
            </div>
          </div>

          {/* Panel price points */}
          {quote.panelPricePoints.length > 1 && (
            <div className="mb-4">
              <div className="text-[12px] font-medium text-[#9a9a9a] mb-1.5">Panel Pricing by Count</div>
              <div className="flex flex-wrap gap-1.5">
                {quote.panelPricePoints.map((p, i) => (
                  <div key={i} className={`rounded-lg border px-2.5 py-1.5 text-center text-[12px] ${
                    p.panelCount === quote.defaultPanelCount ? "border-emerald-200 bg-emerald-50" : "border-[#ebebeb]"
                  }`}>
                    <div className="font-medium">{p.panelCount} panels</div>
                    <div className="text-[#7a7a7a]">£{p.price.toLocaleString()}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Packages table */}
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b text-[11px] text-[#9a9a9a] uppercase tracking-wider">
                  <th className="text-left py-1.5 pr-3 font-medium">Package</th>
                  <th className="text-left py-1.5 pr-3 font-medium">Panels</th>
                  <th className="text-left py-1.5 pr-3 font-medium">Battery</th>
                  <th className="text-left py-1.5 pr-3 font-medium">Inverter</th>
                  <th className="text-right py-1.5 pr-3 font-medium">System Price</th>
                  {quote.panelOnlyPrice && <th className="text-right py-1.5 font-medium">Battery Cost</th>}
                </tr>
              </thead>
              <tbody>
                {quote.packages.map((pkg, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="py-2 pr-3 font-medium text-[#1D1D1D] max-w-[180px]">
                      <div className="truncate">{pkg.name}</div>
                    </td>
                    <td className="py-2 pr-3 text-[12px] text-[#7a7a7a]">
                      {pkg.panelCount && pkg.panelWattageW
                        ? `${pkg.panelCount}× ${pkg.panelWattageW}W`
                        : pkg.panelCount
                        ? `${pkg.panelCount} panels`
                        : "—"}
                      {pkg.systemSizeKw && <div className="text-[11px]">{pkg.systemSizeKw}kWp</div>}
                    </td>
                    <td className="py-2 pr-3 text-[12px] text-[#7a7a7a]">
                      {pkg.hasBattery ? (
                        <>
                          <div className="truncate max-w-[150px]">{pkg.batteryModel}</div>
                          {pkg.batteryCapacityKwh && <div className="text-[11px] font-medium">{pkg.batteryCapacityKwh} kWh</div>}
                        </>
                      ) : (
                        <span className="text-[#c0c0c0]">No battery</span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-[12px] text-[#7a7a7a] max-w-[130px]">
                      <div className="truncate">{pkg.inverterModel || "—"}</div>
                    </td>
                    <td className="py-2 pr-3 text-right font-semibold text-[#1D1D1D]">
                      £{pkg.systemPrice.toLocaleString()}
                    </td>
                    {quote.panelOnlyPrice && (
                      <td className="py-2 text-right text-[#9a9a9a]">
                        {pkg.batteryAddOnCost != null ? `£${pkg.batteryAddOnCost.toLocaleString()}` : "—"}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      )}

      {!quote && (
        <CardContent className="pt-0 pb-3">
          <p className="text-[13px] text-[#9a9a9a]">No data yet — click Scrape Now</p>
        </CardContent>
      )}
    </Card>
  );
}
