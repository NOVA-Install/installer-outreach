"use client";

import { useState, useMemo } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";

interface ScrapeResult {
  id: number;
  installerId: number;
  status: string;
  priceMatrix: string | null;
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
  panelPrice: number | null;
  batteryName: string | null;
  batteryCapacityKwh: number | null;
  batteryPrice: number | null;
  systemTotal: number | null;
  monthlyPayment: number | null;
  panelModel: string | null;
  panelCount: number;
  isFullSystem: boolean;
}

const PANEL_OPTIONS = [4, 6, 8, 10, 12, 14, 16, 18, 20];
const BATTERY_OPTIONS = [
  { label: "No battery", value: 0 },
  { label: "~5 kWh", value: 5 },
  { label: "~10 kWh", value: 10 },
  { label: "~13.5 kWh", value: 13.5 },
  { label: "~15 kWh", value: 15 },
  { label: "~27 kWh", value: 27 },
  { label: "~40 kWh", value: 40 },
];

export function PriceComparison({ configs }: { configs: ScraperConfig[] }) {
  const [selectedPanels, setSelectedPanels] = useState(10);
  const [selectedBattery, setSelectedBattery] = useState(5);

  const quotes = useMemo(() => {
    const results: MatchedQuote[] = [];

    for (const config of configs) {
      if (!config.latestResult?.priceMatrix) continue;

      let matrix: Record<string, unknown>;
      try {
        matrix = JSON.parse(config.latestResult.priceMatrix);
      } catch {
        continue;
      }

      const batteryOptions = (matrix.batteryOptions as Array<Record<string, unknown>>) || [];
      if (batteryOptions.length === 0) continue;

      // Detect if this is a full-system package or battery add-on installer
      const isFullSystem = batteryOptions.some(
        (b) => b.panelModel || b.panelCount || b.systemSizeKw
      );

      if (isFullSystem) {
        // Full system packages (Wickes-style): find best matching package
        const matched = findBestFullSystemMatch(
          batteryOptions,
          selectedPanels,
          selectedBattery
        );
        if (matched) {
          results.push({
            installerId: config.installerId,
            companyName: config.companyName,
            panelPrice: null,
            batteryName: matched.batteryName,
            batteryCapacityKwh: matched.batteryCapacityKwh,
            batteryPrice: null,
            systemTotal: matched.price,
            monthlyPayment: matched.monthlyPayment,
            panelModel: matched.panelModel,
            panelCount: matched.panelCount,
            isFullSystem: true,
          });
        }
      } else {
        // Battery add-on installer (Boxt-style): calculate system total
        const panelOnlyPrice = matrix.panelOnlyPrice as number | null;
        const pricePerPanel = matrix.pricePerPanel as number | null;
        const recommendedPanels = matrix.recommendedPanelCount as number | null;
        const originalTotal = matrix.originalTotalPrice as number | null;
        const recTotal = matrix.totalPrice as number | null;
        const bundleDiscount = (originalTotal && recTotal) ? originalTotal - recTotal : 0;

        // Calculate panel price for selected count
        let adjustedPanelPrice = panelOnlyPrice;
        if (panelOnlyPrice && pricePerPanel && recommendedPanels) {
          const panelDiff = selectedPanels - recommendedPanels;
          adjustedPanelPrice = panelOnlyPrice + panelDiff * pricePerPanel;
        }

        if (selectedBattery === 0) {
          // No battery selected
          results.push({
            installerId: config.installerId,
            companyName: config.companyName,
            panelPrice: adjustedPanelPrice,
            batteryName: "No battery",
            batteryCapacityKwh: 0,
            batteryPrice: 0,
            systemTotal: adjustedPanelPrice,
            monthlyPayment: null,
            panelModel: matrix.panelModel as string | null,
            panelCount: selectedPanels,
            isFullSystem: false,
          });
        } else {
          // Find cheapest battery within 1kWh of selected size
          const matched = findCheapestBatteryMatch(batteryOptions, selectedBattery);
          if (matched && adjustedPanelPrice) {
            const systemTotal = adjustedPanelPrice + matched.price - bundleDiscount;
            results.push({
              installerId: config.installerId,
              companyName: config.companyName,
              panelPrice: adjustedPanelPrice,
              batteryName: matched.name,
              batteryCapacityKwh: matched.capacityKwh,
              batteryPrice: matched.price,
              systemTotal,
              monthlyPayment: null,
              panelModel: matrix.panelModel as string | null,
              panelCount: selectedPanels,
              isFullSystem: false,
            });
          }
        }
      }
    }

    // Sort by system total price (cheapest first), nulls last
    return results.sort((a, b) => {
      if (a.systemTotal == null) return 1;
      if (b.systemTotal == null) return -1;
      return a.systemTotal - b.systemTotal;
    });
  }, [configs, selectedPanels, selectedBattery]);

  const configsWithData = configs.filter((c) => c.latestResult?.priceMatrix);
  if (configsWithData.length < 1) return null;

  return (
    <Card className="mb-6">
      <CardHeader className="pb-3">
        <CardTitle className="text-[15px] font-semibold">Price Comparison</CardTitle>
      </CardHeader>
      <CardContent>
        {/* Selectors */}
        <div className="flex items-center gap-4 mb-4">
          <div className="flex items-center gap-2">
            <span className="text-[13px] text-[#9a9a9a]">Panels:</span>
            <Select
              value={String(selectedPanels)}
              onValueChange={(v) => setSelectedPanels(Number(v))}
            >
              <SelectTrigger className="w-[80px] h-8 text-[13px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PANEL_OPTIONS.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[13px] text-[#9a9a9a]">Battery:</span>
            <Select
              value={String(selectedBattery)}
              onValueChange={(v) => setSelectedBattery(Number(v))}
            >
              <SelectTrigger className="w-[120px] h-8 text-[13px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BATTERY_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={String(opt.value)}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <span className="text-[11px] text-[#9a9a9a]">
            {quotes.length} of {configsWithData.length} installers have matching quotes
          </span>
        </div>

        {/* Comparison table */}
        {quotes.length === 0 ? (
          <p className="text-[13px] text-[#9a9a9a] py-4">
            No matching quotes for this configuration. Try different panel count or battery size.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b text-[11px] text-[#9a9a9a] uppercase tracking-wider">
                  <th className="text-left py-2 pr-3 font-medium">Installer</th>
                  <th className="text-left py-2 pr-3 font-medium">Panels</th>
                  <th className="text-left py-2 pr-3 font-medium">Battery</th>
                  <th className="text-right py-2 pr-3 font-medium">System Total</th>
                  <th className="text-right py-2 font-medium">Monthly</th>
                </tr>
              </thead>
              <tbody>
                {quotes.map((q, i) => (
                  <tr
                    key={q.installerId}
                    className={`border-b last:border-0 ${i === 0 ? "bg-emerald-50/50" : ""}`}
                  >
                    <td className="py-2 pr-3">
                      <Link
                        href={`/installers/${q.installerId}`}
                        className="font-medium text-[#1D1D1D] hover:underline"
                      >
                        {q.companyName}
                      </Link>
                      {i === 0 && (
                        <Badge className="ml-1.5 text-[9px] bg-emerald-100 text-emerald-700 border-0">
                          Cheapest
                        </Badge>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-[#7a7a7a]">
                      <div>{q.panelCount}x {q.panelModel ? q.panelModel.replace(/\(.*\)/, "").trim().slice(0, 25) : "panels"}</div>
                      {q.panelPrice != null && (
                        <div className="text-[11px]">panels: £{q.panelPrice.toLocaleString()}</div>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-[#7a7a7a]">
                      {q.batteryName || "—"}
                      {q.batteryCapacityKwh ? ` (${q.batteryCapacityKwh}kWh)` : ""}
                      {q.batteryPrice != null && q.batteryPrice > 0 && (
                        <div className="text-[11px]">+£{q.batteryPrice.toLocaleString()}</div>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-right font-semibold text-[#1D1D1D]">
                      {q.systemTotal != null ? `£${q.systemTotal.toLocaleString()}` : "—"}
                    </td>
                    <td className="py-2 text-right text-[#7a7a7a]">
                      {q.monthlyPayment ? `£${q.monthlyPayment}/mo` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Find the cheapest battery within 1kWh of the target size.
 */
function findCheapestBatteryMatch(
  options: Array<Record<string, unknown>>,
  targetKwh: number
): { name: string; capacityKwh: number; price: number } | null {
  const candidates = options
    .filter((b) => {
      const cap = (b.capacityKwh as number) ?? 0;
      return Math.abs(cap - targetKwh) <= 1;
    })
    .map((b) => ({
      name: (b.model || b.name || "Unknown") as string,
      capacityKwh: (b.capacityKwh as number) ?? 0,
      price: ((b.totalPrice ?? b.price) as number) ?? Infinity,
    }))
    .sort((a, b) => a.price - b.price);

  return candidates[0] || null;
}

/**
 * Find the best matching full-system package (Wickes-style).
 * Matches by battery capacity within 1kWh, prefers matching panel count.
 */
function findBestFullSystemMatch(
  options: Array<Record<string, unknown>>,
  targetPanels: number,
  targetBatteryKwh: number
): {
  price: number;
  batteryName: string;
  batteryCapacityKwh: number;
  monthlyPayment: number | null;
  panelModel: string | null;
  panelCount: number;
} | null {
  // Filter by battery capacity within 1kWh
  let candidates = options.filter((b) => {
    const cap = (b.capacityKwh as number) ?? 0;
    if (targetBatteryKwh === 0) return cap === 0 || !b.capacityKwh;
    return Math.abs(cap - targetBatteryKwh) <= 1;
  });

  // If no exact battery match, try within 3kWh
  if (candidates.length === 0 && targetBatteryKwh > 0) {
    candidates = options.filter((b) => {
      const cap = (b.capacityKwh as number) ?? 0;
      return Math.abs(cap - targetBatteryKwh) <= 3;
    });
  }

  // If still nothing, use all options
  if (candidates.length === 0) {
    candidates = [...options];
  }

  // Sort by price (cheapest first)
  const sorted = candidates
    .map((b) => ({
      price: ((b.totalPrice ?? b.price) as number) ?? Infinity,
      batteryName: (b.model || b.name || "Unknown") as string,
      batteryCapacityKwh: (b.capacityKwh as number) ?? 0,
      monthlyPayment: (b.monthlyPayment as number) ?? null,
      panelModel: (b.panelModel as string) ?? null,
      panelCount: (b.panelCount ?? b.recommendedPanels ?? targetPanels) as number,
    }))
    .sort((a, b) => a.price - b.price);

  return sorted[0] || null;
}
