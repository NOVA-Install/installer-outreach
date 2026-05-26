"use client";

import { useState, useCallback, type ReactNode } from "react";
import { ChevronDown, X, MapPin, Loader2 } from "lucide-react";
import { PIPELINE_STAGES, UK_ZONES } from "@/lib/constants";

// --- Types ---

export interface Filters {
  zones: string;
  counties: string;
  stage: string;
  tier: string;
  hasWebsite: string;
  hasEmail: string;
  hasGoogleReviews: string;
  hasTrustpilot: string;
  googleRatingMin: string;
  trustpilotRatingMin: string;
  reviewCountMin: string;
  inMcs: string;
  inNova: string;
  inTrustMark: string;
  scoreMin: string;
  scoreMax: string;
  isShortlisted: string;
  crmTool: string;
  formType: string;
}

export const EMPTY_FILTERS: Filters = {
  zones: "", counties: "", stage: "", tier: "", hasWebsite: "", hasEmail: "",
  hasGoogleReviews: "", hasTrustpilot: "", googleRatingMin: "", trustpilotRatingMin: "", reviewCountMin: "",
  inMcs: "", inNova: "", inTrustMark: "", scoreMin: "", scoreMax: "", isShortlisted: "",
  crmTool: "", formType: "",
};

export function countActiveFilters(f: Filters): number {
  return Object.values(f).filter((v) => v !== "").length;
}

const FILTER_STORAGE_KEY = "installer-filters";

export function loadFilters(): Filters {
  if (typeof window === "undefined") return EMPTY_FILTERS;
  try {
    const s = localStorage.getItem(FILTER_STORAGE_KEY);
    if (s) {
      const p = JSON.parse(s);
      // Merge with EMPTY_FILTERS to handle any new keys added over time
      return { ...EMPTY_FILTERS, ...p };
    }
  } catch {}
  return EMPTY_FILTERS;
}

export function saveFilters(f: Filters) {
  try {
    // Don't persist if all empty
    const hasAny = Object.values(f).some((v) => v !== "");
    if (hasAny) {
      localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(f));
    } else {
      localStorage.removeItem(FILTER_STORAGE_KEY);
    }
  } catch {}
}

// --- Distance from postcode ---

export interface DistanceOrigin {
  postcode: string;
  lat: number;
  lng: number;
  maxKm?: number | null;
}

// --- Sub-components ---

function FilterAccordion({ label, icon, isActive, children }: { label: string; icon?: ReactNode; isActive?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-[#f0f0f0]">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2.5 px-4 py-3 text-left hover:bg-[#FAFAF9] transition-colors"
      >
        {icon && <span className="text-[#6a6a6a] shrink-0">{icon}</span>}
        <span className="text-[13.5px] font-semibold text-[#1D1D1D] flex-1">{label}</span>
        {isActive && <div className="h-[7px] w-[7px] rounded-full bg-[#4ABDE8] shrink-0" />}
        <ChevronDown className={`h-4 w-4 text-[#9a9a9a] transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className="px-4 pb-3 space-y-2">{children}</div>}
    </div>
  );
}

function FilterSidebarSelect({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full h-8 rounded-lg border border-[#e5e5e5] bg-white px-2.5 text-[13px] text-[#1D1D1D] outline-none focus:border-[#4ABDE8] transition-colors">
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

function FilterMultiSelect({ values, onChange, options, placeholder }: {
  values: string[];
  onChange: (v: string[]) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
}) {
  const [search, setSearch] = useState("");
  const filtered = options.filter(o => o.label.toLowerCase().includes(search.toLowerCase()));
  const toggle = (v: string) => onChange(values.includes(v) ? values.filter(x => x !== v) : [...values, v]);

  return (
    <div className="space-y-1.5">
      {options.length > 8 && (
        <input
          type="text"
          placeholder={placeholder || "Search..."}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full h-7 rounded-md border border-[#e5e5e5] bg-white px-2 text-[12px] outline-none focus:border-[#4ABDE8]"
        />
      )}
      <div className="max-h-[200px] overflow-y-auto space-y-0.5">
        {filtered.map((o) => (
          <label key={o.value} className="flex items-center gap-2 px-1 py-0.5 rounded-md cursor-pointer hover:bg-[#FAFAF9] transition-colors">
            <input
              type="checkbox"
              checked={values.includes(o.value)}
              onChange={() => toggle(o.value)}
              className="h-3.5 w-3.5 rounded accent-[#4ABDE8]"
            />
            <span className="text-[12.5px] text-[#3a3a3a]">{o.label}</span>
          </label>
        ))}
        {filtered.length === 0 && <span className="text-[12px] text-[#9a9a9a] px-1">No matches</span>}
      </div>
      {values.length > 0 && (
        <button onClick={() => onChange([])} className="text-[11px] text-[#4ABDE8] hover:underline px-1">
          Clear ({values.length})
        </button>
      )}
    </div>
  );
}

// --- Main FilterSidebar ---

export function FilterSidebar({ filters, onChange, onClear, counties, crmTools, onClose, distanceOrigin, onDistanceOriginChange }: {
  filters: Filters;
  onChange: (f: Filters) => void;
  onClear: () => void;
  counties: string[];
  crmTools: string[];
  onClose: () => void;
  distanceOrigin?: DistanceOrigin | null;
  onDistanceOriginChange?: (origin: DistanceOrigin | null) => void;
}) {
  const set = (key: keyof Filters, value: string) => onChange({ ...filters, [key]: value });
  const setMulti = (key: keyof Filters, values: string[]) => onChange({ ...filters, [key]: values.join(",") });
  const parseMulti = (s: string): string[] => s ? s.split(",") : [];
  const yesNoOpts = [{ value: "", label: "Any" }, { value: "true", label: "Yes" }, { value: "false", label: "No" }];
  const active = countActiveFilters(filters);

  const [postcodeInput, setPostcodeInput] = useState(distanceOrigin?.postcode || "");
  const [postcodeLoading, setPostcodeLoading] = useState(false);
  const [postcodeError, setPostcodeError] = useState("");
  const DISTANCE_PRESETS = [null, 10, 25, 50, 100] as const;
  const isCustomDistance = distanceOrigin?.maxKm != null && !DISTANCE_PRESETS.includes(distanceOrigin.maxKm as any);
  const [customKmInput, setCustomKmInput] = useState(isCustomDistance ? String(distanceOrigin!.maxKm) : "");

  const lookupPostcode = useCallback(async () => {
    const pc = postcodeInput.trim();
    if (!pc) {
      onDistanceOriginChange?.(null);
      setPostcodeError("");
      return;
    }
    setPostcodeLoading(true);
    setPostcodeError("");
    try {
      const res = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(pc)}`);
      const json = await res.json();
      if (json.status === 200 && json.result) {
        onDistanceOriginChange?.({ postcode: json.result.postcode, lat: json.result.latitude, lng: json.result.longitude });
      } else {
        setPostcodeError("Postcode not found");
        onDistanceOriginChange?.(null);
      }
    } catch {
      setPostcodeError("Lookup failed");
      onDistanceOriginChange?.(null);
    } finally {
      setPostcodeLoading(false);
    }
  }, [postcodeInput, onDistanceOriginChange]);

  return (
    <div className="w-[280px] shrink-0 border-r border-[#e5e5e5] bg-white flex flex-col h-full overflow-hidden">
      {/* Sidebar header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#e5e5e5]">
        <span className="text-[14px] font-semibold text-[#1D1D1D]">Filters</span>
        <div className="flex items-center gap-2">
          {active > 0 && (
            <button onClick={onClear} className="text-[12px] text-[#4ABDE8] hover:underline">Clear all</button>
          )}
          <button onClick={onClose} className="h-6 w-6 flex items-center justify-center rounded-md text-[#9a9a9a] hover:bg-[#f0f0f0] transition-colors">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Scrollable filter list */}
      <div className="flex-1 overflow-y-auto">
        {/* PIPELINE section */}
        <div className="px-4 pt-4 pb-1">
          <span className="text-[11px] font-bold text-[#4ABDE8] uppercase tracking-wider">Pipeline</span>
        </div>

        <FilterAccordion label="Stage" isActive={!!filters.stage}>
          <div className="space-y-1">
            {[{ key: "", label: "All Stages" }, ...PIPELINE_STAGES.map((s) => ({ key: s.key, label: s.label, color: s.color }))].map((s) => (
              <label key={s.key} className="flex items-center gap-2 px-1 py-1 rounded-md cursor-pointer hover:bg-[#FAFAF9] transition-colors">
                <input
                  type="radio"
                  name="stage-filter"
                  checked={filters.stage === s.key}
                  onChange={() => set("stage", s.key)}
                  className="h-3.5 w-3.5 accent-[#4ABDE8]"
                />
                {"color" in s && s.color && <div className="h-[7px] w-[7px] rounded-full shrink-0" style={{ backgroundColor: s.color }} />}
                <span className="text-[13px] text-[#3a3a3a]">{s.label}</span>
              </label>
            ))}
          </div>
        </FilterAccordion>

        <FilterAccordion label="Tier" isActive={!!filters.tier}>
          <FilterSidebarSelect value={filters.tier} onChange={(v) => set("tier", v)} options={[{ value: "", label: "All Tiers" }, { value: "high", label: "High" }, { value: "medium", label: "Medium" }, { value: "low", label: "Low" }]} />
        </FilterAccordion>

        <FilterAccordion label="Shortlisted" isActive={!!filters.isShortlisted}>
          <FilterSidebarSelect value={filters.isShortlisted} onChange={(v) => set("isShortlisted", v)} options={[{ value: "", label: "Any" }, { value: "true", label: "Shortlisted only" }]} />
        </FilterAccordion>

        {/* LOCATION section */}
        <div className="px-4 pt-4 pb-1">
          <span className="text-[11px] font-bold text-[#4ABDE8] uppercase tracking-wider">Location</span>
        </div>

        <FilterAccordion label="Distance From" icon={<MapPin className="h-3.5 w-3.5" />} isActive={!!distanceOrigin}>
          <div className="space-y-2">
            <div className="flex gap-1.5">
              <input
                type="text"
                placeholder="Enter postcode"
                value={postcodeInput}
                onChange={(e) => setPostcodeInput(e.target.value.toUpperCase())}
                onKeyDown={(e) => { if (e.key === "Enter") lookupPostcode(); }}
                className="flex-1 h-8 rounded-lg border border-[#e5e5e5] bg-white px-2.5 text-[13px] text-[#1D1D1D] outline-none focus:border-[#4ABDE8] transition-colors uppercase"
              />
              <button
                onClick={lookupPostcode}
                disabled={postcodeLoading}
                className="h-8 px-2.5 rounded-lg border border-[#e5e5e5] bg-white text-[13px] text-[#6a6a6a] hover:bg-[#FAFAF9] transition-colors disabled:opacity-50 shrink-0"
              >
                {postcodeLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Go"}
              </button>
            </div>
            {postcodeError && <p className="text-[11px] text-red-500">{postcodeError}</p>}
            {distanceOrigin && (
              <>
                <div>
                  <p className="text-[11px] text-[#9a9a9a] uppercase tracking-wider mb-1.5">Max distance</p>
                  <div className="flex flex-wrap gap-1">
                    {DISTANCE_PRESETS.map((km) => (
                      <button
                        key={km ?? "any"}
                        onClick={() => { onDistanceOriginChange?.({ ...distanceOrigin, maxKm: km }); setCustomKmInput(""); }}
                        className={`h-7 px-2.5 rounded-md text-[12px] font-medium transition-colors ${
                          (distanceOrigin.maxKm ?? null) === km && !isCustomDistance
                            ? "bg-[#4ABDE8] text-white"
                            : "bg-[#f0f0f0] text-[#6a6a6a] hover:bg-[#e5e5e5]"
                        }`}
                      >
                        {km == null ? "Any" : `${km} km`}
                      </button>
                    ))}
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min="1"
                        placeholder="Custom"
                        value={customKmInput}
                        onChange={(e) => setCustomKmInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            const val = Number(customKmInput);
                            if (val > 0) onDistanceOriginChange?.({ ...distanceOrigin, maxKm: val });
                          }
                        }}
                        onBlur={() => {
                          const val = Number(customKmInput);
                          if (val > 0) onDistanceOriginChange?.({ ...distanceOrigin, maxKm: val });
                        }}
                        className={`h-7 w-[72px] rounded-md border text-[12px] text-center tabular-nums outline-none transition-colors ${
                          isCustomDistance
                            ? "border-[#4ABDE8] bg-[#4ABDE8]/10 text-[#4ABDE8] font-medium"
                            : "border-[#e5e5e5] bg-white text-[#6a6a6a] focus:border-[#4ABDE8]"
                        }`}
                      />
                      <span className="text-[11px] text-[#9a9a9a]">km</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-[#3a3a3a]">
                    {distanceOrigin.maxKm
                      ? <>Within <strong>{distanceOrigin.maxKm} km</strong> of <strong>{distanceOrigin.postcode}</strong></>
                      : <>Sorting by distance from <strong>{distanceOrigin.postcode}</strong></>
                    }
                  </span>
                  <button
                    onClick={() => { onDistanceOriginChange?.(null); setPostcodeInput(""); }}
                    className="text-[11px] text-[#4ABDE8] hover:underline"
                  >
                    Clear
                  </button>
                </div>
              </>
            )}
          </div>
        </FilterAccordion>

        <FilterAccordion label="Zone" isActive={!!filters.zones}>
          <FilterMultiSelect
            values={parseMulti(filters.zones)}
            onChange={(v) => setMulti("zones", v)}
            options={UK_ZONES.map((z) => ({ value: z.id, label: z.name }))}
          />
        </FilterAccordion>

        <FilterAccordion label="County" isActive={!!filters.counties}>
          <FilterMultiSelect
            values={parseMulti(filters.counties)}
            onChange={(v) => setMulti("counties", v)}
            options={counties.map((c) => ({ value: c, label: c }))}
            placeholder="Search counties..."
          />
        </FilterAccordion>

        {/* DATA section */}
        <div className="px-4 pt-4 pb-1">
          <span className="text-[11px] font-bold text-[#4ABDE8] uppercase tracking-wider">Data Quality</span>
        </div>

        <FilterAccordion label="Has Website" isActive={!!filters.hasWebsite}>
          <FilterSidebarSelect value={filters.hasWebsite} onChange={(v) => set("hasWebsite", v)} options={yesNoOpts} />
        </FilterAccordion>

        <FilterAccordion label="Has Email" isActive={!!filters.hasEmail}>
          <FilterSidebarSelect value={filters.hasEmail} onChange={(v) => set("hasEmail", v)} options={yesNoOpts} />
        </FilterAccordion>

        <FilterAccordion label="CRM Tool" isActive={!!filters.crmTool}>
          <FilterSidebarSelect value={filters.crmTool} onChange={(v) => set("crmTool", v)} options={[{ value: "", label: "Any" }, { value: "has_crm", label: "Has CRM (any)" }, { value: "no_crm", label: "No CRM" }, ...crmTools.map((t) => ({ value: t, label: t }))]} />
        </FilterAccordion>

        <FilterAccordion label="Form Type" isActive={!!filters.formType}>
          <FilterSidebarSelect value={filters.formType} onChange={(v) => set("formType", v)} options={[{ value: "", label: "Any" }, { value: "multi_step", label: "Multi-step" }, { value: "quote_form", label: "Quote form" }, { value: "basic_contact", label: "Basic contact" }, { value: "none", label: "No form" }]} />
        </FilterAccordion>

        {/* REVIEWS section */}
        <div className="px-4 pt-4 pb-1">
          <span className="text-[11px] font-bold text-[#4ABDE8] uppercase tracking-wider">Reviews</span>
        </div>

        <FilterAccordion label="Has Google Reviews" isActive={!!filters.hasGoogleReviews}>
          <FilterSidebarSelect value={filters.hasGoogleReviews} onChange={(v) => set("hasGoogleReviews", v)} options={yesNoOpts} />
        </FilterAccordion>

        <FilterAccordion label="Has Trustpilot" isActive={!!filters.hasTrustpilot}>
          <FilterSidebarSelect value={filters.hasTrustpilot} onChange={(v) => set("hasTrustpilot", v)} options={yesNoOpts} />
        </FilterAccordion>

        <FilterAccordion label="Min Google Rating" isActive={!!filters.googleRatingMin}>
          <input type="number" step="0.1" min="0" max="5" placeholder="e.g. 4.0" value={filters.googleRatingMin} onChange={(e) => set("googleRatingMin", e.target.value)} className="w-full h-8 rounded-lg border border-[#e5e5e5] bg-white px-2.5 text-[13px] outline-none focus:border-[#4ABDE8] tabular-nums" />
        </FilterAccordion>

        <FilterAccordion label="Min Trustpilot Rating" isActive={!!filters.trustpilotRatingMin}>
          <input type="number" step="0.1" min="0" max="5" placeholder="e.g. 4.0" value={filters.trustpilotRatingMin} onChange={(e) => set("trustpilotRatingMin", e.target.value)} className="w-full h-8 rounded-lg border border-[#e5e5e5] bg-white px-2.5 text-[13px] outline-none focus:border-[#4ABDE8] tabular-nums" />
        </FilterAccordion>

        <FilterAccordion label="Min Total Reviews" isActive={!!filters.reviewCountMin}>
          <input type="number" min="0" step="1" placeholder="e.g. 10" value={filters.reviewCountMin} onChange={(e) => set("reviewCountMin", e.target.value)} className="w-full h-8 rounded-lg border border-[#e5e5e5] bg-white px-2.5 text-[13px] outline-none focus:border-[#4ABDE8] tabular-nums" />
        </FilterAccordion>

        {/* SOURCES section */}
        <div className="px-4 pt-4 pb-1">
          <span className="text-[11px] font-bold text-[#4ABDE8] uppercase tracking-wider">Sources</span>
        </div>

        <FilterAccordion label="Registrations" isActive={!!(filters.inMcs || filters.inNova || filters.inTrustMark)}>
          <div className="space-y-1.5">
            {([["inMcs", "MCS Certified"], ["inNova", "Nova Energy"], ["inTrustMark", "TrustMark"]] as const).map(([k, label]) => (
              <label key={k} className="flex items-center gap-2.5 px-1 py-1 rounded-md cursor-pointer hover:bg-[#FAFAF9] transition-colors">
                <input
                  type="checkbox"
                  checked={filters[k] === "true"}
                  onChange={(e) => set(k, e.target.checked ? "true" : "")}
                  className="h-4 w-4 rounded accent-[#4ABDE8]"
                />
                <span className="text-[13px] text-[#3a3a3a]">{label}</span>
              </label>
            ))}
          </div>
        </FilterAccordion>

        {/* SCORING section */}
        <div className="px-4 pt-4 pb-1">
          <span className="text-[11px] font-bold text-[#4ABDE8] uppercase tracking-wider">Scoring</span>
        </div>

        <FilterAccordion label="Score Range" isActive={!!(filters.scoreMin || filters.scoreMax)}>
          <div className="flex items-center gap-2">
            <input type="number" placeholder="Min" value={filters.scoreMin} onChange={(e) => set("scoreMin", e.target.value)} className="w-full h-8 rounded-lg border border-[#e5e5e5] bg-white px-2.5 text-[13px] outline-none focus:border-[#4ABDE8] tabular-nums" />
            <span className="text-[#9a9a9a] text-[12px]">&ndash;</span>
            <input type="number" placeholder="Max" value={filters.scoreMax} onChange={(e) => set("scoreMax", e.target.value)} className="w-full h-8 rounded-lg border border-[#e5e5e5] bg-white px-2.5 text-[13px] outline-none focus:border-[#4ABDE8] tabular-nums" />
          </div>
        </FilterAccordion>
      </div>
    </div>
  );
}
