"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  ClipboardList,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
  AlertCircle,
} from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

interface Task {
  id: number;
  installerId: number;
  taskId: string;
  source: string;
  endpoint: string;
  status: string;
  searchTerm: string | null;
  resultSummary: string | null;
  rawResult: string | null;
  createdAt: string;
  completedAt: string | null;
}

const STATUS_CONFIG: Record<string, { icon: typeof Clock; color: string; label: string }> = {
  pending: { icon: Clock, label: "Pending", color: "text-amber-500" },
  completed: { icon: CheckCircle2, label: "Completed", color: "text-green-600" },
  failed: { icon: XCircle, label: "Failed", color: "text-red-400" },
  no_results: { icon: AlertCircle, label: "No Results", color: "text-gray-400" },
};

const SOURCE_LABELS: Record<string, string> = {
  google_reviews: "Google Reviews",
  trustpilot_search: "Trustpilot Search",
  trustpilot_reviews: "Trustpilot Reviews",
};

function RawResultToggle({ rawResult }: { rawResult: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(!open)}
        className="text-[10px] text-primary hover:underline"
      >
        {open ? "Hide" : "View"} raw data
      </button>
      {open && (
        <pre className="mt-1 max-h-[200px] overflow-auto rounded-md bg-[#1D1D1D] text-[#e5e5e5] p-2 text-[10px] leading-relaxed whitespace-pre-wrap break-all">
          {(() => { try { return JSON.stringify(JSON.parse(rawResult), null, 2); } catch { return rawResult; } })()}
        </pre>
      )}
    </>
  );
}

export function TaskTracker({ installerId }: { installerId: number }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState<number | null>(null);
  const router = useRouter();

  const fetchTasks = useCallback(async () => {
    try {
      const res = await fetch(`/api/installers/${installerId}/tasks`);
      const data = await res.json();
      setTasks(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [installerId]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  const checkTask = async (taskDbId: number) => {
    setChecking(taskDbId);
    try {
      const res = await fetch(`/api/installers/${installerId}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskDbId }),
      });
      const data = await res.json();

      if (data.status === "completed") {
        toast.success(`Results retrieved: ${data.message}`);
        router.refresh();
      } else if (data.status === "pending") {
        toast.info(data.message);
      } else if (data.status === "no_results") {
        toast.info(data.message);
      } else {
        toast.error(data.message);
      }

      fetchTasks();
    } catch {
      toast.error("Failed to check task");
    } finally {
      setChecking(null);
    }
  };

  const checkAllPending = async () => {
    const pending = tasks.filter((t) => t.status === "pending");
    for (const task of pending) {
      await checkTask(task.id);
    }
  };

  const pendingCount = tasks.filter((t) => t.status === "pending").length;

  if (loading) return null;
  if (tasks.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center justify-between">
          <span className="flex items-center gap-2">
            <ClipboardList className="h-4 w-4" />
            DataForSEO Tasks
            {pendingCount > 0 && (
              <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-200">
                {pendingCount} pending
              </Badge>
            )}
          </span>
          <div className="flex gap-1">
            {pendingCount > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={checkAllPending}
                disabled={checking !== null}
                className="h-7 text-xs"
              >
                {checking !== null ? (
                  <Loader2 className="h-3 w-3 animate-spin mr-1" />
                ) : (
                  <RefreshCw className="h-3 w-3 mr-1" />
                )}
                Check All
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={fetchTasks}
            >
              <RefreshCw className="h-3 w-3" />
            </Button>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2 max-h-[300px] overflow-y-auto">
          {tasks.map((task) => {
            const config = STATUS_CONFIG[task.status] || STATUS_CONFIG.pending;
            const Icon = config.icon;

            return (
              <div
                key={task.id}
                className="flex items-center justify-between py-2 border-b last:border-0 text-sm"
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <Icon className={`h-3.5 w-3.5 shrink-0 ${config.color}`} />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium text-xs">
                        {SOURCE_LABELS[task.source] || task.source}
                      </span>
                      {task.searchTerm && (
                        <span className="text-xs text-muted-foreground truncate max-w-[150px]">
                          &quot;{task.searchTerm}&quot;
                        </span>
                      )}
                    </div>
                    {task.resultSummary && (
                      <p className="text-xs text-muted-foreground truncate">
                        {task.resultSummary}
                      </p>
                    )}
                    <div className="flex items-center gap-2">
                      <p className="text-[10px] text-muted-foreground">
                        {new Date(task.createdAt).toLocaleString("en-GB", {
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                      {task.rawResult && (
                        <RawResultToggle rawResult={task.rawResult} />
                      )}
                    </div>
                  </div>
                </div>

                {task.status === "pending" && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => checkTask(task.id)}
                    disabled={checking !== null}
                    className="h-7 text-xs shrink-0 ml-2"
                  >
                    {checking === task.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      "Check"
                    )}
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
