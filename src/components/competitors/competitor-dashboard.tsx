"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Plus,
  Users,
  FileText,
  ExternalLink,
  Trash2,
  Search,
  Building2,
  X,
  ChevronRight,
  ChevronDown,
  Loader2,
  Download,
  Heart,
  MessageSquare,
  Link2,
  RefreshCw,
} from "lucide-react";
import { FaLinkedinIn } from "react-icons/fa6";
import Link from "next/link";

interface Competitor {
  id: number;
  name: string;
  website: string | null;
  linkedinUrl: string | null;
  linkedinSlug: string | null;
  notes: string | null;
  createdAt: string;
  clientCount: number;
  employeeCount: number;
  postCount: number;
  engagementCount: number;
}

interface Client {
  id: number;
  installerId: number;
  source: string;
  confidence: number | null;
  notes: string | null;
  addedAt: string;
  companyName: string;
  website: string | null;
  email: string | null;
  postcode: string | null;
  pipelineStage: string | null;
}

interface Employee {
  id: number;
  competitorId: number;
  fullName: string;
  headline: string | null;
  profileUrl: string | null;
  avatarUrl: string | null;
  role: string | null;
  lastSeenAt: string | null;
}

interface InstallerSearchResult {
  id: number;
  companyName: string;
  website: string | null;
  postcode: string | null;
}

interface Post {
  id: number;
  postUrl: string | null;
  authorName: string | null;
  postText: string | null;
  postedAt: string | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  employeeId: number | null;
  scrapedAt: string;
  engagementCount: number;
  matchedCount: number;
}

interface Engagement {
  id: number;
  engagerName: string;
  engagerProfileId: string | null;
  engagerHeadline: string | null;
  engagerProfileUrl: string | null;
  engagerCompany: string | null;
  engagementType: string;
  commentText: string | null;
  installerId: number | null;
  installerName: string | null;
  installerPostcode: string | null;
}

export function CompetitorDashboard() {
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [clientsLoading, setClientsLoading] = useState(false);

  // Add competitor
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newLinkedin, setNewLinkedin] = useState("");

  // Add client
  const [clientSearch, setClientSearch] = useState("");
  const [searchResults, setSearchResults] = useState<InstallerSearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  // Edit linkedin
  const [editingLinkedin, setEditingLinkedin] = useState<number | null>(null);
  const [linkedinInput, setLinkedinInput] = useState("");

  // Scrape
  const [scraping, setScraping] = useState(false);
  const [scrapingPosts, setScrapingPosts] = useState(false);
  const [scrapingEngagement, setScrapingEngagement] = useState(false);

  // Posts + engagement
  const [posts, setPosts] = useState<Post[]>([]);
  const [postsLoading, setPostsLoading] = useState(false);
  const [expandedPostId, setExpandedPostId] = useState<number | null>(null);
  const [engagementByPost, setEngagementByPost] = useState<Record<number, Engagement[]>>({});
  const [engagementLoading, setEngagementLoading] = useState<number | null>(null);

  const fetchCompetitors = useCallback(async () => {
    const res = await fetch("/api/competitors");
    const data = await res.json();
    setCompetitors(data);
    setLoading(false);
  }, []);

  const fetchClients = useCallback(async (competitorId: number) => {
    setClientsLoading(true);
    const res = await fetch(`/api/competitors/${competitorId}/clients`);
    const data = await res.json();
    setClients(data);
    setClientsLoading(false);
  }, []);

  useEffect(() => {
    fetchCompetitors();
  }, [fetchCompetitors]);

  const fetchEmployees = useCallback(async (competitorId: number) => {
    const res = await fetch(`/api/competitors/${competitorId}/employees`);
    const data = await res.json();
    setEmployees(data);
  }, []);

  const fetchPosts = useCallback(async (competitorId: number) => {
    setPostsLoading(true);
    const res = await fetch(`/api/competitors/${competitorId}/posts`);
    const data = await res.json();
    setPosts(data);
    setPostsLoading(false);
  }, []);

  const fetchEngagement = useCallback(async (competitorId: number, postId: number) => {
    setEngagementLoading(postId);
    const res = await fetch(`/api/competitors/${competitorId}/engagement?postId=${postId}`);
    const data = await res.json();
    setEngagementByPost((prev) => ({ ...prev, [postId]: data }));
    setEngagementLoading(null);
  }, []);

  useEffect(() => {
    if (selectedId) {
      fetchClients(selectedId);
      fetchEmployees(selectedId);
      fetchPosts(selectedId);
      setExpandedPostId(null);
      setEngagementByPost({});
    }
  }, [selectedId, fetchClients, fetchEmployees, fetchPosts]);

  const togglePost = (postId: number) => {
    if (expandedPostId === postId) {
      setExpandedPostId(null);
      return;
    }
    setExpandedPostId(postId);
    if (selectedId && !engagementByPost[postId]) {
      fetchEngagement(selectedId, postId);
    }
  };

  const linkEngagement = async (
    postId: number,
    engagementId: number,
    installerId: number | null
  ) => {
    if (!selectedId) return;
    await fetch(`/api/competitors/${selectedId}/engagement`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ engagementId, installerId }),
    });
    await fetchEngagement(selectedId, postId);
    fetchPosts(selectedId);
    toast.success(installerId ? "Linked to installer" : "Link removed");
  };

  const addCompetitor = async () => {
    if (!newName.trim()) return;
    await fetch("/api/competitors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim(), linkedinUrl: newLinkedin.trim() || null }),
    });
    setNewName("");
    setNewLinkedin("");
    setShowAdd(false);
    fetchCompetitors();
    toast.success("Competitor added");
  };

  const deleteCompetitor = async (id: number) => {
    await fetch(`/api/competitors/${id}`, { method: "DELETE" });
    if (selectedId === id) {
      setSelectedId(null);
      setClients([]);
    }
    fetchCompetitors();
    toast.success("Competitor removed");
  };

  const saveLinkedin = async (id: number) => {
    await fetch(`/api/competitors/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ linkedinUrl: linkedinInput.trim() || null }),
    });
    setEditingLinkedin(null);
    fetchCompetitors();
    toast.success("LinkedIn URL saved");
  };

  const searchInstallers = async (q: string) => {
    setClientSearch(q);
    if (q.length < 2) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    const res = await fetch(`/api/installers?search=${encodeURIComponent(q)}&pageSize=8`);
    const data = await res.json();
    setSearchResults(data.installers || []);
    setSearching(false);
  };

  const scrapeEmployees = async (competitorId: number) => {
    setScraping(true);
    try {
      const res = await fetch(`/api/competitors/${competitorId}/scrape-employees`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Scrape failed");
        return;
      }
      toast.success(`Found ${data.total} employees (${data.new} new)`);
      fetchCompetitors();
      fetchEmployees(competitorId);
    } catch {
      toast.error("Failed to scrape employees");
    } finally {
      setScraping(false);
    }
  };

  const scrapePosts = async (competitorId: number) => {
    setScrapingPosts(true);
    try {
      const res = await fetch(`/api/competitors/${competitorId}/scrape-posts`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Scrape failed");
        return;
      }
      toast.success("Scraping posts & reactions in the background. This may take a few minutes.");
    } catch {
      toast.error("Failed to start scrape");
    } finally {
      setScrapingPosts(false);
    }
  };

  const scrapeEngagement = async (competitorId: number) => {
    setScrapingEngagement(true);
    try {
      const res = await fetch(`/api/competitors/${competitorId}/scrape-engagement`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Scrape failed");
        return;
      }
      toast.success(
        "Scraping reactions & comments in the background. Hit refresh on the Posts list in a minute or two."
      );
    } catch {
      toast.error("Failed to start scrape");
    } finally {
      setScrapingEngagement(false);
    }
  };

  const refreshPosts = async () => {
    if (!selectedId) return;
    setEngagementByPost({});
    await fetchPosts(selectedId);
    if (expandedPostId) fetchEngagement(selectedId, expandedPostId);
  };

  const addClient = async (installerId: number) => {
    if (!selectedId) return;
    const res = await fetch(`/api/competitors/${selectedId}/clients`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ installerId }),
    });
    if (res.status === 409) {
      toast.error("Already added as a client");
      return;
    }
    setClientSearch("");
    setSearchResults([]);
    fetchClients(selectedId);
    fetchCompetitors();
    toast.success("Client added");
  };

  const removeClient = async (clientId: number) => {
    if (!selectedId) return;
    await fetch(`/api/competitors/${selectedId}/clients?clientId=${clientId}`, { method: "DELETE" });
    fetchClients(selectedId);
    fetchCompetitors();
    toast.success("Client removed");
  };

  const selected = competitors.find((c) => c.id === selectedId);

  const stageColors: Record<string, string> = {
    uncontacted: "bg-gray-100 text-gray-600",
    contacted: "bg-blue-50 text-blue-600",
    meeting_booked: "bg-indigo-50 text-indigo-600",
    proposal_sent: "bg-purple-50 text-purple-600",
    negotiating: "bg-amber-50 text-amber-600",
    won: "bg-emerald-50 text-emerald-600",
    lost: "bg-red-50 text-red-600",
    not_a_fit: "bg-gray-50 text-gray-500",
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-[13px] text-[#9a9a9a]">
        Loading competitors...
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* Left panel — competitor list */}
      <div className="w-[320px] shrink-0 border-r border-[#ebebeb] flex flex-col bg-white">
        <div className="px-4 py-3 border-b border-[#ebebeb]">
          <div className="flex items-center justify-between mb-2">
            <h1 className="text-[15px] font-semibold text-[#1D1D1D]">Competitors</h1>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[12px]"
              onClick={() => setShowAdd(!showAdd)}
            >
              <Plus className="h-3 w-3 mr-1" /> Add
            </Button>
          </div>
          {showAdd && (
            <div className="space-y-2 mt-2 p-3 bg-[#fafafa] rounded-lg border border-[#ebebeb]">
              <Input
                placeholder="Company name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="h-8 text-[13px]"
                onKeyDown={(e) => e.key === "Enter" && addCompetitor()}
              />
              <Input
                placeholder="LinkedIn URL (optional)"
                value={newLinkedin}
                onChange={(e) => setNewLinkedin(e.target.value)}
                className="h-8 text-[13px]"
                onKeyDown={(e) => e.key === "Enter" && addCompetitor()}
              />
              <div className="flex gap-2">
                <Button size="sm" className="h-7 text-[12px]" onClick={addCompetitor}>
                  Add
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-[12px]"
                  onClick={() => setShowAdd(false)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          {competitors.map((c) => (
            <button
              key={c.id}
              onClick={() => setSelectedId(c.id)}
              className={`w-full text-left px-4 py-3 border-b border-[#f5f5f5] transition-colors ${
                selectedId === c.id
                  ? "bg-[#f0f9fd] border-l-2 border-l-[#4ABDE8]"
                  : "hover:bg-[#fafafa]"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-medium text-[#1D1D1D]">{c.name}</span>
                <ChevronRight className="h-3.5 w-3.5 text-[#d0d0d0]" />
              </div>
              <div className="flex items-center gap-3 mt-1 text-[11px] text-[#9a9a9a]">
                <span className="flex items-center gap-1">
                  <Building2 className="h-3 w-3" /> {c.clientCount} clients
                </span>
                {c.employeeCount > 0 && (
                  <span className="flex items-center gap-1">
                    <Users className="h-3 w-3" /> {c.employeeCount}
                  </span>
                )}
                {c.postCount > 0 && (
                  <span className="flex items-center gap-1">
                    <FileText className="h-3 w-3" /> {c.postCount} posts
                  </span>
                )}
                {c.linkedinUrl && <FaLinkedinIn className="h-3 w-3 text-[#0a66c2]" />}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Right panel — selected competitor detail */}
      <div className="flex-1 overflow-y-auto">
        {selected ? (
          <div>
            {/* Header */}
            <div className="px-6 py-4 border-b border-[#ebebeb] bg-white">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-[18px] font-semibold text-[#1D1D1D]">{selected.name}</h2>
                  <div className="flex items-center gap-3 mt-1">
                    {selected.linkedinUrl ? (
                      <a
                        href={selected.linkedinUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[12px] text-[#0a66c2] hover:underline"
                      >
                        <FaLinkedinIn className="h-3 w-3" /> LinkedIn
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : (
                      <button
                        onClick={() => {
                          setEditingLinkedin(selected.id);
                          setLinkedinInput("");
                        }}
                        className="text-[12px] text-[#9a9a9a] hover:text-[#0a66c2]"
                      >
                        + Add LinkedIn
                      </button>
                    )}
                    {selected.website && (
                      <a
                        href={selected.website.startsWith("http") ? selected.website : `https://${selected.website}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[12px] text-[#6a6a6a] hover:underline inline-flex items-center gap-1"
                      >
                        {selected.website} <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                  {editingLinkedin === selected.id && (
                    <div className="flex items-center gap-2 mt-2">
                      <Input
                        placeholder="https://linkedin.com/company/..."
                        value={linkedinInput}
                        onChange={(e) => setLinkedinInput(e.target.value)}
                        className="h-8 text-[12px] w-[350px]"
                        onKeyDown={(e) => e.key === "Enter" && saveLinkedin(selected.id)}
                      />
                      <Button size="sm" className="h-7 text-[12px]" onClick={() => saveLinkedin(selected.id)}>
                        Save
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 text-[12px]" onClick={() => setEditingLinkedin(null)}>
                        Cancel
                      </Button>
                    </div>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-[12px] text-red-500 hover:text-red-600 hover:bg-red-50"
                  onClick={() => deleteCompetitor(selected.id)}
                >
                  <Trash2 className="h-3 w-3 mr-1" /> Remove
                </Button>
              </div>

              {/* Stats + Actions */}
              <div className="flex items-center gap-4 mt-3">
                <div className="flex items-center gap-2 px-3 py-1.5 bg-[#fafafa] rounded-lg border border-[#ebebeb]">
                  <Building2 className="h-3.5 w-3.5 text-[#9a9a9a]" />
                  <span className="text-[13px] font-medium">{selected.clientCount}</span>
                  <span className="text-[11px] text-[#9a9a9a]">clients</span>
                </div>
                <div className="flex items-center gap-2 px-3 py-1.5 bg-[#fafafa] rounded-lg border border-[#ebebeb]">
                  <Users className="h-3.5 w-3.5 text-[#9a9a9a]" />
                  <span className="text-[13px] font-medium">{selected.employeeCount}</span>
                  <span className="text-[11px] text-[#9a9a9a]">employees</span>
                </div>
                <div className="flex items-center gap-2 px-3 py-1.5 bg-[#fafafa] rounded-lg border border-[#ebebeb]">
                  <FileText className="h-3.5 w-3.5 text-[#9a9a9a]" />
                  <span className="text-[13px] font-medium">{selected.postCount}</span>
                  <span className="text-[11px] text-[#9a9a9a]">posts</span>
                </div>
                <div className="ml-auto flex items-center gap-2">
                  {selected.linkedinUrl ? (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 text-[12px] gap-1.5"
                        disabled={scraping}
                        onClick={() => scrapeEmployees(selected.id)}
                      >
                        {scraping ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Users className="h-3.5 w-3.5" />
                        )}
                        {scraping ? "Scraping..." : "Scrape Employees"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 text-[12px] gap-1.5"
                        disabled={scrapingPosts || selected.employeeCount === 0}
                        onClick={() => scrapePosts(selected.id)}
                        title={selected.employeeCount === 0 ? "Scrape employees first" : undefined}
                      >
                        {scrapingPosts ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <FileText className="h-3.5 w-3.5" />
                        )}
                        {scrapingPosts ? "Scraping..." : "Scrape Posts & Reactions"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 text-[12px] gap-1.5"
                        disabled={scrapingEngagement || selected.postCount === 0}
                        onClick={() => scrapeEngagement(selected.id)}
                        title={
                          selected.postCount === 0
                            ? "Scrape posts first"
                            : "Re-fetch reactions & comments for stored posts"
                        }
                      >
                        {scrapingEngagement ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Heart className="h-3.5 w-3.5" />
                        )}
                        {scrapingEngagement ? "Scraping..." : "Get Reactions & Comments"}
                      </Button>
                    </>
                  ) : (
                    <span className="text-[11px] text-[#9a9a9a]">Add LinkedIn URL to scrape</span>
                  )}
                </div>
              </div>
            </div>

            {/* Client list */}
            <div className="px-6 py-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-[12px] font-semibold text-[#8a8a8a] uppercase tracking-[0.08em]">
                  Clients
                </h3>
              </div>

              {/* Search to add client */}
              <div className="relative mb-4">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#9a9a9a]" />
                <Input
                  placeholder="Search installers to add as client..."
                  value={clientSearch}
                  onChange={(e) => searchInstallers(e.target.value)}
                  className="h-9 pl-9 text-[13px]"
                />
                {clientSearch && (
                  <button
                    onClick={() => {
                      setClientSearch("");
                      setSearchResults([]);
                    }}
                    className="absolute right-3 top-1/2 -translate-y-1/2"
                  >
                    <X className="h-3.5 w-3.5 text-[#9a9a9a]" />
                  </button>
                )}
                {searchResults.length > 0 && (
                  <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-white border border-[#ebebeb] rounded-lg shadow-lg max-h-[250px] overflow-y-auto">
                    {searchResults.map((inst) => (
                      <button
                        key={inst.id}
                        onClick={() => addClient(inst.id)}
                        className="w-full text-left px-3 py-2 hover:bg-[#f5f5f5] border-b border-[#f5f5f5] last:border-0"
                      >
                        <span className="text-[13px] font-medium text-[#1D1D1D]">
                          {inst.companyName}
                        </span>
                        {inst.postcode && (
                          <span className="text-[11px] text-[#9a9a9a] ml-2">{inst.postcode}</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Client table */}
              {clientsLoading ? (
                <p className="text-[13px] text-[#9a9a9a]">Loading clients...</p>
              ) : clients.length === 0 ? (
                <div className="text-center py-8 text-[#9a9a9a]">
                  <Building2 className="h-8 w-8 mx-auto mb-2 text-[#d0d0d0]" />
                  <p className="text-[13px]">No clients tracked yet</p>
                  <p className="text-[11px] mt-1">Search above to add installer clients</p>
                </div>
              ) : (
                <div className="border border-[#ebebeb] rounded-lg overflow-hidden">
                  <table className="w-full">
                    <thead>
                      <tr className="bg-[#fafafa] border-b border-[#ebebeb]">
                        <th className="text-left px-3 py-2 text-[11px] font-medium text-[#9a9a9a] uppercase tracking-wider">
                          Company
                        </th>
                        <th className="text-left px-3 py-2 text-[11px] font-medium text-[#9a9a9a] uppercase tracking-wider">
                          Stage
                        </th>
                        <th className="text-left px-3 py-2 text-[11px] font-medium text-[#9a9a9a] uppercase tracking-wider">
                          Source
                        </th>
                        <th className="text-left px-3 py-2 text-[11px] font-medium text-[#9a9a9a] uppercase tracking-wider">
                          Added
                        </th>
                        <th className="w-8"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {clients.map((client) => (
                        <tr
                          key={client.id}
                          className="border-b border-[#f5f5f5] last:border-0 hover:bg-[#fafafa]"
                        >
                          <td className="px-3 py-2.5">
                            <Link
                              href={`/installers/${client.installerId}`}
                              className="text-[13px] font-medium text-[#1D1D1D] hover:text-[#4ABDE8] transition-colors"
                            >
                              {client.companyName}
                            </Link>
                            {client.postcode && (
                              <span className="text-[11px] text-[#9a9a9a] ml-2">
                                {client.postcode}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2.5">
                            {client.pipelineStage && (
                              <Badge
                                variant="outline"
                                className={`text-[10px] ${stageColors[client.pipelineStage] || ""}`}
                              >
                                {client.pipelineStage.replace(/_/g, " ")}
                              </Badge>
                            )}
                          </td>
                          <td className="px-3 py-2.5">
                            <span className="text-[12px] text-[#6a6a6a]">
                              {client.source === "linkedin_engagement" ? (
                                <span className="inline-flex items-center gap-1">
                                  <FaLinkedinIn className="h-3 w-3 text-[#0a66c2]" />
                                  engagement
                                  {client.confidence != null && (
                                    <span className="text-[10px] text-[#9a9a9a]">
                                      ({Math.round(client.confidence * 100)}%)
                                    </span>
                                  )}
                                </span>
                              ) : (
                                "manual"
                              )}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-[12px] text-[#9a9a9a]">
                            {new Date(client.addedAt).toLocaleDateString("en-GB", {
                              day: "numeric",
                              month: "short",
                            })}
                          </td>
                          <td className="px-2 py-2.5">
                            <button
                              onClick={() => removeClient(client.id)}
                              className="p-1 rounded hover:bg-red-50 text-[#d0d0d0] hover:text-red-500 transition-colors"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Employees */}
            {employees.length > 0 && (
              <div className="px-6 py-4 border-t border-[#ebebeb]">
                <h3 className="text-[12px] font-semibold text-[#8a8a8a] uppercase tracking-[0.08em] mb-3">
                  Employees ({employees.length})
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {employees.map((emp) => (
                    <div
                      key={emp.id}
                      className="flex items-center gap-3 p-2.5 rounded-lg border border-[#f0f0f0] hover:border-[#e0e0e0] hover:bg-[#fafafa] transition-colors"
                    >
                      {emp.avatarUrl ? (
                        <img
                          src={emp.avatarUrl}
                          alt=""
                          className="h-9 w-9 rounded-full object-cover shrink-0"
                        />
                      ) : (
                        <div className="h-9 w-9 rounded-full bg-[#f0f0f0] flex items-center justify-center shrink-0">
                          <span className="text-[12px] font-semibold text-[#9a9a9a]">
                            {emp.fullName[0]?.toUpperCase()}
                          </span>
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        {emp.profileUrl ? (
                          <a
                            href={emp.profileUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[13px] font-medium text-[#1D1D1D] hover:text-[#0a66c2] transition-colors truncate block"
                          >
                            {emp.fullName}
                          </a>
                        ) : (
                          <span className="text-[13px] font-medium text-[#1D1D1D] truncate block">
                            {emp.fullName}
                          </span>
                        )}
                        {(emp.role || emp.headline) && (
                          <p className="text-[11px] text-[#9a9a9a] truncate">
                            {emp.role || emp.headline}
                          </p>
                        )}
                      </div>
                      {emp.profileUrl && (
                        <a
                          href={emp.profileUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="shrink-0"
                        >
                          <FaLinkedinIn className="h-3.5 w-3.5 text-[#0a66c2]/40 hover:text-[#0a66c2] transition-colors" />
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Posts */}
            <div className="px-6 py-4 border-t border-[#ebebeb]">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-[12px] font-semibold text-[#8a8a8a] uppercase tracking-[0.08em]">
                  Posts {posts.length > 0 && `(${posts.length})`}
                </h3>
                {posts.length > 0 && (
                  <button
                    onClick={refreshPosts}
                    disabled={postsLoading}
                    className="inline-flex items-center gap-1 text-[11px] text-[#9a9a9a] hover:text-[#4ABDE8] transition-colors"
                    title="Refresh posts & engagement"
                  >
                    <RefreshCw
                      className={`h-3 w-3 ${postsLoading ? "animate-spin" : ""}`}
                    />
                    Refresh
                  </button>
                )}
              </div>

              {postsLoading ? (
                <p className="text-[13px] text-[#9a9a9a]">Loading posts...</p>
              ) : posts.length === 0 ? (
                <div className="text-center py-8 text-[#9a9a9a]">
                  <FileText className="h-8 w-8 mx-auto mb-2 text-[#d0d0d0]" />
                  <p className="text-[13px]">No posts scraped yet</p>
                  <p className="text-[11px] mt-1">
                    Use &ldquo;Scrape Posts &amp; Reactions&rdquo; above to pull recent posts
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {posts.map((post) => {
                    const expanded = expandedPostId === post.id;
                    const engagement = engagementByPost[post.id] || [];
                    return (
                      <div
                        key={post.id}
                        className="border border-[#ebebeb] rounded-lg overflow-hidden"
                      >
                        {/* Post header — click to expand */}
                        <button
                          onClick={() => togglePost(post.id)}
                          className="w-full text-left px-4 py-3 hover:bg-[#fafafa] transition-colors"
                        >
                          <div className="flex items-start gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-[13px] font-medium text-[#1D1D1D] truncate">
                                  {post.authorName || "Unknown author"}
                                </span>
                                {post.postedAt && (
                                  <span className="text-[11px] text-[#9a9a9a] shrink-0">
                                    {post.postedAt}
                                  </span>
                                )}
                              </div>
                              {post.postText && (
                                <p className="text-[12px] text-[#6a6a6a] mt-1 line-clamp-2">
                                  {post.postText}
                                </p>
                              )}
                              <div className="flex items-center gap-3 mt-2 text-[11px] text-[#9a9a9a]">
                                <span className="flex items-center gap-1">
                                  <Heart className="h-3 w-3" /> {post.likes ?? 0}
                                </span>
                                <span className="flex items-center gap-1">
                                  <MessageSquare className="h-3 w-3" /> {post.comments ?? 0}
                                </span>
                                <span className="flex items-center gap-1">
                                  <Users className="h-3 w-3" /> {post.engagementCount} captured
                                </span>
                                {post.matchedCount > 0 && (
                                  <span className="flex items-center gap-1 text-[#4ABDE8] font-medium">
                                    <Link2 className="h-3 w-3" /> {post.matchedCount} matched
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              {post.postUrl && (
                                <a
                                  href={post.postUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="text-[#0a66c2]/40 hover:text-[#0a66c2]"
                                >
                                  <FaLinkedinIn className="h-3.5 w-3.5" />
                                </a>
                              )}
                              {expanded ? (
                                <ChevronDown className="h-4 w-4 text-[#9a9a9a]" />
                              ) : (
                                <ChevronRight className="h-4 w-4 text-[#d0d0d0]" />
                              )}
                            </div>
                          </div>
                        </button>

                        {/* Engagement list */}
                        {expanded && (
                          <div className="border-t border-[#f0f0f0] bg-[#fcfcfc] px-4 py-3">
                            {engagementLoading === post.id ? (
                              <p className="text-[12px] text-[#9a9a9a]">Loading engagement...</p>
                            ) : engagement.length === 0 ? (
                              <p className="text-[12px] text-[#9a9a9a]">
                                No reactions or comments captured for this post.
                              </p>
                            ) : (
                              <div className="space-y-1.5">
                                {engagement.map((eng) => (
                                  <div
                                    key={eng.id}
                                    className="flex items-start gap-2 py-1.5 border-b border-[#f0f0f0] last:border-0"
                                  >
                                    {eng.engagementType === "comment" ? (
                                      <MessageSquare className="h-3.5 w-3.5 text-[#9a9a9a] mt-0.5 shrink-0" />
                                    ) : (
                                      <Heart className="h-3.5 w-3.5 text-[#e0738a] mt-0.5 shrink-0" />
                                    )}
                                    <div className="min-w-0 flex-1">
                                      <div className="flex items-center gap-2 flex-wrap">
                                        {eng.engagerProfileUrl ? (
                                          <a
                                            href={eng.engagerProfileUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-[13px] font-medium text-[#1D1D1D] hover:text-[#0a66c2]"
                                          >
                                            {eng.engagerName}
                                          </a>
                                        ) : (
                                          <span className="text-[13px] font-medium text-[#1D1D1D]">
                                            {eng.engagerName}
                                          </span>
                                        )}
                                      </div>
                                      {eng.engagerHeadline && (
                                        <p className="text-[11px] text-[#9a9a9a] truncate">
                                          {eng.engagerHeadline}
                                        </p>
                                      )}
                                      {eng.commentText && (
                                        <p className="text-[12px] text-[#6a6a6a] mt-1 italic">
                                          &ldquo;{eng.commentText}&rdquo;
                                        </p>
                                      )}
                                    </div>
                                    <div className="shrink-0">
                                      <InstallerLinker
                                        engagement={eng}
                                        onLink={(installerId) =>
                                          linkEngagement(post.id, eng.id, installerId)
                                        }
                                      />
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-[#9a9a9a]">
            <div className="text-center">
              <Building2 className="h-10 w-10 mx-auto mb-3 text-[#d0d0d0]" />
              <p className="text-[14px] font-medium text-[#6a6a6a]">Select a competitor</p>
              <p className="text-[12px] mt-1">
                Track marketing agencies and their installer clients
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Inline installer search/link control for a single engager.
function InstallerLinker({
  engagement,
  onLink,
}: {
  engagement: Engagement;
  onLink: (installerId: number | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<InstallerSearchResult[]>([]);

  const search = async (val: string) => {
    setQ(val);
    if (val.length < 2) {
      setResults([]);
      return;
    }
    const res = await fetch(`/api/installers?search=${encodeURIComponent(val)}&pageSize=6`);
    const data = await res.json();
    setResults(data.installers || []);
  };

  // Already matched — show the installer with an unlink action
  if (engagement.installerId) {
    return (
      <span className="inline-flex items-center gap-1">
        <Link
          href={`/installers/${engagement.installerId}`}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#eef9fd] text-[#2596be] text-[11px] font-medium hover:bg-[#dcf2fa] transition-colors max-w-[160px]"
        >
          <Building2 className="h-3 w-3 shrink-0" />
          <span className="truncate">{engagement.installerName || "Installer"}</span>
        </Link>
        <button
          onClick={() => onLink(null)}
          title="Unlink installer"
          className="p-0.5 rounded hover:bg-red-50 text-[#d0d0d0] hover:text-red-500 transition-colors"
        >
          <X className="h-3 w-3" />
        </button>
      </span>
    );
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-dashed border-[#d0d0d0] text-[11px] text-[#9a9a9a] hover:border-[#4ABDE8] hover:text-[#4ABDE8] transition-colors"
      >
        <Link2 className="h-3 w-3" /> Link installer
      </button>
    );
  }

  return (
    <div className="relative w-[200px]">
      <Input
        autoFocus
        placeholder="Search installers..."
        value={q}
        onChange={(e) => search(e.target.value)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="h-7 text-[12px]"
      />
      {results.length > 0 && (
        <div className="absolute z-20 top-full right-0 mt-1 w-full bg-white border border-[#ebebeb] rounded-lg shadow-lg max-h-[200px] overflow-y-auto">
          {results.map((inst) => (
            <button
              key={inst.id}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onLink(inst.id);
                setOpen(false);
                setQ("");
                setResults([]);
              }}
              className="w-full text-left px-3 py-2 hover:bg-[#f5f5f5] border-b border-[#f5f5f5] last:border-0"
            >
              <span className="text-[12px] font-medium text-[#1D1D1D]">
                {inst.companyName}
              </span>
              {inst.postcode && (
                <span className="text-[10px] text-[#9a9a9a] ml-2">{inst.postcode}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
