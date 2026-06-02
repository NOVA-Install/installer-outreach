"use client";

import { useState, useEffect, useCallback } from "react";
import { FaLinkedinIn } from "react-icons/fa6";
import {
  Search,
  Mail,
  Phone,
  Send,
  FileEdit,
  CheckCircle2,
  Trash2,
  ExternalLink,
  Loader2,
  MessageSquareText,
  ChevronDown,
  Plus,
  X,
} from "lucide-react";
import Link from "next/link";

interface OutreachMessage {
  id: number;
  installerId: number;
  signalId: number | null;
  contactName: string;
  contactLinkedinUrl: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  platform: string;
  message: string;
  status: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  companyName: string;
  companyWebsite: string | null;
  postText: string | null;
  postUrl: string | null;
  postAuthorName: string | null;
  postPostedAt: string | null;
}

function getDomain(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = url.startsWith("http") ? url : `https://${url}`;
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function timeAgo(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  } catch {
    return "";
  }
}

const platformIcon = (platform: string) => {
  switch (platform) {
    case "linkedin": return <FaLinkedinIn className="h-3 w-3" />;
    case "email": return <Mail className="h-3 w-3" />;
    case "call": return <Phone className="h-3 w-3" />;
    default: return <Mail className="h-3 w-3" />;
  }
};

const platformColor = (platform: string) => {
  switch (platform) {
    case "linkedin": return "text-[#0a66c2] bg-[#0a66c2]/8 border-[#0a66c2]/20";
    case "email": return "text-violet-600 bg-violet-50 border-violet-200/60";
    case "call": return "text-emerald-600 bg-emerald-50 border-emerald-200/60";
    default: return "text-gray-600 bg-gray-50 border-gray-200/60";
  }
};

const statusConfig: Record<string, { label: string; color: string }> = {
  draft: { label: "Draft", color: "text-amber-700 bg-amber-50 border-amber-200/60" },
  approved: { label: "Approved", color: "text-blue-700 bg-blue-50 border-blue-200/60" },
  sent: { label: "Sent", color: "text-emerald-700 bg-emerald-50 border-emerald-200/60" },
};

interface InstallerOption {
  id: number;
  companyName: string;
}

const NEW_FORM_DEFAULTS = {
  installerId: 0,
  contactName: "",
  contactLinkedinUrl: "",
  contactEmail: "",
  contactPhone: "",
  platform: "linkedin" as string,
  message: "",
  notes: "",
};

export default function OutreachPage() {
  const [messages, setMessages] = useState<OutreachMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [platformFilter, setPlatformFilter] = useState("");
  const [selected, setSelected] = useState<OutreachMessage | null>(null);
  const [editing, setEditing] = useState(false);
  const [editMessage, setEditMessage] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [saving, setSaving] = useState(false);

  // New message form state
  const [creating, setCreating] = useState(false);
  const [newForm, setNewForm] = useState(NEW_FORM_DEFAULTS);
  const [installerSearch, setInstallerSearch] = useState("");
  const [installerResults, setInstallerResults] = useState<InstallerOption[]>([]);
  const [installerLoading, setInstallerLoading] = useState(false);
  const [selectedInstaller, setSelectedInstaller] = useState<InstallerOption | null>(null);
  const [showInstallerDropdown, setShowInstallerDropdown] = useState(false);

  // Installer search with debounce
  useEffect(() => {
    if (!installerSearch || installerSearch.length < 2) {
      setInstallerResults([]);
      return;
    }
    const t = setTimeout(async () => {
      setInstallerLoading(true);
      const res = await fetch(`/api/installers?search=${encodeURIComponent(installerSearch)}&limit=10&fields=id,companyName`);
      if (res.ok) {
        const json = await res.json();
        setInstallerResults((json.data || json.installers || []).map((i: Record<string, unknown>) => ({
          id: i.id as number,
          companyName: (i.companyName || i.company_name) as string,
        })));
      }
      setInstallerLoading(false);
      setShowInstallerDropdown(true);
    }, 300);
    return () => clearTimeout(t);
  }, [installerSearch]);

  const createMessage = async () => {
    if (!newForm.installerId || !newForm.contactName || !newForm.message) return;
    setSaving(true);
    const res = await fetch("/api/outreach", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        installerId: newForm.installerId,
        contactName: newForm.contactName,
        contactLinkedinUrl: newForm.contactLinkedinUrl || null,
        contactEmail: newForm.contactEmail || null,
        contactPhone: newForm.contactPhone || null,
        platform: newForm.platform,
        message: newForm.message,
        notes: newForm.notes || null,
      }),
    });
    if (res.ok) {
      setCreating(false);
      setNewForm(NEW_FORM_DEFAULTS);
      setSelectedInstaller(null);
      setInstallerSearch("");
      fetchMessages();
    }
    setSaving(false);
  };

  const fetchMessages = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (statusFilter) params.set("status", statusFilter);
    if (platformFilter) params.set("platform", platformFilter);
    const res = await fetch(`/api/outreach?${params}`);
    if (res.ok) {
      const json = await res.json();
      setMessages(json.data);
    }
    setLoading(false);
  }, [search, statusFilter, platformFilter]);

  useEffect(() => { fetchMessages(); }, [fetchMessages]);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const updateStatus = async (id: number, status: string) => {
    await fetch(`/api/outreach/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    setMessages((prev) => prev.map((m) => m.id === id ? { ...m, status, updatedAt: new Date().toISOString() } : m));
    if (selected?.id === id) setSelected({ ...selected, status, updatedAt: new Date().toISOString() });
  };

  const saveEdit = async () => {
    if (!selected) return;
    setSaving(true);
    await fetch(`/api/outreach/${selected.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: editMessage, notes: editNotes || null }),
    });
    const updated = { ...selected, message: editMessage, notes: editNotes || null, updatedAt: new Date().toISOString() };
    setMessages((prev) => prev.map((m) => m.id === selected.id ? updated : m));
    setSelected(updated);
    setEditing(false);
    setSaving(false);
  };

  const deleteMessage = async (id: number) => {
    await fetch(`/api/outreach/${id}`, { method: "DELETE" });
    setMessages((prev) => prev.filter((m) => m.id !== id));
    if (selected?.id === id) setSelected(null);
  };

  const counts = {
    all: messages.length,
    draft: messages.filter((m) => m.status === "draft").length,
    approved: messages.filter((m) => m.status === "approved").length,
    sent: messages.filter((m) => m.status === "sent").length,
  };

  return (
    <div className="flex h-full">
      {/* Left panel — message list */}
      <div className="flex flex-col w-[520px] min-w-[400px] max-w-[600px] border-r border-[#ebebeb] h-full">
        {/* Header */}
        <div className="shrink-0 border-b border-[#ebebeb] bg-white px-5 py-3">
          <div className="flex items-center gap-2.5 mb-3">
            <Send className="h-4 w-4 text-[#0a66c2]" />
            <h1 className="text-[16px] font-semibold text-[#1D1D1D]">Outreach</h1>
            {messages.length > 0 && (
              <span className="inline-flex items-center rounded-full bg-[#f5f5f5] px-2 py-0.5 text-[11px] font-medium text-[#6a6a6a] tabular-nums">
                {messages.length}
              </span>
            )}
            <button
              onClick={() => { setCreating(true); setSelected(null); setEditing(false); }}
              className="ml-auto inline-flex items-center gap-1 h-7 px-2.5 rounded-lg bg-[#0a66c2] text-white text-[11px] font-medium hover:bg-[#094fa0] transition-colors"
            >
              <Plus className="h-3 w-3" /> New
            </button>
          </div>

          {/* Search + platform filter */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#9a9a9a]" />
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search contacts, companies..."
                className="w-full h-8 rounded-lg border border-[#e5e5e5] bg-[#fafafa] pl-8 pr-3 text-[12px] placeholder:text-[#b0b0b0] focus:outline-none focus:ring-1 focus:ring-[#0a66c2]/40 focus:border-[#0a66c2]/40"
              />
            </div>
            <div className="relative">
              <select
                value={platformFilter}
                onChange={(e) => setPlatformFilter(e.target.value)}
                className="appearance-none h-8 pl-2.5 pr-7 rounded-lg border border-[#e5e5e5] bg-white text-[11px] text-[#6a6a6a] cursor-pointer focus:outline-none"
              >
                <option value="">All platforms</option>
                <option value="linkedin">LinkedIn</option>
                <option value="email">Email</option>
                <option value="call">Call</option>
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 text-[#9a9a9a] pointer-events-none" />
            </div>
          </div>

          {/* Status tabs */}
          <div className="flex gap-1 mt-2">
            {[
              { value: "", label: "All", count: counts.all },
              { value: "draft", label: "Drafts", count: counts.draft },
              { value: "approved", label: "Approved", count: counts.approved },
              { value: "sent", label: "Sent", count: counts.sent },
            ].map((tab) => (
              <button
                key={tab.value}
                onClick={() => setStatusFilter(tab.value)}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                  statusFilter === tab.value
                    ? "bg-[#0a66c2] text-white"
                    : "text-[#6a6a6a] hover:bg-[#f0f0f0]"
                }`}
              >
                {tab.label}
                {tab.count > 0 && <span className="ml-1 tabular-nums">{tab.count}</span>}
              </button>
            ))}
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto bg-[#fafaf9]">
          {loading && messages.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-[13px] text-[#9a9a9a]">
              Loading...
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-center px-8">
              <MessageSquareText className="h-8 w-8 text-[#d5d5d5] mb-3" />
              <p className="text-[14px] font-medium text-[#6a6a6a]">No outreach messages yet</p>
              <p className="text-[12px] text-[#9a9a9a] mt-1">
                Draft messages from Social Signals to start tracking your outreach.
              </p>
            </div>
          ) : (
            <div>
              {messages.map((msg) => {
                const domain = getDomain(msg.companyWebsite);
                const isSelected = selected?.id === msg.id;
                const sc = statusConfig[msg.status] || statusConfig.draft;
                return (
                  <button
                    key={msg.id}
                    onClick={() => { setSelected(isSelected ? null : msg); setEditing(false); setCreating(false); }}
                    className={`w-full text-left px-5 py-3 border-b border-[#f0f0f0] transition-colors cursor-pointer ${
                      isSelected
                        ? "bg-[#0a66c2]/5 border-l-2 border-l-[#0a66c2]"
                        : "bg-white hover:bg-[#fafaf9] border-l-2 border-l-transparent"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      {/* Avatar */}
                      <div className="shrink-0 mt-0.5">
                        {domain ? (
                          <img
                            src={`https://www.google.com/s2/favicons?domain=${domain}&sz=64`}
                            alt=""
                            className="h-9 w-9 rounded-full bg-[#f5f5f5] object-contain p-1"
                          />
                        ) : (
                          <div className="h-9 w-9 rounded-full bg-gradient-to-br from-[#e8f4f9] to-[#d4eef7] flex items-center justify-center">
                            <span className="text-[13px] font-bold text-[#4ABDE8]">
                              {msg.contactName[0]}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[13px] font-semibold text-[#1D1D1D] truncate">
                            {msg.contactName}
                          </span>
                          <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${platformColor(msg.platform)}`}>
                            {platformIcon(msg.platform)}
                            {msg.platform}
                          </span>
                        </div>
                        <p className="text-[11px] text-[#8a8a8a] truncate">{msg.companyName}</p>
                        <p className="text-[11px] text-[#b0b0b0] truncate mt-0.5">
                          {msg.message.slice(0, 80)}{msg.message.length > 80 ? "..." : ""}
                        </p>
                      </div>

                      {/* Status + time */}
                      <div className="shrink-0 text-right flex flex-col items-end gap-1">
                        <span className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${sc.color}`}>
                          {sc.label}
                        </span>
                        <span className="text-[10px] text-[#b0b0b0] tabular-nums">
                          {timeAgo(msg.updatedAt)}
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Right panel — detail view or create form */}
      <div className="flex-1 h-full overflow-y-auto bg-white">
        {creating ? (
          <div className="p-6 max-w-[640px]">
            {/* Create header */}
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-[16px] font-semibold text-[#1D1D1D]">New outreach message</h2>
              <button
                onClick={() => { setCreating(false); setNewForm(NEW_FORM_DEFAULTS); setSelectedInstaller(null); setInstallerSearch(""); }}
                className="inline-flex items-center justify-center h-7 w-7 rounded-lg border border-[#e5e5e5] text-[#9a9a9a] hover:bg-[#fafafa] transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Installer search */}
            <div className="mb-4">
              <label className="text-[11px] font-medium text-[#8a8a8a] uppercase tracking-wider">Installer *</label>
              {selectedInstaller ? (
                <div className="mt-1.5 flex items-center gap-2 h-9 px-3 rounded-lg border border-[#e5e5e5] bg-[#fafafa]">
                  <span className="text-[13px] text-[#1D1D1D] flex-1">{selectedInstaller.companyName}</span>
                  <button
                    onClick={() => { setSelectedInstaller(null); setNewForm(f => ({ ...f, installerId: 0 })); setInstallerSearch(""); }}
                    className="text-[#9a9a9a] hover:text-[#6a6a6a]"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ) : (
                <div className="relative mt-1.5">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#9a9a9a]" />
                  <input
                    type="text"
                    value={installerSearch}
                    onChange={(e) => setInstallerSearch(e.target.value)}
                    onFocus={() => installerResults.length > 0 && setShowInstallerDropdown(true)}
                    placeholder="Search for an installer..."
                    className="w-full h-9 rounded-lg border border-[#e5e5e5] bg-[#fafafa] pl-8 pr-3 text-[13px] placeholder:text-[#b0b0b0] focus:outline-none focus:ring-1 focus:ring-[#0a66c2]/40 focus:border-[#0a66c2]/40"
                  />
                  {showInstallerDropdown && installerResults.length > 0 && (
                    <div className="absolute z-10 top-full mt-1 w-full bg-white border border-[#e5e5e5] rounded-lg shadow-lg max-h-48 overflow-y-auto">
                      {installerResults.map((inst) => (
                        <button
                          key={inst.id}
                          onClick={() => {
                            setSelectedInstaller(inst);
                            setNewForm(f => ({ ...f, installerId: inst.id }));
                            setShowInstallerDropdown(false);
                            setInstallerSearch("");
                          }}
                          className="w-full text-left px-3 py-2 text-[13px] text-[#1D1D1D] hover:bg-[#f5f5f5] transition-colors"
                        >
                          {inst.companyName}
                        </button>
                      ))}
                    </div>
                  )}
                  {showInstallerDropdown && installerSearch.length >= 2 && !installerLoading && installerResults.length === 0 && (
                    <div className="absolute z-10 top-full mt-1 w-full bg-white border border-[#e5e5e5] rounded-lg shadow-lg px-3 py-2 text-[12px] text-[#9a9a9a]">
                      No installers found
                    </div>
                  )}
                  {installerLoading && (
                    <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
                      <Loader2 className="h-3.5 w-3.5 text-[#9a9a9a] animate-spin" />
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Contact name + platform */}
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div>
                <label className="text-[11px] font-medium text-[#8a8a8a] uppercase tracking-wider">Contact name *</label>
                <input
                  type="text"
                  value={newForm.contactName}
                  onChange={(e) => setNewForm(f => ({ ...f, contactName: e.target.value }))}
                  placeholder="e.g. John Smith"
                  className="mt-1.5 w-full h-9 rounded-lg border border-[#e5e5e5] bg-[#fafafa] px-3 text-[13px] placeholder:text-[#b0b0b0] focus:outline-none focus:ring-1 focus:ring-[#0a66c2]/40 focus:border-[#0a66c2]/40"
                />
              </div>
              <div>
                <label className="text-[11px] font-medium text-[#8a8a8a] uppercase tracking-wider">Platform *</label>
                <div className="relative mt-1.5">
                  <select
                    value={newForm.platform}
                    onChange={(e) => setNewForm(f => ({ ...f, platform: e.target.value }))}
                    className="appearance-none w-full h-9 px-3 pr-8 rounded-lg border border-[#e5e5e5] bg-[#fafafa] text-[13px] cursor-pointer focus:outline-none focus:ring-1 focus:ring-[#0a66c2]/40 focus:border-[#0a66c2]/40"
                  >
                    <option value="linkedin">LinkedIn</option>
                    <option value="email">Email</option>
                    <option value="call">Call</option>
                  </select>
                  <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#9a9a9a] pointer-events-none" />
                </div>
              </div>
            </div>

            {/* Contact details */}
            <div className="grid grid-cols-1 gap-3 mb-4">
              {(newForm.platform === "linkedin" || newForm.platform === "email") && (
                <div>
                  <label className="text-[11px] font-medium text-[#8a8a8a] uppercase tracking-wider">
                    {newForm.platform === "linkedin" ? "LinkedIn profile URL" : "Email address"}
                  </label>
                  <input
                    type="text"
                    value={newForm.platform === "linkedin" ? newForm.contactLinkedinUrl : newForm.contactEmail}
                    onChange={(e) => setNewForm(f => ({
                      ...f,
                      ...(newForm.platform === "linkedin"
                        ? { contactLinkedinUrl: e.target.value }
                        : { contactEmail: e.target.value }),
                    }))}
                    placeholder={newForm.platform === "linkedin" ? "https://linkedin.com/in/..." : "name@company.com"}
                    className="mt-1.5 w-full h-9 rounded-lg border border-[#e5e5e5] bg-[#fafafa] px-3 text-[13px] placeholder:text-[#b0b0b0] focus:outline-none focus:ring-1 focus:ring-[#0a66c2]/40 focus:border-[#0a66c2]/40"
                  />
                </div>
              )}
              {newForm.platform === "call" && (
                <div>
                  <label className="text-[11px] font-medium text-[#8a8a8a] uppercase tracking-wider">Phone number</label>
                  <input
                    type="text"
                    value={newForm.contactPhone}
                    onChange={(e) => setNewForm(f => ({ ...f, contactPhone: e.target.value }))}
                    placeholder="07..."
                    className="mt-1.5 w-full h-9 rounded-lg border border-[#e5e5e5] bg-[#fafafa] px-3 text-[13px] placeholder:text-[#b0b0b0] focus:outline-none focus:ring-1 focus:ring-[#0a66c2]/40 focus:border-[#0a66c2]/40"
                  />
                </div>
              )}
            </div>

            {/* Message */}
            <div className="mb-4">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-medium text-[#8a8a8a] uppercase tracking-wider">Message *</label>
                {newForm.platform === "linkedin" && (
                  <span className={`text-[11px] tabular-nums ${newForm.message.length > 400 ? "text-red-500 font-medium" : "text-[#b0b0b0]"}`}>
                    {newForm.message.length} chars
                  </span>
                )}
              </div>
              <textarea
                value={newForm.message}
                onChange={(e) => setNewForm(f => ({ ...f, message: e.target.value }))}
                placeholder="Write your outreach message..."
                className="mt-1.5 w-full h-40 rounded-lg border border-[#e5e5e5] bg-[#fafafa] px-3 py-2.5 text-[13px] leading-relaxed text-[#2a2a2a] placeholder:text-[#b0b0b0] focus:outline-none focus:ring-1 focus:ring-[#0a66c2]/40 focus:border-[#0a66c2]/40 resize-y"
              />
            </div>

            {/* Notes */}
            <div className="mb-5">
              <label className="text-[11px] font-medium text-[#8a8a8a] uppercase tracking-wider">Notes</label>
              <textarea
                value={newForm.notes}
                onChange={(e) => setNewForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Internal notes..."
                className="mt-1.5 w-full h-20 rounded-lg border border-[#e5e5e5] bg-[#fafafa] px-3 py-2 text-[12px] text-[#2a2a2a] placeholder:text-[#b0b0b0] focus:outline-none focus:ring-1 focus:ring-[#0a66c2]/40 focus:border-[#0a66c2]/40 resize-none"
              />
            </div>

            {/* Actions */}
            <div className="flex gap-2 pt-4 border-t border-[#f0f0f0]">
              <button
                onClick={createMessage}
                disabled={saving || !newForm.installerId || !newForm.contactName || !newForm.message}
                className="inline-flex items-center gap-1.5 h-8 px-4 rounded-lg bg-[#0a66c2] text-white text-[12px] font-medium hover:bg-[#094fa0] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                Create draft
              </button>
              <button
                onClick={() => { setCreating(false); setNewForm(NEW_FORM_DEFAULTS); setSelectedInstaller(null); setInstallerSearch(""); }}
                className="inline-flex items-center gap-1 h-8 px-3 rounded-lg border border-[#e5e5e5] text-[12px] font-medium text-[#6a6a6a] hover:bg-[#fafafa] transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : selected ? (
          <div className="p-6 max-w-[640px]">
            {/* Header */}
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="text-[16px] font-semibold text-[#1D1D1D]">{selected.contactName}</h2>
                <Link
                  href={`/installers/${selected.installerId}`}
                  className="text-[13px] text-[#0a66c2] hover:underline"
                >
                  {selected.companyName}
                </Link>
              </div>
              <div className="flex items-center gap-2">
                <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${platformColor(selected.platform)}`}>
                  {platformIcon(selected.platform)}
                  {selected.platform}
                </span>
                <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusConfig[selected.status]?.color || ""}`}>
                  {statusConfig[selected.status]?.label || selected.status}
                </span>
              </div>
            </div>

            {/* Contact details */}
            <div className="flex flex-wrap gap-3 mb-4 text-[12px] text-[#6a6a6a]">
              {selected.contactLinkedinUrl && (
                <a href={selected.contactLinkedinUrl} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[#0a66c2] hover:underline">
                  <FaLinkedinIn className="h-3 w-3" /> Profile <ExternalLink className="h-2.5 w-2.5" />
                </a>
              )}
              {selected.contactEmail && (
                <span className="inline-flex items-center gap-1">
                  <Mail className="h-3 w-3" /> {selected.contactEmail}
                </span>
              )}
              {selected.contactPhone && (
                <span className="inline-flex items-center gap-1">
                  <Phone className="h-3 w-3" /> {selected.contactPhone}
                </span>
              )}
            </div>

            {/* Original LinkedIn Post */}
            {selected.postText && (
              <div className="mb-4">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[11px] font-medium text-[#8a8a8a] uppercase tracking-wider">Original LinkedIn Post</span>
                  {selected.postUrl && (
                    <a
                      href={selected.postUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] text-[#0a66c2] hover:underline"
                    >
                      View on LinkedIn <ExternalLink className="h-2.5 w-2.5" />
                    </a>
                  )}
                </div>
                <div className="rounded-xl bg-[#f0f7ff] border border-[#0a66c2]/10 p-4">
                  <p className="text-[12px] text-[#3a3a3a] leading-relaxed whitespace-pre-line">{selected.postText}</p>
                  {selected.postAuthorName && (
                    <p className="text-[11px] text-[#8a8a8a] mt-2">
                      — {selected.postAuthorName}{selected.postPostedAt ? `, ${new Date(selected.postPostedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}` : ""}
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Message */}
            <div className="mb-4">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] font-medium text-[#8a8a8a] uppercase tracking-wider">Message</span>
                {selected.platform === "linkedin" && (
                  <span className={`text-[11px] tabular-nums ${selected.message.length > 400 ? "text-red-500 font-medium" : "text-[#b0b0b0]"}`}>
                    {selected.message.length} chars
                  </span>
                )}
              </div>
              {editing ? (
                <textarea
                  value={editMessage}
                  onChange={(e) => setEditMessage(e.target.value)}
                  className="w-full h-40 rounded-lg border border-[#e5e5e5] bg-[#fafafa] px-3 py-2.5 text-[13px] leading-relaxed text-[#2a2a2a] focus:outline-none focus:ring-1 focus:ring-[#0a66c2]/40 focus:border-[#0a66c2]/40 resize-y"
                />
              ) : (
                <div className="rounded-xl bg-[#fafaf9] border border-[#ebebeb] p-4">
                  <p className="text-[13px] text-[#2a2a2a] leading-relaxed whitespace-pre-line">{selected.message}</p>
                </div>
              )}
            </div>

            {/* Notes */}
            <div className="mb-5">
              <span className="text-[11px] font-medium text-[#8a8a8a] uppercase tracking-wider">Notes</span>
              {editing ? (
                <textarea
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  placeholder="Internal notes..."
                  className="w-full h-20 mt-1.5 rounded-lg border border-[#e5e5e5] bg-[#fafafa] px-3 py-2 text-[12px] text-[#2a2a2a] placeholder:text-[#b0b0b0] focus:outline-none focus:ring-1 focus:ring-[#0a66c2]/40 focus:border-[#0a66c2]/40 resize-none"
                />
              ) : (
                <p className="text-[12px] text-[#6a6a6a] mt-1">
                  {selected.notes || "No notes"}
                </p>
              )}
            </div>

            {/* Timestamps */}
            <div className="text-[11px] text-[#b0b0b0] mb-5 flex gap-4">
              <span>Created {new Date(selected.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>
              <span>Updated {timeAgo(selected.updatedAt)}</span>
            </div>

            {/* Actions */}
            <div className="flex flex-wrap gap-2 pt-4 border-t border-[#f0f0f0]">
              {editing ? (
                <>
                  <button
                    onClick={saveEdit}
                    disabled={saving}
                    className="inline-flex items-center gap-1.5 h-8 px-3.5 rounded-lg bg-[#0a66c2] text-white text-[12px] font-medium hover:bg-[#094fa0] transition-colors disabled:opacity-50"
                  >
                    {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                    Save
                  </button>
                  <button
                    onClick={() => setEditing(false)}
                    className="inline-flex items-center gap-1 h-8 px-3 rounded-lg border border-[#e5e5e5] text-[12px] font-medium text-[#6a6a6a] hover:bg-[#fafafa] transition-colors"
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => { setEditing(true); setEditMessage(selected.message); setEditNotes(selected.notes || ""); }}
                    className="inline-flex items-center gap-1.5 h-8 px-3.5 rounded-lg border border-[#e5e5e5] text-[12px] font-medium text-[#3a3a3a] hover:bg-[#fafafa] transition-colors"
                  >
                    <FileEdit className="h-3 w-3" /> Edit
                  </button>
                  {selected.status === "draft" && (
                    <button
                      onClick={() => updateStatus(selected.id, "approved")}
                      className="inline-flex items-center gap-1.5 h-8 px-3.5 rounded-lg border border-blue-200 bg-blue-50 text-[12px] font-medium text-blue-700 hover:bg-blue-100 transition-colors"
                    >
                      <CheckCircle2 className="h-3 w-3" /> Approve
                    </button>
                  )}
                  {(selected.status === "draft" || selected.status === "approved") && (
                    <button
                      onClick={() => updateStatus(selected.id, "sent")}
                      className="inline-flex items-center gap-1.5 h-8 px-3.5 rounded-lg border border-emerald-200 bg-emerald-50 text-[12px] font-medium text-emerald-700 hover:bg-emerald-100 transition-colors"
                    >
                      <Send className="h-3 w-3" /> Mark as Sent
                    </button>
                  )}
                  {selected.status === "sent" && (
                    <button
                      onClick={() => updateStatus(selected.id, "draft")}
                      className="inline-flex items-center gap-1 h-8 px-3 rounded-lg border border-[#e5e5e5] text-[12px] font-medium text-[#9a9a9a] hover:bg-[#fafafa] transition-colors"
                    >
                      Move to Draft
                    </button>
                  )}
                  <button
                    onClick={() => deleteMessage(selected.id)}
                    className="inline-flex items-center gap-1 h-8 px-3 rounded-lg border border-red-200 text-[12px] font-medium text-red-500 hover:bg-red-50 transition-colors ml-auto"
                  >
                    <Trash2 className="h-3 w-3" /> Delete
                  </button>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center px-8">
            <div className="relative mb-4">
              <div className="h-24 w-24 rounded-full bg-gradient-to-br from-[#e8f4f9] to-[#d4eef7] flex items-center justify-center">
                <Send className="h-10 w-10 text-[#0a66c2]/30" />
              </div>
            </div>
            <p className="text-[15px] font-medium text-[#3a3a3a]">
              {messages.length > 0 ? "Select a message to view" : "No outreach yet"}
            </p>
            <p className="text-[13px] text-[#9a9a9a] mt-1 max-w-[280px]">
              Draft messages from Social Signals, discuss with your team, then mark as sent once delivered.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
