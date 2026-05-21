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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Loader2,
  Play,
  CheckCircle2,
  XCircle,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

interface TaskProgress {
  pending: number;
  completed: number;
  failed: number;
  noResults: number;
  total: number;
}

interface EnrichmentStatus {
  total: number;
  coverage: Record<string, number>;
  pendingTasks?: Record<string, TaskProgress>;
  jobs: Record<
    string,
    {
      id: number;
      type: string;
      status: string;
      totalItems: number;
      processedItems: number;
      errorCount: number;
      errorLog: string | null;
      startedAt: string | null;
      completedAt: string | null;
    }
  >;
}

const SOURCES = [
  {
    key: "email_to_website",
    label: "Website from Email",
    endpoint: "/api/enrichment/email-to-website",
    description: "Extract website domain from email address (skips Gmail, Hotmail, Yahoo etc.)",
    cost: "Free",
  },
  {
    key: "tech_detection",
    label: "Website Tech Detection",
    endpoint: "/api/enrichment/tech-detection",
    description: "Scans installer websites for GA, Meta Pixel, CRM tools, live chat",
    cost: "Free",
  },
  {
    key: "companies_house",
    label: "Companies House",
    endpoint: "/api/enrichment/companies-house",
    description: "Company overview, directors, PSC, accounts filings, insolvency flags",
    cost: "Free",
  },
  {
    key: "google_reviews",
    label: "Google Reviews",
    endpoint: "/api/enrichment/google-reviews",
    description: "Aggregate rating + review count",
    costByPriority: {
      standard: "$0.00075/10 reviews (up to 45 min)",
      priority: "$0.0015/10 reviews (up to 1 min)",
    },
  },
  {
    key: "trustpilot",
    label: "Trustpilot (by name)",
    endpoint: "/api/enrichment/trustpilot",
    description: "Search Trustpilot by company name. Run this first.",
    costByPriority: {
      standard: "$0.00075/10 results (up to 45 min)",
      priority: "$0.0015/10 results (up to 1 min)",
    },
  },
  {
    key: "trustpilot_domain",
    label: "Trustpilot (by domain)",
    endpoint: "/api/enrichment/trustpilot-domain",
    description: "Fallback: search by website domain for unmatched installers. Run after collecting name results.",
    costByPriority: {
      standard: "$0.00075/10 results (up to 45 min)",
      priority: "$0.0015/10 results (up to 1 min)",
    },
  },
  {
    key: "seo",
    label: "SEO / Backlinks",
    endpoint: "/api/enrichment/seo",
    description: "Domain authority, backlinks, referring domains",
    cost: "~$0.005/domain",
  },
  {
    key: "traffic_bulk",
    label: "Traffic (Quick)",
    endpoint: "/api/enrichment/traffic-bulk",
    description: "Organic + paid traffic estimates for Google & Bing",
    cost: "$0.001/domain",
  },
  {
    key: "google_business",
    label: "Google Business Info",
    endpoint: "/api/enrichment/google-business",
    description: "Phone, website, hours, category, claimed status from Google Maps (uses place_id from reviews)",
    cost: "~$0.002/business",
  },
  {
    key: "google_ads_transparency",
    label: "Google Ads Transparency",
    endpoint: "/api/enrichment/google-ads",
    description: "Detect active Google Ads campaigns, ad counts, formats, verification status",
    cost: "~$0.002/domain",
  },
  {
    key: "job_postings",
    label: "Job Postings",
    endpoint: "/api/enrichment/job-postings",
    description: "Detect if company is hiring via Indeed, LinkedIn, Reed, Totaljobs, etc.",
    cost: "~$0.002/search",
  },
  {
    key: "creditsafe",
    label: "CreditSafe",
    endpoint: "",
    description: "Credit reports, financial data, employee count, risk scores (coming soon)",
    cost: "Subscription",
    disabled: true,
  },
  {
    key: "county_backfill",
    label: "County from Postcode",
    endpoint: "/api/enrichment/county-backfill",
    description: "Fill missing county fields using postcode lookup (no API needed)",
    cost: "Free",
  },
  {
    key: "scores",
    label: "Recalculate Scores",
    endpoint: "/api/enrichment/scores",
    description: "Compute reputation, volume, marketing, and overall scores",
    cost: "Free",
  },
];

function CostEstimator({ total, coverage }: { total: number; coverage: Record<string, number> }) {
  const gRemaining = Math.max(0, total - (coverage.google_reviews || 0));
  const tRemaining = Math.max(0, total - (coverage.trustpilot || 0));
  const sRemaining = Math.max(0, total - (coverage.seo || 0));
  const rows: [string, string][] = [
    [`Google Reviews (${gRemaining} remaining)`, `~$${(gRemaining * 0.0015).toFixed(2)} priority / $${(gRemaining * 0.00075).toFixed(2)} standard`],
    [`Trustpilot (${tRemaining} remaining)`, `~$${(tRemaining * 0.0015).toFixed(2)} priority / $${(tRemaining * 0.00075).toFixed(2)} standard`],
    [`SEO / Backlinks (${sRemaining} remaining)`, `~$${(sRemaining * 0.005).toFixed(2)}`],
    ["Tech Detection + Companies House", "Free"],
  ];
  return (
    <div className="rounded-lg bg-[#FFF8F5] border border-[#4ABDE8]/20 px-3 py-2.5">
      <p className="text-[11px] font-medium text-[#4ABDE8] uppercase tracking-wider mb-1.5">Estimated enrichment costs</p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[12px]">
        {rows.map(([label, cost]) => (
          <div key={label} className="contents">
            <span className="text-[#6a6a6a]">{label}</span>
            <span className={`tabular-nums font-medium ${cost === "Free" ? "text-green-600" : "text-[#1D1D1D]"}`}>{cost}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function EnrichmentPanel() {
  const [status, setStatus] = useState<EnrichmentStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState<Set<string>>(new Set());
  const [priority, setPriority] = useState<"priority" | "standard">("priority");
  const [reviewMode, setReviewMode] = useState<"aggregate" | "individual">("aggregate");
  const [lastErrors, setLastErrors] = useState<Record<string, string>>({});

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/enrichment/status");
      const data = await res.json();
      setStatus(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 3000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  const runEnrichment = async (source: (typeof SOURCES)[0]) => {
    setRunning((prev) => new Set([...prev, source.key]));
    setLastErrors((prev) => { const next = { ...prev }; delete next[source.key]; return next; });

    try {
      const res = await fetch(source.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priority, reviewMode }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `Failed: ${res.status}`);
      }
      toast.success(`${source.label}: tasks submitted. Click "Collect Results" to retrieve data.`);
      fetchStatus();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast.error(`${source.label}: ${msg}`, { duration: 8000 });
      setLastErrors((prev) => ({ ...prev, [source.key]: msg }));
    } finally {
      setRunning((prev) => {
        const next = new Set(prev);
        next.delete(source.key);
        return next;
      });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Summary */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-[13px] font-medium text-muted-foreground flex items-center justify-between">
            Data Coverage
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={fetchStatus}
            >
              <RefreshCw className="h-3 w-3" />
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {status && status.total > 0 ? (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-3 text-[13px]">
                {Object.entries(status.coverage).map(([key, val]) => (
                  <div key={key}>
                    <p className="text-[11px] text-muted-foreground capitalize uppercase tracking-wider">
                      {key.replace(/_/g, " ")}
                    </p>
                    <p className="font-medium tabular-nums mt-0.5">
                      {val} / {status.total}{" "}
                      <span className="text-muted-foreground font-normal">
                        ({Math.round((val / status.total) * 100)}%)
                      </span>
                    </p>
                  </div>
                ))}
              </div>
              <CostEstimator total={status.total} coverage={status.coverage} />
            </div>
          ) : (
            <p className="text-[13px] text-muted-foreground">
              No data imported yet. Import installers first.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Collect Pending Results */}
      <Card>
        <CardContent className="pt-4 pb-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-[13px]">
              <p className="font-medium">Collect Pending Results</p>
              <p className="text-[12px] text-muted-foreground">
                Tasks run on DataForSEO servers. Click to retrieve completed results.
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                setRunning((prev) => new Set([...prev, "__collect"]));
                try {
                  const res = await fetch("/api/enrichment/collect", { method: "POST" });
                  const data = await res.json();
                  const parts = [`${data.collected} collected`];
                  if (data.stillPending > 0) parts.push(`${data.stillPending} still pending`);
                  if (data.rejected > 0) parts.push(`${data.rejected} rejected (wrong match)`);
                  if (data.errored > 0) parts.push(`${data.errored} errors`);
                  if (data.timedOut) parts.push("(timed out - click again for more)");
                  toast.success(parts.join(", "), { duration: 8000 });

                  if (data.rejectedMatches?.length > 0) {
                    toast.info(
                      `Rejected matches:\n${data.rejectedMatches.slice(0, 5).join("\n")}${data.rejectedMatches.length > 5 ? `\n...and ${data.rejectedMatches.length - 5} more` : ""}`,
                      { duration: 15000 }
                    );
                  }
                  fetchStatus();
                } catch {
                  toast.error("Failed to collect results");
                } finally {
                  setRunning((prev) => { const next = new Set(prev); next.delete("__collect"); return next; });
                }
              }}
              disabled={running.has("__collect")}
            >
              {running.has("__collect") ? (
                <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Collecting</>
              ) : (
                <><RefreshCw className="h-3.5 w-3.5" /> Collect Results</>
              )}
            </Button>
          </div>

          {/* Task progress breakdown */}
          {status?.pendingTasks && Object.keys(status.pendingTasks).length > 0 && (
            <div className="space-y-2">
              {Object.entries(status.pendingTasks).map(([source, progress]) => {
                const pct = progress.total > 0 ? Math.round(((progress.completed + progress.noResults + progress.failed) / progress.total) * 100) : 0;
                const sourceLabels: Record<string, string> = {
                  google_reviews: "Google Reviews",
                  trustpilot_search: "Trustpilot",
                  trustpilot_reviews: "Trustpilot Reviews",
                };
                return (
                  <div key={source} className="space-y-1">
                    <div className="flex justify-between text-[12px]">
                      <span>{sourceLabels[source] || source}</span>
                      <span className="text-muted-foreground tabular-nums">
                        {progress.pending > 0 && <span className="text-amber-600">{progress.pending} pending</span>}
                        {progress.pending > 0 && (progress.completed > 0 || progress.failed > 0) && " · "}
                        {progress.completed > 0 && <span className="text-emerald-600">{progress.completed} done</span>}
                        {progress.failed > 0 && <span className="text-red-500"> · {progress.failed} failed</span>}
                        {progress.noResults > 0 && <span> · {progress.noResults} no results</span>}
                        <span className="ml-1">({pct}%)</span>
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden flex">
                      {progress.completed > 0 && (
                        <div className="h-full bg-emerald-500 transition-all" style={{ width: `${(progress.completed / progress.total) * 100}%` }} />
                      )}
                      {progress.noResults > 0 && (
                        <div className="h-full bg-gray-400 transition-all" style={{ width: `${(progress.noResults / progress.total) * 100}%` }} />
                      )}
                      {progress.failed > 0 && (
                        <div className="h-full bg-red-400 transition-all" style={{ width: `${(progress.failed / progress.total) * 100}%` }} />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Options */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Priority</label>
              <Select
                value={priority}
                onValueChange={(v: string | null) => { if (v) setPriority(v as "priority" | "standard"); }}
              >
                <SelectTrigger className="w-[200px] h-8 text-[13px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="priority">Priority (~1 min, 2x cost)</SelectItem>
                  <SelectItem value="standard">Standard (~45 min, cheapest)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Reviews</label>
              <Select
                value={reviewMode}
                onValueChange={(v: string | null) => { if (v) setReviewMode(v as "aggregate" | "individual"); }}
              >
                <SelectTrigger className="w-[180px] h-8 text-[13px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="aggregate">Aggregate only</SelectItem>
                  <SelectItem value="individual">Individual reviews</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <p className="text-[11px] text-muted-foreground">
              These settings apply to Google Reviews and Trustpilot batch runs.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Enrichment Sources */}
      {SOURCES.map((source) => {
        const job = status?.jobs?.[source.key];
        const isRunning =
          job?.status === "running" ||
          job?.status === "pending" ||
          running.has(source.key);
        const progress =
          job?.totalItems && job.totalItems > 0
            ? Math.round((job.processedItems / job.totalItems) * 100)
            : 0;

        return (
          <Card key={source.key}>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <h3 className="text-[13px] font-medium">{source.label}</h3>
                    <Badge variant="outline" className="text-[10px]">
                      {"costByPriority" in source
                        ? (source.costByPriority as Record<string, string>)[priority]
                        : source.cost}
                    </Badge>
                    {job?.status === "completed" && (
                      <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                    )}
                    {job?.status === "failed" && (
                      <XCircle className="h-3.5 w-3.5 text-red-500" />
                    )}
                  </div>
                  <p className="text-[12px] text-muted-foreground">
                    {source.description}
                  </p>

                  {isRunning && job && (
                    <div className="mt-2 space-y-1.5">
                      <div className="flex items-center gap-2 text-[12px]">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        <span className="tabular-nums">
                          {job.processedItems} / {job.totalItems} ({progress}%)
                        </span>
                        {job.errorCount > 0 && (
                          <span className="text-amber-600">
                            {job.errorCount} errors
                          </span>
                        )}
                      </div>
                      <div className="h-1 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full bg-primary rounded-full transition-all"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {job?.status === "completed" && (
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Completed{" "}
                      {job.completedAt &&
                        new Date(job.completedAt).toLocaleString("en-GB")}
                      {job.errorCount > 0 &&
                        ` with ${job.errorCount} errors`}
                    </p>
                  )}

                  {job?.errorLog && (job.errorCount ?? 0) > 0 && (
                    <div className="mt-2 rounded-md border border-red-200 bg-red-50 p-2 text-[11px] text-red-700 max-h-32 overflow-y-auto whitespace-pre-wrap">
                      {JSON.parse(job.errorLog)
                        .slice(0, 10)
                        .join("\n")}
                      {JSON.parse(job.errorLog).length > 10 && (
                        `\n... and ${JSON.parse(job.errorLog).length - 10} more`
                      )}
                    </div>
                  )}

                  {lastErrors[source.key] && (
                    <div className="mt-2 rounded-md border border-red-200 bg-red-50 p-2 text-[11px] text-red-700">
                      {lastErrors[source.key]}
                    </div>
                  )}
                </div>

                <div className="flex gap-1.5 shrink-0">
                  {isRunning && job?.id && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-destructive border-destructive/30 hover:bg-destructive/10"
                      onClick={async () => {
                        await fetch("/api/enrichment/cancel", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ jobId: job.id }),
                        });
                        toast.success(`${source.label} cancelled`);
                        fetchStatus();
                      }}
                    >
                      Cancel
                    </Button>
                  )}
                  <Button
                    onClick={() => runEnrichment(source)}
                    disabled={isRunning || (status?.total ?? 0) === 0 || !!(source as Record<string, unknown>).disabled}
                    size="sm"
                    variant={isRunning ? "outline" : "default"}
                  >
                    {(source as Record<string, unknown>).disabled ? (
                      "Coming Soon"
                    ) : isRunning ? (
                      <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Running</>
                    ) : (
                      <><Play className="h-3.5 w-3.5" /> Run</>
                    )}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}

    </div>
  );
}
