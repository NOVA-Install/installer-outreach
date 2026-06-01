"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Plus, Settings, ArrowRight } from "lucide-react";
import { toast } from "sonner";

interface Campaign {
  id: number;
  name: string;
  status: string;
  zones: string | null;
  systemSpec: string | null;
  totalTargets: number | null;
  processedTargets: number | null;
  errorCount: number | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  running: "bg-blue-100 text-blue-700",
  completed: "bg-green-100 text-green-700",
  cancelled: "bg-red-100 text-red-700",
};

export function CampaignList() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newSystemSpec, setNewSystemSpec] = useState("");
  const [creating, setCreating] = useState(false);

  const fetchCampaigns = useCallback(async () => {
    const res = await fetch("/api/mystery-shopping/campaigns");
    const data = await res.json();
    setCampaigns(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchCampaigns();
  }, [fetchCampaigns]);

  const createCampaign = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/mystery-shopping/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          systemSpec: newSystemSpec.trim() || null,
        }),
      });
      if (!res.ok) throw new Error("Failed to create campaign");
      toast.success("Campaign created");
      setNewName("");
      setNewSystemSpec("");
      setCreateOpen(false);
      fetchCampaigns();
    } catch {
      toast.error("Failed to create campaign");
    } finally {
      setCreating(false);
    }
  };

  if (loading) {
    return <div className="text-[13px] text-[#9a9a9a]">Loading campaigns...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger className="inline-flex shrink-0 items-center justify-center rounded-lg bg-primary px-2.5 h-8 gap-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors">
              <Plus className="h-3.5 w-3.5" />
              New Campaign
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create Campaign</DialogTitle>
              </DialogHeader>
              <div className="space-y-3 pt-2">
                <div>
                  <label className="text-[13px] font-medium text-[#1D1D1D]">Name</label>
                  <Input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="e.g. June 2026 - All Zones"
                    className="mt-1"
                  />
                </div>
                <div>
                  <label className="text-[13px] font-medium text-[#1D1D1D]">System Spec</label>
                  <Input
                    value={newSystemSpec}
                    onChange={(e) => setNewSystemSpec(e.target.value)}
                    placeholder="e.g. 10 panel system with battery"
                    className="mt-1"
                  />
                </div>
                <Button onClick={createCampaign} disabled={creating || !newName.trim()}>
                  {creating ? "Creating..." : "Create"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
          <Link href="/mystery-shopping/setup">
            <Button variant="outline" size="sm" className="gap-1.5">
              <Settings className="h-3.5 w-3.5" />
              Setup
            </Button>
          </Link>
        </div>
      </div>

      {campaigns.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-[13px] text-[#9a9a9a]">
              No campaigns yet. Create one to start mystery shopping.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {campaigns.map((campaign) => {
            const total = campaign.totalTargets || 0;
            const processed = campaign.processedTargets || 0;
            const progress = total > 0 ? Math.round((processed / total) * 100) : 0;
            const zones = campaign.zones ? JSON.parse(campaign.zones) : null;

            return (
              <Link key={campaign.id} href={`/mystery-shopping/${campaign.id}`}>
                <Card className="hover:border-[#1D1D1D]/20 transition-colors cursor-pointer">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-[14px] font-medium">
                        {campaign.name}
                      </CardTitle>
                      <div className="flex items-center gap-2">
                        <Badge
                          variant="secondary"
                          className={STATUS_COLORS[campaign.status] || ""}
                        >
                          {campaign.status}
                        </Badge>
                        <ArrowRight className="h-4 w-4 text-[#9a9a9a]" />
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-4 text-[12px] text-[#9a9a9a]">
                      {campaign.systemSpec && (
                        <span>{campaign.systemSpec}</span>
                      )}
                      {zones && (
                        <span>{zones.length} zone{zones.length !== 1 ? "s" : ""}</span>
                      )}
                      {total > 0 && (
                        <span>
                          {processed}/{total} targets ({progress}%)
                        </span>
                      )}
                      <span>
                        {new Date(campaign.createdAt).toLocaleDateString("en-GB", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </span>
                    </div>
                    {total > 0 && campaign.status === "running" && (
                      <div className="mt-2 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-blue-500 rounded-full transition-all"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                    )}
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
