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

interface InstallerSearchResult {
  id: number;
  companyName: string;
  website: string | null;
  postcode: string | null;
}

export function CompetitorDashboard() {
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
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

  useEffect(() => {
    if (selectedId) fetchClients(selectedId);
  }, [selectedId, fetchClients]);

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

              {/* Stats */}
              <div className="flex gap-4 mt-3">
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
