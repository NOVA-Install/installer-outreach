"use client";

import { useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import { FaLinkedinIn, FaFacebookF, FaInstagram, FaXTwitter, FaYoutube } from "react-icons/fa6";
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
  Sun,
  Thermometer,
  Battery,
  Wind,
  TreePine,
  Globe,
  Droplets,
  Flame,
  Zap,
  RefreshCw,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { PIPELINE_STAGES } from "@/lib/constants";
import { AddInstallerDialog } from "@/components/installers/add-installer-dialog";
import { toast } from "sonner";
import { FilterSidebar, countActiveFilters, EMPTY_FILTERS, type Filters, type DistanceOrigin } from "@/components/filters/filter-sidebar";

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
  crmToolName: string | null;
  hasLiveChat: boolean | null;
  // Traffic
  googleOrganicEtv: number | null;
  googlePaidEtv: number | null;
  // Source specific
  novaYearStarted: string | null;
  trustmarkStatus: string | null;
  certificationBody: string | null;
  // Shortlist
  isShortlisted: boolean | null;
  priority: number | null;
  priorityNote: string | null;
  // Website quality
  formType: string | null;
  performanceScore: number | null;
  siteBuilder: string | null;
  // Social
  facebookUrl: string | null;
  instagramUrl: string | null;
  linkedinUrl: string | null;
  twitterUrl: string | null;
  youtubeUrl: string | null;
  // Computed
  distance: number | null;
}

interface InstallerResponse {
  data: Installer[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

interface InstallerTableProps {
  counties?: string[];
  crmTools?: string[];
}

// Filters type, EMPTY_FILTERS, and countActiveFilters imported from @/components/filters/filter-sidebar

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

// --- Compact rating bar ---

function RatingBar({ rating, max = 5, color }: { rating: number; max?: number; color: string }) {
  const pct = (rating / max) * 100;
  return (
    <div className="w-[40px] h-[4px] rounded-full bg-[#f0f0f0] overflow-hidden shrink-0">
      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
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
  const hue = name.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;

  if (!domain || errored) {
    return (
      <div
        className="h-8 w-8 rounded-lg flex items-center justify-center shrink-0"
        style={{ background: `hsl(${hue}, 35%, 93%)` }}
      >
        <span className="text-[12px] font-bold" style={{ color: `hsl(${hue}, 40%, 50%)` }}>
          {name[0]?.toUpperCase() || "?"}
        </span>
      </div>
    );
  }
  return (
    <img
      src={`https://www.google.com/s2/favicons?domain=${domain}&sz=32`}
      alt=""
      width={32}
      height={32}
      loading="lazy"
      decoding="async"
      className="h-8 w-8 rounded-lg bg-white object-contain shrink-0 border border-[#f0f0f0]"
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
      const techs = row.technologiesCertified?.split(/[;,|]/).map((t) => t.trim()).filter(Boolean) || [];
      // Deduplicate techs by their icon category
      const seen = new Set<string>();
      const uniqueTechs = techs.filter((t) => {
        const lower = t.toLowerCase();
        let key = lower;
        if (lower.includes("solar") && !lower.includes("heat")) key = "solar";
        else if (lower.includes("air source") || lower.includes("ashp") || lower.includes("exhaust air")) key = "ashp";
        else if (lower.includes("water source")) key = "wshp";
        else if (lower.includes("ground source") || lower.includes("gshp")) key = "gshp";
        else if (lower.includes("heat pump") && !lower.includes("air") && !lower.includes("water") && !lower.includes("ground") && !lower.includes("exhaust")) key = "heat_pump";
        else if (lower.includes("battery") || lower.includes("storage")) key = "battery";
        else if (lower.includes("wind")) key = "wind";
        else if (lower.includes("biomass")) key = "biomass";
        else if (lower.includes("boiler")) key = "boiler";
        else if (lower.includes("micro chp") || lower.includes("chp")) key = "chp";
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      return (
        <div className="flex items-center gap-2.5">
          <CompanyLogo domain={domain} name={row.companyName} />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <Link href={`/installers/${row.id}`} className="text-[13px] font-semibold text-[#1D1D1D] hover:text-[#4ABDE8] transition-colors truncate">
                {row.companyName}
              </Link>
              {row.website && (
                <a href={row.website.startsWith("http") ? row.website : `https://${row.website}`} target="_blank" rel="noopener noreferrer" className="text-[#b0b0b0] hover:text-[#4ABDE8] transition-colors shrink-0">
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
            <div className="flex items-center gap-1 mt-0.5">
              {uniqueTechs.length > 0 && uniqueTechs.map((t) => {
                const lower = t.toLowerCase();
                const ico = "h-[14px] w-[14px] text-[#6a6a6a]";
                const box = "inline-flex items-center justify-center h-[20px] w-[20px] rounded-md bg-[#f5f5f5] group/tip relative";
                const tip = "pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-1.5 py-0.5 rounded bg-[#1D1D1D] text-[10px] text-white whitespace-nowrap opacity-0 group-hover/tip:opacity-100 transition-opacity z-20";
                if (lower.includes("solar") && !lower.includes("heat")) return <span key={t} className={box}><Sun className={ico} /><span className={tip}>Solar PV</span></span>;
                if (lower.includes("air source") || lower.includes("ashp") || lower.includes("exhaust air")) return <span key={t} className={box}><Thermometer className={ico} /><span className={tip}>Air Source Heat Pump</span></span>;
                if (lower.includes("water source")) return <span key={t} className={box}><Droplets className={ico} /><span className={tip}>Water Source Heat Pump</span></span>;
                if (lower.includes("ground source") || lower.includes("gshp")) return <span key={t} className={box}><Globe className={ico} /><span className={tip}>Ground Source Heat Pump</span></span>;
                if (lower.includes("gas absorption") || (lower.includes("heat pump") && !lower.includes("air") && !lower.includes("water") && !lower.includes("ground") && !lower.includes("exhaust"))) return <span key={t} className={box}><RefreshCw className={ico} /><span className={tip}>Gas Absorption Heat Pump</span></span>;
                if (lower.includes("battery") || lower.includes("storage")) return <span key={t} className={box}><Battery className={ico} /><span className={tip}>Battery Storage</span></span>;
                if (lower.includes("wind")) return <span key={t} className={box}><Wind className={ico} /><span className={tip}>Wind Turbine</span></span>;
                if (lower.includes("biomass")) return <span key={t} className={box}><TreePine className={ico} /><span className={tip}>Biomass</span></span>;
                if (lower.includes("boiler")) return <span key={t} className={box}><Flame className={ico} /><span className={tip}>Boiler</span></span>;
                if (lower.includes("micro chp") || lower.includes("chp")) return <span key={t} className={box}><Zap className={ico} /><span className={tip}>Micro CHP</span></span>;
                return <span key={t} title={t} className="inline-flex items-center justify-center h-[20px] px-1.5 rounded-md bg-[#f5f5f5] text-[9px] text-[#9a9a9a] font-medium">{t.slice(0, 3).toUpperCase()}</span>;
              })}
            </div>
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
    label: "Location",
    sortKey: "county",
    render: (row) => {
      const county = row.county && !row.county.toLowerCase().includes("unspecified") ? row.county : null;
      if (!county) return <span className="text-[#d5d5d5]">—</span>;
      return (
        <div className="flex items-center gap-1.5">
          <span className="text-[12px] shrink-0">🇬🇧</span>
          <span className="text-[13px] text-[#3a3a3a]">{county}</span>
        </div>
      );
    },
  },
  {
    key: "postcode",
    label: "Postcode",
    sortKey: "postcode",
    render: (row) => <span className="text-[#6a6a6a] font-mono text-[12px]">{row.postcode || "—"}</span>,
  },
  {
    key: "distance",
    label: "Distance",
    sortKey: "distance",
    render: (row) =>
      row.distance != null ? (
        <span className="tabular-nums text-[12px] text-[#6a6a6a]">{row.distance < 1 ? "<1 mi" : `${Math.round(row.distance)} mi`}</span>
      ) : (
        <span className="text-[#d5d5d5]">—</span>
      ),
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
    render: (row) => {
      if (row.googleRating == null) return <span className="text-[#d5d5d5]">—</span>;
      const r = row.googleRating;
      const bg = r >= 4.5 ? "#0d652d" : r >= 4.0 ? "#2e7d32" : r >= 3.5 ? "#f9a825" : r >= 3.0 ? "#e65100" : "#c62828";
      return (
        <div className="flex flex-col gap-0.5">
          <div className="inline-flex items-center gap-1 h-[22px] px-1.5 rounded-md w-fit" style={{ backgroundColor: bg }}>
            <svg className="h-2.5 w-2.5 shrink-0" viewBox="0 0 24 24" fill="white"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
            <span className="font-bold tabular-nums text-[11.5px] text-white leading-none">{r.toFixed(1)}</span>
          </div>
          {row.googleReviewCount != null && (
            <span className="text-[11px] text-[#6a6a6a] tabular-nums pl-0.5">{row.googleReviewCount.toLocaleString()} reviews</span>
          )}
        </div>
      );
    },
  },
  {
    key: "trustpilotReviews",
    label: "Trustpilot",
    sortKey: "trustpilotReviewCount",
    render: (row) => {
      if (row.trustpilotRating == null) return <span className="text-[#d5d5d5]">—</span>;
      const r = row.trustpilotRating;
      const starCount = Math.round(r);
      const tpColors: Record<number, string> = { 5: "#00b67a", 4: "#73cf11", 3: "#ffce00", 2: "#ff8622", 1: "#ff3722" };
      const tpColor = tpColors[starCount] || "#00b67a";
      return (
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-1.5">
            <div className="flex items-center gap-[2px]">
              {Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className="h-[14px] w-[14px] flex items-center justify-center rounded-[2px]"
                  style={{ backgroundColor: i < starCount ? tpColor : "#dcdce6" }}
                >
                  <svg className="h-[8px] w-[8px]" viewBox="0 0 24 24" fill="white"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
                </div>
              ))}
            </div>
            <span className="font-semibold tabular-nums text-[12px] text-[#1D1D1D]">{r.toFixed(1)}</span>
          </div>
          {row.trustpilotReviewCount != null && (
            <span className="text-[11px] text-[#6a6a6a] tabular-nums pl-0.5">{row.trustpilotReviewCount.toLocaleString()} reviews</span>
          )}
        </div>
      );
    },
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
    render: (row) => {
      if (row.overallScore == null) return <span className="text-[#d5d5d5]">—</span>;
      const s = row.overallScore;
      const pct = Math.min(100, Math.max(0, s));
      const color = pct >= 70 ? "#10b981" : pct >= 45 ? "#f59e0b" : "#9ca3af";
      const circumference = 2 * Math.PI * 13;
      const dasharray = `${(pct / 100) * circumference} ${circumference}`;
      return (
        <div className="relative h-[34px] w-[34px]">
          <svg className="h-full w-full -rotate-90" viewBox="0 0 34 34">
            <circle cx="17" cy="17" r="13" stroke="#f0f0f0" strokeWidth="2.5" fill="none" />
            <circle cx="17" cy="17" r="13" stroke={color} strokeWidth="2.5" fill="none"
              strokeDasharray={dasharray} strokeLinecap="round" />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center font-bold tabular-nums text-[11px] leading-none text-[#1D1D1D]">{s.toFixed(0)}</span>
        </div>
      );
    },
  },
  {
    key: "website",
    label: "Website",
    sortKey: "website",
    render: (row) => {
      const domain = getDomain(row.website);
      return domain ? (
        <a
          href={row.website!.startsWith("http") ? row.website! : `https://${row.website}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[12px] text-[#6a6a6a] hover:text-[#4ABDE8] transition-colors truncate block max-w-[160px]"
        >
          {domain}
        </a>
      ) : <span className="text-[#d5d5d5]">—</span>;
    },
  },
  {
    key: "technologies",
    label: "Technologies",
    render: (row) => {
      if (!row.technologiesCertified) return <span className="text-[#d5d5d5]">—</span>;
      const techs = row.technologiesCertified.split(",").map((t) => t.trim()).filter(Boolean);
      const visible = techs.slice(0, 2);
      const rest = techs.length - visible.length;
      return (
        <div className="flex items-center gap-1 flex-wrap">
          {visible.map((t) => (
            <span key={t} className="inline-flex items-center px-2 py-0.5 rounded-md bg-[#f0f0f0] text-[11px] font-medium text-[#3a3a3a] whitespace-nowrap">
              {t}
            </span>
          ))}
          {rest > 0 && <span className="text-[11px] text-[#9a9a9a]">+{rest}</span>}
        </div>
      );
    },
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
    sortKey: "googleOrganicEtv",
    render: (row) =>
      row.googleOrganicEtv != null ? <span className="tabular-nums text-[12px] text-[#6a6a6a]">{Math.round(row.googleOrganicEtv).toLocaleString()}</span> : <span className="text-[#d5d5d5]">—</span>,
  },
  {
    key: "paidTraffic",
    label: "Paid Traffic",
    sortKey: "googlePaidEtv",
    render: (row) =>
      row.googlePaidEtv != null && row.googlePaidEtv > 0 ? <span className="tabular-nums text-[12px] text-[#4ABDE8]">{Math.round(row.googlePaidEtv).toLocaleString()}</span> : <span className="text-[#d5d5d5]">—</span>,
  },
  {
    key: "shortlist",
    label: "Shortlist",
    sortKey: "isShortlisted",
    render: (row, onUpdate) => {
      const isOn = row.isShortlisted === true;
      return (
        <button
          onClick={async () => {
            const newVal = !isOn;
            onUpdate(row.id, "isShortlisted", String(newVal));
            await fetch(`/api/installers/${row.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ isShortlisted: newVal }),
            });
          }}
          className={`inline-flex items-center gap-1 h-[24px] px-2 rounded-md text-[11px] font-medium transition-colors ${
            isOn
              ? "bg-[#4ABDE8]/10 text-[#4ABDE8] border border-[#4ABDE8]/30"
              : "bg-[#FAFAF9] text-[#9a9a9a] border border-[#e5e5e5] hover:border-[#4ABDE8] hover:text-[#4ABDE8]"
          }`}
          title={isOn ? "Remove from shortlist" : "Add to shortlist"}
        >
          <Star className={`h-3 w-3 ${isOn ? "fill-[#4ABDE8]" : ""}`} />
          {isOn ? "Listed" : "Add"}
        </button>
      );
    },
  },
  {
    key: "priority",
    label: "Priority",
    sortKey: "priority",
    render: (row, onUpdate) => {
      const p = row.priority;
      const colors: Record<number, string> = {
        1: "bg-red-50 text-red-600 border-red-200",
        2: "bg-orange-50 text-orange-600 border-orange-200",
        3: "bg-yellow-50 text-yellow-700 border-yellow-200",
        4: "bg-blue-50 text-blue-600 border-blue-200",
        5: "bg-gray-50 text-gray-500 border-gray-200",
      };
      const labels: Record<number, string> = { 1: "Urgent", 2: "High", 3: "Medium", 4: "Low", 5: "Minimal" };
      return (
        <select
          value={p ?? ""}
          onChange={async (e) => {
            const val = e.target.value ? Number(e.target.value) : null;
            onUpdate(row.id, "priority", String(val));
            await fetch(`/api/installers/${row.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ priority: val }),
            });
          }}
          className={`h-[24px] rounded-md border text-[11px] font-medium px-1.5 outline-none cursor-pointer ${p ? colors[p] || "" : "border-[#e5e5e5] text-[#9a9a9a]"}`}
        >
          <option value="">—</option>
          {[1,2,3,4,5].map((v) => <option key={v} value={v}>{labels[v]}</option>)}
        </select>
      );
    },
  },
  {
    key: "sources",
    label: "Sources",
    render: (row) => {
      const sources = [
        row.inMcs && { label: "MCS", color: "bg-blue-50 text-blue-600" },
        row.inNova && { label: "Nova", color: "bg-purple-50 text-purple-600" },
        row.inTrustMark && { label: "TM", color: "bg-green-50 text-green-600" },
      ].filter(Boolean) as { label: string; color: string }[];
      if (sources.length === 0) return <span className="text-[#d5d5d5]">—</span>;
      return (
        <div className="flex items-center gap-1">
          {sources.map((s) => (
            <span key={s.label} className={`inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-semibold ${s.color}`}>
              {s.label}
            </span>
          ))}
        </div>
      );
    },
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
  {
    key: "formType",
    label: "Form Type",
    render: (row) => {
      if (!row.formType) return <span className="text-[#d5d5d5]">—</span>;
      const styles: Record<string, string> = {
        multi_step: "bg-emerald-50 text-emerald-600",
        quote_form: "bg-sky-50 text-sky-600",
        basic_contact: "bg-amber-50 text-amber-600",
        none: "bg-red-50 text-red-500",
      };
      const labels: Record<string, string> = {
        multi_step: "Multi-step",
        quote_form: "Quote form",
        basic_contact: "Basic contact",
        none: "No form",
      };
      return <span className={`inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-semibold ${styles[row.formType] || ""}`}>{labels[row.formType] || row.formType}</span>;
    },
  },
  {
    key: "performanceScore",
    label: "PageSpeed",
    sortKey: "performanceScore",
    render: (row) => {
      if (row.performanceScore == null) return <span className="text-[#d5d5d5]">—</span>;
      const color = row.performanceScore >= 70 ? "text-emerald-600" : row.performanceScore >= 40 ? "text-amber-600" : "text-red-600";
      return <span className={`text-[12px] font-semibold tabular-nums ${color}`}>{row.performanceScore}</span>;
    },
  },
  {
    key: "siteBuilder",
    label: "Site Builder",
    render: (row) =>
      row.siteBuilder ? <span className="text-[12px] text-[#6a6a6a]">{row.siteBuilder}</span> : <span className="text-[#d5d5d5]">—</span>,
  },
  {
    key: "social",
    label: "Social",
    render: (row) => {
      const links = [
        row.linkedinUrl && { icon: <FaLinkedinIn className="h-3 w-3" />, color: "#0a66c2", url: row.linkedinUrl, name: "LinkedIn" },
        row.facebookUrl && { icon: <FaFacebookF className="h-3 w-3" />, color: "#1877f2", url: row.facebookUrl, name: "Facebook" },
        row.instagramUrl && { icon: <FaInstagram className="h-3 w-3" />, color: "#e4405f", url: row.instagramUrl, name: "Instagram" },
        row.twitterUrl && { icon: <FaXTwitter className="h-3 w-3" />, color: "#1d9bf0", url: row.twitterUrl, name: "X" },
        row.youtubeUrl && { icon: <FaYoutube className="h-3 w-3" />, color: "#ff0000", url: row.youtubeUrl, name: "YouTube" },
      ].filter(Boolean) as { icon: ReactNode; color: string; url: string; name: string }[];
      if (links.length === 0) return <span className="text-[#d5d5d5]">—</span>;
      return (
        <div className="flex items-center gap-1">
          {links.map((l) => (
            <a
              key={l.name}
              href={l.url}
              target="_blank"
              rel="noopener noreferrer"
              className="h-[22px] w-[22px] rounded-md flex items-center justify-center transition-opacity hover:opacity-70"
              style={{ backgroundColor: `${l.color}15`, color: l.color }}
              title={l.name}
            >
              {l.icon}
            </a>
          ))}
        </div>
      );
    },
  },
];

const DEFAULT_VISIBLE = ["companyName", "county", "postcode", "stage", "googleReviews", "trustpilotReviews", "score", "totalReviews", "website"];
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

// FilterSidebar imported from @/components/filters/filter-sidebar

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

export function InstallerTable({ counties: initialCounties, crmTools: initialCrmTools }: InstallerTableProps = {}) {
  const [data, setData] = useState<Installer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const [counties, setCounties] = useState<string[]>(initialCounties ?? []);
  const [crmTools, setCrmTools] = useState<string[]>(initialCrmTools ?? []);
  const [distanceOrigin, setDistanceOrigin] = useState<DistanceOrigin | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [sortBy, setSortBy] = useState("overallScore");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [visibleColumns, setVisibleColumns] = useState<string[]>(DEFAULT_VISIBLE);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [colWidths, setColWidths] = useState<Record<string, number>>({});
  const resizingRef = useRef<{ key: string; startX: number; startW: number } | null>(null);

  const searchParams = useSearchParams();
  const router = useRouter();

  useEffect(() => { setVisibleColumns(loadColumns()); setPageSize(loadPageSize()); }, []);

  // Fetch filter dropdown options client-side (non-blocking)
  useEffect(() => {
    if (counties.length > 0 && crmTools.length > 0) return; // already have data (from server props)
    fetch("/api/installers/filter-options")
      .then((r) => r.json())
      .then((d: { counties: string[]; crmTools: string[] }) => {
        setCounties(d.counties);
        setCrmTools(d.crmTools);
      })
      .catch(() => {}); // filters just stay empty if this fails
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Read distanceFrom URL param (from command-K navigation) — reactive to client-side nav
  useEffect(() => {
    const postcode = searchParams.get("distanceFrom");
    const lat = searchParams.get("lat");
    const lng = searchParams.get("lng");
    if (postcode && lat && lng) {
      const origin: DistanceOrigin = { postcode, lat: Number(lat), lng: Number(lng) };
      setDistanceOrigin(origin);
      // Auto-show distance column
      setVisibleColumns((prev) => {
        if (prev.includes("distance")) return prev;
        const cols = [...prev];
        const postcodeIdx = cols.indexOf("postcode");
        cols.splice(postcodeIdx >= 0 ? postcodeIdx + 1 : 2, 0, "distance");
        saveColumns(cols);
        return cols;
      });
      // Clean up URL without reload
      router.replace("/installers", { scroll: false });
    }
  }, [searchParams, router]);

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
      for (const [k, v] of Object.entries(filters)) {
        if (!v) continue;
        if (k === "crmTool") {
          if (v === "has_crm") params.set("hasCrmTool", "true");
          else if (v === "no_crm") params.set("hasCrmTool", "false");
          else params.set("crmToolName", v);
        } else {
          params.set(k === "stage" ? "stage" : k, v);
        }
      }
      params.set("page", String(page));
      params.set("pageSize", String(pageSize));
      if (distanceOrigin) {
        params.set("originLat", String(distanceOrigin.lat));
        params.set("originLng", String(distanceOrigin.lng));
        params.set("sortBy", "distance");
        params.set("sortOrder", "asc");
      } else {
        params.set("sortBy", sortBy);
        params.set("sortOrder", sortOrder);
      }
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
  }, [search, filters, page, pageSize, sortBy, sortOrder, distanceOrigin]);

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
      <div className="flex items-center gap-2 border-b border-[#e5e5e5] bg-white px-4 py-2 shrink-0">
        <h1 className="text-[14px] font-semibold text-[#1D1D1D] hidden sm:block">Installers</h1>
        {!loading && (
          <span className="text-[12px] font-medium text-[#9a9a9a] bg-[#f0f0f0] rounded-md px-1.5 py-0.5 tabular-nums hidden sm:inline">
            {total.toLocaleString()}
          </span>
        )}
        <div className="h-4 w-px bg-[#e5e5e5] mx-1 hidden sm:block" />

        {/* Shortlist quick toggle */}
        <button
          onClick={() => {
            const next = filters.isShortlisted === "true" ? "" : "true";
            setFilters({ ...filters, isShortlisted: next });
            setPage(1);
          }}
          className={`h-8 flex items-center gap-1.5 rounded-lg border px-3 text-[13px] font-medium transition-colors shrink-0 ${
            filters.isShortlisted === "true"
              ? "border-[#4ABDE8] bg-[#4ABDE8]/10 text-[#4ABDE8]"
              : "border-[#e5e5e5] bg-white text-[#6a6a6a] hover:bg-[#FAFAF9]"
          }`}
        >
          <Star className={`h-3.5 w-3.5 ${filters.isShortlisted === "true" ? "fill-[#4ABDE8]" : ""}`} />
          <span className="hidden sm:inline">Shortlist</span>
        </button>

        <button onClick={() => setShowFilters(!showFilters)} className={`h-8 flex items-center gap-1.5 rounded-lg border px-3 text-[13px] font-medium transition-colors shrink-0 ${showFilters || activeFilterCount > 0 ? "border-[#4ABDE8] bg-[#e8f4f9] text-[#4ABDE8]" : "border-[#e5e5e5] bg-white text-[#6a6a6a] hover:bg-[#FAFAF9]"}`}>
          <Filter className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Filter</span>
          {activeFilterCount > 0 && <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[#4ABDE8] text-[10px] font-semibold text-white px-1">{activeFilterCount}</span>}
        </button>

        <div className="ml-auto flex items-center gap-2">
          <ColumnSettings visible={visibleColumns} onUpdate={updateColumns} />
          <AddInstallerDialog />
        </div>
      </div>

      {/* Main content area with optional sidebar */}
      <div className="flex flex-1 overflow-hidden">
        {/* Filter sidebar */}
        {showFilters && (
          <FilterSidebar
            filters={filters}
            onChange={(f) => { setFilters(f); setPage(1); }}
            onClear={() => { setFilters(EMPTY_FILTERS); setPage(1); }}
            counties={counties}
            crmTools={crmTools}
            onClose={() => setShowFilters(false)}
            distanceOrigin={distanceOrigin}
            onDistanceOriginChange={(o) => {
              setDistanceOrigin(o);
              setPage(1);
              if (o && !visibleColumns.includes("distance")) {
                const cols = [...visibleColumns];
                const postcodeIdx = cols.indexOf("postcode");
                cols.splice(postcodeIdx >= 0 ? postcodeIdx + 1 : 2, 0, "distance");
                updateColumns(cols);
              } else if (!o && visibleColumns.includes("distance")) {
                updateColumns(visibleColumns.filter((c) => c !== "distance"));
              }
            }}
          />
        )}

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
              <tr className="bg-[#FAFAFA] border-b border-[#e8e8e8]">
                <th className="w-[36px] px-3 py-2.5">
                  <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} className="h-3.5 w-3.5 rounded accent-[#4ABDE8]" />
                </th>
                {columns.map((col) => (
                  <th key={col.key} className="text-left font-medium text-[#6a6a6a] text-[12px] px-4 py-2.5 whitespace-nowrap relative group/th">
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
                    <td className="px-3 py-4"><Skeleton className="h-3.5 w-3.5 rounded" /></td>
                    {columns.map((col) => (
                      <td key={col.key} className="px-4 py-4 overflow-hidden"><Skeleton className="h-4 w-full rounded" /></td>
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
                data.filter((row, idx, arr) => arr.findIndex((r) => r.id === row.id) === idx).map((row) => (
                  <tr key={row.id} className={`border-b border-[#f0f0f0] transition-colors ${selected.has(row.id) ? "bg-[#e8f4f9]/30" : "hover:bg-[#FAFAF9]/70"}`}>
                    <td className="px-3 py-3">
                      <input type="checkbox" checked={selected.has(row.id)} onChange={() => toggleSelect(row.id)} className="h-3.5 w-3.5 rounded accent-[#4ABDE8]" />
                    </td>
                    {columns.map((col) => (
                      <td key={col.key} className="px-4 py-3 overflow-hidden">
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
      </div>{/* close flex wrapper for sidebar + content */}

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
