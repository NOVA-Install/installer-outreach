"use client";

import { useState, useMemo } from "react";
import { InstallerMap } from "./installer-map";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search } from "lucide-react";

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
}

export function MapPageClient({
  installers,
  counties,
}: {
  installers: MapInstaller[];
  counties: string[];
}) {
  const [county, setCounty] = useState("");
  const [tier, setTier] = useState("");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    return installers.filter((inst) => {
      if (county && inst.county !== county) return false;
      if (tier && inst.tier !== tier) return false;
      if (
        search &&
        !inst.companyName.toLowerCase().includes(search.toLowerCase()) &&
        !(inst.postcode || "").toLowerCase().includes(search.toLowerCase())
      )
        return false;
      return true;
    });
  }, [installers, county, tier, search]);

  const withCoords = filtered.filter(
    (i) => i.latitude != null && i.longitude != null
  );

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[#e5e5e5] bg-white px-4 py-2">
        <div className="relative min-w-[180px]">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#9a9a9a]" />
          <input
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-7 w-full rounded-md border border-[#e5e5e5] bg-white pl-7 pr-2 text-[13px] text-[#1D1D1D] placeholder:text-[#9a9a9a] outline-none focus:border-[#4ABDE8] focus:ring-1 focus:ring-[#4ABDE8]/20 transition-colors"
          />
        </div>
        <Select
          value={county || undefined}
          onValueChange={(v: string | null) =>
            setCounty(!v || v === "all" ? "" : v)
          }
        >
          <SelectTrigger className="h-7 w-auto min-w-[100px] gap-1 border-[#e5e5e5] text-[13px] bg-white">
            <SelectValue placeholder="County" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Counties</SelectItem>
            {counties.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={tier || undefined}
          onValueChange={(v: string | null) =>
            setTier(!v || v === "all" ? "" : v)
          }
        >
          <SelectTrigger className="h-7 w-auto min-w-[80px] gap-1 border-[#e5e5e5] text-[13px] bg-white">
            <SelectValue placeholder="Tier" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Tiers</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="low">Low</SelectItem>
          </SelectContent>
        </Select>
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
          <InstallerMap installers={withCoords} />
        )}
      </div>
    </div>
  );
}
