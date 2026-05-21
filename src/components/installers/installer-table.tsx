"use client";

import { useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Search,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Star,
  Settings2,
  Filter,
  X,
  Copy,
  Check,
  Download,
  Trash2,
  ArrowRight,
  Loader2,
  ExternalLink,
  CheckCircle2,
} from "lucide-react";
import Link from "next/link";
import { PIPELINE_STAGES } from "@/lib/constants";
import { AddInstallerDialog } from "@/components/installers/add-installer-dialog";
import { toast } from "sonner";

// --- Types ---

interface Installer {
  id: number;
  companyName: string;
  email: string | null;
  telephone: string | null;
  website: string | null;
  county: string | null;
  postcode: string | null;
  address: string | null;
  country: string | null;
  technologiesCertified: string | null;
  legalEntityName: string | null;
  legalEntityNumber: string | null;
  alternativeNames: string | null;
  websiteStatus: string | null;
  pipelineStage: string | null;
  inMcs: boolean | null;
  inNova: boolean | null;
  inTrustMark: boolean | null;
  sourceCount: number | null;
  // Scores
  overallScore: number | null;
  reputationScore: number | null;
  marketingActivityScore: number | null;
  estimatedMonthlyInstalls: number | null;
  tier: string | null;
  // Reviews
  googleRating: number | null;
  googleReviewCount: number | null;
  googleReviewsPerMonth: number | null;
  trustpilotRating: number | null;
  trustpilotReviewCount: number | null;
  // Marketing
  hasGoogleAnalytics: boolean | null;
  hasGoogleAds: boolean | null;
  hasMetaPixel: boolean | null;
  hasCrmTool: boolean | null;
  hasLiveChat: boolean | null;
  // Traffic
  googleOrganicEtv: number | null;
  googlePaidEtv: number | null;
  // Source specific
  novaYearStarted: string | null;
  trustmarkStatus: string | null;
  certificationBody: string | null;
}

interface InstallerResponse {
  data: Installer[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

interface InstallerTableProps {
  counties: string[];
}

interface Filters {
  county: string;
  stage: string;
  tier: string;
  hasWebsite: string;
  hasEmail: string;
  hasReviews: string;
  inMcs: string;
  inNova: string;
  inTrustMark: string;
  scoreMin: string;
  scoreMax: string;
  ratingMin: string;
}

const EMPTY_FILTERS: Filters = {
  county: "", stage: "", tier: "", hasWebsite: "", hasEmail: "", hasReviews: "",
  inMcs: "", inNova: "", inTrustMark: "", scoreMin: "", scoreMax: "", ratingMin: "",
};

function countActiveFilters(f: Filters): number {
  return Object.values(f).filter((v) => v !== "").length;
}

// --- Inline edit cell ---

function EditableCell({
  value,
  installerId,
  field,
  onSaved,
}: {
  value: string | null;
  installerId: number;
  field: string;
  onSaved: (newVal: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value || "");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const save = async () => {
    if (val === (value || "")) { setEditing(false); return; }
    setSaving(true);
    try {
      const res = await fetch(`/api/installers/${installerId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: val || null }),
      });
      if (!res.ok) throw new Error();
      onSaved(val);
      toast.success(`${field} updated`);
    } catch {
      toast.error("Failed to save");
      setVal(value || "");
    } finally {
      setSaving(false);
      setEditing(false);
    }
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") { setVal(value || ""); setEditing(false); } }}
        disabled={saving}
        className="w-full h-6 rounded border border-[#4ABDE8] bg-white px-1.5 text-[12px] text-[#1D1D1D] outline-none"
      />
    );
  }

  return (
    <span
      onClick={() => setEditing(true)}
      className="cursor-text hover:bg-[#FFF8F5] rounded px-0.5 -mx-0.5 transition-colors"
      title="Click to edit"
    >
      {value || <span className="text-[#d5d5d5]">—</span>}
    </span>
  );
}

// --- Inline stage edit ---

function EditableStage({
  value,
  installerId,
  onSaved,
}: {
  value: string | null;
  installerId: number;
  onSaved: (newVal: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!editing) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setEditing(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [editing]);

  const save = async (stage: string) => {
    setEditing(false);
    if (stage === value) return;
    try {
      const res = await fetch(`/api/installers/${installerId}/stage`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage }),
      });
      if (!res.ok) throw new Error();
      onSaved(stage);
      toast.success(`Stage updated`);
    } catch { toast.error("Failed to save"); }
  };

  const stageKey = value || "uncontacted";
  const stageInfo = PIPELINE_STAGES.find((s) => s.key === stageKey);

  if (editing) {
    return (
      <div ref={ref} className="absolute z-20 left-0 top-0 w-[160px] bg-white rounded-lg border border-[#e5e5e5] shadow-lg py-1">
        {PIPELINE_STAGES.map((s) => (
          <button
            key={s.key}
            onClick={() => save(s.key)}
            className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-[12px] text-left hover:bg-[#FAFAF9] transition-colors ${s.key === stageKey ? "font-medium text-[#1D1D1D]" : "text-[#6a6a6a]"}`}
          >
            <div className="h-[6px] w-[6px] rounded-full shrink-0" style={{ backgroundColor: s.color }} />
            {s.label}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div
      onClick={() => setEditing(true)}
      className="inline-flex items-center gap-1.5 cursor-pointer rounded-full px-2 py-[2px] transition-colors hover:opacity-80"
      style={{ backgroundColor: `${stageInfo?.color}15`, border: `1px solid ${stageInfo?.color}30` }}
      title="Click to change stage"
    >
      <div className="h-[6px] w-[6px] rounded-full shrink-0" style={{ backgroundColor: stageInfo?.color }} />
      <span className="text-[11px] font-medium" style={{ color: stageInfo?.color }}>{stageInfo?.label || stageKey}</span>
    </div>
  );
}

// --- Star rating display ---

function StarRating({ rating, color }: { rating: number; color: string }) {
  return (
    <div className="flex items-center gap-[1px]">
      {Array.from({ length: 5 }).map((_, i) => {
        const fill = Math.min(1, Math.max(0, rating - i));
        return (
          <div key={i} className="relative h-3 w-3">
            {/* Empty star */}
            <Star className="absolute inset-0 h-3 w-3 text-[#e5e5e5]" />
            {/* Filled star with clip */}
            {fill > 0 && (
              <div className="absolute inset-0 overflow-hidden" style={{ width: `${fill * 100}%` }}>
                <Star className="h-3 w-3" style={{ fill: color, color }} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// --- Copy button ---

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button onClick={copy} className="ml-1 inline-flex items-center text-[#9a9a9a] hover:text-[#4ABDE8] transition-colors shrink-0" title="Copy">
      {copied ? <Check className="h-3 w-3 text-green-600" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

// --- Column definitions ---

interface ColumnDef {
  key: string;
  label: string;
  sortKey?: string;
  editable?: boolean;
  render: (row: Installer, onUpdate: (id: number, field: string, val: string) => void) => ReactNode;
}

function getDomain(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = url.startsWith("http") ? url : `https://${url}`;
    return new URL(u).hostname.replace(/^www\./, "");
  } catch { return null; }
}

function CompanyLogo({ domain, name }: { domain: string | null; name: string }) {
  const [errored, setErrored] = useState(false);
  // Generate a consistent color from the name
  const hue = name.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;

  if (!domain || errored) {
    return (
      <div
        className="h-9 w-9 rounded-[10px] flex items-center justify-center shrink-0 shadow-[0_1px_3px_rgba(0,0,0,0.06)]"
        style={{ background: `hsl(${hue}, 40%, 92%)` }}
      >
        <span className="text-[13px] font-bold" style={{ color: `hsl(${hue}, 45%, 45%)` }}>
          {name[0]?.toUpperCase() || "?"}
        </span>
      </div>
    );
  }
  return (
    <img
      src={`https://www.google.com/s2/favicons?domain=${domain}&sz=128`}
      alt=""
      width={36}
      height={36}
      className="h-9 w-9 rounded-[10px] bg-white object-contain shrink-0 shadow-[0_1px_3px_rgba(0,0,0,0.06)] border border-[#f0f0f0]"
      onError={() => setErrored(true)}
    />
  );
}

const ALL_COLUMNS: ColumnDef[] = [
  {
    key: "companyName",
    label: "Company",
    sortKey: "companyName",
    render: (row) => {
      const domain = getDomain(row.website);
      const sources = [
        row.inMcs && "MCS",
        row.inNova && "Nova",
        row.inTrustMark && "TM",
      ].filter(Boolean);
      const techs = row.technologiesCertified?.split(",").map((t) => t.trim()).filter(Boolean) || [];
      return (
        <div className="flex items-center gap-3 py-[3px]">
          <CompanyLogo domain={domain} name={row.companyName} />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <Link href={`/installers/${row.id}`} className="text-[13px] font-semibold text-[#1D1D1D] hover:text-[#4ABDE8] transition-colors">
                {row.companyName}
              </Link>
              {row.inMcs && (
                <img src="/mcs-certified.png" alt="MCS" title="MCS Certified" className="h-[28px] rounded-[3px] object-contain shrink-0" />
              )}
              {row.inTrustMark && (
                <img src="/logo-trustmark.jpg" alt="TrustMark" title="TrustMark Certified" className="h-[22px] rounded-[3px] object-contain shrink-0" />
              )}
            </div>
            {techs.length > 0 && (
              <div className="text-[11px] text-[#9a9a9a] truncate max-w-[280px] mt-[1px]">
                {techs.slice(0, 3).join(" · ")}
                {techs.length > 3 && <span className="text-[#c5c5c5]"> +{techs.length - 3}</span>}
              </div>
            )}
          </div>
        </div>
      );
    },
  },
  {
    key: "legalEntityName",
    label: "Companies House Name",
    sortKey: "legalEntityName",
    render: (row) =>
      row.legalEntityName && row.legalEntityName !== "__no_match__"
        ? <span className="text-[#3a3a3a] text-[12px]">{row.legalEntityName}</span>
        : <span className="text-[#d5d5d5]">—</span>,
  },
  {
    key: "county",
    label: "County",
    sortKey: "county",
    render: (row) => <span className="text-[#6a6a6a]">{row.county || "—"}</span>,
  },
  {
    key: "postcode",
    label: "Postcode",
    sortKey: "postcode",
    render: (row) => <span className="text-[#6a6a6a] font-mono text-[12px]">{row.postcode || "—"}</span>,
  },
  {
    key: "email",
    label: "Email",
    sortKey: "email",
    editable: true,
    render: (row, onUpdate) => (
      <div className="flex items-center gap-0.5 max-w-[220px]">
        <EditableCell
          value={row.email}
          installerId={row.id}
          field="email"
          onSaved={(v) => onUpdate(row.id, "email", v)}
        />
        {row.email && <CopyButton text={row.email} />}
      </div>
    ),
  },
  {
    key: "telephone",
    label: "Phone",
    sortKey: "telephone",
    editable: true,
    render: (row, onUpdate) => (
      <div className="flex items-center gap-0.5">
        <EditableCell
          value={row.telephone}
          installerId={row.id}
          field="telephone"
          onSaved={(v) => onUpdate(row.id, "telephone", v)}
        />
        {row.telephone && <CopyButton text={row.telephone} />}
      </div>
    ),
  },
  {
    key: "stage",
    label: "Stage",
    sortKey: "pipelineStage",
    render: (row, onUpdate) => {
      const stageKey = row.pipelineStage || "uncontacted";
      const stageInfo = PIPELINE_STAGES.find((s) => s.key === stageKey);
      return (
        <div className="relative">
          <EditableStage
            value={row.pipelineStage}
            installerId={row.id}
            onSaved={(v) => onUpdate(row.id, "pipelineStage", v)}
          />
        </div>
      );
    },
  },
  {
    key: "googleReviews",
    label: "Google",
    sortKey: "googleReviewCount",
    render: (row) =>
      row.googleRating != null ? (
        <div className="flex flex-col gap-0.5">
          <StarRating rating={row.googleRating} color="#e8b94a" />
          <div className="flex items-center gap-1">
            <span className="font-medium tabular-nums text-[12px] text-[#1D1D1D]">{row.googleRating.toFixed(1)}</span>
            {row.googleReviewCount != null && <span className="text-[11px] text-[#9a9a9a]">({row.googleReviewCount})</span>}
          </div>
        </div>
      ) : <span className="text-[#d5d5d5]">—</span>,
  },
  {
    key: "trustpilotReviews",
    label: "Trustpilot",
    sortKey: "trustpilotReviewCount",
    render: (row) =>
      row.trustpilotRating != null ? (
        <div className="flex flex-col gap-0.5">
          <StarRating rating={row.trustpilotRating} color="#00b67a" />
          <div className="flex items-center gap-1">
            <span className="font-medium tabular-nums text-[12px] text-[#1D1D1D]">{row.trustpilotRating.toFixed(1)}</span>
            {row.trustpilotReviewCount != null && <span className="text-[11px] text-[#9a9a9a]">({row.trustpilotReviewCount})</span>}
          </div>
        </div>
      ) : <span className="text-[#d5d5d5]">—</span>,
  },
  {
    key: "totalReviews",
    label: "Reviews",
    sortKey: "totalReviews",
    render: (row) => {
      const total = (row.googleReviewCount || 0) + (row.trustpilotReviewCount || 0);
      if (total === 0) return <span className="text-[#d5d5d5]">—</span>;
      return <span className="font-medium tabular-nums text-[13px] text-[#1D1D1D]">{total.toLocaleString()}</span>;
    },
  },
  {
    key: "tier",
    label: "Tier",
    render: (row) => {
      if (!row.tier) return <span className="text-[#d5d5d5]">—</span>;
      const dot: Record<string, string> = { high: "bg-green-500", medium: "bg-yellow-500", low: "bg-gray-400" };
      return (
        <div className="flex items-center gap-1.5">
          <div className={`h-[6px] w-[6px] rounded-full ${dot[row.tier] || "bg-gray-300"}`} />
          <span className="text-[12px] text-[#3a3a3a] capitalize">{row.tier}</span>
        </div>
      );
    },
  },
  {
    key: "score",
    label: "Score",
    sortKey: "overallScore",
    render: (row) =>
      row.overallScore != null
        ? <span className="font-medium tabular-nums text-[#1D1D1D]">{row.overallScore.toFixed(0)}</span>
        : <span className="text-[#d5d5d5]">—</span>,
  },
  {
    key: "website",
    label: "Website",
    sortKey: "website",
    render: (row) =>
      row.website ? (
        <a
          href={row.website.startsWith("http") ? row.website : `https://${row.website}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 h-[26px] px-2.5 rounded-lg bg-[#FAFAF9] border border-[#e5e5e5] text-[11px] font-medium text-[#3a3a3a] hover:border-[#4ABDE8] hover:text-[#4ABDE8] hover:bg-[#FFF8F5] transition-all whitespace-nowrap shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
        >
          <ExternalLink className="h-3 w-3" />
          Visit site
        </a>
      ) : <span className="text-[#d5d5d5]">—</span>,
  },
  {
    key: "technologies",
    label: "Technologies",
    render: (row) =>
      row.technologiesCertified
        ? <span className="text-[12px] text-[#6a6a6a] truncate block max-w-[180px]">{row.technologiesCertified}</span>
        : <span className="text-[#d5d5d5]">—</span>,
  },
  {
    key: "address",
    label: "Address",
    render: (row) =>
      row.address ? <span className="text-[12px] text-[#6a6a6a] truncate block max-w-[200px]">{row.address}</span> : <span className="text-[#d5d5d5]">—</span>,
  },
  {
    key: "alternativeNames",
    label: "Alt Names",
    render: (row) =>
      row.alternativeNames ? <span className="text-[12px] text-[#6a6a6a] truncate block max-w-[180px]">{row.alternativeNames}</span> : <span className="text-[#d5d5d5]">—</span>,
  },
  {
    key: "legalEntityNumber",
    label: "CH Number",
    render: (row) =>
      row.legalEntityNumber
        ? <a href={`https://find-and-update.company-information.service.gov.uk/company/${row.legalEntityNumber}`} target="_blank" rel="noopener noreferrer" className="text-[12px] text-[#6a6a6a] hover:text-[#4ABDE8] font-mono">{row.legalEntityNumber}</a>
        : <span className="text-[#d5d5d5]">—</span>,
  },
  {
    key: "certificationBody",
    label: "Cert Body",
    render: (row) =>
      row.certificationBody ? <span className="text-[12px] text-[#6a6a6a]">{row.certificationBody}</span> : <span className="text-[#d5d5d5]">—</span>,
  },
  {
    key: "reputationScore",
    label: "Reputation",
    render: (row) =>
      row.reputationScore != null ? <span className="font-medium tabular-nums text-[12px]">{row.reputationScore.toFixed(0)}</span> : <span className="text-[#d5d5d5]">—</span>,
  },
  {
    key: "marketingScore",
    label: "Marketing Score",
    render: (row) =>
      row.marketingActivityScore != null ? <span className="font-medium tabular-nums text-[12px]">{row.marketingActivityScore.toFixed(0)}</span> : <span className="text-[#d5d5d5]">—</span>,
  },
  {
    key: "estInstalls",
    label: "Est Installs/mo",
    render: (row) =>
      row.estimatedMonthlyInstalls != null && row.estimatedMonthlyInstalls > 0 ? <span className="font-medium tabular-nums text-[12px]">{row.estimatedMonthlyInstalls.toFixed(0)}</span> : <span className="text-[#d5d5d5]">—</span>,
  },
  {
    key: "reviewsPerMonth",
    label: "Reviews/mo",
    render: (row) =>
      row.googleReviewsPerMonth != null ? <span className="tabular-nums text-[12px] text-[#6a6a6a]">{row.googleReviewsPerMonth.toFixed(1)}</span> : <span className="text-[#d5d5d5]">—</span>,
  },
  {
    key: "googleAds",
    label: "Google Ads",
    render: (row) => row.hasGoogleAds ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500" /> : <span className="text-[#d5d5d5]">—</span>,
  },
  {
    key: "metaPixel",
    label: "Meta Pixel",
    render: (row) => row.hasMetaPixel ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500" /> : <span className="text-[#d5d5d5]">—</span>,
  },
  {
    key: "crmTool",
    label: "CRM Tool",
    render: (row) => row.hasCrmTool ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500" /> : <span className="text-[#d5d5d5]">—</span>,
  },
  {
    key: "liveChat",
    label: "Live Chat",
    render: (row) => row.hasLiveChat ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500" /> : <span className="text-[#d5d5d5]">—</span>,
  },
  {
    key: "organicTraffic",
    label: "Organic Traffic",
    render: (row) =>
      row.googleOrganicEtv != null ? <span className="tabular-nums text-[12px] text-[#6a6a6a]">{row.googleOrganicEtv.toLocaleString()}</span> : <span className="text-[#d5d5d5]">—</span>,
  },
  {
    key: "paidTraffic",
    label: "Paid Traffic",
    render: (row) =>
      row.googlePaidEtv != null && row.googlePaidEtv > 0 ? <span className="tabular-nums text-[12px] text-[#4ABDE8]">{row.googlePaidEtv.toLocaleString()}</span> : <span className="text-[#d5d5d5]">—</span>,
  },
  {
    key: "sources",
    label: "Sources",
    render: (row) => (
      <div className="flex gap-0.5">
        {row.inMcs && <span className="text-[9px] px-1 py-0.5 rounded bg-blue-50 text-blue-600 font-medium">MCS</span>}
        {row.inNova && <span className="text-[9px] px-1 py-0.5 rounded bg-purple-50 text-purple-600 font-medium">Nova</span>}
        {row.inTrustMark && <span className="text-[9px] px-1 py-0.5 rounded bg-green-50 text-green-600 font-medium">TM</span>}
      </div>
    ),
  },
  {
    key: "novaYearStarted",
    label: "Year Started",
    render: (row) =>
      row.novaYearStarted ? <span className="text-[12px] text-[#6a6a6a]">{row.novaYearStarted}</span> : <span className="text-[#d5d5d5]">—</span>,
  },
  {
    key: "trustmarkStatus",
    label: "TM Status",
    render: (row) =>
      row.trustmarkStatus ? <span className="text-[12px] text-[#6a6a6a]">{row.trustmarkStatus}</span> : <span className="text-[#d5d5d5]">—</span>,
  },
];

const DEFAULT_VISIBLE = ["companyName", "county", "postcode", "stage", "googleReviews", "trustpilotReviews", "score", "website"];
const STORAGE_KEY = "installer-table-columns-v2";
const PAGE_SIZE_KEY = "installer-table-pagesize";

function loadColumns(): string[] {
  if (typeof window === "undefined") return DEFAULT_VISIBLE;
  try { const s = localStorage.getItem(STORAGE_KEY); if (s) { const p = JSON.parse(s); if (Array.isArray(p) && p.length > 0) return p; } } catch {}
  return DEFAULT_VISIBLE;
}
function saveColumns(cols: string[]) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cols)); } catch {} }
function loadPageSize(): number {
  if (typeof window === "undefined") return 100;
  try { const s = localStorage.getItem(PAGE_SIZE_KEY); if (s) return Number(s); } catch {}
  return 100;
}
function savePageSize(n: number) { try { localStorage.setItem(PAGE_SIZE_KEY, String(n)); } catch {} }

// --- Column settings popover ---

function ColumnSettings({ visible, onUpdate }: { visible: string[]; onUpdate: (cols: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!open) return; function h(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); } document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h); }, [open]);

  const toggle = (key: string) => { if (key === "companyName") return; onUpdate(visible.includes(key) ? visible.filter((k) => k !== key) : [...visible, key]); };
  const moveUp = (key: string) => { const i = visible.indexOf(key); if (i <= 1) return; const n = [...visible]; [n[i-1],n[i]]=[n[i],n[i-1]]; onUpdate(n); };
  const moveDown = (key: string) => { const i = visible.indexOf(key); if (i<=0||i>=visible.length-1) return; const n=[...visible]; [n[i],n[i+1]]=[n[i+1],n[i]]; onUpdate(n); };

  const enabled = visible.map((k) => ALL_COLUMNS.find((c) => c.key === k)!).filter(Boolean);
  const disabled = ALL_COLUMNS.filter((c) => !visible.includes(c.key));

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(!open)} className="h-7 w-7 flex items-center justify-center rounded-md border border-[#e5e5e5] bg-white text-[#6a6a6a] hover:bg-[#FAFAF9] hover:text-[#1D1D1D] transition-colors" title="Column settings">
        <Settings2 className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-[260px] rounded-lg border border-[#e5e5e5] bg-white shadow-lg">
          <div className="px-3 py-2 border-b border-[#e5e5e5]"><p className="text-[12px] font-semibold text-[#1D1D1D]">Columns</p></div>
          <div className="py-1 max-h-[400px] overflow-y-auto">
            {enabled.map((col) => (
              <div key={col.key} className="flex items-center gap-2 px-3 py-1.5 hover:bg-[#FAFAF9]">
                <input type="checkbox" checked disabled={col.key==="companyName"} onChange={() => toggle(col.key)} className="h-3.5 w-3.5 rounded accent-[#4ABDE8]" />
                <span className="text-[13px] text-[#1D1D1D] flex-1">{col.label}</span>
                {col.key !== "companyName" && (
                  <div className="flex gap-0.5">
                    <button onClick={() => moveUp(col.key)} className="h-5 w-5 flex items-center justify-center rounded text-[#9a9a9a] hover:bg-[#ece9e5] transition-colors"><ChevronDown className="h-3 w-3 rotate-180" /></button>
                    <button onClick={() => moveDown(col.key)} className="h-5 w-5 flex items-center justify-center rounded text-[#9a9a9a] hover:bg-[#ece9e5] transition-colors"><ChevronDown className="h-3 w-3" /></button>
                  </div>
                )}
              </div>
            ))}
            {disabled.length > 0 && <div className="mx-3 my-1 border-t border-[#e5e5e5]" />}
            {disabled.map((col) => (
              <div key={col.key} className="flex items-center gap-2 px-3 py-1.5 hover:bg-[#FAFAF9]">
                <input type="checkbox" checked={false} onChange={() => toggle(col.key)} className="h-3.5 w-3.5 rounded accent-[#4ABDE8]" />
                <span className="text-[13px] text-[#9a9a9a] flex-1">{col.label}</span>
              </div>
            ))}
          </div>
          <div className="px-3 py-2 border-t border-[#e5e5e5]"><button onClick={() => onUpdate(DEFAULT_VISIBLE)} className="text-[12px] text-[#4ABDE8] hover:underline">Reset to default</button></div>
        </div>
      )}
    </div>
  );
}

// --- Filter panel ---

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div className="space-y-1">
      <label className="text-[11px] font-medium text-[#9a9a9a] uppercase tracking-wider">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full h-7 rounded-md border border-[#e5e5e5] bg-white px-2 text-[13px] text-[#1D1D1D] outline-none focus:border-[#4ABDE8]">
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

function FilterPanel({ filters, onChange, onClear, counties }: { filters: Filters; onChange: (f: Filters) => void; onClear: () => void; counties: string[] }) {
  const set = (key: keyof Filters, value: string) => onChange({ ...filters, [key]: value });
  const yesNoOpts = [{ value: "", label: "Any" }, { value: "true", label: "Yes" }, { value: "false", label: "No" }];

  return (
    <div className="border-b border-[#e5e5e5] bg-white px-4 py-3 shrink-0">
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-x-3 gap-y-2.5">
        <FilterSelect label="County" value={filters.county} onChange={(v) => set("county", v)} options={[{ value: "", label: "All Counties" }, ...counties.map((c) => ({ value: c, label: c }))]} />
        <FilterSelect label="Stage" value={filters.stage} onChange={(v) => set("stage", v)} options={[{ value: "", label: "All Stages" }, ...PIPELINE_STAGES.map((s) => ({ value: s.key, label: s.label }))]} />
        <FilterSelect label="Tier" value={filters.tier} onChange={(v) => set("tier", v)} options={[{ value: "", label: "All" }, { value: "high", label: "High" }, { value: "medium", label: "Medium" }, { value: "low", label: "Low" }]} />
        <FilterSelect label="Has Website" value={filters.hasWebsite} onChange={(v) => set("hasWebsite", v)} options={yesNoOpts} />
        <FilterSelect label="Has Email" value={filters.hasEmail} onChange={(v) => set("hasEmail", v)} options={yesNoOpts} />
        <FilterSelect label="Has Reviews" value={filters.hasReviews} onChange={(v) => set("hasReviews", v)} options={yesNoOpts} />
        <div className="space-y-1">
          <label className="text-[11px] font-medium text-[#9a9a9a] uppercase tracking-wider">Sources</label>
          <div className="flex items-center gap-3 h-7">
            {(["inMcs","inNova","inTrustMark"] as const).map((k) => (
              <label key={k} className="flex items-center gap-1 text-[12px] text-[#3a3a3a] cursor-pointer">
                <input type="checkbox" checked={filters[k]==="true"} onChange={(e) => set(k, e.target.checked ? "true" : "")} className="h-3 w-3 rounded accent-[#4ABDE8]" />
                {k === "inMcs" ? "MCS" : k === "inNova" ? "Nova" : "TM"}
              </label>
            ))}
          </div>
        </div>
        <div className="space-y-1">
          <label className="text-[11px] font-medium text-[#9a9a9a] uppercase tracking-wider">Score</label>
          <div className="flex items-center gap-1">
            <input type="number" placeholder="Min" value={filters.scoreMin} onChange={(e) => set("scoreMin", e.target.value)} className="w-full h-7 rounded-md border border-[#e5e5e5] bg-white px-2 text-[12px] outline-none focus:border-[#4ABDE8] tabular-nums" />
            <span className="text-[#9a9a9a] text-[11px]">–</span>
            <input type="number" placeholder="Max" value={filters.scoreMax} onChange={(e) => set("scoreMax", e.target.value)} className="w-full h-7 rounded-md border border-[#e5e5e5] bg-white px-2 text-[12px] outline-none focus:border-[#4ABDE8] tabular-nums" />
          </div>
        </div>
        <div className="space-y-1">
          <label className="text-[11px] font-medium text-[#9a9a9a] uppercase tracking-wider">Min Rating</label>
          <input type="number" step="0.1" min="0" max="5" placeholder="e.g. 4.0" value={filters.ratingMin} onChange={(e) => set("ratingMin", e.target.value)} className="w-full h-7 rounded-md border border-[#e5e5e5] bg-white px-2 text-[12px] outline-none focus:border-[#4ABDE8] tabular-nums" />
        </div>
      </div>
      {countActiveFilters(filters) > 0 && (
        <div className="mt-2.5 flex items-center gap-2">
          <button onClick={onClear} className="text-[12px] text-[#4ABDE8] hover:underline flex items-center gap-1"><X className="h-3 w-3" />Clear all</button>
          <span className="text-[11px] text-[#9a9a9a]">{countActiveFilters(filters)} active</span>
        </div>
      )}
    </div>
  );
}

// --- Bulk action bar ---

function BulkActionBar({
  count,
  onClear,
  onStageChange,
  onExport,
  onDelete,
}: {
  count: number;
  onClear: () => void;
  onStageChange: (stage: string) => void;
  onExport: () => void;
  onDelete: () => void;
}) {
  const [stageOpen, setStageOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!stageOpen) return; function h(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setStageOpen(false); } document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h); }, [stageOpen]);

  return (
    <div className="absolute bottom-12 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 rounded-xl border border-[#e5e5e5] bg-white px-4 py-2 shadow-lg">
      <span className="text-[13px] font-medium text-[#1D1D1D]">{count} selected</span>
      <div className="h-4 w-px bg-[#e5e5e5]" />

      {/* Change stage */}
      <div className="relative" ref={ref}>
        <button onClick={() => setStageOpen(!stageOpen)} className="h-7 flex items-center gap-1 rounded-md border border-[#e5e5e5] bg-white px-2.5 text-[12px] text-[#6a6a6a] hover:bg-[#FAFAF9] hover:text-[#1D1D1D] transition-colors">
          <ArrowRight className="h-3 w-3" /> Move to
        </button>
        {stageOpen && (
          <div className="absolute bottom-full mb-1 left-0 w-[160px] bg-white rounded-lg border border-[#e5e5e5] shadow-lg py-1">
            {PIPELINE_STAGES.map((s) => (
              <button key={s.key} onClick={() => { onStageChange(s.key); setStageOpen(false); }} className="w-full flex items-center gap-2 px-2.5 py-1.5 text-[12px] text-left text-[#6a6a6a] hover:bg-[#FAFAF9]">
                <div className="h-[6px] w-[6px] rounded-full" style={{ backgroundColor: s.color }} />
                {s.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <button onClick={onExport} className="h-7 flex items-center gap-1 rounded-md border border-[#e5e5e5] bg-white px-2.5 text-[12px] text-[#6a6a6a] hover:bg-[#FAFAF9] hover:text-[#1D1D1D] transition-colors">
        <Download className="h-3 w-3" /> Export
      </button>

      <button onClick={onDelete} className="h-7 flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2.5 text-[12px] text-red-600 hover:bg-red-100 transition-colors">
        <Trash2 className="h-3 w-3" /> Delete
      </button>

      <button onClick={onClear} className="h-7 w-7 flex items-center justify-center rounded-md text-[#9a9a9a] hover:bg-[#ece9e5] transition-colors">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// --- Mobile card ---

function InstallerCard({ row, selected, onToggle }: { row: Installer; selected: boolean; onToggle: () => void }) {
  const stageInfo = PIPELINE_STAGES.find((s) => s.key === (row.pipelineStage || "uncontacted"));
  return (
    <div className={`border border-[#e5e5e5] rounded-xl bg-white p-3.5 ${selected ? "ring-2 ring-[#4ABDE8]" : ""}`}>
      <div className="flex items-start gap-2.5">
        <input type="checkbox" checked={selected} onChange={onToggle} className="mt-1 h-3.5 w-3.5 rounded accent-[#4ABDE8] shrink-0" />
        <div className="flex-1 min-w-0">
          <Link href={`/installers/${row.id}`} className="text-[14px] font-medium text-[#1D1D1D] hover:text-[#4ABDE8]">{row.companyName}</Link>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-[12px] text-[#6a6a6a]">
            {row.county && <span>{row.county}</span>}
            {row.postcode && <span className="font-mono">{row.postcode}</span>}
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-2">
            {stageInfo && (
              <div className="flex items-center gap-1">
                <div className="h-[6px] w-[6px] rounded-full" style={{ backgroundColor: stageInfo.color }} />
                <span className="text-[11px] text-[#6a6a6a]">{stageInfo.label}</span>
              </div>
            )}
            {row.googleRating != null && (
              <div className="flex items-center gap-0.5">
                <Star className="h-3 w-3 fill-[#e8b94a] text-[#e8b94a]" />
                <span className="text-[11px] font-medium">{row.googleRating.toFixed(1)}</span>
              </div>
            )}
            {row.overallScore != null && (
              <span className="text-[11px] text-[#6a6a6a]">Score: {row.overallScore.toFixed(0)}</span>
            )}
          </div>
          <div className="flex flex-wrap gap-2 mt-2 text-[11px]">
            {row.email && <a href={`mailto:${row.email}`} className="text-[#4ABDE8] truncate max-w-[180px]">{row.email}</a>}
            {row.telephone && <a href={`tel:${row.telephone}`} className="text-[#6a6a6a]">{row.telephone}</a>}
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Main table ---

export function InstallerTable({ counties }: InstallerTableProps) {
  const [data, setData] = useState<Installer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [sortBy, setSortBy] = useState("companyName");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [visibleColumns, setVisibleColumns] = useState<string[]>(DEFAULT_VISIBLE);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [colWidths, setColWidths] = useState<Record<string, number>>({});
  const resizingRef = useRef<{ key: string; startX: number; startW: number } | null>(null);

  useEffect(() => { setVisibleColumns(loadColumns()); setPageSize(loadPageSize()); }, []);

  // Column resize handlers
  const startResize = useCallback((key: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const th = (e.target as HTMLElement).closest("th");
    if (!th) return;
    const startW = th.getBoundingClientRect().width;
    resizingRef.current = { key, startX: e.clientX, startW };

    const onMove = (ev: MouseEvent) => {
      if (!resizingRef.current) return;
      const delta = ev.clientX - resizingRef.current.startX;
      const newW = Math.max(60, resizingRef.current.startW + delta);
      setColWidths((prev) => ({ ...prev, [resizingRef.current!.key]: newW }));
    };
    const onUp = () => {
      resizingRef.current = null;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);
  const updateColumns = (cols: string[]) => { setVisibleColumns(cols); saveColumns(cols); };
  const updatePageSize = (n: number) => { setPageSize(n); savePageSize(n); setPage(1); };

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      for (const [k, v] of Object.entries(filters)) { if (v) params.set(k === "stage" ? "stage" : k, v); }
      params.set("page", String(page));
      params.set("pageSize", String(pageSize));
      params.set("sortBy", sortBy);
      params.set("sortOrder", sortOrder);
      const res = await fetch(`/api/installers?${params}`);
      if (!res.ok) {
        console.error("API error:", res.status, await res.text().catch(() => ""));
        return;
      }
      const json: InstallerResponse = await res.json();
      setData(json.data);
      setTotalPages(json.totalPages);
      setTotal(json.total);
    } catch (err) {
      console.error("Fetch error:", err);
    } finally {
      setLoading(false);
    }
  }, [search, filters, page, pageSize, sortBy, sortOrder]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const [searchInput, setSearchInput] = useState("");
  useEffect(() => { const t = setTimeout(() => { setSearch(searchInput); setPage(1); }, 300); return () => clearTimeout(t); }, [searchInput]);

  const toggleSort = (column: string) => {
    if (sortBy === column) setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    else { setSortBy(column); setSortOrder("asc"); }
  };

  // Inline update handler - update local state
  const handleCellUpdate = (id: number, field: string, val: string) => {
    setData((prev) => prev.map((r) => r.id === id ? { ...r, [field]: val || null } : r));
  };

  // Selection
  const toggleSelect = (id: number) => {
    setSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };
  const toggleSelectAll = () => {
    if (selected.size === data.length) setSelected(new Set());
    else setSelected(new Set(data.map((r) => r.id)));
  };
  const clearSelection = () => setSelected(new Set());

  // Bulk actions
  const bulkStageChange = async (stage: string) => {
    setBulkLoading(true);
    try {
      await Promise.all([...selected].map((id) =>
        fetch(`/api/installers/${id}/stage`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stage }) })
      ));
      toast.success(`${selected.size} installers moved to ${PIPELINE_STAGES.find((s) => s.key === stage)?.label}`);
      clearSelection();
      fetchData();
    } catch { toast.error("Failed to update stages"); }
    finally { setBulkLoading(false); }
  };

  const bulkExport = () => {
    const selectedRows = data.filter((r) => selected.has(r.id));
    const columns = visibleColumns.map((k) => ALL_COLUMNS.find((c) => c.key === k)).filter(Boolean) as ColumnDef[];
    const headers = columns.map((c) => c.label);
    const rows = selectedRows.map((r) =>
      columns.map((c) => {
        if (c.key === "companyName") return r.companyName;
        if (c.key === "county") return r.county || "";
        if (c.key === "postcode") return r.postcode || "";
        if (c.key === "email") return r.email || "";
        if (c.key === "telephone") return r.telephone || "";
        if (c.key === "website") return r.website || "";
        if (c.key === "stage") return PIPELINE_STAGES.find((s) => s.key === (r.pipelineStage || "uncontacted"))?.label || "";
        if (c.key === "score") return r.overallScore?.toFixed(0) || "";
        if (c.key === "tier") return r.tier || "";
        if (c.key === "reviews") return [r.googleRating ? `G:${r.googleRating.toFixed(1)}` : "", r.trustpilotRating ? `T:${r.trustpilotRating.toFixed(1)}` : ""].filter(Boolean).join(" ") || "";
        if (c.key === "legalEntityName") return r.legalEntityName || "";
        if (c.key === "technologies") return r.technologiesCertified || "";
        return "";
      })
    );
    const csv = [headers.join(","), ...rows.map((r) => r.map((v) => `"${v.replace(/"/g, '""')}"`).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `installers-${selected.size}-selected.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${selected.size} rows`);
  };

  const bulkDelete = async () => {
    if (!confirm(`Delete ${selected.size} installers? This cannot be undone.`)) return;
    setBulkLoading(true);
    try {
      let deleted = 0;
      for (const id of selected) {
        const res = await fetch(`/api/installers/${id}`, { method: "DELETE" });
        if (res.ok) deleted++;
      }
      toast.success(`Deleted ${deleted} installers`);
      clearSelection();
      fetchData();
    } catch { toast.error("Failed to delete"); }
    finally { setBulkLoading(false); }
  };

  const SortHeader = ({ label, column }: { label: string; column: string }) => {
    const isActive = sortBy === column;
    return (
      <button className="flex items-center gap-1 text-left w-full group/sort" onClick={() => toggleSort(column)}>
        {label}
        <ChevronDown className={`h-3 w-3 transition-all ${isActive ? "text-[#4ABDE8] opacity-100" : "opacity-0 group-hover/sort:opacity-40"} ${isActive && sortOrder === "desc" ? "rotate-180" : ""}`} />
      </button>
    );
  };

  const columns = visibleColumns.map((key) => ALL_COLUMNS.find((c) => c.key === key)).filter(Boolean) as ColumnDef[];
  const activeFilterCount = countActiveFilters(filters);
  const allSelected = data.length > 0 && selected.size === data.length;

  return (
    <div className="flex h-full flex-col relative">
      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b border-[#e5e5e5] bg-white px-4 py-2 shrink-0 shadow-[0_1px_3px_rgba(0,0,0,0.03)]">
        <h1 className="text-[14px] font-semibold text-[#1D1D1D] mr-2 hidden sm:block">Installers</h1>
        <div className="h-4 w-px bg-[#e5e5e5] mx-1 hidden sm:block" />

        <div className="relative flex-1 sm:flex-none">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#9a9a9a]" />
          <input placeholder="Search..." value={searchInput} onChange={(e) => setSearchInput(e.target.value)} className="h-7 w-full sm:w-[180px] rounded-md border border-[#e5e5e5] bg-white pl-7 pr-2 text-[13px] text-[#1D1D1D] placeholder:text-[#9a9a9a] outline-none focus:border-[#4ABDE8] focus:ring-1 focus:ring-[#4ABDE8]/20 transition-colors" />
        </div>

        <button onClick={() => setShowFilters(!showFilters)} className={`h-7 flex items-center gap-1.5 rounded-md border px-2.5 text-[13px] font-medium transition-colors shrink-0 ${showFilters || activeFilterCount > 0 ? "border-[#4ABDE8] bg-[#FFF8F5] text-[#4ABDE8]" : "border-[#e5e5e5] bg-white text-[#6a6a6a] hover:bg-[#FAFAF9]"}`}>
          <Filter className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Filter</span>
          {activeFilterCount > 0 && <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[#4ABDE8] text-[10px] font-semibold text-white px-1">{activeFilterCount}</span>}
        </button>

        <div className="ml-auto flex items-center gap-2">
          <span className="text-[12px] text-[#9a9a9a] tabular-nums hidden sm:inline">{total.toLocaleString()} rows</span>
          <ColumnSettings visible={visibleColumns} onUpdate={updateColumns} />
          <AddInstallerDialog />
        </div>
      </div>

      {showFilters && <FilterPanel filters={filters} onChange={(f) => { setFilters(f); setPage(1); }} onClear={() => { setFilters(EMPTY_FILTERS); setPage(1); }} counties={counties} />}

      {/* Desktop table */}
      <div className="flex-1 overflow-auto bg-white hidden md:block">
        <table className="border-collapse text-[13px]" style={{ tableLayout: "fixed", minWidth: "100%" }}>
          <colgroup>
            <col style={{ width: 36 }} />
            {columns.map((col) => (
              <col key={col.key} style={colWidths[col.key] ? { width: colWidths[col.key] } : undefined} />
            ))}
          </colgroup>
          <thead className="sticky top-0 z-10">
            <tr className="bg-[#FAFAF9] border-b border-[#e5e5e5]">
              <th className="w-[36px] px-2.5 py-2.5">
                <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} className="h-3.5 w-3.5 rounded accent-[#4ABDE8]" />
              </th>
              {columns.map((col) => (
                <th key={col.key} className="text-left font-medium text-[#9a9a9a] text-[11px] uppercase tracking-wider px-3 py-2.5 whitespace-nowrap relative group/th">
                  {col.sortKey ? <SortHeader label={col.label} column={col.sortKey} /> : col.label}
                  <div
                    onMouseDown={(e) => startResize(col.key, e)}
                    className="absolute right-0 top-0 h-full w-[4px] cursor-col-resize opacity-0 group-hover/th:opacity-100 hover:!opacity-100 bg-[#4ABDE8]/40 transition-opacity"
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 15 }).map((_, i) => (
                <tr key={i} className="border-b border-[#f0f0f0]">
                  <td className="px-2.5 py-3"><Skeleton className="h-3.5 w-3.5 rounded" /></td>
                  {columns.map((col) => (
                    <td key={col.key} className="px-3 py-3 overflow-hidden"><Skeleton className="h-4 w-full rounded" /></td>
                  ))}
                </tr>
              ))
            ) : data.length === 0 ? (
              <tr>
                <td colSpan={columns.length + 1} className="px-3 py-20 text-center">
                  <div className="flex flex-col items-center gap-2">
                    <div className="h-10 w-10 rounded-xl bg-[#ece9e5] flex items-center justify-center">
                      <Search className="h-5 w-5 text-[#9a9a9a]" />
                    </div>
                    <p className="text-[13px] font-medium text-[#6a6a6a]">No installers found</p>
                    <p className="text-[12px] text-[#9a9a9a]">Try adjusting your search or filters</p>
                  </div>
                </td>
              </tr>
            ) : (
              data.map((row, rowIdx) => (
                <tr key={row.id} className={`border-b border-[#f0f0f0] transition-colors ${selected.has(row.id) ? "bg-[#FFF8F5]" : rowIdx % 2 === 1 ? "bg-[#FAFAF9]/50" : "hover:bg-[#FAFAF9]"}`}>
                  <td className="px-2.5 py-[6px]">
                    <input type="checkbox" checked={selected.has(row.id)} onChange={() => toggleSelect(row.id)} className="h-3.5 w-3.5 rounded accent-[#4ABDE8]" />
                  </td>
                  {columns.map((col) => (
                    <td key={col.key} className="px-3 py-[6px] overflow-hidden">
                      {col.render(row, handleCellUpdate)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile card list */}
      <div className="flex-1 overflow-auto bg-[#F5F4F3] p-3 space-y-2 md:hidden">
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="border border-[#e5e5e5] rounded-xl bg-white p-3.5">
              <Skeleton className="h-4 w-3/4 mb-2" />
              <Skeleton className="h-3 w-1/2 mb-1" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          ))
        ) : data.length === 0 ? (
          <div className="text-center text-[13px] text-[#9a9a9a] py-12">No installers found</div>
        ) : (
          data.map((row) => (
            <InstallerCard key={row.id} row={row} selected={selected.has(row.id)} onToggle={() => toggleSelect(row.id)} />
          ))
        )}
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <BulkActionBar
          count={selected.size}
          onClear={clearSelection}
          onStageChange={bulkStageChange}
          onExport={bulkExport}
          onDelete={bulkDelete}
        />
      )}

      {/* Bottom pagination bar */}
      <div className="flex items-center justify-between border-t border-[#e5e5e5] bg-white px-4 py-1.5 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-[#9a9a9a] tabular-nums">
            {((page - 1) * pageSize + 1).toLocaleString()}–{Math.min(page * pageSize, total).toLocaleString()} of {total.toLocaleString()}
          </span>
          <div className="h-3.5 w-px bg-[#e5e5e5] mx-0.5" />
          <select
            value={pageSize}
            onChange={(e) => updatePageSize(Number(e.target.value))}
            className="h-6 rounded-md border border-[#e5e5e5] bg-white px-1.5 text-[11px] text-[#6a6a6a] outline-none hover:border-[#d0d0d0] transition-colors"
          >
            <option value={25}>25 / page</option>
            <option value={50}>50 / page</option>
            <option value={100}>100 / page</option>
            <option value={250}>250 / page</option>
          </select>
        </div>
        <div className="flex items-center gap-0.5">
          <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="h-7 px-2 flex items-center justify-center rounded-md text-[12px] text-[#6a6a6a] hover:bg-[#ece9e5] disabled:opacity-30 disabled:hover:bg-transparent transition-colors">
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          {/* Page numbers */}
          {(() => {
            const pages: (number | "...")[] = [];
            const tp = totalPages || 1;
            if (tp <= 7) {
              for (let i = 1; i <= tp; i++) pages.push(i);
            } else {
              pages.push(1);
              if (page > 3) pages.push("...");
              for (let i = Math.max(2, page - 1); i <= Math.min(tp - 1, page + 1); i++) pages.push(i);
              if (page < tp - 2) pages.push("...");
              pages.push(tp);
            }
            return pages.map((p, idx) =>
              p === "..." ? (
                <span key={`e${idx}`} className="px-1 text-[11px] text-[#9a9a9a]">...</span>
              ) : (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  className={`h-7 min-w-[28px] px-1.5 flex items-center justify-center rounded-md text-[12px] font-medium transition-colors tabular-nums ${
                    p === page
                      ? "bg-[#4ABDE8] text-white shadow-sm"
                      : "text-[#6a6a6a] hover:bg-[#ece9e5]"
                  }`}
                >
                  {p}
                </button>
              )
            );
          })()}
          <button disabled={page >= totalPages} onClick={() => setPage(page + 1)} className="h-7 px-2 flex items-center justify-center rounded-md text-[12px] text-[#6a6a6a] hover:bg-[#ece9e5] disabled:opacity-30 disabled:hover:bg-transparent transition-colors">
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
