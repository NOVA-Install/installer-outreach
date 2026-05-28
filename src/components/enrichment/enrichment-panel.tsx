"use client";

import { useState, useEffect, useCallback, useRef } from "react";
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
  X,
  Plus,
} from "lucide-react";
import { FaLinkedinIn } from "react-icons/fa6";
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
    key: "site_analysis",
    label: "Site Analysis",
    endpoint: "/api/enrichment/site-analysis",
    description: "Tech detection (GA, CRM, chat), PageSpeed scores, form quality, site builder, HTTPS, privacy policy, agency, social links — all in one pass",
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
    key: "linkedin_signals",
    label: "LinkedIn Social Signals",
    endpoint: "/api/enrichment/linkedin-signals",
    description: "Search LinkedIn for recent posts by employees of tracked companies. Requires LinkedIn URLs from Site Analysis.",
    cost: "~$2/1K posts (Apify)",
  },
  {
    key: "linkedin_company_lookup",
    label: "LinkedIn Company Lookup",
    endpoint: "/api/enrichment/linkedin-company-lookup",
    description: "Find LinkedIn company pages for installers that don't have one. Searches by company name and verifies by matching website domain. Only saves high-confidence matches.",
    cost: "~$4/1K companies (Apify)",
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
    description: `Overall = (Reputation x 0.35) + (Volume x 0.25) + (Marketing x 0.40).

REPUTATION (0-100): Google rating/5 x 100 (weight 0.35) + Google review count capped at 200 (weight 0.25) + Trustpilot rating/5 x 100 (weight 0.20) + Trustpilot reviews capped at 100 (weight 0.10) + company age capped at 15yrs (weight 0.10). Divided by sum of available weights.

VOLUME (0-100): reviews/month x 15 = est. monthly installs. If employee count exists: employees x 4, averaged with review estimate. Then: min(installs/50, 1) x 100.

MARKETING (0-100): Website +5, Google Analytics +10, Google Ads +15, Meta Pixel +15, CRM tool +15, Live Chat +10, organic traffic (scaled 0-15 based on ETV up to 1000), paid traffic +15. Capped at 100.

TIERS: High = 65+, Medium = 35-64, Low = under 35.`,
    cost: "Free",
  },
];

function ErrorLogDisplay({ errorLog }: { errorLog: string }) {
  let errors: string[];
  try {
    errors = JSON.parse(errorLog);
  } catch {
    return (
      <div className="mt-2 rounded-md border border-red-200 bg-red-50 p-2 text-[11px] text-red-700 max-h-32 overflow-y-auto whitespace-pre-wrap">
        {errorLog}
      </div>
    );
  }
  return (
    <div className="mt-2 rounded-md border border-red-200 bg-red-50 p-2 text-[11px] text-red-700 max-h-32 overflow-y-auto whitespace-pre-wrap">
      {errors.slice(0, 10).join("\n")}
      {errors.length > 10 && `\n... and ${errors.length - 10} more`}
    </div>
  );
}

function CostEstimator({ total, coverage }: { total: number; coverage: Record<string, number> }) {
  const gRemaining = Math.max(0, total - (coverage.google_reviews || 0));
  const tRemaining = Math.max(0, total - (coverage.trustpilot || 0));
  const sRemaining = Math.max(0, total - (coverage.seo || 0));
  const rows: [string, string][] = [
    [`Google Reviews (${gRemaining} remaining)`, `~$${(gRemaining * 0.0015).toFixed(2)} priority / $${(gRemaining * 0.00075).toFixed(2)} standard`],
    [`Trustpilot (${tRemaining} remaining)`, `~$${(tRemaining * 0.0015).toFixed(2)} priority / $${(tRemaining * 0.00075).toFixed(2)} standard`],
    [`SEO / Backlinks (${sRemaining} remaining)`, `~$${(sRemaining * 0.005).toFixed(2)}`],
    ["Site Analysis + Companies House", "Free"],
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

const METHOD_LABELS: Record<string, { label: string; color: string }> = {
  auto_matched: { label: "Auto-matched (name)", color: "text-emerald-600" },
  ai_verified: { label: "AI verified", color: "text-blue-600" },
  ai_matched: { label: "AI matched", color: "text-blue-600" },
  ai_rejected: { label: "AI rejected", color: "text-red-500" },
  ai_unavailable: { label: "Saved (AI unavailable)", color: "text-amber-600" },
  no_results: { label: "No results from API", color: "text-gray-500" },
  no_rating: { label: "No rating found", color: "text-gray-400" },
  other: { label: "Other", color: "text-gray-400" },
};

const SOURCE_LABELS: Record<string, string> = {
  google_reviews: "Google Reviews",
  trustpilot_search: "Trustpilot",
  google_business_info: "Google Business",
  job_postings: "Job Postings",
};

function MatchBreakdown({ data }: { data: { source: string; match_method: string; cnt: number }[] }) {
  const [expanded, setExpanded] = useState(false);
  if (!data || data.length === 0) return null;

  // Group by source
  const bySource: Record<string, { method: string; count: number }[]> = {};
  for (const row of data) {
    if (!bySource[row.source]) bySource[row.source] = [];
    bySource[row.source].push({ method: row.match_method, count: Number(row.cnt) });
  }

  return (
    <div className="pt-2 border-t border-[#f0f0f0]">
      <button
        onClick={() => setExpanded(!expanded)}
        className="text-[11px] text-primary hover:underline font-medium"
      >
        {expanded ? "Hide" : "Show"} match breakdown
      </button>
      {expanded && (
        <div className="mt-2 space-y-3">
          {Object.entries(bySource).map(([source, methods]) => (
            <div key={source}>
              <p className="text-[11px] font-semibold text-[#3a3a3a] uppercase tracking-wider mb-1">
                {SOURCE_LABELS[source] || source}
              </p>
              <div className="space-y-0.5">
                {methods.map((m) => {
                  const config = METHOD_LABELS[m.method] || METHOD_LABELS.other;
                  return (
                    <div key={m.method} className="flex justify-between text-[12px]">
                      <span className={config.color}>{config.label}</span>
                      <span className="tabular-nums text-[#6a6a6a]">{m.count}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function GoogleAdsFilter({ onRun, disabled }: { onRun: (minTraffic: number) => void; disabled: boolean }) {
  const [minTraffic, setMinTraffic] = useState(50);
  const [preview, setPreview] = useState<{ eligible: number; estimatedCost: string } | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);

  // Debounced preview fetch - triggers 500ms after user stops dragging
  const handleChange = useCallback((val: number) => {
    setMinTraffic(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoadingPreview(true);
      try {
        const res = await fetch(`/api/enrichment/google-ads/preview?minTraffic=${val}`);
        if (res.ok) {
          const data = await res.json();
          setPreview(data);
        }
      } catch { /* preview is non-critical */ }
      setLoadingPreview(false);
    }, 500);
  }, []);

  // Initial fetch
  useEffect(() => {
    handleChange(minTraffic);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-2 mt-2 pt-2 border-t border-[#f0f0f0]">
      <div className="flex items-center gap-3">
        <label className="text-[11px] text-muted-foreground whitespace-nowrap">Min organic traffic:</label>
        <input
          type="range"
          min={0}
          max={500}
          step={10}
          value={minTraffic}
          onChange={(e) => handleChange(Number(e.target.value))}
          className="flex-1 h-1.5 accent-primary"
        />
        <span className="text-[12px] font-medium tabular-nums w-[40px] text-right">{minTraffic}</span>
      </div>
      <div className="flex items-center justify-between text-[12px]">
        <span className="text-muted-foreground">
          {loadingPreview ? "..." : preview ? `${preview.eligible} installers · est. ${preview.estimatedCost}` : ""}
        </span>
        <Button
          size="sm"
          onClick={() => onRun(minTraffic)}
          disabled={disabled || !preview || preview.eligible === 0}
        >
          <Play className="h-3.5 w-3.5" /> Run ({preview?.eligible || 0})
        </Button>
      </div>
    </div>
  );
}

const DEFAULT_LINKEDIN_KEYWORDS = [
  "solar installation",
  "solar panel",
  "heat pump",
  "renewable energy installer",
  "MCS certified",
  "solar PV",
  "air source heat pump",
  "battery storage",
  "EV charger installation",
];

const LINKEDIN_KEYWORDS_KEY = "linkedin-signals-keywords";
const LINKEDIN_POSTED_LIMIT_KEY = "linkedin-signals-posted-limit";
const LINKEDIN_BATCH_SIZE_KEY = "linkedin-signals-batch-size";

function loadLinkedInKeywords(): string[] {
  if (typeof window === "undefined") return DEFAULT_LINKEDIN_KEYWORDS;
  try {
    const s = localStorage.getItem(LINKEDIN_KEYWORDS_KEY);
    if (s) { const p = JSON.parse(s); if (Array.isArray(p) && p.length > 0) return p; }
  } catch {}
  return DEFAULT_LINKEDIN_KEYWORDS;
}
function saveLinkedInKeywords(kw: string[]) {
  try { localStorage.setItem(LINKEDIN_KEYWORDS_KEY, JSON.stringify(kw)); } catch {}
}

function LinkedInSignalsConfig({ onRun, disabled }: { onRun: (config: { keywords: string[]; postedLimit: string; companyBatchSize: number; maxCompanies?: number }) => void; disabled: boolean }) {
  const [keywords, setKeywords] = useState<string[]>(loadLinkedInKeywords);
  const [preview, setPreview] = useState<{ eligible: number; estimatedCost: string } | null>(null);
  const [maxCompanies, setMaxCompanies] = useState<number | undefined>(undefined);
  const [newKeyword, setNewKeyword] = useState("");
  const [postedLimit, setPostedLimit] = useState(() => {
    if (typeof window === "undefined") return "week";
    return localStorage.getItem(LINKEDIN_POSTED_LIMIT_KEY) || "week";
  });
  const [companyBatchSize, setCompanyBatchSize] = useState(() => {
    if (typeof window === "undefined") return 10;
    const s = typeof window !== "undefined" ? localStorage.getItem(LINKEDIN_BATCH_SIZE_KEY) : null;
    return s ? Number(s) : 1;
  });

  // Fetch cost preview on mount
  useEffect(() => {
    fetch("/api/enrichment/linkedin-signals/preview")
      .then((r) => r.json())
      .then((data) => setPreview(data))
      .catch(() => {});
  }, []);

  const addKeyword = () => {
    const trimmed = newKeyword.trim().toLowerCase();
    if (!trimmed || keywords.includes(trimmed)) return;
    const next = [...keywords, trimmed];
    setKeywords(next);
    saveLinkedInKeywords(next);
    setNewKeyword("");
  };

  const removeKeyword = (kw: string) => {
    const next = keywords.filter((k) => k !== kw);
    setKeywords(next);
    saveLinkedInKeywords(next);
  };

  const resetToDefaults = () => {
    setKeywords(DEFAULT_LINKEDIN_KEYWORDS);
    saveLinkedInKeywords(DEFAULT_LINKEDIN_KEYWORDS);
  };

  return (
    <div className="space-y-3 mt-3 pt-3 border-t border-[#f0f0f0]">
      {/* Search Keywords */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Search Keywords</label>
          <button onClick={resetToDefaults} className="text-[10px] text-primary hover:underline">Reset to defaults</button>
        </div>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {keywords.map((kw) => (
            <span
              key={kw}
              className="inline-flex items-center gap-1 rounded-full bg-[#0a66c2]/8 border border-[#0a66c2]/20 px-2.5 py-1 text-[11px] text-[#0a66c2]"
            >
              {kw}
              <button
                onClick={() => removeKeyword(kw)}
                className="hover:text-red-500 transition-colors"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-1.5">
          <input
            type="text"
            value={newKeyword}
            onChange={(e) => setNewKeyword(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addKeyword(); } }}
            placeholder="Add keyword..."
            className="flex-1 h-7 rounded-md border border-input bg-background px-2.5 text-[12px] placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <Button size="sm" variant="outline" className="h-7 px-2" onClick={addKeyword} disabled={!newKeyword.trim()}>
            <Plus className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Options row */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="space-y-1">
          <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Time Range</label>
          <Select
            value={postedLimit}
            onValueChange={(v: string | null) => {
              if (v) {
                setPostedLimit(v);
                try { localStorage.setItem(LINKEDIN_POSTED_LIMIT_KEY, v); } catch {}
              }
            }}
          >
            <SelectTrigger className="w-[140px] h-7 text-[12px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="24h">Last 24 hours</SelectItem>
              <SelectItem value="week">Last week</SelectItem>
              <SelectItem value="month">Last month</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Company Batch Size</label>
          <Select
            value={String(companyBatchSize)}
            onValueChange={(v: string | null) => {
              if (v) {
                setCompanyBatchSize(Number(v));
                try { localStorage.setItem(LINKEDIN_BATCH_SIZE_KEY, v); } catch {}
              }
            }}
          >
            <SelectTrigger className="w-[100px] h-7 text-[12px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">1 (precise)</SelectItem>
              <SelectItem value="5">5</SelectItem>
              <SelectItem value="10">10 (default)</SelectItem>
              <SelectItem value="20">20 (faster)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Company limit */}
      {preview && preview.eligible > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider whitespace-nowrap">Max companies:</label>
            <input
              type="range"
              min={10}
              max={preview.eligible}
              step={10}
              value={maxCompanies ?? preview.eligible}
              onChange={(e) => {
                const v = Number(e.target.value);
                setMaxCompanies(v >= preview.eligible ? undefined : v);
              }}
              className="flex-1 h-1.5 accent-[#0a66c2]"
            />
            <span className="text-[12px] font-medium tabular-nums w-[60px] text-right">
              {maxCompanies ?? preview.eligible} / {preview.eligible}
            </span>
          </div>
        </div>
      )}

      {/* Cost estimate + Run */}
      <div className="flex items-center justify-between pt-1">
        <div className="text-[11px] text-muted-foreground">
          {preview ? (
            <span>
              <span className="font-medium text-[#1D1D1D]">{maxCompanies ?? preview.eligible}</span> companies with LinkedIn URLs
              {" · "}
              Est. cost: <span className="font-medium text-[#1D1D1D]">
                {maxCompanies
                  ? `~$${((maxCompanies / preview.eligible) * parseFloat(preview.estimatedCost.replace(/[^0-9.]/g, ""))).toFixed(2)}`
                  : preview.estimatedCost}
              </span>
            </span>
          ) : (
            "Loading preview..."
          )}
        </div>
        <Button
          size="sm"
          onClick={() => onRun({ keywords, postedLimit, companyBatchSize, maxCompanies })}
          disabled={disabled || keywords.length === 0}
        >
          <FaLinkedinIn className="h-3 w-3" /> Run
        </Button>
      </div>
    </div>
  );
}

function LinkedInCompanyLookupConfig({ onRun, disabled }: { onRun: (config: { maxCompanies: number }) => void; disabled: boolean }) {
  const [preview, setPreview] = useState<{ eligible: number; estimatedCost: string } | null>(null);
  const [maxCompanies, setMaxCompanies] = useState<number>(100);

  useEffect(() => {
    fetch("/api/enrichment/linkedin-company-lookup/preview")
      .then((r) => r.json())
      .then((data) => {
        setPreview(data);
        setMaxCompanies(Math.min(100, data.eligible));
      })
      .catch(() => {});
  }, []);

  return (
    <div className="space-y-3 mt-3 pt-3 border-t border-[#f0f0f0]">
      {preview && preview.eligible > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider whitespace-nowrap">Companies to search:</label>
            <input
              type="range"
              min={10}
              max={Math.min(500, preview.eligible)}
              step={10}
              value={maxCompanies}
              onChange={(e) => setMaxCompanies(Number(e.target.value))}
              className="flex-1 h-1.5 accent-[#0a66c2]"
            />
            <span className="text-[12px] font-medium tabular-nums w-[60px] text-right">
              {maxCompanies} / {preview.eligible}
            </span>
          </div>
        </div>
      )}
      <div className="flex items-center justify-between">
        <div className="text-[11px] text-muted-foreground">
          {preview ? (
            <span>
              <span className="font-medium text-[#1D1D1D]">{preview.eligible}</span> companies with website but no LinkedIn URL
              {" · "}
              Est. cost for {maxCompanies}: <span className="font-medium text-[#1D1D1D]">
                ~${((maxCompanies / 1000) * 4).toFixed(2)}
              </span>
              {" · "}
              Domain verification ensures only correct matches are saved
            </span>
          ) : (
            "Loading preview..."
          )}
        </div>
        <Button
          size="sm"
          onClick={() => onRun({ maxCompanies })}
          disabled={disabled || !preview || preview.eligible === 0}
        >
          <FaLinkedinIn className="h-3 w-3" /> Search ({maxCompanies})
        </Button>
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
    const interval = setInterval(fetchStatus, 10000);
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

      const needsCollect = ["google_reviews", "trustpilot", "trustpilot_domain", "google_business", "job_postings"].includes(source.key);

      // Clear any previous error for this source
      setLastErrors((prev) => { const next = { ...prev }; delete next[source.key]; return next; });

      toast.success(
        needsCollect
          ? `${source.label}: tasks submitted. Click "Collect Results" to retrieve data.`
          : `${source.label}: started. Running in background — you can close this page.`
      );
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
                  if (!res.ok) throw new Error("Failed to start collection");
                  toast.success("Collecting results in background — you can close this page.");
                  fetchStatus();
                } catch {
                  toast.error("Failed to start result collection");
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

          {/* Match method breakdown */}
          {status && "matchBreakdown" in (status as object) && (
            <MatchBreakdown data={(status as unknown as { matchBreakdown: { source: string; match_method: string; cnt: number }[] }).matchBreakdown} />
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
                        {job.totalItems > 0 ? (
                          <span className="tabular-nums">
                            {job.processedItems} / {job.totalItems} ({progress}%)
                          </span>
                        ) : (
                          <span className="text-muted-foreground">Starting...</span>
                        )}
                        {job.errorCount > 0 && (
                          <span className="text-amber-600">
                            {job.errorCount} errors
                          </span>
                        )}
                      </div>
                      {job.totalItems > 0 && (
                        <div className="h-1 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full bg-primary rounded-full transition-all"
                            style={{ width: `${progress}%` }}
                          />
                        </div>
                      )}
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
                    <ErrorLogDisplay errorLog={job.errorLog} />
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
                        try {
                          const res = await fetch("/api/enrichment/cancel", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ jobId: job.id }),
                          });
                          if (res.ok) {
                            toast.success(`${source.label} cancelled`);
                          } else {
                            toast.error(`Failed to cancel ${source.label}`);
                          }
                        } catch {
                          toast.error(`Failed to cancel ${source.label}`);
                        }
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

              {/* LinkedIn Signals config */}
              {source.key === "linkedin_signals" && (
                <LinkedInSignalsConfig
                  disabled={isRunning || (status?.total ?? 0) === 0}
                  onRun={async (config: { keywords: string[]; postedLimit: string; companyBatchSize: number; maxCompanies?: number }) => {
                    setRunning((prev) => new Set([...prev, source.key]));
                    try {
                      const res = await fetch("/api/enrichment/linkedin-signals", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(config),
                      });
                      const data = await res.json().catch(() => ({}));
                      if (!res.ok) throw new Error(data.error || "Failed");
                      toast.success(`LinkedIn Signals: started with ${config.keywords.length} keywords. Running in background.`);
                      fetchStatus();
                    } catch (err) {
                      toast.error(`LinkedIn Signals: ${err instanceof Error ? err.message : "Failed"}`, { duration: 8000 });
                    } finally {
                      setRunning((prev) => { const next = new Set(prev); next.delete(source.key); return next; });
                    }
                  }}
                />
              )}

              {/* LinkedIn Company Lookup config */}
              {source.key === "linkedin_company_lookup" && (
                <LinkedInCompanyLookupConfig
                  disabled={isRunning || (status?.total ?? 0) === 0}
                  onRun={async (config) => {
                    setRunning((prev) => new Set([...prev, source.key]));
                    try {
                      const res = await fetch("/api/enrichment/linkedin-company-lookup", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(config),
                      });
                      const data = await res.json().catch(() => ({}));
                      if (!res.ok) throw new Error(data.error || "Failed");
                      toast.success(`LinkedIn Lookup: searching ${config.maxCompanies} companies. Running in background.`);
                      fetchStatus();
                    } catch (err) {
                      toast.error(`LinkedIn Lookup: ${err instanceof Error ? err.message : "Failed"}`, { duration: 8000 });
                    } finally {
                      setRunning((prev) => { const next = new Set(prev); next.delete(source.key); return next; });
                    }
                  }}
                />
              )}

              {/* Google Ads filter */}
              {source.key === "google_ads_transparency" && (
                <GoogleAdsFilter
                  disabled={isRunning || (status?.total ?? 0) === 0}
                  onRun={async (minTraffic) => {
                    setRunning((prev) => new Set([...prev, source.key]));
                    try {
                      const res = await fetch("/api/enrichment/google-ads", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ minTraffic }),
                      });
                      const data = await res.json().catch(() => ({}));
                      if (!res.ok) throw new Error(data.error || "Failed");
                      toast.success(`Google Ads: started with min traffic ${minTraffic}. Running in background — you can close this page.`);
                      fetchStatus();
                    } catch (err) {
                      toast.error(`Google Ads: ${err instanceof Error ? err.message : "Failed"}`, { duration: 8000 });
                    } finally {
                      setRunning((prev) => { const next = new Set(prev); next.delete(source.key); return next; });
                    }
                  }}
                />
              )}
            </CardContent>
          </Card>
        );
      })}

    </div>
  );
}
