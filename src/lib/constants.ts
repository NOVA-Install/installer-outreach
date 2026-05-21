export const PIPELINE_STAGES = [
  { key: "uncontacted", label: "Uncontacted", color: "#9a9a9a" },
  { key: "target", label: "Target", color: "#60a5fa" },
  { key: "contacted", label: "Contacted", color: "#4ABDE8" },
  { key: "first_meeting", label: "First Meeting", color: "#e8b94a" },
  { key: "proposal", label: "Proposal", color: "#b8a4ed" },
  { key: "negotiation", label: "Negotiation", color: "#38bdf8" },
  { key: "won", label: "Won", color: "#22c55e" },
  { key: "lost", label: "Lost", color: "#f87171" },
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number]["key"];

export const ACTIVITY_TYPES = [
  { key: "note", label: "Note", icon: "MessageSquare" },
  { key: "call", label: "Call", icon: "Phone" },
  { key: "email", label: "Email", icon: "Mail" },
  { key: "meeting", label: "Meeting", icon: "Users" },
  { key: "stage_change", label: "Stage Change", icon: "ArrowRight" },
] as const;

export type ActivityType = (typeof ACTIVITY_TYPES)[number]["key"];
