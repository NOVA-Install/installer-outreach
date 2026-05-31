"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Play,
  Loader2,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Building2,
} from "lucide-react";
import Link from "next/link";
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
  includedExtras?: string[];
  panelOptions?: Array<{ name: string; pricePerUnit: number | null }>;
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

interface ScraperConfig {
  installerId: number;
  companyName: string;
  calculatorUrl: string;
  installer: {
    id: number;
    companyName: string;
    website: string | null;
    postcode: string | null;
  } | null;
  latestResult: ScrapeResult | null;
  totalScrapes: number;
}

export function PriceTrackerDashboard() {
  const [configs, setConfigs] = useState<ScraperConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [scraping, setScraping] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [history, setHistory] = useState<Record<number, ScrapeResult[]>>({});

  const fetchConfigs = useCallback(async () => {
    const res = await fetch("/api/price-tracker");
    const data = await res.json();
    setConfigs(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchConfigs();
  }, [fetchConfigs]);

  const runScrape = async (installerId: number) => {
    setScraping(installerId);
    toast.info("Scraping started — this takes 1-2 minutes...");

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

      toast.success("Scrape completed!");
      fetchConfigs();

      // Refresh history if expanded
      if (expandedId === installerId) {
        fetchHistory(installerId);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Scrape failed");
    } finally {
      setScraping(null);
    }
  };

  const fetchHistory = async (installerId: number) => {
    const res = await fetch(`/api/price-tracker/results?installerId=${installerId}&limit=20`);
    const data = await res.json();
    setHistory((prev) => ({
      ...prev,
      [installerId]: data.map((d: { result: ScrapeResult }) => d.result),
    }));
  };

  const toggleExpand = (installerId: number) => {
    if (expandedId === installerId) {
      setExpandedId(null);
    } else {
      setExpandedId(installerId);
      if (!history[installerId]) {
        fetchHistory(installerId);
      }
    }
  };

  if (loading) {
    return <div className="text-[13px] text-[#9a9a9a]">Loading...</div>;
  }

  if (configs.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="text-[13px] text-[#9a9a9a]">
            No price scrapers configured. Add installers to the CALCULATOR_REGISTRY in calculator-scraper.ts.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {configs.map((config) => {
        const latest = config.latestResult;
        const isExpanded = expandedId === config.installerId;
        const isScraping = scraping === config.installerId;
        const matrix: PriceMatrix | null = latest?.priceMatrix
          ? JSON.parse(latest.priceMatrix)
          : null;

        return (
          <Card key={config.installerId}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <CardTitle className="text-[15px] font-semibold">
                    <Link href={`/installers/${config.installerId}`} className="hover:underline">
                      {config.companyName}
                    </Link>
                  </CardTitle>
                  <Link
                    href={`/installers/${config.installerId}`}
                    className="text-[12px] text-[#9a9a9a] hover:text-[#1D1D1D] flex items-center gap-0.5"
                  >
                    <Building2 className="h-3 w-3" /> Profile
                  </Link>
                  <a
                    href={config.calculatorUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[12px] text-blue-500 hover:underline flex items-center gap-0.5"
                  >
                    Calculator <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
                <div className="flex items-center gap-2">
                  {latest && (
                    <span className="text-[12px] text-[#9a9a9a]">
                      Last scraped:{" "}
                      {new Date(latest.scrapedAt).toLocaleDateString("en-GB", {
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  )}
                  <Badge variant="secondary" className="text-[11px]">
                    {config.totalScrapes} scrape{config.totalScrapes !== 1 ? "s" : ""}
                  </Badge>
                  <Button
                    size="sm"
                    onClick={() => runScrape(config.installerId)}
                    disabled={isScraping}
                    className="gap-1.5"
                  >
                    {isScraping ? (
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
              </div>
            </CardHeader>

            {/* Latest result summary */}
            {latest?.status === "completed" && matrix && (
              <CardContent className="pt-0 pb-3">
                {/* Summary cards */}
                <div className="grid grid-cols-5 gap-3 mb-3">
                  <div className="bg-gray-50 rounded-lg p-3">
                    <div className="text-[11px] text-[#9a9a9a]">Recommended System</div>
                    <div className="text-[16px] font-semibold">
                      {matrix.totalPrice ? `£${matrix.totalPrice.toLocaleString()}` : matrix.panelOnlyPrice ? `£${matrix.panelOnlyPrice.toLocaleString()}` : "—"}
                    </div>
                    {matrix.originalTotalPrice && matrix.totalPrice && matrix.originalTotalPrice > matrix.totalPrice && (
                      <div className="text-[11px] text-[#9a9a9a] line-through">£{matrix.originalTotalPrice.toLocaleString()}</div>
                    )}
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3">
                    <div className="text-[11px] text-[#9a9a9a]">Panels Only</div>
                    <div className="text-[16px] font-semibold">
                      {matrix.panelOnlyPrice ? `£${matrix.panelOnlyPrice.toLocaleString()}` : "—"}
                    </div>
                    <div className="text-[11px] text-[#9a9a9a]">
                      {matrix.recommendedPanelCount ? `${matrix.recommendedPanelCount} panels` : ""}
                    </div>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3">
                    <div className="text-[11px] text-[#9a9a9a]">Per Panel (incremental)</div>
                    <div className="text-[16px] font-semibold">
                      {matrix.pricePerPanel ? `£${matrix.pricePerPanel.toLocaleString()}` : "—"}
                    </div>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3">
                    <div className="text-[11px] text-[#9a9a9a]">Monthly Savings</div>
                    <div className="text-[16px] font-semibold text-green-600">
                      {matrix.monthlySavings ? `£${matrix.monthlySavings.toFixed(0)}/mo` : "—"}
                    </div>
                    {matrix.annualSavings && (
                      <div className="text-[11px] text-[#9a9a9a]">£{matrix.annualSavings.toFixed(0)}/year</div>
                    )}
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3">
                    <div className="text-[11px] text-[#9a9a9a]">Panel Model</div>
                    <div className="text-[12px] font-medium leading-tight">
                      {matrix.panelModel || matrix.panelOptions?.[0]?.name?.replace(/\s*panels?\s*$/i, "") || "—"}
                    </div>
                    {matrix.panelWarrantyYears && (
                      <div className="text-[11px] text-[#9a9a9a]">{matrix.panelWarrantyYears}yr warranty</div>
                    )}
                  </div>
                </div>

                {/* Packages / battery options table */}
                {matrix.batteryOptions.length > 0 && (() => {
                  // Detect if packages are full systems (have panelModel) or just battery add-ons
                  const isFullSystem = matrix.batteryOptions.some(
                    (b) => (b as unknown as Record<string, unknown>).panelModel || (b as unknown as Record<string, unknown>).panelCount || (b as unknown as Record<string, unknown>).systemSizeKw
                  );
                  const bundleDiscount = (matrix.originalTotalPrice && matrix.totalPrice)
                    ? matrix.originalTotalPrice - matrix.totalPrice : 0;

                  return (
                  <div className="mb-3">
                    <div className="text-[12px] font-medium text-[#9a9a9a] mb-1.5">
                      {isFullSystem ? "Packages" : "Battery Options"}
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-[13px]">
                        <thead>
                          <tr className="border-b text-[#9a9a9a]">
                            <th className="text-left py-1.5 pr-3 font-medium">Package</th>
                            {isFullSystem && <th className="text-left py-1.5 pr-3 font-medium">Panels</th>}
                            <th className="text-left py-1.5 pr-3 font-medium">{isFullSystem ? "Battery" : "Model"}</th>
                            {isFullSystem && <th className="text-right py-1.5 pr-3 font-medium">System</th>}
                            <th className="text-right py-1.5 pr-3 font-medium">Price</th>
                            {isFullSystem && <th className="text-right py-1.5 pr-3 font-medium">Monthly</th>}
                            {!isFullSystem && matrix.panelOnlyPrice && (
                              <th className="text-right py-1.5 pr-3 font-medium">System Total</th>
                            )}
                          </tr>
                        </thead>
                        <tbody>
                          {matrix.batteryOptions.map((b, i) => {
                            const pkg = b as unknown as Record<string, unknown>;
                            const price = (b.totalPrice ?? b.price ?? 0) as number;
                            const bName = b.name || b.model || "—";
                            const systemTotal = matrix.panelOnlyPrice
                              ? matrix.panelOnlyPrice + price - bundleDiscount : null;

                            return (
                            <tr key={i} className="border-b last:border-0">
                              <td className="py-1.5 pr-3 font-medium text-[#1D1D1D] max-w-[200px]">
                                <div className="truncate">{bName}</div>
                              </td>
                              {isFullSystem && (
                                <td className="py-1.5 pr-3 text-[12px] text-[#7a7a7a]">
                                  {pkg.panelCount ? `${pkg.panelCount}x ` : ""}
                                  {pkg.panelModel ? String(pkg.panelModel).replace(/\(.*\)/, "").trim() : "—"}
                                </td>
                              )}
                              <td className="py-1.5 pr-3 text-[#7a7a7a]">
                                {b.model || "—"}
                                {b.capacityKwh ? ` ${b.capacityKwh}kWh` : ""}
                              </td>
                              {isFullSystem && (
                                <td className="py-1.5 pr-3 text-right text-[#7a7a7a]">
                                  {pkg.systemSizeKw ? `${pkg.systemSizeKw}kW` : "—"}
                                </td>
                              )}
                              <td className="py-1.5 pr-3 text-right font-medium text-[#1D1D1D]">
                                £{price.toLocaleString()}
                              </td>
                              {isFullSystem && (
                                <td className="py-1.5 pr-3 text-right text-[#7a7a7a]">
                                  {pkg.monthlyPayment ? `£${pkg.monthlyPayment}/mo` : "—"}
                                </td>
                              )}
                              {!isFullSystem && matrix.panelOnlyPrice && (
                                <td className="py-1.5 pr-3 text-right font-medium">
                                  {systemTotal ? `£${systemTotal.toLocaleString()}` : "—"}
                                </td>
                              )}
                            </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  );
                })()}

                {/* Included extras */}
                {(matrix.includedExtras ?? []).length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {matrix.includedExtras?.map((extra, i) => (
                      <Badge key={i} variant="secondary" className="text-[10px] bg-green-50 text-green-700">
                        {extra}
                      </Badge>
                    ))}
                  </div>
                )}
              </CardContent>
            )}

            {/* Error state */}
            {latest?.status === "failed" && (
              <CardContent className="pt-0 pb-3">
                <div className="text-[13px] text-red-500">
                  Last scrape failed: {latest.errorLog}
                </div>
              </CardContent>
            )}

            {/* Expand for history */}
            <div
              className="border-t px-6 py-2 flex items-center justify-center cursor-pointer hover:bg-gray-50 transition-colors"
              onClick={() => toggleExpand(config.installerId)}
            >
              <span className="text-[12px] text-[#9a9a9a] flex items-center gap-1">
                {isExpanded ? (
                  <>
                    Hide history <ChevronUp className="h-3.5 w-3.5" />
                  </>
                ) : (
                  <>
                    View history ({config.totalScrapes}) <ChevronDown className="h-3.5 w-3.5" />
                  </>
                )}
              </span>
            </div>

            {/* History table */}
            {isExpanded && (
              <CardContent className="pt-0 pb-3 border-t">
                {!history[config.installerId] ? (
                  <div className="text-[12px] text-[#9a9a9a] py-2">Loading...</div>
                ) : history[config.installerId].length === 0 ? (
                  <div className="text-[12px] text-[#9a9a9a] py-2">No scrape history yet.</div>
                ) : (
                  <table className="w-full text-[12px] mt-2">
                    <thead>
                      <tr className="border-b text-[#9a9a9a]">
                        <th className="text-left py-1.5 pr-3 font-medium">Date</th>
                        <th className="text-left py-1.5 pr-3 font-medium">Status</th>
                        <th className="text-right py-1.5 pr-3 font-medium">Panel Only</th>
                        <th className="text-right py-1.5 pr-3 font-medium">Per Panel</th>
                        <th className="text-right py-1.5 pr-3 font-medium">Panels</th>
                        <th className="text-left py-1.5 font-medium">Model</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history[config.installerId].map((result) => (
                        <tr key={result.id} className="border-b last:border-0">
                          <td className="py-1.5 pr-3">
                            {new Date(result.scrapedAt).toLocaleDateString("en-GB", {
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </td>
                          <td className="py-1.5 pr-3">
                            <Badge
                              variant="secondary"
                              className={`text-[10px] ${
                                result.status === "completed"
                                  ? "bg-green-100 text-green-700"
                                  : result.status === "failed"
                                  ? "bg-red-100 text-red-700"
                                  : "bg-yellow-100 text-yellow-700"
                              }`}
                            >
                              {result.status}
                            </Badge>
                          </td>
                          <td className="py-1.5 pr-3 text-right font-medium">
                            {result.panelOnlyPrice
                              ? `£${result.panelOnlyPrice.toLocaleString()}`
                              : "—"}
                          </td>
                          <td className="py-1.5 pr-3 text-right">
                            {result.pricePerPanel ? `£${result.pricePerPanel}` : "—"}
                          </td>
                          <td className="py-1.5 pr-3 text-right">
                            {result.recommendedPanelCount || "—"}
                          </td>
                          <td className="py-1.5 text-[#9a9a9a] truncate max-w-[200px]">
                            {result.panelModel || "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            )}
          </Card>
        );
      })}
    </div>
  );
}
