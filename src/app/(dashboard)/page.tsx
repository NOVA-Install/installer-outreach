import { db } from "@/lib/db";
import {
  installers,
  installerScores,
  googleReviews,
  companiesHouseData,
  marketingSignals,
  trustpilotReviews,
  seoData,
} from "@/lib/db/schema";
import { count, avg, sql } from "drizzle-orm";
import { Building2, Globe, Mail, TrendingUp, Database, ArrowRight } from "lucide-react";
import { DashboardCharts } from "@/components/dashboard/dashboard-charts";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const [totalResult] = await db
    .select({ count: count() })
    .from(installers);

  const [withWebsite] = await db
    .select({ count: count() })
    .from(installers)
    .where(
      sql`${installers.website} IS NOT NULL AND ${installers.website} != ''`
    );

  const [withEmail] = await db
    .select({ count: count() })
    .from(installers)
    .where(
      sql`${installers.email} IS NOT NULL AND ${installers.email} != ''`
    );

  const [scored] = await db
    .select({
      count: count(),
      avgScore: avg(installerScores.overallScore),
    })
    .from(installerScores);

  const total = totalResult?.count ?? 0;

  const countyData = total > 0
    ? await db
        .select({
          county: installers.county,
          count: count(),
        })
        .from(installers)
        .where(
          sql`${installers.county} IS NOT NULL AND ${installers.county} != ''`
        )
        .groupBy(installers.county)
        .orderBy(sql`count(*) DESC`)
        .limit(15)
    : [];

  const tierData = total > 0
    ? await db
        .select({
          tier: installerScores.tier,
          count: count(),
        })
        .from(installerScores)
        .groupBy(installerScores.tier)
    : [];

  const [googleCount] = await db.select({ count: count() }).from(googleReviews);
  const [trustpilotCount] = await db.select({ count: count() }).from(trustpilotReviews);
  const [chCount] = await db.select({ count: count() }).from(companiesHouseData);
  const [marketingCount] = await db.select({ count: count() }).from(marketingSignals);
  const [seoCount] = await db.select({ count: count() }).from(seoData);

  const coverage = {
    "Google Reviews": googleCount?.count ?? 0,
    Trustpilot: trustpilotCount?.count ?? 0,
    "Companies House": chCount?.count ?? 0,
    "Tech Detection": marketingCount?.count ?? 0,
    SEO: seoCount?.count ?? 0,
  };

  const stats = [
    {
      label: "Total Installers",
      value: total.toLocaleString(),
      sub: null,
      icon: Building2,
    },
    {
      label: "With Website",
      value: (withWebsite?.count ?? 0).toLocaleString(),
      sub: total > 0 ? `${Math.round(((withWebsite?.count ?? 0) / total) * 100)}%` : null,
      icon: Globe,
    },
    {
      label: "With Email",
      value: (withEmail?.count ?? 0).toLocaleString(),
      sub: total > 0 ? `${Math.round(((withEmail?.count ?? 0) / total) * 100)}%` : null,
      icon: Mail,
    },
    {
      label: "Avg Score",
      value: scored?.avgScore ? Number(scored.avgScore).toFixed(1) : "—",
      sub: `${(scored?.count ?? 0).toLocaleString()} scored`,
      icon: TrendingUp,
    },
  ];

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[18px] font-semibold text-[#1D1D1D]">Dashboard</h1>
          <p className="text-[13px] text-[#9a9a9a] mt-0.5">
            Overview of your installer database
          </p>
        </div>
        <Link
          href="/installers"
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-[#1D1D1D] text-white text-[13px] font-medium hover:bg-[#2a2a2a] transition-colors"
        >
          View Installers
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      {/* Stat cards */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="bg-white rounded-xl border border-[#e5e5e5] px-4 py-4"
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-[12px] font-medium text-[#9a9a9a]">
                {stat.label}
              </span>
              <stat.icon className="h-4 w-4 text-[#d5d5d5]" />
            </div>
            <div className="text-[24px] font-semibold text-[#1D1D1D] leading-none">
              {stat.value}
            </div>
            {stat.sub && (
              <p className="text-[12px] text-[#9a9a9a] mt-1.5">
                {stat.sub}
              </p>
            )}
          </div>
        ))}
      </div>

      {total === 0 ? (
        <div className="bg-white rounded-xl border border-[#e5e5e5] flex flex-col items-center justify-center py-16">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#F5F4F3] mb-4">
            <Database className="h-7 w-7 text-[#9a9a9a]" />
          </div>
          <h3 className="text-[15px] font-semibold text-[#1D1D1D] mb-1">No data yet</h3>
          <p className="text-[13px] text-[#9a9a9a] text-center max-w-sm mb-5">
            Get started by importing your CSV of MCS-registered installers.
          </p>
          <Link
            href="/import"
            className="inline-flex h-9 items-center justify-center rounded-xl bg-[#1D1D1D] px-5 text-[13px] font-medium text-white hover:bg-[#2a2a2a] transition-colors"
          >
            Import Data
          </Link>
        </div>
      ) : (
        <DashboardCharts
          countyData={countyData.map((c) => ({
            name: c.county || "Unknown",
            count: c.count,
          }))}
          tierData={tierData.map((t) => ({
            name: t.tier || "Unscored",
            count: t.count,
          }))}
          coverage={coverage}
          total={total}
        />
      )}
    </div>
  );
}
