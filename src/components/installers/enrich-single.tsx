"use client";

import { useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Sparkles, CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

const SOURCES = [
  { key: "companies_house", label: "Companies House", cost: "Free", group: "free" },
  { key: "tech_detection", label: "Tech Detection", cost: "Free", group: "free" },
  { key: "google_reviews", label: "Google Reviews", costByPriority: { standard: "$0.00075/10 reviews (up to 45 min)", priority: "$0.0015/10 reviews (up to 1 min)" }, group: "reviews" },
  { key: "trustpilot", label: "Trustpilot", costByPriority: { standard: "$0.00075/10 results (up to 45 min)", priority: "$0.0015/10 results (up to 1 min)" }, group: "reviews" },
  { key: "seo", label: "SEO / Backlinks", cost: "~$0.005", group: "seo" },
  { key: "traffic_bulk", label: "Traffic (Quick)", cost: "$0.001/domain", group: "traffic" },
  { key: "traffic_detailed", label: "Traffic (Detailed)", cost: "~$0.01/domain", group: "traffic" },
  { key: "keywords", label: "Keywords for Site", cost: "~$0.01", group: "traffic" },
  { key: "google_business", label: "Google Business Info", cost: "~$0.002", group: "business" },
  { key: "google_ads", label: "Google Ads Transparency", cost: "~$0.002", group: "marketing" },
  { key: "job_postings", label: "Job Postings", cost: "~$0.002", group: "signals" },
  { key: "website_quality", label: "Website Quality & PageSpeed", cost: "Free", group: "free" },
  { key: "creditsafe", label: "CreditSafe", cost: "Subscription", disabled: true, group: "other" },
];

type ReviewMode = "aggregate" | "individual";
type Priority = "priority" | "standard";

export function EnrichSingle({
  installerId,
  hasGoogleReviews = false,
  hasTrustpilotProfile = false,
}: {
  installerId: number;
  hasGoogleReviews?: boolean;
  hasTrustpilotProfile?: boolean;
}) {
  const [running, setRunning] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, { success: boolean; message: string }>>({});
  const [reviewMode, setReviewMode] = useState<ReviewMode>("aggregate");
  const [priority, setPriority] = useState<Priority>("priority");
  const router = useRouter();

  const runEnrichment = async (source: string) => {
    setRunning(source);
    try {
      const res = await fetch(`/api/installers/${installerId}/enrich`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source, reviewMode, priority }),
      });

      const data = await res.json();

      if (data.errors?.length > 0) {
        setResults((prev) => ({
          ...prev,
          [source]: { success: false, message: data.errors[0] },
        }));
        toast.error(data.errors[0], { duration: 8000 });
      } else {
        const resultData = data.results?.[source];
        // Build a descriptive message from the result data
        let message = resultData?.message || "Data fetched";
        if (resultData && !resultData.message) {
          const details = Object.entries(resultData)
            .filter(([k]) => !["mode", "priority", "searchQuery", "searchTerm", "taskStatus"].includes(k))
            .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`)
            .join(", ");
          if (details) message = details;
        }
        setResults((prev) => ({
          ...prev,
          [source]: { success: true, message },
        }));
        toast.success(`${SOURCES.find((s) => s.key === source)?.label}: ${message}`);
        router.refresh();
      }
    } catch {
      setResults((prev) => ({
        ...prev,
        [source]: { success: false, message: "Request failed" },
      }));
      toast.error("Failed to fetch data");
    } finally {
      setRunning(null);
    }
  };

  const runAll = async () => {
    setRunning("all");
    try {
      const res = await fetch(`/api/installers/${installerId}/enrich`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: "all", reviewMode, priority }),
      });

      const data = await res.json();

      for (const [key, val] of Object.entries(data.results || {})) {
        const v = val as { message?: string };
        setResults((prev) => ({
          ...prev,
          [key]: { success: true, message: v.message || "Done" },
        }));
      }

      if (data.errors?.length > 0) {
        for (const err of data.errors as string[]) {
          const source = err.split(":")[0].toLowerCase().replace(/ /g, "_");
          setResults((prev) => ({
            ...prev,
            [source]: { success: false, message: err },
          }));
        }
        toast.error(`Completed with ${data.errors.length} error(s)`);
      } else {
        toast.success("All enrichment complete");
      }
      router.refresh();
    } catch {
      toast.error("Enrichment failed");
    } finally {
      setRunning(null);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" />
            Enrich Data
          </span>
          <Button size="sm" onClick={runAll} disabled={running !== null}>
            {running === "all" ? (
              <Loader2 className="h-4 w-4 animate-spin mr-1" />
            ) : (
              <Sparkles className="h-4 w-4 mr-1" />
            )}
            Fetch All
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Options */}
        <div className="flex flex-wrap gap-3 rounded-lg border p-3 bg-muted/30">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Reviews</label>
            <Select
              value={reviewMode}
              onValueChange={(v: string | null) => {
                if (v) setReviewMode(v as ReviewMode);
              }}
            >
              <SelectTrigger className="w-[180px] h-7 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="aggregate">Aggregate only</SelectItem>
                <SelectItem
                  value="individual"
                  disabled={!hasGoogleReviews && !hasTrustpilotProfile}
                >
                  Individual reviews
                  {!hasGoogleReviews && !hasTrustpilotProfile && " (run aggregate first)"}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Priority</label>
            <Select
              value={priority}
              onValueChange={(v: string | null) => {
                if (v) setPriority(v as Priority);
              }}
            >
              <SelectTrigger className="w-[150px] h-7 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="priority">Priority (~1 min, 2x cost)</SelectItem>
                <SelectItem value="standard">Standard (~45 min, cheapest)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="text-xs font-medium text-muted-foreground">Pricing notes</label>
            <div className="text-xs text-muted-foreground mt-1.5 space-y-0.5">
              <p>Google Reviews: {priority === "standard" ? "$0.00075" : "$0.0015"}/10 reviews</p>
              <p>Trustpilot: {priority === "standard" ? "$0.00075" : "$0.0015"}/10 results</p>
              <p>Wait time: {priority === "standard" ? "up to 45 min" : "up to 1 min"}</p>
              {reviewMode === "individual" && (
                <p className="text-primary">Individual reviews cost more (billed per 10/20 reviews returned)</p>
              )}
            </div>
          </div>
        </div>

        {/* Sources */}
        <div className="space-y-2">
          {SOURCES.map((source) => {
            const result = results[source.key];
            const isDisabled = !!(source as Record<string, unknown>).disabled;
            return (
              <div
                key={source.key}
                className="flex items-center justify-between py-1.5"
              >
                <div className="flex items-center gap-2">
                  {result?.success === true && (
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                  )}
                  {result?.success === false && (
                    <XCircle className="h-3.5 w-3.5 text-red-400" />
                  )}
                  {result === undefined && <div className="h-3.5 w-3.5" />}
                  <span className="text-sm">{source.label}</span>
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                    {"costByPriority" in source
                      ? (source.costByPriority as Record<string, string>)[priority]
                      : source.cost}
                  </Badge>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => runEnrichment(source.key)}
                  disabled={running !== null || isDisabled}
                  className="h-7 text-xs"
                >
                  {running === source.key ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : isDisabled ? (
                    "Coming Soon"
                  ) : (
                    "Fetch"
                  )}
                </Button>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
