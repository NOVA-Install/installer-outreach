import { db } from "@/lib/db";
import {
  installers,
  installerScores,
  googleReviews,
  companiesHouseData,
  marketingSignals,
  trustpilotReviews,
  seoData,
  activities,
} from "@/lib/db/schema";
import { count, avg, sql, eq, desc } from "drizzle-orm";
import { Building2, Globe, Mail, TrendingUp, Database, ArrowRight, Star, AlertCircle, UserCheck, Clock, Zap, Phone } from "lucide-react";
import Link from "next/link";
import { PIPELINE_STAGES } from "@/lib/constants";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  let data = {
    total: 0,
    withWebsite: 0,
    withEmail: 0,
    withPhone: 0,
    avgScore: null as string | null,
    scoredCount: 0,
    shortlistedCount: 0,
    pipelineCounts: {} as Record<string, number>,
    coverageGoogle: 0,
    coverageTrustpilot: 0,
    coverageCH: 0,
    coverageTech: 0,
    coverageSEO: 0,
    topProspects: [] as { id: number; companyName: string; overallScore: number | null; googleRating: number | null; googleReviewCount: number | null; county: string | null; website: string | null }[],
    readyToContact: 0,
    missingEmail: 0,
    staleCount: 0,
    recentActivity: [] as { id: number; installerId: number; type: string; content: string; createdAt: string; companyName: string }[],
  };

  try {
    const [totalR] = await db.select({ count: count() }).from(installers);
    data.total = totalR?.count ?? 0;

    if (data.total > 0) {
      const [ws] = await db.select({ count: count() }).from(installers).where(sql`${installers.website} IS NOT NULL AND ${installers.website} != ''`);
      data.withWebsite = ws?.count ?? 0;

      const [em] = await db.select({ count: count() }).from(installers).where(sql`${installers.email} IS NOT NULL AND ${installers.email} != ''`);
      data.withEmail = em?.count ?? 0;

      const [ph] = await db.select({ count: count() }).from(installers).where(sql`${installers.telephone} IS NOT NULL AND ${installers.telephone} != ''`);
      data.withPhone = ph?.count ?? 0;

      const [sc] = await db.select({ count: count(), avgScore: avg(installerScores.overallScore) }).from(installerScores);
      data.scoredCount = sc?.count ?? 0;
      data.avgScore = sc?.avgScore ?? null;

      const [sl] = await db.select({ count: count() }).from(installers).where(eq(installers.isShortlisted, true));
      data.shortlistedCount = sl?.count ?? 0;

      // Pipeline counts
      const pipelineRows = await db.select({ stage: installers.pipelineStage, count: count() }).from(installers).groupBy(installers.pipelineStage);
      for (const r of pipelineRows) { data.pipelineCounts[r.stage || "uncontacted"] = r.count; }

      // Coverage
      const [gc] = await db.select({ count: count() }).from(googleReviews);
      data.coverageGoogle = gc?.count ?? 0;
      const [tc] = await db.select({ count: count() }).from(trustpilotReviews);
      data.coverageTrustpilot = tc?.count ?? 0;
      const [cc] = await db.select({ count: count() }).from(companiesHouseData);
      data.coverageCH = cc?.count ?? 0;
      const [mc] = await db.select({ count: count() }).from(marketingSignals);
      data.coverageTech = mc?.count ?? 0;
      const [sec] = await db.select({ count: count() }).from(seoData);
      data.coverageSEO = sec?.count ?? 0;

      // Top uncontacted prospects (high score, not yet contacted)
      data.topProspects = await db
        .select({
          id: installers.id,
          companyName: installers.companyName,
          overallScore: installerScores.overallScore,
          googleRating: googleReviews.rating,
          googleReviewCount: googleReviews.reviewCount,
          county: installers.county,
          website: installers.website,
        })
        .from(installers)
        .leftJoin(installerScores, eq(installers.id, installerScores.installerId))
        .leftJoin(googleReviews, eq(installers.id, googleReviews.installerId))
        .where(sql`${installers.pipelineStage} = 'uncontacted' AND ${installerScores.overallScore} IS NOT NULL`)
        .orderBy(sql`${installerScores.overallScore} DESC NULLS LAST`)
        .limit(8);

      // Ready to contact: has email + uncontacted
      const [rtc] = await db.select({ count: count() }).from(installers)
        .where(sql`${installers.pipelineStage} = 'uncontacted' AND ${installers.email} IS NOT NULL AND ${installers.email} != ''`);
      data.readyToContact = rtc?.count ?? 0;

      // Missing email but has high score
      const [me] = await db.select({ count: count() }).from(installers)
        .leftJoin(installerScores, eq(installers.id, installerScores.installerId))
        .where(sql`(${installers.email} IS NULL OR ${installers.email} = '') AND ${installerScores.overallScore} >= 50`);
      data.missingEmail = me?.count ?? 0;

      // Recent activity
      const recentActs = await db
        .select({
          id: activities.id,
          installerId: activities.installerId,
          type: activities.type,
          content: activities.content,
          createdAt: activities.createdAt,
          companyName: installers.companyName,
        })
        .from(activities)
        .innerJoin(installers, eq(activities.installerId, installers.id))
        .orderBy(desc(activities.createdAt))
        .limit(8);
      data.recentActivity = recentActs;
    }
  } catch (err) {
    console.error("Dashboard query error:", err);
  }

  const pct = (n: number) => data.total > 0 ? Math.round((n / data.total) * 100) : 0;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[18px] font-semibold text-[#1D1D1D]">Dashboard</h1>
          <p className="text-[13px] text-[#9a9a9a] mt-0.5">{data.total.toLocaleString()} installers tracked</p>
        </div>
        <div className="flex gap-2">
          <Link href="/installers?isShortlisted=true" className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-[#e5e5e5] bg-white text-[13px] font-medium text-[#3a3a3a] hover:border-[#4ABDE8] hover:text-[#4ABDE8] transition-colors">
            <Star className="h-3.5 w-3.5" /> Shortlist ({data.shortlistedCount})
          </Link>
          <Link href="/installers" className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-[#0f1d2a] text-white text-[13px] font-medium hover:bg-[#1a3040] transition-colors">
            View All <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>

      {data.total === 0 ? (
        <div className="bg-white rounded-xl border border-[#e5e5e5] flex flex-col items-center justify-center py-16">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#F5F4F3] mb-4">
            <Database className="h-7 w-7 text-[#9a9a9a]" />
          </div>
          <h3 className="text-[15px] font-semibold text-[#1D1D1D] mb-1">No data yet</h3>
          <p className="text-[13px] text-[#9a9a9a] text-center max-w-sm mb-5">Get started by importing your CSV of MCS-registered installers.</p>
          <Link href="/import" className="inline-flex h-9 items-center justify-center rounded-xl bg-[#0f1d2a] px-5 text-[13px] font-medium text-white hover:bg-[#1a3040] transition-colors">Import Data</Link>
        </div>
      ) : (
        <>
          {/* ── Pipeline Funnel ── */}
          <div className="bg-white rounded-xl border border-[#e5e5e5] p-5">
            <p className="text-[11px] font-semibold text-[#9a9a9a] uppercase tracking-wider mb-3">Pipeline</p>
            <div className="flex gap-1">
              {PIPELINE_STAGES.map((s) => {
                const c = data.pipelineCounts[s.key] || 0;
                const w = data.total > 0 ? Math.max(8, (c / data.total) * 100) : 8;
                return (
                  <Link key={s.key} href={`/installers?stage=${s.key}`} className="group flex-1 min-w-0" style={{ flex: `${w} 1 0%` }}>
                    <div className="h-[6px] rounded-full mb-1.5 transition-opacity group-hover:opacity-80" style={{ backgroundColor: s.color }} />
                    <p className="text-[12px] font-medium text-[#1D1D1D] tabular-nums">{c.toLocaleString()}</p>
                    <p className="text-[10px] text-[#9a9a9a] truncate">{s.label}</p>
                  </Link>
                );
              })}
            </div>
          </div>

          {/* ── Action Items + Stats ── */}
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
            <Link href="/installers?stage=uncontacted&hasEmail=true" className="bg-white rounded-xl border border-[#e5e5e5] p-4 hover:border-[#4ABDE8] hover:shadow-sm transition-all group">
              <div className="flex items-center gap-2 mb-2">
                <Zap className="h-4 w-4 text-[#4ABDE8]" />
                <span className="text-[11px] font-medium text-[#9a9a9a] uppercase tracking-wider">Ready to Contact</span>
              </div>
              <p className="text-[24px] font-semibold text-[#1D1D1D] leading-none">{data.readyToContact.toLocaleString()}</p>
              <p className="text-[11px] text-[#9a9a9a] mt-1">Have email, still uncontacted</p>
            </Link>

            <Link href="/installers?isShortlisted=true" className="bg-white rounded-xl border border-[#e5e5e5] p-4 hover:border-[#4ABDE8] hover:shadow-sm transition-all">
              <div className="flex items-center gap-2 mb-2">
                <Star className="h-4 w-4 text-[#e8b94a]" />
                <span className="text-[11px] font-medium text-[#9a9a9a] uppercase tracking-wider">Shortlisted</span>
              </div>
              <p className="text-[24px] font-semibold text-[#1D1D1D] leading-none">{data.shortlistedCount}</p>
              <p className="text-[11px] text-[#9a9a9a] mt-1">In-target installers</p>
            </Link>

            <Link href="/installers?hasEmail=false" className="bg-white rounded-xl border border-[#e5e5e5] p-4 hover:border-[#4ABDE8] hover:shadow-sm transition-all">
              <div className="flex items-center gap-2 mb-2">
                <AlertCircle className="h-4 w-4 text-[#FB7232]" />
                <span className="text-[11px] font-medium text-[#9a9a9a] uppercase tracking-wider">Missing Email</span>
              </div>
              <p className="text-[24px] font-semibold text-[#1D1D1D] leading-none">{data.missingEmail}</p>
              <p className="text-[11px] text-[#9a9a9a] mt-1">High-score but no email</p>
            </Link>

            <div className="bg-white rounded-xl border border-[#e5e5e5] p-4">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="h-4 w-4 text-[#22c55e]" />
                <span className="text-[11px] font-medium text-[#9a9a9a] uppercase tracking-wider">Avg Score</span>
              </div>
              <p className="text-[24px] font-semibold text-[#1D1D1D] leading-none">{data.avgScore ? Number(data.avgScore).toFixed(1) : "—"}</p>
              <p className="text-[11px] text-[#9a9a9a] mt-1">{data.scoredCount.toLocaleString()} scored</p>
            </div>
          </div>

          {/* ── Top Prospects + Recent Activity ── */}
          <div className="grid gap-3 lg:grid-cols-2">
            {/* Top Prospects */}
            <div className="bg-white rounded-xl border border-[#e5e5e5] p-5">
              <div className="flex items-center justify-between mb-3">
                <p className="text-[11px] font-semibold text-[#9a9a9a] uppercase tracking-wider">Top Uncontacted Prospects</p>
                <Link href="/installers?stage=uncontacted&sortBy=overallScore&sortOrder=desc" className="text-[11px] text-[#4ABDE8] hover:underline">View all</Link>
              </div>
              {data.topProspects.length > 0 ? (
                <div className="space-y-0">
                  {data.topProspects.map((p, i) => (
                    <Link key={p.id} href={`/installers/${p.id}`} className={`flex items-center gap-3 py-2.5 hover:bg-[#FAFAF9] -mx-2 px-2 rounded-lg transition-colors ${i > 0 ? "border-t border-[#f0f0f0]" : ""}`}>
                      <span className="text-[11px] text-[#9a9a9a] w-4 text-right tabular-nums shrink-0">{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-medium text-[#1D1D1D] truncate">{p.companyName}</p>
                        <p className="text-[11px] text-[#9a9a9a]">
                          {p.county || "Unknown"}
                          {p.googleRating != null && ` · ${p.googleRating.toFixed(1)}★ (${p.googleReviewCount})`}
                        </p>
                      </div>
                      {p.overallScore != null && (
                        <span className="text-[13px] font-semibold tabular-nums text-[#1D1D1D]">{p.overallScore.toFixed(0)}</span>
                      )}
                    </Link>
                  ))}
                </div>
              ) : (
                <p className="text-[13px] text-[#9a9a9a] py-4 text-center">Run enrichment and score calculation first</p>
              )}
            </div>

            {/* Recent Activity */}
            <div className="bg-white rounded-xl border border-[#e5e5e5] p-5">
              <p className="text-[11px] font-semibold text-[#9a9a9a] uppercase tracking-wider mb-3">Recent Activity</p>
              {data.recentActivity.length > 0 ? (
                <div className="space-y-0">
                  {data.recentActivity.map((a, i) => (
                    <Link key={a.id} href={`/installers/${a.installerId}`} className={`block py-2.5 hover:bg-[#FAFAF9] -mx-2 px-2 rounded-lg transition-colors ${i > 0 ? "border-t border-[#f0f0f0]" : ""}`}>
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] font-medium text-[#1D1D1D]">{a.companyName}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#ece9e5] text-[#6a6a6a] font-medium capitalize">{a.type}</span>
                      </div>
                      <p className="text-[12px] text-[#6a6a6a] truncate mt-0.5">{a.content}</p>
                      <p className="text-[10px] text-[#9a9a9a] mt-0.5">{new Date(a.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</p>
                    </Link>
                  ))}
                </div>
              ) : (
                <p className="text-[13px] text-[#9a9a9a] py-4 text-center">No activity logged yet</p>
              )}
            </div>
          </div>

          {/* ── Data Completeness ── */}
          <div className="bg-white rounded-xl border border-[#e5e5e5] p-5">
            <p className="text-[11px] font-semibold text-[#9a9a9a] uppercase tracking-wider mb-3">Data Completeness</p>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
              {[
                { label: "Website", count: data.withWebsite, icon: Globe },
                { label: "Email", count: data.withEmail, icon: Mail },
                { label: "Phone", count: data.withPhone, icon: Phone },
                { label: "Google", count: data.coverageGoogle, icon: Star },
                { label: "Trustpilot", count: data.coverageTrustpilot, icon: Star },
                { label: "Companies House", count: data.coverageCH, icon: Building2 },
                { label: "Tech / Marketing", count: data.coverageTech, icon: TrendingUp },
              ].map((item) => {
                const p = pct(item.count);
                const color = p >= 75 ? "#22c55e" : p >= 40 ? "#4ABDE8" : p >= 10 ? "#e8b94a" : "#d5d5d5";
                return (
                  <div key={item.label} className="text-center">
                    <div className="relative h-12 w-12 mx-auto mb-1.5">
                      <svg className="h-12 w-12 -rotate-90" viewBox="0 0 36 36">
                        <circle cx="18" cy="18" r="15.5" fill="none" stroke="#f0f0f0" strokeWidth="3" />
                        <circle cx="18" cy="18" r="15.5" fill="none" stroke={color} strokeWidth="3" strokeDasharray={`${p} ${100 - p}`} strokeLinecap="round" />
                      </svg>
                      <span className="absolute inset-0 flex items-center justify-center text-[11px] font-semibold tabular-nums text-[#1D1D1D]">{p}%</span>
                    </div>
                    <p className="text-[11px] text-[#6a6a6a]">{item.label}</p>
                    <p className="text-[10px] text-[#9a9a9a] tabular-nums">{item.count.toLocaleString()}/{data.total.toLocaleString()}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
