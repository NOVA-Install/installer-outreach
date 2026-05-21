"use client";

import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface DashboardChartsProps {
  countyData: { name: string; count: number }[];
  tierData: { name: string; count: number }[];
  coverage: Record<string, number>;
  total: number;
}

const TIER_COLORS: Record<string, string> = {
  high: "#22c55e",
  medium: "#e8b94a",
  low: "#9a9a9a",
  Unscored: "#e5e5e5",
};

// Generate a gradient of orange shades for the county bars
function getBarColor(index: number, total: number): string {
  const opacity = 1 - (index / Math.max(total, 1)) * 0.6;
  return `rgba(251, 114, 50, ${opacity})`;
}

export function DashboardCharts({
  countyData,
  tierData,
  coverage,
  total,
}: DashboardChartsProps) {
  const maxCount = countyData.length > 0 ? Math.max(...countyData.map((c) => c.count)) : 1;

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {/* County Distribution - inline bar list */}
      <div className="md:col-span-2 bg-white rounded-xl border border-[#e5e5e5] p-5">
        <div className="flex items-center justify-between mb-4">
          <p className="text-[13px] font-medium text-[#6a6a6a]">
            Installers by County
          </p>
          <span className="text-[11px] text-[#9a9a9a]">Top {countyData.length}</span>
        </div>
        {countyData.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-[6px]">
            {countyData.map((item, i) => {
              const pct = (item.count / maxCount) * 100;
              return (
                <div key={item.name} className="flex items-center gap-3 group">
                  <span className="text-[11px] text-[#9a9a9a] w-4 text-right tabular-nums shrink-0">
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-[3px]">
                      <span className="text-[13px] text-[#1D1D1D] truncate">{item.name}</span>
                      <span className="text-[12px] text-[#6a6a6a] tabular-nums font-medium ml-2 shrink-0">
                        {item.count.toLocaleString()}
                      </span>
                    </div>
                    <div className="h-[5px] rounded-full bg-[#F5F4F3] overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${pct}%`,
                          backgroundColor: getBarColor(i, countyData.length),
                        }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-[13px] text-[#9a9a9a] py-8 text-center">
            No county data available
          </p>
        )}
      </div>

      {/* Tier Distribution */}
      <div className="bg-white rounded-xl border border-[#e5e5e5] p-5">
        <p className="text-[13px] font-medium text-[#6a6a6a] mb-3">
          Tier Distribution
        </p>
        {tierData.length > 0 ? (
          <div>
            <div className="flex items-center justify-center">
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={tierData}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={80}
                    dataKey="count"
                    nameKey="name"
                    strokeWidth={2}
                    stroke="#ffffff"
                  >
                    {tierData.map((entry) => (
                      <Cell
                        key={entry.name}
                        fill={TIER_COLORS[entry.name] || "#9a9a9a"}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      fontSize: 12,
                      borderRadius: 8,
                      border: "1px solid #e5e5e5",
                      boxShadow: "0 4px 12px rgba(0,0,0,0.06)",
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            {/* Legend */}
            <div className="flex items-center justify-center gap-4 mt-2">
              {tierData.map((entry) => (
                <div key={entry.name} className="flex items-center gap-1.5">
                  <div
                    className="h-[8px] w-[8px] rounded-full"
                    style={{ backgroundColor: TIER_COLORS[entry.name] || "#9a9a9a" }}
                  />
                  <span className="text-[12px] text-[#6a6a6a] capitalize">{entry.name}</span>
                  <span className="text-[12px] text-[#9a9a9a] tabular-nums">({entry.count})</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-[13px] text-[#9a9a9a] py-8 text-center">
            Run enrichment to see tier distribution
          </p>
        )}
      </div>

      {/* Enrichment Coverage */}
      <div className="bg-white rounded-xl border border-[#e5e5e5] p-5">
        <p className="text-[13px] font-medium text-[#6a6a6a] mb-3">
          Enrichment Coverage
        </p>
        <div className="space-y-3">
          {Object.entries(coverage).map(([label, val]) => {
            const pct = total > 0 ? Math.round((val / total) * 100) : 0;
            return (
              <div key={label} className="space-y-1.5">
                <div className="flex justify-between text-[13px]">
                  <span className="text-[#3a3a3a]">{label}</span>
                  <span className="text-[#9a9a9a] tabular-nums">
                    {val}/{total} ({pct}%)
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-[#ece9e5] overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${pct}%`,
                      backgroundColor: pct > 75 ? "#22c55e" : pct > 25 ? "#4ABDE8" : "#9a9a9a",
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
