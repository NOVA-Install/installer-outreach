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
import type { NormalizedQuote, NormalizedPackage } from "@/lib/mystery-shopping/normalize-quote";

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
  const [selectedPanelCount, setSelectedPanelCount] = useState<number | null>(null);

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

  // Determine which packages to show based on selected panel count
  const activePanelCount = selectedPanelCount || quote?.defaultPanelCount || null;
  const hasPriceTable = quote && Object.keys(quote.priceTable).length > 0;

  let displayPackages: NormalizedPackage[] = quote?.packages || [];
  if (hasPriceTable && activePanelCount && quote.priceTable[activePanelCount]) {
    displayPackages = quote.priceTable[activePanelCount];
  }

  const cheapestPrice = displayPackages.length > 0
    ? Math.min(...displayPackages.map((p) => p.systemPrice))
    : null;

  const panelOnlyPkg = displayPackages.find((p) => !p.hasBattery);

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
              </div>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <div className="text-[11px] text-[#9a9a9a]">Panels Only</div>
              <div className="text-[16px] font-semibold">
                {panelOnlyPkg ? `£${panelOnlyPkg.systemPrice.toLocaleString()}` : quote.panelOnlyPrice ? `£${quote.panelOnlyPrice.toLocaleString()}` : "—"}
              </div>
              <div className="text-[11px] text-[#9a9a9a]">
                {activePanelCount ? `${activePanelCount} panels` : ""}
              </div>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <div className="text-[11px] text-[#9a9a9a]">Cheapest System</div>
              <div className="text-[16px] font-semibold">
                {cheapestPrice ? `£${cheapestPrice.toLocaleString()}` : "—"}
              </div>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <div className="text-[11px] text-[#9a9a9a]">Packages</div>
              <div className="text-[16px] font-semibold">{displayPackages.length}</div>
              <div className="text-[11px] text-[#9a9a9a]">
                {displayPackages.filter((p) => p.hasBattery).length} with battery
              </div>
            </div>
          </div>

          {/* Clickable panel count selector */}
          {quote.panelPricePoints.length > 1 && (
            <div className="mb-4">
              <div className="text-[12px] font-medium text-[#9a9a9a] mb-1.5">
                Panel Count {hasPriceTable && <span className="text-[#c0c0c0]">— click to update prices</span>}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {quote.panelPricePoints.map((p, i) => {
                  const isActive = activePanelCount === p.panelCount;
                  const isDefault = quote.defaultPanelCount === p.panelCount && !selectedPanelCount;
                  return (
                    <button
                      key={i}
                      onClick={() => setSelectedPanelCount(p.panelCount === selectedPanelCount ? null : p.panelCount)}
                      className={`rounded-lg border px-3 py-1.5 text-center text-[12px] transition-colors cursor-pointer ${
                        isActive
                          ? "border-blue-300 bg-blue-50 text-blue-700"
                          : isDefault
                          ? "border-emerald-200 bg-emerald-50"
                          : "border-[#ebebeb] hover:border-[#ccc]"
                      }`}
                    >
                      <div className="font-medium">{p.panelCount} panels</div>
                      <div className="text-[#7a7a7a]">£{p.price.toLocaleString()}</div>
                    </button>
                  );
                })}
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
                  <th className="text-right py-1.5 pr-3 font-medium">kWh</th>
                  <th className="text-left py-1.5 pr-3 font-medium">Inverter</th>
                  <th className="text-right py-1.5 pr-3 font-medium">System Price</th>
                  {panelOnlyPkg && <th className="text-right py-1.5 font-medium">Battery Cost</th>}
                </tr>
              </thead>
              <tbody>
                {displayPackages.map((pkg, i) => (
                  <tr key={i} className={`border-b last:border-0 ${!pkg.hasBattery ? "bg-gray-50/50" : ""}`}>
                    <td className="py-2 pr-3 font-medium text-[#1D1D1D] max-w-[180px]">
                      <div className="truncate">{pkg.name}</div>
                    </td>
                    <td className="py-2 pr-3 text-[12px] text-[#7a7a7a]">
                      {pkg.panelCount && pkg.panelWattageW
                        ? `${pkg.panelCount}× ${pkg.panelWattageW}W`
                        : pkg.panelCount ? `${pkg.panelCount} panels` : "—"}
                      {pkg.systemSizeKw && <div className="text-[11px]">{pkg.systemSizeKw} kWp</div>}
                    </td>
                    <td className="py-2 pr-3 text-[12px] text-[#7a7a7a]">
                      {pkg.hasBattery ? (
                        <div className="truncate max-w-[140px]">{pkg.batteryModel}</div>
                      ) : (
                        <span className="text-[#c0c0c0] italic">No battery</span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-right text-[12px] text-[#7a7a7a] tabular-nums">
                      {pkg.hasBattery && pkg.batteryCapacityKwh
                        ? `${pkg.batteryCapacityKwh}`
                        : "—"}
                    </td>
                    <td className="py-2 pr-3 text-[12px] text-[#7a7a7a] max-w-[130px]">
                      <div className="truncate">{pkg.inverterModel || "—"}</div>
                    </td>
                    <td className="py-2 pr-3 text-right font-semibold text-[#1D1D1D] tabular-nums">
                      £{pkg.systemPrice.toLocaleString()}
                    </td>
                    {panelOnlyPkg && (
                      <td className="py-2 text-right text-[#9a9a9a] tabular-nums">
                        {pkg.hasBattery && pkg.batteryAddOnCost != null
                          ? `+£${pkg.batteryAddOnCost.toLocaleString()}`
                          : pkg.hasBattery
                          ? `+£${Math.round(pkg.systemPrice - panelOnlyPkg.systemPrice).toLocaleString()}`
                          : "—"}
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
