"use client";

import { useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  MessageSquare,
  Phone,
  Mail,
  Users,
  ArrowRight,
  Send,
  Loader2,
  Clock,
} from "lucide-react";
import { toast } from "sonner";
import { PIPELINE_STAGES } from "@/lib/constants";

interface Activity {
  id: number;
  installerId: number;
  type: string;
  content: string;
  metadata: string | null;
  createdAt: string;
}

const TYPE_CONFIG: Record<
  string,
  { icon: typeof MessageSquare; label: string; color: string }
> = {
  note: { icon: MessageSquare, label: "Note", color: "text-gray-500" },
  call: { icon: Phone, label: "Call", color: "text-green-600" },
  email: { icon: Mail, label: "Email", color: "text-blue-500" },
  meeting: { icon: Users, label: "Meeting", color: "text-violet-500" },
  stage_change: { icon: ArrowRight, label: "Stage Change", color: "text-primary" },
};

function getStageName(key: string) {
  return PIPELINE_STAGES.find((s) => s.key === key)?.label || key;
}

export function ActivityTimeline({
  installerId,
  initialActivities,
}: {
  installerId: number;
  initialActivities: Activity[];
}) {
  const [activities, setActivities] = useState(initialActivities);
  const [content, setContent] = useState("");
  const [type, setType] = useState("note");
  const [saving, setSaving] = useState(false);

  const addActivity = async () => {
    if (!content.trim()) return;
    setSaving(true);

    try {
      const res = await fetch(`/api/installers/${installerId}/activities`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, content }),
      });

      if (!res.ok) throw new Error("Failed to save");

      const activity = await res.json();
      setActivities((prev) => [activity, ...prev]);
      setContent("");
      toast.success("Activity logged");
    } catch {
      toast.error("Failed to save activity");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Clock className="h-4 w-4" />
          Activity Timeline
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Add new activity */}
        <div className="space-y-2 rounded-lg border p-3 bg-card">
          <div className="flex gap-2">
            <Select
              value={type}
              onValueChange={(v: string | null) => {
                if (v) setType(v);
              }}
            >
              <SelectTrigger className="w-[120px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="note">Note</SelectItem>
                <SelectItem value="call">Call</SelectItem>
                <SelectItem value="email">Email</SelectItem>
                <SelectItem value="meeting">Meeting</SelectItem>
              </SelectContent>
            </Select>
            <Textarea
              placeholder={
                type === "call"
                  ? "Log your call..."
                  : type === "email"
                    ? "Log your email..."
                    : type === "meeting"
                      ? "Log your meeting..."
                      : "Add a note..."
              }
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="min-h-[60px]"
            />
          </div>
          <div className="flex justify-end">
            <Button
              onClick={addActivity}
              disabled={!content.trim() || saving}
              size="sm"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : (
                <Send className="h-4 w-4 mr-1" />
              )}
              Log {TYPE_CONFIG[type]?.label || "Activity"}
            </Button>
          </div>
        </div>

        {/* Timeline */}
        {activities.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            No activity yet. Log a note, call, email, or meeting.
          </p>
        ) : (
          <div className="relative space-y-0">
            {/* Vertical line */}
            <div className="absolute left-[15px] top-2 bottom-2 w-px bg-border" />

            {activities.map((activity) => {
              const config = TYPE_CONFIG[activity.type] || TYPE_CONFIG.note;
              const Icon = config.icon;

              return (
                <div
                  key={activity.id}
                  className="relative flex gap-3 py-2.5"
                >
                  {/* Icon dot */}
                  <div
                    className={`relative z-10 flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-card border ${config.color}`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0 pt-0.5">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground mb-0.5">
                      <span className="font-medium text-foreground/70">
                        {config.label}
                      </span>
                      <span>
                        {new Date(activity.createdAt).toLocaleDateString(
                          "en-GB",
                          {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          }
                        )}
                      </span>
                    </div>
                    <p className="text-sm">
                      {activity.type === "stage_change" ? (
                        <span>
                          Moved to{" "}
                          <span className="font-medium">
                            {getStageName(
                              activity.content.split("→").pop()?.trim() ||
                                activity.content
                            )}
                          </span>
                        </span>
                      ) : (
                        activity.content
                      )}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
