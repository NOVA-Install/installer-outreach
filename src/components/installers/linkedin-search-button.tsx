"use client";

import { useState, useRef, useEffect } from "react";
import { FaLinkedinIn } from "react-icons/fa6";
import { Loader2, ChevronDown, Search, Users, FileText } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

type Action = "search" | "employees" | "posts";

export function LinkedInSearchButton({ installerId }: { installerId: number }) {
  const [loading, setLoading] = useState<Action | null>(null);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    function h(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const run = async (action: Action) => {
    setLoading(action);
    setOpen(false);

    try {
      if (action === "search") {
        const res = await fetch(`/api/installers/${installerId}/linkedin-search`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ postedLimit: "month" }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed");
        if (data.newSignals > 0) {
          toast.success(`Found ${data.newSignals} new post${data.newSignals !== 1 ? "s" : ""}`);
        } else {
          toast.info("No new posts found (" + data.postsFound + " checked)");
        }
      } else if (action === "employees") {
        const res = await fetch(`/api/installers/${installerId}/linkedin-employees`, {
          method: "POST",
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed");
        toast.success(`Found ${data.employees} employees, ${data.newContacts} saved`);
      } else if (action === "posts") {
        const res = await fetch(`/api/installers/${installerId}/linkedin-posts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ postedLimit: "month" }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed");
        if (data.newSignals > 0) {
          toast.success(`Found ${data.newSignals} new posts from ${data.contactsSearched} contacts`);
        } else {
          toast.info(`No new posts (${data.postsFound} checked from ${data.contactsSearched} contacts)`);
        }
      }
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setLoading(null);
    }
  };

  const isLoading = loading !== null;

  return (
    <div className="relative" ref={ref}>
      <div className="flex">
        <button
          onClick={() => run("search")}
          disabled={isLoading}
          className="inline-flex items-center gap-1.5 h-7 px-3 rounded-l-lg border border-[#0a66c2]/20 bg-[#0a66c2]/5 text-[11px] font-medium text-[#0a66c2] hover:bg-[#0a66c2]/10 transition-colors disabled:opacity-50"
        >
          {loading === "search" ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <FaLinkedinIn className="h-3 w-3" />
          )}
          {loading === "search" ? "Searching..." : loading === "employees" ? "Finding employees..." : loading === "posts" ? "Scraping posts..." : "Search LinkedIn"}
        </button>
        <button
          onClick={() => setOpen(!open)}
          disabled={isLoading}
          className="inline-flex items-center h-7 px-1.5 rounded-r-lg border border-l-0 border-[#0a66c2]/20 bg-[#0a66c2]/5 text-[#0a66c2] hover:bg-[#0a66c2]/10 transition-colors disabled:opacity-50"
        >
          <ChevronDown className="h-3 w-3" />
        </button>
      </div>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-64 rounded-lg border border-[#e5e5e5] bg-white shadow-lg z-50">
          <div className="p-1">
            <button
              onClick={() => run("search")}
              className="flex items-start gap-2.5 w-full rounded-md px-2.5 py-2 text-left hover:bg-[#fafafa] transition-colors"
            >
              <Search className="h-3.5 w-3.5 text-[#0a66c2] mt-0.5 shrink-0" />
              <div>
                <p className="text-[12px] font-medium text-[#1D1D1D]">Keyword Search</p>
                <p className="text-[10px] text-[#9a9a9a]">Search by keywords (uses your saved keywords)</p>
              </div>
            </button>
            <button
              onClick={() => run("employees")}
              className="flex items-start gap-2.5 w-full rounded-md px-2.5 py-2 text-left hover:bg-[#fafafa] transition-colors"
            >
              <Users className="h-3.5 w-3.5 text-[#0a66c2] mt-0.5 shrink-0" />
              <div>
                <p className="text-[12px] font-medium text-[#1D1D1D]">Scrape Employees</p>
                <p className="text-[10px] text-[#9a9a9a]">Find all employees from company page (~$0.004/employee)</p>
              </div>
            </button>
            <button
              onClick={() => run("posts")}
              className="flex items-start gap-2.5 w-full rounded-md px-2.5 py-2 text-left hover:bg-[#fafafa] transition-colors"
            >
              <FileText className="h-3.5 w-3.5 text-[#0a66c2] mt-0.5 shrink-0" />
              <div>
                <p className="text-[12px] font-medium text-[#1D1D1D]">Scrape All Posts</p>
                <p className="text-[10px] text-[#9a9a9a]">Get all recent posts from known contacts (~$0.002/post)</p>
              </div>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
