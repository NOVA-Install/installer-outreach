"use client";

import { useState, useEffect, useCallback } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Building2,
  Globe,
  Loader2,
  CheckCircle2,
  XCircle,
  Search,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Eye,
} from "lucide-react";
import { toast } from "sonner";

interface ChResult {
  companyName: string;
  companyNumber: string;
  status: string;
  address: string;
  postcodeMatch: boolean;
}

interface WebsiteSuggestion {
  domain: string;
  title: string;
  url: string;
}

interface Installer {
  id: number;
  companyName: string;
  postcode: string | null;
  website?: string | null;
  websiteStatus?: string | null;
  legalEntityName?: string | null;
  legalEntityNumber?: string | null;
  alternativeNames?: string | null;
}

export function CleanupPanel() {
  return (
    <Tabs defaultValue="companies-house">
      <TabsList>
        <TabsTrigger value="companies-house">
          <Building2 className="h-3.5 w-3.5 mr-1.5" />
          Legal Entity
        </TabsTrigger>
        <TabsTrigger value="websites">
          <Globe className="h-3.5 w-3.5 mr-1.5" />
          Missing Websites
        </TabsTrigger>
      </TabsList>

      <TabsContent value="companies-house" className="mt-4">
        <CompaniesHouseTab />
      </TabsContent>

      <TabsContent value="websites" className="mt-4">
        <WebsiteLookupTab />
      </TabsContent>
    </Tabs>
  );
}

// ─── Companies House Tab ──────────────────────────────────

function CompaniesHouseTab() {
  const [installers, setInstallers] = useState<Installer[]>([]);
  const [stats, setStats] = useState({ unmatchedCount: 0, matchedCount: 0 });
  const [loading, setLoading] = useState(true);
  const [lookingUp, setLookingUp] = useState<number | null>(null);
  const [results, setResults] = useState<Record<number, ChResult[]>>({});
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ done: 0, total: 0, autoMatched: 0 });

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/cleanup/companies-house");
      const data = await res.json();
      setInstallers(data.unmatched || []);
      setStats(data.stats || { unmatchedCount: 0, matchedCount: 0 });
    } catch {
      // silently handle
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const lookupSingle = async (inst: Installer) => {
    setLookingUp(inst.id);
    try {
      const res = await fetch("/api/cleanup/companies-house", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ installerId: inst.id, action: "lookup" }),
      });
      const data = await res.json();

      if (data.autoMatched) {
        toast.success(`Auto-matched: ${data.match.companyName}`);
        setInstallers((prev) => prev.filter((i) => i.id !== inst.id));
        setStats((prev) => ({ ...prev, unmatchedCount: prev.unmatchedCount - 1, matchedCount: prev.matchedCount + 1 }));
      } else {
        setResults((prev) => ({ ...prev, [inst.id]: data.results }));
      }
    } catch {
      toast.error("Lookup failed");
    } finally {
      setLookingUp(null);
    }
  };

  const acceptMatch = async (instId: number, match: ChResult) => {
    await fetch("/api/cleanup/companies-house", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ installerId: instId, action: "accept", companyNumber: match.companyNumber, legalName: match.companyName }),
    });
    toast.success(`Matched: ${match.companyName}`);
    setInstallers((prev) => prev.filter((i) => i.id !== instId));
    setResults((prev) => { const next = { ...prev }; delete next[instId]; return next; });
    setStats((prev) => ({ ...prev, unmatchedCount: prev.unmatchedCount - 1, matchedCount: prev.matchedCount + 1 }));
  };

  const skipInstaller = async (instId: number) => {
    await fetch("/api/cleanup/companies-house", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ installerId: instId, action: "skip" }),
    });
    setInstallers((prev) => prev.filter((i) => i.id !== instId));
    setStats((prev) => ({ ...prev, unmatchedCount: prev.unmatchedCount - 1 }));
  };

  const runBulk = async () => {
    setBulkRunning(true);
    const batch = installers.slice(0, 50);
    setBulkProgress({ done: 0, total: batch.length, autoMatched: 0 });

    for (let i = 0; i < batch.length; i++) {
      try {
        const res = await fetch("/api/cleanup/companies-house", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ installerId: batch[i].id, action: "lookup" }),
        });
        const data = await res.json();

        if (data.autoMatched) {
          setBulkProgress((prev) => ({ ...prev, done: prev.done + 1, autoMatched: prev.autoMatched + 1 }));
          setInstallers((prev) => prev.filter((inst) => inst.id !== batch[i].id));
        } else {
          setResults((prev) => ({ ...prev, [batch[i].id]: data.results }));
          setBulkProgress((prev) => ({ ...prev, done: prev.done + 1 }));
        }
      } catch {
        setBulkProgress((prev) => ({ ...prev, done: prev.done + 1 }));
      }
      // Rate limit: 1.5 req/sec for Companies House
      await new Promise((r) => setTimeout(r, 700));
    }

    setBulkRunning(false);
    toast.success(`Bulk lookup complete. ${bulkProgress.autoMatched} auto-matched.`);
    fetchData();
  };

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex items-center justify-between">
            <div className="text-[13px]">
              <span className="font-medium">{stats.matchedCount}</span> matched &middot;{" "}
              <span className="font-medium text-amber-600">{stats.unmatchedCount}</span> unmatched
            </div>
            <Button size="sm" onClick={runBulk} disabled={bulkRunning || installers.length === 0}>
              {bulkRunning ? (
                <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> {bulkProgress.done}/{bulkProgress.total}</>
              ) : (
                <><Search className="h-3.5 w-3.5 mr-1" /> Bulk Lookup (next 50)</>
              )}
            </Button>
          </div>
          {bulkRunning && (
            <div className="mt-2">
              <div className="h-1 rounded-full bg-muted overflow-hidden">
                <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${(bulkProgress.done / bulkProgress.total) * 100}%` }} />
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">{bulkProgress.autoMatched} auto-matched by postcode</p>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="space-y-2 max-h-[500px] overflow-y-auto">
        {installers.map((inst) => {
          const chResults = results[inst.id];
          return (
            <Card key={inst.id}>
              <CardContent className="pt-3 pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-[13px] font-medium">{inst.companyName}</span>
                    <span className="text-[12px] text-muted-foreground ml-2">{inst.postcode}</span>
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" onClick={() => skipInstaller(inst.id)} className="h-7 text-[11px] text-muted-foreground">
                      Skip
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => lookupSingle(inst)} disabled={lookingUp !== null} className="h-7 text-[11px]">
                      {lookingUp === inst.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3 mr-1" />}
                      Lookup
                    </Button>
                  </div>
                </div>

                {chResults && (
                  <div className="mt-2 space-y-1 border-t pt-2">
                    {chResults.length === 0 ? (
                      <p className="text-[12px] text-muted-foreground">No Companies House results</p>
                    ) : (
                      chResults.map((r) => (
                        <div key={r.companyNumber} className="flex items-center justify-between text-[12px] py-1">
                          <div className="flex items-center gap-1.5 min-w-0">
                            {r.postcodeMatch && <CheckCircle2 className="h-3 w-3 text-green-600 shrink-0" />}
                            <span className="font-medium truncate">{r.companyName}</span>
                            <span className="text-muted-foreground shrink-0">({r.companyNumber})</span>
                            <Badge variant="outline" className="text-[9px] shrink-0">{r.status}</Badge>
                          </div>
                          <Button variant="ghost" size="sm" onClick={() => acceptMatch(inst.id, r)} className="h-6 text-[10px] shrink-0 ml-2">
                            <CheckCircle2 className="h-3 w-3 mr-0.5" /> Accept
                          </Button>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
        {installers.length === 0 && !loading && (
          <p className="text-[13px] text-muted-foreground text-center py-6">All installers matched or skipped</p>
        )}
      </div>
    </div>
  );
}

// ─── Website Lookup Tab ──────────────────────────────────

function WebsiteLookupTab() {
  const [installers, setInstallers] = useState<Installer[]>([]);
  const [stats, setStats] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [lookingUp, setLookingUp] = useState<number | null>(null);
  const [suggestions, setSuggestions] = useState<Record<number, WebsiteSuggestion[]>>({});

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/cleanup/website-lookup");
      const data = await res.json();
      setInstallers(data.missing || []);
      setStats(data.stats || {});
    } catch {
      // silently handle
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const lookupSingle = async (inst: Installer) => {
    setLookingUp(inst.id);
    try {
      const res = await fetch("/api/cleanup/website-lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ installerId: inst.id, action: "lookup" }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setSuggestions((prev) => ({ ...prev, [inst.id]: data.suggestions }));
      if (data.cost) toast.info(`Lookup cost: $${data.cost.toFixed(4)}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Lookup failed");
    } finally {
      setLookingUp(null);
    }
  };

  const setWebsite = async (instId: number, website: string) => {
    await fetch("/api/cleanup/website-lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ installerId: instId, action: "set_website", website }),
    });
    toast.success("Website set");
    setInstallers((prev) => prev.filter((i) => i.id !== instId));
    setSuggestions((prev) => { const next = { ...prev }; delete next[instId]; return next; });
  };

  const markNotFound = async (instId: number) => {
    await fetch("/api/cleanup/website-lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ installerId: instId, action: "not_found" }),
    });
    setInstallers((prev) => prev.filter((i) => i.id !== instId));
  };

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex items-center justify-between text-[13px]">
            <div>
              <span className="font-medium">{stats.withWebsite ?? 0}</span> with website &middot;{" "}
              <span className="font-medium text-amber-600">{installers.length}</span> missing &middot;{" "}
              <span className="text-muted-foreground">{stats.notFound ?? 0} marked not found</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-2 max-h-[500px] overflow-y-auto">
        {installers.map((inst) => {
          const suggs = suggestions[inst.id];
          return (
            <Card key={inst.id}>
              <CardContent className="pt-3 pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-[13px] font-medium">{inst.companyName}</span>
                    <span className="text-[12px] text-muted-foreground ml-2">{inst.postcode}</span>
                    {inst.websiteStatus === "pending_review" && (
                      <Badge variant="outline" className="text-[9px] ml-2 bg-amber-50 text-amber-700 border-amber-200">
                        Pending review
                      </Badge>
                    )}
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" onClick={() => markNotFound(inst.id)} className="h-7 text-[11px] text-muted-foreground">
                      <XCircle className="h-3 w-3 mr-0.5" /> No website
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => lookupSingle(inst)} disabled={lookingUp !== null} className="h-7 text-[11px]">
                      {lookingUp === inst.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3 mr-1" />}
                      Lookup (~$0.002)
                    </Button>
                  </div>
                </div>

                {suggs && (
                  <div className="mt-2 space-y-1 border-t pt-2">
                    {suggs.length === 0 ? (
                      <p className="text-[12px] text-muted-foreground">No website found in search results</p>
                    ) : (
                      suggs.map((s) => (
                        <div key={s.domain} className="flex items-center justify-between text-[12px] py-1">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <Globe className="h-3 w-3 text-muted-foreground shrink-0" />
                            <span className="font-medium truncate">{s.domain}</span>
                            {s.title && (
                              <span className="text-muted-foreground truncate max-w-[200px]">{s.title}</span>
                            )}
                          </div>
                          <div className="flex gap-1 shrink-0 ml-2">
                            <a
                              href={s.url || `https://${s.domain}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center justify-center h-6 w-6 rounded text-muted-foreground hover:bg-muted transition-colors"
                            >
                              <ExternalLink className="h-3 w-3" />
                            </a>
                            <Button variant="ghost" size="sm" onClick={() => setWebsite(inst.id, s.domain)} className="h-6 text-[10px]">
                              <CheckCircle2 className="h-3 w-3 mr-0.5" /> Use
                            </Button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
        {installers.length === 0 && (
          <p className="text-[13px] text-muted-foreground text-center py-6">All websites found or marked</p>
        )}
      </div>
    </div>
  );
}
