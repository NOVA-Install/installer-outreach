"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Calculator, FileText, Mail, Play } from "lucide-react";
import { toast } from "sonner";

interface Target {
  id: number;
  campaignId: number;
  installerId: number;
  category: string;
  status: string;
  submittedAt: string | null;
  firstResponseAt: string | null;
  responseTimeHours: number | null;
  responseFormat: string | null;
  createdAt: string;
}

interface Quote {
  id: number;
  targetId: number;
  optionLabel: string | null;
  totalPrice: number | null;
  summary: string | null;
  details: string | null;
  confidence: number | null;
  createdAt: string;
}

interface Campaign {
  id: number;
  name: string;
  status: string;
  zones: string | null;
  systemSpec: string | null;
  totalTargets: number | null;
  processedTargets: number | null;
  errorCount: number | null;
  createdAt: string;
}

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-gray-100 text-gray-700",
  submitting: "bg-yellow-100 text-yellow-700",
  submitted: "bg-blue-100 text-blue-700",
  response_received: "bg-indigo-100 text-indigo-700",
  parsed: "bg-green-100 text-green-700",
  failed: "bg-red-100 text-red-700",
  no_response: "bg-gray-100 text-gray-500",
};

const CATEGORY_ICONS: Record<string, typeof Calculator> = {
  calculator: Calculator,
  web_form: FileText,
  email_outreach: Mail,
};

export function CampaignDetail({ campaignId }: { campaignId: number }) {
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [targets, setTargets] = useState<Target[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);

  const fetchData = useCallback(async () => {
    const res = await fetch(`/api/mystery-shopping/campaigns/${campaignId}`);
    if (!res.ok) return;
    const data = await res.json();
    setCampaign(data.campaign);
    setTargets(data.targets);
    setQuotes(data.quotes);
    setLoading(false);
  }, [campaignId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const startCampaign = async () => {
    setStarting(true);
    try {
      const res = await fetch(`/api/mystery-shopping/campaigns/${campaignId}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categories: ["calculator"] }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to start");
      }
      toast.success("Campaign started — scraping calculators");
      fetchData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to start campaign");
    } finally {
      setStarting(false);
    }
  };

  if (loading) {
    return <div className="text-[13px] text-[#9a9a9a]">Loading...</div>;
  }

  if (!campaign) {
    return <div className="text-[13px] text-red-500">Campaign not found</div>;
  }

  // Stats by category
  const categoryStats = targets.reduce(
    (acc, t) => {
      if (!acc[t.category]) acc[t.category] = { total: 0, responded: 0, parsed: 0 };
      acc[t.category].total++;
      if (t.status === "response_received" || t.status === "parsed") acc[t.category].responded++;
      if (t.status === "parsed") acc[t.category].parsed++;
      return acc;
    },
    {} as Record<string, { total: number; responded: number; parsed: number }>
  );

  // Quote stats
  const quotePrices = quotes
    .map((q) => q.totalPrice)
    .filter((p): p is number => p != null);
  const avgPrice = quotePrices.length > 0
    ? Math.round(quotePrices.reduce((a, b) => a + b, 0) / quotePrices.length)
    : null;
  const minPrice = quotePrices.length > 0 ? Math.min(...quotePrices) : null;
  const maxPrice = quotePrices.length > 0 ? Math.max(...quotePrices) : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link href="/mystery-shopping">
          <Button variant="ghost" size="sm" className="gap-1">
            <ArrowLeft className="h-3.5 w-3.5" />
            Back
          </Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-[18px] font-semibold text-[#1D1D1D]">{campaign.name}</h1>
          {campaign.systemSpec && (
            <p className="text-[13px] text-[#9a9a9a]">{campaign.systemSpec}</p>
          )}
        </div>
        {campaign.status === "draft" && (
          <Button size="sm" className="gap-1.5" onClick={startCampaign} disabled={starting}>
            <Play className="h-3.5 w-3.5" />
            {starting ? "Starting..." : "Start Campaign"}
          </Button>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-3">
        <Card>
          <CardContent className="pt-4">
            <div className="text-[12px] text-[#9a9a9a]">Total Targets</div>
            <div className="text-[20px] font-semibold">{targets.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-[12px] text-[#9a9a9a]">Quotes Received</div>
            <div className="text-[20px] font-semibold">{quotes.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-[12px] text-[#9a9a9a]">Avg Price</div>
            <div className="text-[20px] font-semibold">
              {avgPrice != null ? `£${avgPrice.toLocaleString()}` : "—"}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-[12px] text-[#9a9a9a]">Price Range</div>
            <div className="text-[20px] font-semibold">
              {minPrice != null && maxPrice != null
                ? `£${minPrice.toLocaleString()} – £${maxPrice.toLocaleString()}`
                : "—"}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Category breakdown */}
      <div className="grid grid-cols-3 gap-3">
        {Object.entries(categoryStats).map(([cat, stats]) => {
          const Icon = CATEGORY_ICONS[cat] || Calculator;
          return (
            <Card key={cat}>
              <CardHeader className="pb-2">
                <CardTitle className="text-[13px] font-medium flex items-center gap-2">
                  <Icon className="h-4 w-4" />
                  {cat === "calculator" ? "Calculator" : cat === "web_form" ? "Web Form" : "Email"}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-[12px] text-[#9a9a9a] space-y-1">
                  <div className="flex justify-between">
                    <span>Total</span>
                    <span className="font-medium text-[#1D1D1D]">{stats.total}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Responded</span>
                    <span className="font-medium text-[#1D1D1D]">{stats.responded}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Parsed</span>
                    <span className="font-medium text-[#1D1D1D]">{stats.parsed}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Quotes table */}
      {quotes.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-[14px] font-medium">Quotes</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b text-[#9a9a9a]">
                    <th className="text-left py-2 pr-4 font-medium">Option</th>
                    <th className="text-right py-2 pr-4 font-medium">Total Price</th>
                    <th className="text-left py-2 pr-4 font-medium">Summary</th>
                    <th className="text-right py-2 font-medium">Confidence</th>
                  </tr>
                </thead>
                <tbody>
                  {quotes.map((quote) => (
                    <tr key={quote.id} className="border-b last:border-0">
                      <td className="py-2 pr-4">{quote.optionLabel || "—"}</td>
                      <td className="py-2 pr-4 text-right font-medium">
                        {quote.totalPrice != null
                          ? `£${quote.totalPrice.toLocaleString()}`
                          : "—"}
                      </td>
                      <td className="py-2 pr-4 text-[#9a9a9a] max-w-[400px] truncate">
                        {quote.summary || "—"}
                      </td>
                      <td className="py-2 text-right">
                        {quote.confidence != null
                          ? `${Math.round(quote.confidence * 100)}%`
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Targets table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-[14px] font-medium">
            Targets ({targets.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b text-[#9a9a9a]">
                  <th className="text-left py-2 pr-4 font-medium">ID</th>
                  <th className="text-left py-2 pr-4 font-medium">Category</th>
                  <th className="text-left py-2 pr-4 font-medium">Status</th>
                  <th className="text-left py-2 pr-4 font-medium">Response Time</th>
                  <th className="text-left py-2 font-medium">Submitted</th>
                </tr>
              </thead>
              <tbody>
                {targets.map((target) => (
                  <tr key={target.id} className="border-b last:border-0">
                    <td className="py-2 pr-4">#{target.installerId}</td>
                    <td className="py-2 pr-4">
                      <Badge variant="outline" className="text-[11px]">
                        {target.category}
                      </Badge>
                    </td>
                    <td className="py-2 pr-4">
                      <Badge
                        variant="secondary"
                        className={`text-[11px] ${STATUS_COLORS[target.status] || ""}`}
                      >
                        {target.status.replace(/_/g, " ")}
                      </Badge>
                    </td>
                    <td className="py-2 pr-4">
                      {target.responseTimeHours != null
                        ? target.responseTimeHours < 1
                          ? `${Math.round(target.responseTimeHours * 60)}m`
                          : `${Math.round(target.responseTimeHours)}h`
                        : "—"}
                    </td>
                    <td className="py-2 text-[#9a9a9a]">
                      {target.submittedAt
                        ? new Date(target.submittedAt).toLocaleDateString("en-GB")
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
