import { CleanupPanel } from "@/components/cleanup/cleanup-panel";

export default function CleanupPage() {
  return (
    <div className="p-6 lg:p-8 space-y-4 max-w-4xl">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Data Cleanup</h1>
        <p className="text-[13px] text-muted-foreground mt-0.5">
          Match legal entities, find missing websites, and clean your data
        </p>
      </div>
      <CleanupPanel />
    </div>
  );
}
