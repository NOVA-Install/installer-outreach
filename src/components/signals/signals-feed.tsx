"use client";

import { useState, useEffect, useCallback } from "react";
import { FaLinkedinIn } from "react-icons/fa6";
import {
  Search,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  ThumbsUp,
  MessageSquare,
  Share2,
  ArrowUpDown,
  Radio,
  X,
} from "lucide-react";
import Link from "next/link";

interface Signal {
  id: number;
  installerId: number;
  postId: string;
  postUrl: string | null;
  postText: string | null;
  authorName: string | null;
  authorHeadline: string | null;
  authorProfileUrl: string | null;
  authorProfileId: string | null;
  postedAt: string | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  matchedKeyword: string | null;
  relevanceScore: number | null;
  relevanceReason: string | null;
  signalType: string;
  fetchedAt: string;
  companyName: string;
  companyWebsite: string | null;
  contactId: number | null;
  contactAvatarUrl: string | null;
  contactName: string | null;
}

interface SignalsResponse {
  data: Signal[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "";
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
    const diffWeeks = Math.floor(diffDays / 7);
    if (diffWeeks < 5) return `${diffWeeks}w ago`;
    return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  } catch {
    return "";
  }
}

function summarizePost(text: string | null, signalType: string): string {
  if (!text) return signalType === "repost" ? "Shared a post" : "Posted on LinkedIn";
  const clean = text.replace(/\n/g, " ").trim();
  if (clean.length <= 60) return clean;
  // Try to extract the first meaningful sentence/phrase
  const firstLine = clean.split(/[.\n!?]/)[0].trim();
  if (firstLine.length > 10 && firstLine.length <= 80) return firstLine;
  return clean.slice(0, 57) + "…";
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

function HighlightKeyword({ text, keyword }: { text: string; keyword: string | null }) {
  if (!keyword || !text) return <>{text}</>;
  const regex = new RegExp(`(${keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
  const parts = text.split(regex);
  return (
    <>
      {parts.map((part, i) =>
        regex.test(part) ? (
          <mark key={i} className="bg-amber-100 text-amber-900 rounded px-0.5">{part}</mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

function RelevanceBadge({ score }: { score: number | null }) {
  if (score == null) return null;
  const color = score >= 70 ? "text-emerald-700 bg-emerald-50 border-emerald-200/60"
    : score >= 40 ? "text-amber-700 bg-amber-50 border-amber-200/60"
    : "text-gray-500 bg-gray-50 border-gray-200/60";
  return (
    <span className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium tabular-nums ${color}`}>
      {score}%
    </span>
  );
}

function SignalBadge({ type }: { type: string }) {
  if (type === "repost") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200/60 px-1.5 py-0.5 text-[10px] font-medium text-amber-600">
        <Share2 className="h-2.5 w-2.5" /> Repost
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-[#0a66c2]/8 border border-[#0a66c2]/20 px-1.5 py-0.5 text-[10px] font-medium text-[#0a66c2]">
      <FaLinkedinIn className="h-2.5 w-2.5" /> Post
    </span>
  );
}

export function SignalsFeed() {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<"postedAt" | "fetchedAt">("postedAt");
  const [selected, setSelected] = useState<Signal | null>(null);

  const fetchSignals = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: "50",
        sortBy,
      });
      if (search) params.set("search", search);
      const res = await fetch(`/api/signals?${params}`);
      if (res.ok) {
        const json: SignalsResponse = await res.json();
        setSignals(json.data);
        setTotal(json.total);
        setTotalPages(json.totalPages);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [page, search, sortBy]);

  useEffect(() => {
    fetchSignals();
  }, [fetchSignals]);

  // Debounced search
  const [searchInput, setSearchInput] = useState("");
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Group signals by recency
  const now = new Date();
  const todaySignals: Signal[] = [];
  const thisWeekSignals: Signal[] = [];
  const olderSignals: Signal[] = [];

  for (const s of signals) {
    const date = s.postedAt ? new Date(s.postedAt) : null;
    if (!date) {
      olderSignals.push(s);
      continue;
    }
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays < 1) todaySignals.push(s);
    else if (diffDays < 7) thisWeekSignals.push(s);
    else olderSignals.push(s);
  }

  const groups = [
    { label: "Today", items: todaySignals },
    { label: "This week", items: thisWeekSignals },
    { label: "Older", items: olderSignals },
  ].filter((g) => g.items.length > 0);

  return (
    <div className="flex h-full">
      {/* Left panel — signal feed */}
      <div className="flex flex-col w-[520px] min-w-[400px] max-w-[600px] border-r border-[#ebebeb] h-full">
        {/* Header */}
        <div className="shrink-0 border-b border-[#ebebeb] bg-white px-5 py-3">
          <div className="flex items-center gap-2.5 mb-3">
            <Radio className="h-4 w-4 text-[#0a66c2]" />
            <h1 className="text-[16px] font-semibold text-[#1D1D1D]">Social Signals</h1>
            {total > 0 && (
              <span className="inline-flex items-center rounded-full bg-[#f5f5f5] px-2 py-0.5 text-[11px] font-medium text-[#6a6a6a] tabular-nums">
                {total}
              </span>
            )}
          </div>

          {/* Toolbar */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#9a9a9a]" />
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search companies, people, posts..."
                className="w-full h-8 rounded-lg border border-[#e5e5e5] bg-[#fafafa] pl-8 pr-3 text-[12px] placeholder:text-[#b0b0b0] focus:outline-none focus:ring-1 focus:ring-[#0a66c2]/40 focus:border-[#0a66c2]/40"
              />
            </div>
            <button
              onClick={() => setSortBy(sortBy === "postedAt" ? "fetchedAt" : "postedAt")}
              className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-[#e5e5e5] bg-white text-[11px] text-[#6a6a6a] hover:bg-[#fafafa] transition-colors shrink-0"
            >
              <ArrowUpDown className="h-3 w-3" />
              {sortBy === "postedAt" ? "Date posted" : "Date added"}
            </button>
          </div>
        </div>

        {/* Feed */}
        <div className="flex-1 overflow-y-auto bg-[#fafaf9]">
          {loading && signals.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-[13px] text-[#9a9a9a]">
              Loading signals...
            </div>
          ) : signals.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-center px-8">
              <Radio className="h-8 w-8 text-[#d5d5d5] mb-3" />
              <p className="text-[14px] font-medium text-[#6a6a6a]">No signals yet</p>
              <p className="text-[12px] text-[#9a9a9a] mt-1">
                Run LinkedIn Social Signals from the Enrichment page to start tracking activity.
              </p>
            </div>
          ) : (
            <div>
              {groups.map((group) => (
                <div key={group.label}>
                  <div className="sticky top-0 z-10 bg-[#f5f5f4] border-b border-[#e8e8e8] px-5 py-1.5">
                    <span className="text-[11px] font-semibold text-[#8a8a8a] uppercase tracking-[0.06em]">
                      {group.label}
                    </span>
                    <span className="ml-2 text-[11px] text-[#b0b0b0] tabular-nums">{group.items.length}</span>
                  </div>
                  {group.items.map((signal) => {
                    const domain = getDomain(signal.companyWebsite);
                    const isSelected = selected?.id === signal.id;
                    return (
                      <button
                        key={signal.id}
                        onClick={() => setSelected(isSelected ? null : signal)}
                        className={`w-full text-left px-5 py-3 border-b border-[#f0f0f0] transition-colors cursor-pointer ${
                          isSelected
                            ? "bg-[#0a66c2]/5 border-l-2 border-l-[#0a66c2]"
                            : "bg-white hover:bg-[#fafaf9] border-l-2 border-l-transparent"
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          {/* Avatar */}
                          <div className="shrink-0 mt-0.5">
                            {signal.contactAvatarUrl ? (
                              <img
                                src={signal.contactAvatarUrl}
                                alt=""
                                className="h-9 w-9 rounded-full bg-[#f5f5f5] object-cover"
                              />
                            ) : domain ? (
                              <img
                                src={`https://www.google.com/s2/favicons?domain=${domain}&sz=64`}
                                alt=""
                                className="h-9 w-9 rounded-full bg-[#f5f5f5] object-contain p-1"
                              />
                            ) : (
                              <div className="h-9 w-9 rounded-full bg-gradient-to-br from-[#e8f4f9] to-[#d4eef7] flex items-center justify-center">
                                <span className="text-[13px] font-bold text-[#4ABDE8]">
                                  {(signal.authorName || signal.companyName)[0]}
                                </span>
                              </div>
                            )}
                          </div>

                          {/* Content */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-[13px] font-semibold text-[#1D1D1D] truncate">
                                {signal.companyName}
                              </span>
                            </div>
                            <p className="text-[11px] text-[#8a8a8a] truncate">
                              {signal.authorName || "Unknown"}
                              {signal.authorHeadline && ` · ${signal.authorHeadline.split(" at ")[0].split(" | ")[0].trim()}`}
                            </p>
                          </div>

                          {/* Signal + time */}
                          <div className="shrink-0 text-right flex flex-col items-end gap-1">
                            <div className="flex items-center gap-1.5">
                              <SignalBadge type={signal.signalType} />
                              <RelevanceBadge score={signal.relevanceScore} />
                              {signal.matchedKeyword && (
                                <span className="inline-flex items-center rounded-full bg-amber-50 border border-amber-200/60 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                                  {signal.matchedKeyword}
                                </span>
                              )}
                              <span className="text-[11px] text-[#0a66c2] max-w-[140px] truncate">
                                <HighlightKeyword text={summarizePost(signal.postText, signal.signalType)} keyword={signal.matchedKeyword} />
                              </span>
                            </div>
                            <span className="text-[10px] text-[#b0b0b0] tabular-nums">
                              {timeAgo(signal.postedAt)}
                            </span>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ))}

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-3 py-4 bg-white border-t border-[#ebebeb]">
                  <button
                    onClick={() => setPage(Math.max(1, page - 1))}
                    disabled={page <= 1}
                    className="h-7 w-7 rounded-md border border-[#e5e5e5] flex items-center justify-center text-[#6a6a6a] hover:bg-[#fafafa] disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </button>
                  <span className="text-[12px] text-[#6a6a6a] tabular-nums">
                    {page} / {totalPages}
                  </span>
                  <button
                    onClick={() => setPage(Math.min(totalPages, page + 1))}
                    disabled={page >= totalPages}
                    className="h-7 w-7 rounded-md border border-[#e5e5e5] flex items-center justify-center text-[#6a6a6a] hover:bg-[#fafafa] disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Right panel — detail view */}
      <div className="flex-1 h-full overflow-y-auto bg-white">
        {selected ? (
          <div className="p-6 max-w-[640px]">
            {/* Header */}
            <div className="flex items-start justify-between mb-5">
              <div className="flex items-start gap-3">
                {selected.contactAvatarUrl ? (
                  <img
                    src={selected.contactAvatarUrl}
                    alt=""
                    className="h-11 w-11 rounded-xl bg-[#f5f5f5] object-cover shadow-[0_2px_8px_rgba(0,0,0,0.06)] border border-[#f0f0f0]"
                  />
                ) : (() => {
                  const domain = getDomain(selected.companyWebsite);
                  return domain ? (
                    <img
                      src={`https://www.google.com/s2/favicons?domain=${domain}&sz=128`}
                      alt=""
                      className="h-11 w-11 rounded-xl bg-white object-contain p-1.5 shadow-[0_2px_8px_rgba(0,0,0,0.06)] border border-[#f0f0f0]"
                    />
                  ) : (
                    <div className="h-11 w-11 rounded-xl bg-gradient-to-br from-[#e8f4f9] to-[#d4eef7] flex items-center justify-center shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
                      <span className="text-[16px] font-bold text-[#4ABDE8]">{selected.companyName[0]}</span>
                    </div>
                  );
                })()}
                <div>
                  <Link
                    href={`/installers/${selected.installerId}`}
                    className="text-[16px] font-semibold text-[#1D1D1D] hover:text-[#0a66c2] transition-colors"
                  >
                    {selected.companyName}
                  </Link>
                  <div className="flex items-center gap-2 mt-0.5">
                    {selected.authorProfileUrl ? (
                      <a
                        href={selected.authorProfileUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[13px] text-[#0a66c2] hover:underline"
                      >
                        {selected.authorName || "Unknown"}
                      </a>
                    ) : (
                      <span className="text-[13px] text-[#3a3a3a]">{selected.authorName || "Unknown"}</span>
                    )}
                  </div>
                  {selected.authorHeadline && (
                    <p className="text-[12px] text-[#8a8a8a] mt-0.5">{selected.authorHeadline}</p>
                  )}
                </div>
              </div>
              <button
                onClick={() => setSelected(null)}
                className="h-7 w-7 rounded-md hover:bg-[#f5f5f5] flex items-center justify-center text-[#9a9a9a] transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Meta */}
            <div className="flex items-center gap-3 mb-4">
              <SignalBadge type={selected.signalType} />
              <RelevanceBadge score={selected.relevanceScore} />
              {selected.matchedKeyword && (
                <span className="inline-flex items-center rounded-full bg-amber-50 border border-amber-200/60 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                  Matched: {selected.matchedKeyword}
                </span>
              )}
              {selected.postedAt && (
                <span className="text-[12px] text-[#9a9a9a]">
                  {new Date(selected.postedAt).toLocaleDateString("en-GB", {
                    weekday: "short",
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </span>
              )}
              {selected.postUrl && (
                <a
                  href={selected.postUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[12px] text-[#0a66c2] hover:underline ml-auto"
                >
                  View on LinkedIn <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>

            {/* Post content */}
            {selected.postText && (
              <div className="rounded-xl bg-[#fafaf9] border border-[#ebebeb] p-4 mb-4">
                <p className="text-[13px] text-[#2a2a2a] leading-relaxed whitespace-pre-line">
                  <HighlightKeyword text={selected.postText} keyword={selected.matchedKeyword} />
                </p>
              </div>
            )}

            {/* Relevance reason */}
            {selected.relevanceReason && (
              <div className="rounded-lg bg-[#f0fdf4] border border-emerald-200/40 px-3 py-2 mb-4">
                <p className="text-[11px] font-medium text-emerald-700 uppercase tracking-wider mb-0.5">Why this is relevant</p>
                <p className="text-[12px] text-emerald-800">{selected.relevanceReason}</p>
              </div>
            )}

            {/* Engagement */}
            {(selected.likes || selected.comments || selected.shares) && (
              <div className="flex items-center gap-5 mb-5">
                {selected.likes != null && selected.likes > 0 && (
                  <span className="flex items-center gap-1.5 text-[13px] text-[#6a6a6a]">
                    <ThumbsUp className="h-3.5 w-3.5 text-[#0a66c2]" /> {selected.likes} likes
                  </span>
                )}
                {selected.comments != null && selected.comments > 0 && (
                  <span className="flex items-center gap-1.5 text-[13px] text-[#6a6a6a]">
                    <MessageSquare className="h-3.5 w-3.5 text-[#0a66c2]" /> {selected.comments} comments
                  </span>
                )}
                {selected.shares != null && selected.shares > 0 && (
                  <span className="flex items-center gap-1.5 text-[13px] text-[#6a6a6a]">
                    <Share2 className="h-3.5 w-3.5 text-[#0a66c2]" /> {selected.shares} shares
                  </span>
                )}
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2 pt-4 border-t border-[#f0f0f0]">
              <Link
                href={`/installers/${selected.installerId}`}
                className="inline-flex items-center gap-1.5 h-8 px-3.5 rounded-lg bg-[#0a66c2] text-white text-[12px] font-medium hover:bg-[#094fa0] transition-colors"
              >
                View Installer
              </Link>
              {selected.authorProfileUrl && (
                <a
                  href={selected.authorProfileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 h-8 px-3.5 rounded-lg border border-[#e5e5e5] text-[12px] font-medium text-[#3a3a3a] hover:bg-[#fafafa] transition-colors"
                >
                  <FaLinkedinIn className="h-3 w-3 text-[#0a66c2]" /> View Profile
                </a>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center px-8">
            <div className="relative mb-4">
              <div className="h-24 w-24 rounded-full bg-gradient-to-br from-[#e8f4f9] to-[#d4eef7] flex items-center justify-center">
                <FaLinkedinIn className="h-10 w-10 text-[#0a66c2]/30" />
              </div>
            </div>
            <p className="text-[15px] font-medium text-[#3a3a3a]">
              {total > 0 ? `${total} signals ready` : "No signals yet"}
            </p>
            <p className="text-[13px] text-[#9a9a9a] mt-1 max-w-[280px]">
              {total > 0
                ? "Select a signal to see the full post and take action."
                : "Run LinkedIn Social Signals enrichment to start tracking activity from your installers."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
