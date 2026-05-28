"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  Hash,
  MapPin,
  Briefcase,
  Sparkles,
  Calculator,
  Search,
  Zap,
  Globe,
  ArrowRight,
} from "lucide-react";
import {
  CommandDialog,
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
} from "@/components/ui/command";

// ── Types ──────────────────────────────────────────────────────────────────────

interface SearchResult {
  id: number;
  companyName: string;
  legalEntityName: string | null;
  legalEntityNumber: string | null;
  postcode: string | null;
  county: string | null;
  website: string | null;
  pipelineStage: string | null;
  matchType: "company" | "legal_entity" | "postcode" | "company_number" | "alternative_name" | "website";
}

interface QuickAction {
  id: string;
  label: string;
  keywords: string[];
  icon: React.ElementType;
  href?: string;
  action?: () => void;
}

// ── Quick actions ──────────────────────────────────────────────────────────────

function useQuickActions(): QuickAction[] {
  const router = useRouter();

  return React.useMemo<QuickAction[]>(
    () => [
      {
        id: "recalculate-scores",
        label: "Recalculate scores",
        keywords: ["score", "recalculate", "calculate", "scores", "recompute"],
        icon: Calculator,
        action: async () => {
          try {
            await fetch("/api/enrichment/scores", { method: "POST" });
            router.push("/enrichment");
          } catch {
            // handled silently
          }
        },
      },
      {
        id: "view-installers",
        label: "View all installers",
        keywords: ["installers", "list", "table", "companies", "view"],
        icon: Building2,
        href: "/installers",
      },
      {
        id: "view-map",
        label: "Open map view",
        keywords: ["map", "geography", "location", "view"],
        icon: MapPin,
        href: "/map",
      },
      {
        id: "import-data",
        label: "Import data",
        keywords: ["import", "upload", "csv", "data"],
        icon: Zap,
        href: "/import",
      },
      {
        id: "export-csv",
        label: "Export installer CSV",
        keywords: ["export", "csv", "download", "data"],
        icon: Globe,
        action: () => {
          window.location.href = "/api/installers/export";
        },
      },
      {
        id: "data-cleanup",
        label: "Data cleanup",
        keywords: ["cleanup", "clean", "data", "duplicates", "fix"],
        icon: Briefcase,
        href: "/cleanup",
      },
    ],
    [router]
  );
}

// ── Match-type helpers ─────────────────────────────────────────────────────────

const matchTypeConfig: Record<
  SearchResult["matchType"],
  { label: string; icon: React.ElementType }
> = {
  company: { label: "Companies", icon: Building2 },
  legal_entity: { label: "Legal Entities", icon: Briefcase },
  postcode: { label: "Postcodes", icon: MapPin },
  company_number: { label: "Company Numbers", icon: Hash },
  alternative_name: { label: "Alternative Names", icon: Search },
  website: { label: "Websites", icon: Globe },
};

// ── The component ──────────────────────────────────────────────────────────────

export function CommandK() {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<SearchResult[]>([]);
  const [loading, setLoading] = React.useState(false);
  const router = useRouter();
  const quickActions = useQuickActions();
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keyboard shortcut
  React.useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // Debounced search
  React.useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!query || query.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/search?q=${encodeURIComponent(query)}`
        );
        if (res.ok) {
          const data = await res.json();
          setResults(data.results ?? []);
        }
      } catch {
        // network error — keep existing results
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  // Reset on close
  React.useEffect(() => {
    if (!open) {
      setQuery("");
      setResults([]);
    }
  }, [open]);

  // Group results by match type
  const grouped = React.useMemo(() => {
    const map: Record<string, SearchResult[]> = {};
    for (const r of results) {
      const key = r.matchType;
      if (!map[key]) map[key] = [];
      map[key].push(r);
    }
    return map;
  }, [results]);

  function navigateTo(id: number) {
    setOpen(false);
    router.push(`/installers/${id}`);
  }

  function runAction(action: QuickAction) {
    setOpen(false);
    if (action.href) {
      router.push(action.href);
    } else if (action.action) {
      action.action();
    }
  }

  // Filter quick actions by query
  const filteredActions = React.useMemo(() => {
    if (!query) return quickActions;
    const lower = query.toLowerCase();
    return quickActions.filter(
      (a) =>
        a.label.toLowerCase().includes(lower) ||
        a.keywords.some((kw) => kw.includes(lower))
    );
  }, [query, quickActions]);

  // Detect UK postcode pattern
  const isPostcode = React.useMemo(() => /^[A-Z]{1,2}\d[A-Z\d]?\s*\d?[A-Z]{0,2}$/i.test(query.trim()), [query]);
  const [postcodeCoords, setPostcodeCoords] = React.useState<{ postcode: string; lat: number; lng: number } | null>(null);
  const [postcodeLoading, setPostcodeLoading] = React.useState(false);

  // Geocode postcode when detected
  React.useEffect(() => {
    if (!isPostcode || query.trim().length < 3) {
      setPostcodeCoords(null);
      return;
    }
    setPostcodeLoading(true);
    const pc = query.trim();
    fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(pc)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.status === 200 && data.result) {
          setPostcodeCoords({ postcode: data.result.postcode, lat: data.result.latitude, lng: data.result.longitude });
        } else {
          setPostcodeCoords(null);
        }
      })
      .catch(() => setPostcodeCoords(null))
      .finally(() => setPostcodeLoading(false));
  }, [isPostcode, query]);

  const hasResults = results.length > 0;
  const hasActions = filteredActions.length > 0;
  const hasPostcodeAction = isPostcode && postcodeCoords && !postcodeLoading;
  const showEmpty = query.length >= 2 && !loading && !hasResults && !hasActions && !hasPostcodeAction;

  return (
    <>
      {/* Trigger button styled as a search input */}
      <button
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-2 rounded-lg border border-white/[0.12] bg-white/[0.04] px-3 py-2 text-[13px] text-[#6a6a6a] transition-all hover:border-white/[0.2] hover:bg-white/[0.07] hover:text-[#9a9a9a] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/[0.2]"
      >
        <Search className="h-[15px] w-[15px] shrink-0" />
        <span className="flex-1 text-left">Search installers...</span>
        <kbd className="pointer-events-none rounded border border-white/[0.12] bg-white/[0.06] px-1.5 py-0.5 font-mono text-[10px] leading-none text-[#4a4a4a]">
          {"\u2318"}K
        </kbd>
      </button>

      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title="Search"
        description="Search installers, postcodes, company numbers, or run quick actions"
        className="sm:max-w-lg"
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search installers, postcodes, actions..."
            value={query}
            onValueChange={setQuery}
          />
          <CommandList className="max-h-80">
            {showEmpty && (
              <CommandEmpty>No results found.</CommandEmpty>
            )}

            {/* Installer results grouped by match type */}
            {Object.entries(grouped).map(([type, items]) => {
              const config =
                matchTypeConfig[type as SearchResult["matchType"]];
              return (
                <CommandGroup
                  key={type}
                  heading={config.label}
                >
                  {items.map((item) => (
                    <CommandItem
                      key={item.id}
                      value={`installer-${item.id}`}
                      onSelect={() => navigateTo(item.id)}
                      className="flex items-center gap-3 py-2"
                    >
                      <config.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-sm font-medium">
                          {item.companyName}
                        </span>
                        <span className="truncate text-xs text-muted-foreground">
                          {[
                            item.postcode,
                            item.county,
                            item.legalEntityNumber
                              ? `CH: ${item.legalEntityNumber}`
                              : null,
                          ]
                            .filter(Boolean)
                            .join(" \u00B7 ")}
                        </span>
                      </div>
                      {item.pipelineStage && (
                        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground capitalize">
                          {item.pipelineStage.replace(/_/g, " ")}
                        </span>
                      )}
                      <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-data-selected/command-item:opacity-100" />
                    </CommandItem>
                  ))}
                </CommandGroup>
              );
            })}

            {/* Distance from postcode */}
            {hasPostcodeAction && (
              <CommandGroup heading="Distance">
                <CommandItem
                  value={`distance-installers-${postcodeCoords.postcode}`}
                  onSelect={() => {
                    setOpen(false);
                    router.push(`/installers?distanceFrom=${encodeURIComponent(postcodeCoords.postcode)}&lat=${postcodeCoords.lat}&lng=${postcodeCoords.lng}`);
                  }}
                  className="flex items-center gap-3 py-2"
                >
                  <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="text-sm">Sort installers by distance from <strong>{postcodeCoords.postcode}</strong></span>
                  <ArrowRight className="ml-auto h-3 w-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-data-selected/command-item:opacity-100" />
                </CommandItem>
                <CommandItem
                  value={`distance-map-${postcodeCoords.postcode}`}
                  onSelect={() => {
                    setOpen(false);
                    router.push(`/map?focusPostcode=${encodeURIComponent(postcodeCoords.postcode)}&lat=${postcodeCoords.lat}&lng=${postcodeCoords.lng}`);
                  }}
                  className="flex items-center gap-3 py-2"
                >
                  <Globe className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="text-sm">Show <strong>{postcodeCoords.postcode}</strong> on map</span>
                  <ArrowRight className="ml-auto h-3 w-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-data-selected/command-item:opacity-100" />
                </CommandItem>
              </CommandGroup>
            )}

            {/* Separator between results and actions */}
            {(hasResults || hasPostcodeAction) && hasActions && <CommandSeparator />}

            {/* Quick actions */}
            {hasActions && (
              <CommandGroup heading="Quick Actions">
                {filteredActions.map((action) => (
                  <CommandItem
                    key={action.id}
                    value={`action-${action.id}`}
                    onSelect={() => runAction(action)}
                    className="flex items-center gap-3 py-2"
                  >
                    <action.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="text-sm">{action.label}</span>
                    <ArrowRight className="ml-auto h-3 w-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-data-selected/command-item:opacity-100" />
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {/* Loading indicator */}
            {loading && (
              <div className="py-4 text-center text-xs text-muted-foreground">
                Searching...
              </div>
            )}
          </CommandList>

          {/* Footer hint */}
          <div className="border-t border-border px-3 py-2">
            <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-[10px]">{"\u2191"}</kbd>
                <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-[10px]">{"\u2193"}</kbd>
                navigate
              </span>
              <span className="flex items-center gap-1">
                <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-[10px]">{"\u23CE"}</kbd>
                select
              </span>
              <span className="flex items-center gap-1">
                <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-[10px]">esc</kbd>
                close
              </span>
            </div>
          </div>
        </Command>
      </CommandDialog>
    </>
  );
}
