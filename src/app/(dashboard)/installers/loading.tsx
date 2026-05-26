import { Skeleton } from "@/components/ui/skeleton";

export default function InstallersLoading() {
  return (
    <div className="flex h-full flex-col">
      {/* Toolbar skeleton */}
      <div className="border-b border-[#ebebeb] bg-white px-4 py-2.5 flex items-center gap-3">
        <Skeleton className="h-8 w-[220px] rounded-lg" />
        <Skeleton className="h-8 w-[100px] rounded-lg" />
        <Skeleton className="h-8 w-[100px] rounded-lg" />
        <div className="ml-auto flex items-center gap-2">
          <Skeleton className="h-8 w-[80px] rounded-lg" />
        </div>
      </div>
      {/* Table skeleton */}
      <div className="flex-1 overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-[#ebebeb] bg-[#FAFAF9]">
              <th className="px-3 py-3"><Skeleton className="h-3.5 w-3.5 rounded" /></th>
              {Array.from({ length: 6 }).map((_, i) => (
                <th key={i} className="px-4 py-3"><Skeleton className="h-3.5 w-20 rounded" /></th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 20 }).map((_, i) => (
              <tr key={i} className="border-b border-[#f0f0f0]">
                <td className="px-3 py-4"><Skeleton className="h-3.5 w-3.5 rounded" /></td>
                {Array.from({ length: 6 }).map((_, j) => (
                  <td key={j} className="px-4 py-4"><Skeleton className="h-4 w-full rounded" /></td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
