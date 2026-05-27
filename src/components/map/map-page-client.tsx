"use client";

import { useState, useMemo, useEffect } from "react";
import { InstallerMap } from "./installer-map";
import { Search, Filter } from "lucide-react";
import { FilterSidebar, countActiveFilters, EMPTY_FILTERS, loadFilters, saveFilters, type Filters, type DistanceOrigin } from "@/components/filters/filter-sidebar";
import { extractPostcodeArea, getPrefixesForZones } from "@/lib/constants";
import { useSearchParams, useRouter } from "next/navigation";

interface MapInstaller {
  id: number;
  companyName: string;
  county: string | null;
  postcode: string | null;
  latitude: number | null;
  longitude: number | null;
  tier: string | null;
  overallScore: number | null;
  googleRating: number | null;
  googleReviewCount: number | null;
  website: string | null;
  technologiesCertified: string | null;
  // Additional fields for filtering
  email: string | null;
  pipelineStage: string | null;
  inMcs: boolean | null;
  inNova: boolean | null;
  inTrustMark: boolean | null;
  isShortlisted: boolean | null;
  trustpilotRating: number | null;
  trustpilotReviewCount: number | null;
  hasCrmTool: boolean | null;
  crmToolName: string | null;
  formType: string | null;
  agencyName: string | null;
}

function applyFilters(inst: MapInstaller, filters: Filters, search: string): boolean {
  // Search
  if (
    search &&
    !inst.companyName.toLowerCase().includes(search.toLowerCase()) &&
    !(inst.postcode || "").toLowerCase().includes(search.toLowerCase())
  )
    return false;

  // Pipeline
  if (filters.stage && inst.pipelineStage !== filters.stage) return false;
  if (filters.tier && inst.tier !== filters.tier) return false;
  if (filters.isShortlisted === "true" && !inst.isShortlisted) return false;

  // Location (zones OR counties — match either)
  const hasZoneFilter = !!filters.zones;
  const hasCountyFilter = !!filters.counties;
  if (hasZoneFilter || hasCountyFilter) {
    let matches = false;
    if (hasZoneFilter) {
      const prefixes = getPrefixesForZones(filters.zones.split(","));
      const area = inst.postcode ? extractPostcodeArea(inst.postcode) : "";
      if (area && prefixes.includes(area)) matches = true;
    }
    if (hasCountyFilter) {
      const selectedCounties = filters.counties.split(",");
      if (inst.county && selectedCounties.includes(inst.county)) matches = true;
    }
    if (!matches) return false;
  }

  // Data quality
  if (filters.hasWebsite === "true" && !inst.website) return false;
  if (filters.hasWebsite === "false" && inst.website) return false;
  if (filters.hasEmail === "true" && !inst.email) return false;
  if (filters.hasEmail === "false" && inst.email) return false;

  // Reviews
  const hasGoogle = inst.googleReviewCount != null && inst.googleReviewCount > 0;
  if (filters.hasGoogleReviews === "true" && !hasGoogle) return false;
  if (filters.hasGoogleReviews === "false" && hasGoogle) return false;

  const hasTp = inst.trustpilotReviewCount != null && inst.trustpilotReviewCount > 0;
  if (filters.hasTrustpilot === "true" && !hasTp) return false;
  if (filters.hasTrustpilot === "false" && hasTp) return false;

  if (filters.googleRatingMin && (inst.googleRating == null || inst.googleRating < Number(filters.googleRatingMin))) return false;
  if (filters.trustpilotRatingMin && (inst.trustpilotRating == null || inst.trustpilotRating < Number(filters.trustpilotRatingMin))) return false;

  const totalReviews = (inst.googleReviewCount || 0) + (inst.trustpilotReviewCount || 0);
  if (filters.reviewCountMin && totalReviews < Number(filters.reviewCountMin)) return false;

  // CRM
  if (filters.crmTool === "has_crm" && !inst.hasCrmTool) return false;
  if (filters.crmTool === "no_crm" && inst.hasCrmTool) return false;
  if (filters.crmTool && filters.crmTool !== "has_crm" && filters.crmTool !== "no_crm" && inst.crmToolName !== filters.crmTool) return false;

  // Form type
  if (filters.formType && inst.formType !== filters.formType) return false;

  // Agency
  if (filters.agencyName === "has_agency" && !inst.agencyName) return false;
  if (filters.agencyName === "no_agency" && inst.agencyName) return false;
  if (filters.agencyName && filters.agencyName !== "has_agency" && filters.agencyName !== "no_agency" && inst.agencyName !== filters.agencyName) return false;

  // Sources
  if (filters.inMcs === "true" && !inst.inMcs) return false;
  if (filters.inNova === "true" && !inst.inNova) return false;
  if (filters.inTrustMark === "true" && !inst.inTrustMark) return false;

  // Scoring
  if (filters.scoreMin && (inst.overallScore == null || inst.overallScore < Number(filters.scoreMin))) return false;
  if (filters.scoreMax && (inst.overallScore == null || inst.overallScore > Number(filters.scoreMax))) return false;

  return true;
}

export function MapPageClient({
  installers,
  counties,
  crmTools,
  agencies,
}: {
  installers: MapInstaller[];
  counties: string[];
  crmTools: string[];
  agencies: string[];
}) {
  const [filters, setFiltersRaw] = useState<Filters>(EMPTY_FILTERS);
  const setFilters = (f: Filters) => { setFiltersRaw(f); saveFilters(f); };
  const [search, setSearch] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [distanceOrigin, setDistanceOrigin] = useState<DistanceOrigin | null>(null);
  const searchParams = useSearchParams();
  const navRouter = useRouter();

  // Load persisted filters on mount
  useEffect(() => { setFiltersRaw(loadFilters()); }, []);

  // Read focusPostcode URL param (from command-K navigation) — reactive to client-side nav
  useEffect(() => {
    const postcode = searchParams.get("focusPostcode");
    const lat = searchParams.get("lat");
    const lng = searchParams.get("lng");
    if (postcode && lat && lng) {
      setDistanceOrigin({ postcode, lat: Number(lat), lng: Number(lng) });
      navRouter.replace("/map", { scroll: false });
    }
  }, [searchParams, navRouter]);

  const activeCount = countActiveFilters(filters);

  const filtered = useMemo(() => {
    return installers.filter((inst) => applyFilters(inst, filters, search));
  }, [installers, filters, search]);

  const withCoords = filtered.filter(
    (i) => i.latitude != null && i.longitude != null
  );

  return (
    <div className="flex h-[calc(100vh-3.5rem)]">
      {/* Filter sidebar */}
      {showFilters && (
        <FilterSidebar
          filters={filters}
          onChange={setFilters}
          onClear={() => setFilters(EMPTY_FILTERS)}
          counties={counties}
          crmTools={crmTools}
          agencies={agencies}
          onClose={() => setShowFilters(false)}
          distanceOrigin={distanceOrigin}
          onDistanceOriginChange={setDistanceOrigin}
        />
      )}

      <div className="flex flex-1 flex-col min-w-0">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2 border-b border-[#e5e5e5] bg-white px-4 py-2 relative z-[1000]">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`h-7 flex items-center gap-1.5 rounded-md border px-2.5 text-[13px] transition-colors ${
              activeCount > 0
                ? "border-[#4ABDE8] bg-[#4ABDE8]/5 text-[#4ABDE8]"
                : "border-[#e5e5e5] bg-white text-[#6a6a6a] hover:bg-[#FAFAF9]"
            }`}
          >
            <Filter className="h-3.5 w-3.5" />
            <span>Filters</span>
            {activeCount > 0 && (
              <span className="ml-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#4ABDE8] px-1 text-[11px] font-medium text-white">
                {activeCount}
              </span>
            )}
          </button>
          <div className="relative min-w-[180px]">
            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#9a9a9a]" />
            <input
              placeholder="Search..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-7 w-full rounded-md border border-[#e5e5e5] bg-white pl-7 pr-2 text-[13px] text-[#1D1D1D] placeholder:text-[#9a9a9a] outline-none focus:border-[#4ABDE8] focus:ring-1 focus:ring-[#4ABDE8]/20 transition-colors"
            />
          </div>
          <span className="text-[12px] text-[#9a9a9a] ml-auto tabular-nums">
            {withCoords.length.toLocaleString()} of{" "}
            {installers.length.toLocaleString()} shown
          </span>
        </div>

        {/* Map */}
        <div className="flex-1">
          {installers.length === 0 ? (
            <div className="flex h-full items-center justify-center text-[13px] text-[#9a9a9a]">
              No installers imported yet. Import data first.
            </div>
          ) : (
            <InstallerMap installers={withCoords} distanceOrigin={distanceOrigin} />
          )}
        </div>
      </div>
    </div>
  );
}
