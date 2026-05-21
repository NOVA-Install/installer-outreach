"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Merge,
  Search,
  Loader2,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

interface SearchResult {
  id: number;
  companyName: string;
  postcode: string | null;
  county: string | null;
  email: string | null;
  website: string | null;
  inMcs: boolean | null;
  inNova: boolean | null;
  inTrustMark: boolean | null;
}

export function MergeDialog({
  installerId,
  installerName,
  externalOpen,
  onExternalClose,
}: {
  installerId: number;
  installerName: string;
  externalOpen?: boolean;
  onExternalClose?: () => void;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = externalOpen ?? internalOpen;
  const setOpen = (v: boolean) => {
    setInternalOpen(v);
    if (!v && onExternalClose) onExternalClose();
  };
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<SearchResult | null>(null);
  const [merging, setMerging] = useState(false);
  const [step, setStep] = useState<"search" | "confirm">("search");
  const router = useRouter();

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const fetchResults = useCallback(async () => {
    if (!search || search.length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    try {
      const res = await fetch(`/api/installers?search=${encodeURIComponent(search)}&pageSize=10`);
      const json = await res.json();
      // Filter out the current installer
      setResults((json.data || []).filter((r: SearchResult) => r.id !== installerId));
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, [search, installerId]);

  useEffect(() => {
    if (open) fetchResults();
  }, [fetchResults, open]);

  const handleMerge = async () => {
    if (!selected) return;
    setMerging(true);
    try {
      const res = await fetch("/api/installers/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          primaryId: installerId,
          secondaryId: selected.id,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Merge failed");
      toast.success(data.message);
      setOpen(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Merge failed");
    } finally {
      setMerging(false);
    }
  };

  const reset = () => {
    setSearchInput("");
    setSearch("");
    setResults([]);
    setSelected(null);
    setStep("search");
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-[15px]">Merge Installers</DialogTitle>
        </DialogHeader>

        {step === "search" && (
          <div className="space-y-4">
            <div className="rounded-lg border border-[#e5e5e5] bg-[#FAFAF9] px-3 py-2.5">
              <p className="text-[11px] font-medium text-[#9a9a9a] uppercase tracking-wider mb-0.5">Primary (keep)</p>
              <p className="text-[14px] font-semibold text-[#1D1D1D]">{installerName}</p>
            </div>

            <div>
              <p className="text-[12px] text-[#6a6a6a] mb-1.5">Search for installer to merge into this one:</p>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#9a9a9a]" />
                <Input
                  placeholder="Search by name, postcode, email..."
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  className="pl-8 text-[13px]"
                  autoFocus
                />
              </div>
            </div>

            {/* Results */}
            <div className="max-h-[280px] overflow-y-auto space-y-1">
              {searching && (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="h-4 w-4 animate-spin text-[#9a9a9a]" />
                </div>
              )}
              {!searching && search.length >= 2 && results.length === 0 && (
                <p className="text-[13px] text-[#9a9a9a] text-center py-6">No results found</p>
              )}
              {!searching && results.map((r) => (
                <button
                  key={r.id}
                  onClick={() => { setSelected(r); setStep("confirm"); }}
                  className="w-full text-left rounded-lg border border-[#e5e5e5] px-3 py-2.5 hover:border-[#4ABDE8] hover:bg-[#FFF8F5] transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] font-medium text-[#1D1D1D]">{r.companyName}</span>
                    <span className="text-[11px] text-[#9a9a9a]">ID: {r.id}</span>
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                    {r.postcode && <span className="text-[12px] text-[#6a6a6a] font-mono">{r.postcode}</span>}
                    {r.county && <span className="text-[12px] text-[#6a6a6a]">{r.county}</span>}
                    {r.email && <span className="text-[12px] text-[#9a9a9a] truncate max-w-[180px]">{r.email}</span>}
                  </div>
                  <div className="flex gap-1 mt-1">
                    {r.inMcs && <Badge variant="outline" className="text-[9px] px-1 py-0 bg-blue-50 text-blue-600 border-blue-200">MCS</Badge>}
                    {r.inNova && <Badge variant="outline" className="text-[9px] px-1 py-0 bg-violet-50 text-violet-600 border-violet-200">Nova</Badge>}
                    {r.inTrustMark && <Badge variant="outline" className="text-[9px] px-1 py-0 bg-green-50 text-green-600 border-green-200">TrustMark</Badge>}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {step === "confirm" && selected && (
          <div className="space-y-4">
            {/* Visual merge preview */}
            <div className="flex items-center gap-3">
              <div className="flex-1 rounded-lg border border-[#e5e5e5] bg-[#FAFAF9] px-3 py-2.5">
                <p className="text-[11px] font-medium text-[#9a9a9a] uppercase tracking-wider mb-0.5">Keep</p>
                <p className="text-[13px] font-semibold text-[#1D1D1D]">{installerName}</p>
                <p className="text-[11px] text-[#9a9a9a]">ID: {installerId}</p>
              </div>
              <ArrowRight className="h-4 w-4 text-[#9a9a9a] shrink-0" />
              <div className="flex-1 rounded-lg border border-red-200 bg-red-50/50 px-3 py-2.5">
                <p className="text-[11px] font-medium text-red-400 uppercase tracking-wider mb-0.5">Delete</p>
                <p className="text-[13px] font-semibold text-[#1D1D1D]">{selected.companyName}</p>
                <p className="text-[11px] text-[#9a9a9a]">ID: {selected.id}</p>
              </div>
            </div>

            {/* Warning */}
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/50 px-3 py-2.5">
              <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
              <div className="text-[12px] text-[#3a3a3a]">
                <p className="font-medium mb-0.5">This will:</p>
                <ul className="space-y-0.5 text-[#6a6a6a]">
                  <li>Fill any missing fields on "{installerName}" from "{selected.companyName}"</li>
                  <li>Merge contact sources, review data, activities, and tags</li>
                  <li>Add "{selected.companyName}" as an alternative name</li>
                  <li>Permanently delete the "{selected.companyName}" record</li>
                </ul>
              </div>
            </div>

            <div className="flex justify-between">
              <Button variant="outline" size="sm" onClick={() => setStep("search")}>
                Back
              </Button>
              <Button
                size="sm"
                onClick={handleMerge}
                disabled={merging}
                className="bg-[#1D1D1D] hover:bg-[#2a2a2a] gap-1.5"
              >
                {merging ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Merge className="h-3.5 w-3.5" />
                )}
                Merge Records
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
