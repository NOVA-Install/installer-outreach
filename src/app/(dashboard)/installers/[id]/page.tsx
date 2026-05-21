import { notFound } from "next/navigation";
import { getSicDescription } from "@/lib/sic-codes";
import { db } from "@/lib/db";
import {
  installers,
  installerScores,
  googleReviews,
  trustpilotReviews,
  companiesHouseData,
  marketingSignals,
  seoData,
  activities,
  reviewItems,
  trafficData,
  keywordData,
  googleBusinessInfo,
  googleAdsData,
  jobPostings,
} from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { Badge } from "@/components/ui/badge";
import {
  Building2,
  Mail,
  Phone,
  Globe,
  MapPin,
  Star,
  Shield,
  ExternalLink,
  TrendingUp,
  CheckCircle2,
  XCircle,
  ArrowLeft,
  Clock,
  Briefcase,
  Users,
  Search as SearchIcon,
} from "lucide-react";
import Link from "next/link";
import { PipelineStageSelector } from "@/components/installers/pipeline-stage";
import { MultiSourceField } from "@/components/installers/multi-source-field";
import { ActivityTimeline } from "@/components/installers/activity-timeline";
import { ReviewDetails } from "@/components/installers/review-details";
import { InstallerActionsMenu } from "@/components/installers/installer-actions-menu";
import { CorrectEnrichment } from "@/components/installers/correct-enrichment";

const tierStyles: Record<string, string> = {
  high: "bg-green-50 text-green-700 border-green-200",
  medium: "bg-orange-50 text-orange-700 border-orange-200",
  low: "bg-gray-50 text-gray-500 border-gray-200",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-2.5 mb-3">
        <div className="w-[3px] h-4 rounded-full bg-primary" />
        <h2 className="text-[13px] font-semibold text-[#1D1D1D] uppercase tracking-wider">{title}</h2>
      </div>
      {children}
    </div>
  );
}

function InfoCard({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-white rounded-xl border border-[#e5e5e5] p-4 hover:shadow-[0_2px_12px_rgba(0,0,0,0.04)] transition-shadow ${className || ""}`}>
      {children}
    </div>
  );
}

function Field({ label, value, mono, link }: { label: string; value: string | number | null | undefined; mono?: boolean; link?: string }) {
  if (value == null || value === "") return null;
  const display = <span className={`text-[13px] text-[#1D1D1D] ${mono ? "font-mono text-[12px]" : ""}`}>{value}</span>;
  return (
    <div>
      <p className="text-[11px] text-[#9a9a9a] uppercase tracking-wider mb-0.5">{label}</p>
      {link ? <a href={link} target="_blank" rel="noopener noreferrer" className="text-[13px] text-primary hover:underline inline-flex items-center gap-1">{value} <ExternalLink className="h-3 w-3" /></a> : display}
    </div>
  );
}

function ScoreBar({ label, value, max = 100 }: { label: string; value: number | null | undefined; max?: number }) {
  if (value == null) return null;
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  const color = pct >= 70 ? "#22c55e" : pct >= 40 ? "#4ABDE8" : "#9a9a9a";
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[13px]">
        <span className="text-[#6a6a6a]">{label}</span>
        <span className="font-medium tabular-nums">{value.toFixed(0)}</span>
      </div>
      <div className="h-[5px] rounded-full bg-[#f0f0f0] overflow-hidden">
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

function StatPill({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 bg-white rounded-lg border border-[#e5e5e5] px-3 py-2">
      <span className="text-[#9a9a9a]">{icon}</span>
      <div>
        <p className="text-[14px] font-semibold text-[#1D1D1D] leading-none tabular-nums">{value}</p>
        <p className="text-[10px] text-[#9a9a9a] uppercase tracking-wider mt-0.5">{label}</p>
      </div>
    </div>
  );
}

function Signal({ label, active, detail }: { label: string; active: boolean | null; detail?: string }) {
  return (
    <div className="flex items-center gap-2">
      {active ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600" /> : <XCircle className="h-3.5 w-3.5 text-[#d5d5d5]" />}
      <span className="text-[13px] text-[#3a3a3a]">
        {label}
        {detail && <span className="text-[#9a9a9a] ml-1">({detail})</span>}
      </span>
    </div>
  );
}

export default async function InstallerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const installerId = parseInt(id, 10);
  if (isNaN(installerId)) notFound();

  const [installer] = await db.select().from(installers).where(eq(installers.id, installerId)).limit(1);
  if (!installer) notFound();

  const [scores, google, trustpilot, companiesHouse, marketing, seo, traffic, keywords, gBusiness, gAds, jobs, googleReviewItems, trustpilotReviewItems, activityList] =
    await Promise.all([
      db.select().from(installerScores).where(eq(installerScores.installerId, installerId)).limit(1),
      db.select().from(googleReviews).where(eq(googleReviews.installerId, installerId)).limit(1),
      db.select().from(trustpilotReviews).where(eq(trustpilotReviews.installerId, installerId)).limit(1),
      db.select().from(companiesHouseData).where(eq(companiesHouseData.installerId, installerId)).limit(1),
      db.select().from(marketingSignals).where(eq(marketingSignals.installerId, installerId)).limit(1),
      db.select().from(seoData).where(eq(seoData.installerId, installerId)).limit(1),
      db.select().from(trafficData).where(eq(trafficData.installerId, installerId)).limit(1),
      db.select().from(keywordData).where(eq(keywordData.installerId, installerId)).orderBy(sql`${keywordData.searchVolume} DESC`).limit(50),
      db.select().from(googleBusinessInfo).where(eq(googleBusinessInfo.installerId, installerId)).limit(1),
      db.select().from(googleAdsData).where(eq(googleAdsData.installerId, installerId)).limit(1),
      db.select().from(jobPostings).where(eq(jobPostings.installerId, installerId)).limit(1),
      db.select().from(reviewItems).where(sql`${reviewItems.installerId} = ${installerId} AND ${reviewItems.source} = 'google'`).orderBy(sql`${reviewItems.reviewDate} DESC`),
      db.select().from(reviewItems).where(sql`${reviewItems.installerId} = ${installerId} AND ${reviewItems.source} = 'trustpilot'`).orderBy(sql`${reviewItems.reviewDate} DESC`),
      db.select().from(activities).where(eq(activities.installerId, installerId)).orderBy(sql`${activities.createdAt} DESC`),
    ]);

  const score = scores[0] ?? null;
  const gReview = google[0] ?? null;
  const tpReview = trustpilot[0] ?? null;
  const chData = companiesHouse[0] ?? null;
  const mktSignals = marketing[0] ?? null;
  const seoInfo = seo[0] ?? null;
  const trafficInfo = traffic[0] ?? null;
  const businessInfo = gBusiness[0] ?? null;
  const adsData = gAds[0] ?? null;
  const jobData = jobs[0] ?? null;

  const technologies = installer.technologiesCertified?.split(/[,;]/).map((t) => t.trim()).filter(Boolean) || [];
  const regions = installer.regionsCovered?.split(/[,;]/).map((r) => r.trim()).filter(Boolean) || [];

  const domain = installer.website
    ? (() => { try { const u = installer.website.startsWith("http") ? installer.website : `https://${installer.website}`; return new URL(u).hostname.replace(/^www\./, ""); } catch { return null; } })()
    : null;

  return (
    <div className="flex flex-col h-full">
      {/* Top bar */}
      <div className="flex items-center gap-2 border-b border-[#e5e5e5] bg-white px-6 py-2 shrink-0">
        <Link href="/installers" className="inline-flex items-center gap-1.5 text-[13px] text-[#9a9a9a] hover:text-[#1D1D1D] transition-colors">
          <ArrowLeft className="h-3.5 w-3.5" />
          Installers
        </Link>
        <div className="h-4 w-px bg-[#e5e5e5] mx-1" />
        <span className="text-[13px] text-[#1D1D1D] font-medium truncate">{installer.companyName}</span>
        <div className="ml-auto">
          <InstallerActionsMenu installerId={installerId} installerName={installer.companyName} hasGoogleReviews={gReview !== null} hasTrustpilotProfile={tpReview !== null} />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Header */}
        <div className="bg-gradient-to-b from-white to-[#FAFAF9] border-b border-[#e5e5e5] px-6 py-5">
          <div className="flex items-start gap-5">
            {domain ? (
              <img src={`https://www.google.com/s2/favicons?domain=${domain}&sz=128`} alt="" className="max-h-14 max-w-[120px] rounded-xl bg-white object-contain shrink-0 shadow-[0_2px_8px_rgba(0,0,0,0.08)] border border-[#f0f0f0] p-1.5" />
            ) : (
              <div className="h-14 w-14 rounded-xl bg-[#ece9e5] flex items-center justify-center shrink-0">
                <span className="text-[20px] font-bold text-[#9a9a9a]">{installer.companyName[0]}</span>
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-[20px] font-semibold text-[#1D1D1D] tracking-tight">{installer.companyName}</h1>
                {score?.tier && <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium capitalize border ${tierStyles[score.tier] || ""}`}>{score.tier}</span>}
                {installer.inMcs && <img src="/mcs-certified.png" alt="MCS" title="MCS Certified" className="h-[32px] object-contain shrink-0" />}
                {installer.inTrustMark && <img src="/logo-trustmark.jpg" alt="TrustMark" title="TrustMark Certified" className="h-[32px] object-contain shrink-0" />}
              </div>
              {installer.alternativeNames && (
                <p className="text-[12px] text-[#9a9a9a] mt-0.5">Also known as: {installer.alternativeNames}</p>
              )}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1.5 text-[13px] text-[#6a6a6a]">
                {(installer.address || installer.postcode) && (
                  <span className="flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5 text-[#9a9a9a]" />{[installer.address, installer.postcode, installer.county].filter(Boolean).join(", ")}</span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-3 mt-2.5">
                {installer.email && (
                  <a href={`mailto:${installer.email}`} className="inline-flex items-center gap-1.5 h-[28px] px-3 rounded-lg bg-[#FAFAF9] border border-[#e5e5e5] text-[12px] text-[#3a3a3a] hover:border-primary hover:text-primary transition-colors">
                    <Mail className="h-3.5 w-3.5" />{installer.email}
                  </a>
                )}
                {installer.telephone && (
                  <a href={`tel:${installer.telephone}`} className="inline-flex items-center gap-1.5 h-[28px] px-3 rounded-lg bg-[#FAFAF9] border border-[#e5e5e5] text-[12px] text-[#3a3a3a] hover:border-primary hover:text-primary transition-colors">
                    <Phone className="h-3.5 w-3.5" />{installer.telephone}
                  </a>
                )}
                {installer.website && (
                  <a href={installer.website.startsWith("http") ? installer.website : `https://${installer.website}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 h-[28px] px-3 rounded-lg bg-[#FAFAF9] border border-[#e5e5e5] text-[12px] text-[#3a3a3a] hover:border-primary hover:text-primary transition-colors">
                    <Globe className="h-3.5 w-3.5" />{domain || "Website"}<ExternalLink className="h-3 w-3 text-[#9a9a9a]" />
                  </a>
                )}
              </div>
            </div>
            {score?.overallScore != null && (
              <div className="text-center shrink-0 bg-[#FAFAF9] rounded-xl px-5 py-3 border border-[#e5e5e5]">
                <div className="text-[28px] font-semibold tabular-nums tracking-tight text-[#1D1D1D] leading-none">{score.overallScore.toFixed(0)}</div>
                <div className="text-[10px] text-[#9a9a9a] uppercase tracking-wider mt-1 font-medium">Score</div>
              </div>
            )}
          </div>
          <div className="mt-4 pt-4 border-t border-[#f0f0f0]">
            <PipelineStageSelector installerId={installerId} currentStage={installer.pipelineStage} />
          </div>
        </div>

        {/* Quick stats bar */}
        <div className="border-b border-[#e5e5e5] bg-[#FAFAF9] px-6 py-3">
          <div className="flex flex-wrap gap-3">
            {gReview?.rating != null && (
              <StatPill label="Google Rating" value={`${gReview.rating.toFixed(1)} (${gReview.reviewCount || 0})`} icon={<Star className="h-3.5 w-3.5 fill-[#e8b94a] text-[#e8b94a]" />} />
            )}
            {tpReview?.rating != null && (
              <StatPill label="Trustpilot" value={`${tpReview.rating.toFixed(1)} (${tpReview.reviewCount || 0})`} icon={<Star className="h-3.5 w-3.5 fill-[#00b67a] text-[#00b67a]" />} />
            )}
            {score?.overallScore != null && (
              <StatPill label="Overall Score" value={score.overallScore.toFixed(0)} icon={<TrendingUp className="h-3.5 w-3.5" />} />
            )}
            {chData?.employeeCount != null && (
              <StatPill label="Employees" value={chData.employeeCount.toLocaleString()} icon={<Users className="h-3.5 w-3.5" />} />
            )}
            {mktSignals && (
              <StatPill
                label="Marketing Signals"
                value={`${[mktSignals.hasGoogleAnalytics, mktSignals.hasGoogleAds, mktSignals.hasMetaPixel, mktSignals.hasMetaAds, mktSignals.hasCrmTool, mktSignals.hasLiveChat].filter(Boolean).length}/6`}
                icon={<TrendingUp className="h-3.5 w-3.5" />}
              />
            )}
            {jobData?.isHiring && (
              <StatPill label="Status" value="Hiring" icon={<Briefcase className="h-3.5 w-3.5" />} />
            )}
          </div>
        </div>

        {/* All content - single scrollable page */}
        <div className="px-6 py-6 space-y-8 max-w-[1200px]">

          {/* ── Scores & Certification ── */}
          <Section title="Scores & Certification">
            <div className="grid gap-3 md:grid-cols-3">
              {score && (
                <InfoCard>
                  <p className="text-[11px] text-[#9a9a9a] uppercase tracking-wider mb-3">Scores</p>
                  <div className="space-y-3">
                    <ScoreBar label="Reputation" value={score.reputationScore} />
                    <ScoreBar label="Est. Monthly Installs" value={score.estimatedMonthlyInstalls} max={50} />
                    <ScoreBar label="Marketing Activity" value={score.marketingActivityScore} />
                    <div className="border-t border-[#f0f0f0] pt-3 mt-1">
                      <ScoreBar label="Overall Score" value={score.overallScore} />
                    </div>
                  </div>
                </InfoCard>
              )}
              <InfoCard>
                <p className="text-[11px] text-[#9a9a9a] uppercase tracking-wider mb-2">Certification</p>
                <div className="space-y-1.5 text-[13px]">
                  <div className="flex items-center gap-2"><Shield className="h-3.5 w-3.5 text-[#9a9a9a]" /><span>{installer.certificationNumber || "N/A"} ({installer.certificationBody || "N/A"})</span></div>
                  {installer.boilerUpgradeScheme && <div><span className="text-[#9a9a9a]">BUS: </span>{installer.boilerUpgradeScheme}</div>}
                  {installer.installerId && <div><span className="text-[#9a9a9a]">Installer ID: </span><span className="font-mono text-[12px]">{installer.installerId}</span></div>}
                </div>
              </InfoCard>
              <InfoCard>
                <p className="text-[11px] text-[#9a9a9a] uppercase tracking-wider mb-2">Record Info</p>
                <div className="space-y-1.5 text-[13px]">
                  <div><span className="text-[#9a9a9a]">Sources: </span>{[installer.inMcs && "MCS", installer.inNova && "Nova", installer.inTrustMark && "TrustMark"].filter(Boolean).join(", ") || "—"} ({installer.sourceCount || 0})</div>
                  {installer.createdAt && <div><span className="text-[#9a9a9a]">Added: </span>{new Date(installer.createdAt).toLocaleDateString("en-GB")}</div>}
                  {installer.updatedAt && <div><span className="text-[#9a9a9a]">Updated: </span>{new Date(installer.updatedAt).toLocaleDateString("en-GB")}</div>}
                  {installer.websiteStatus && <div><span className="text-[#9a9a9a]">Website status: </span>{installer.websiteStatus}</div>}
                </div>
              </InfoCard>
            </div>
            {technologies.length > 0 && (
              <div className="mt-3">
                <p className="text-[11px] text-[#9a9a9a] uppercase tracking-wider mb-1.5">Technologies Certified</p>
                <div className="flex flex-wrap gap-1.5">{technologies.map((t) => <Badge key={t} variant="outline" className="text-[11px]">{t}</Badge>)}</div>
              </div>
            )}
            {regions.length > 0 && (
              <div className="mt-3">
                <p className="text-[11px] text-[#9a9a9a] uppercase tracking-wider mb-1.5">Regions Covered</p>
                <div className="flex flex-wrap gap-1.5">{regions.map((r) => <Badge key={r} variant="outline" className="text-[11px]">{r}</Badge>)}</div>
              </div>
            )}
          </Section>

          {/* ── Data Sources ── */}
          {(installer.websiteSources || installer.emailSources || installer.telephoneSources) && (
            <Section title="Data Sources">
              <InfoCard>
                <div className="space-y-3">
                  <MultiSourceField label="Website" primaryValue={installer.website} sources={installer.websiteSources} installerId={installerId} field="website" />
                  <MultiSourceField label="Email" primaryValue={installer.email} sources={installer.emailSources} installerId={installerId} field="email" />
                  <MultiSourceField label="Telephone" primaryValue={installer.telephone} sources={installer.telephoneSources} installerId={installerId} field="telephone" />
                  <MultiSourceField label="Address" primaryValue={installer.address} sources={installer.addressSources} installerId={installerId} field="address" />
                </div>
              </InfoCard>
            </Section>
          )}

          {/* ── Reviews ── */}
          <Section title="Reviews">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="bg-white rounded-xl border border-[#e5e5e5] p-4 hover:shadow-[0_2px_12px_rgba(0,0,0,0.04)] transition-shadow border-l-[3px] border-l-[#e8b94a]">
                <div className="flex items-center gap-2 mb-2">
                  <Star className="h-4 w-4 fill-[#e8b94a] text-[#e8b94a]" />
                  <p className="text-[13px] font-medium text-[#3a3a3a]">Google Reviews</p>
                </div>
                {gReview ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[24px] font-semibold tabular-nums">{gReview.rating?.toFixed(1)}</span>
                      <div className="flex">{Array.from({ length: 5 }).map((_, i) => <Star key={i} className={`h-4 w-4 ${i < Math.round(gReview.rating || 0) ? "fill-[#e8b94a] text-[#e8b94a]" : "text-[#e5e5e5]"}`} />)}</div>
                    </div>
                    <p className="text-[13px] text-[#6a6a6a]">{gReview.reviewCount} reviews{gReview.reviewsPerMonth != null && ` (~${gReview.reviewsPerMonth.toFixed(1)}/month)`}</p>
                    {gReview.businessStatus && <p className="text-[12px] text-[#9a9a9a]">Status: {gReview.businessStatus}</p>}
                    <div className="flex flex-wrap gap-2 pt-2 border-t border-[#f0f0f0]">
                      {gReview.placeId && <a href={`https://search.google.com/local/reviews?placeid=${gReview.placeId}`} target="_blank" rel="noopener noreferrer" className="text-[11px] text-primary hover:underline inline-flex items-center gap-1">Verify on Google Maps <ExternalLink className="h-3 w-3" /></a>}
                    </div>
                    <CorrectEnrichment installerId={installerId} source="google" currentValue={gReview.placeId ? `Place ID: ${gReview.placeId}` : null} label="Google Reviews" placeholder="Search query or place ID" helpText="Clears current data so enrichment can re-fetch" />
                  </div>
                ) : <p className="text-[13px] text-[#9a9a9a]">No Google review data yet</p>}
              </div>

              <div className="bg-white rounded-xl border border-[#e5e5e5] p-4 hover:shadow-[0_2px_12px_rgba(0,0,0,0.04)] transition-shadow border-l-[3px] border-l-[#00b67a]">
                <div className="flex items-center gap-2 mb-2">
                  <Star className="h-4 w-4 fill-[#00b67a] text-[#00b67a]" />
                  <p className="text-[13px] font-medium text-[#3a3a3a]">Trustpilot</p>
                </div>
                {tpReview ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[24px] font-semibold tabular-nums">{tpReview.rating?.toFixed(1)}</span>
                      <div className="flex">{Array.from({ length: 5 }).map((_, i) => <Star key={i} className={`h-4 w-4 ${i < Math.round(tpReview.rating || 0) ? "fill-[#00b67a] text-[#00b67a]" : "text-[#e5e5e5]"}`} />)}</div>
                    </div>
                    <p className="text-[13px] text-[#6a6a6a]">{tpReview.reviewCount} reviews</p>
                    {tpReview.trustScore != null && <p className="text-[12px] text-[#9a9a9a]">Trust Score: {tpReview.trustScore}</p>}
                    {tpReview.trustpilotUrl && <a href={tpReview.trustpilotUrl} target="_blank" rel="noopener noreferrer" className="text-[11px] text-primary hover:underline inline-flex items-center gap-1">View on Trustpilot <ExternalLink className="h-3 w-3" /></a>}
                    <CorrectEnrichment installerId={installerId} source="trustpilot" currentValue={tpReview.trustpilotUrl} label="Trustpilot" placeholder="e.g. 247staywarm.co.uk" helpText="Enter domain or URL — scrapes actual rating" />
                  </div>
                ) : <p className="text-[13px] text-[#9a9a9a]">No Trustpilot data yet</p>}
              </div>
            </div>
            {/* Individual reviews */}
            <div className="mt-3 space-y-3">
              <ReviewDetails source="Google" reviews={googleReviewItems} icon={<Star className="h-3.5 w-3.5 text-[#e8b94a]" />} />
              <ReviewDetails source="Trustpilot" reviews={trustpilotReviewItems} icon={<Star className="h-3.5 w-3.5 text-[#00b67a]" />} />
            </div>
          </Section>

          {/* ── Google Business Profile ── */}
          {businessInfo && (
            <Section title="Google Business Profile">
              <InfoCard>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <Field label="Business Name" value={businessInfo.title} />
                  <Field label="Phone" value={businessInfo.phone} />
                  <Field label="Category" value={businessInfo.mainCategory} />
                  <Field label="Address" value={[businessInfo.address, businessInfo.city, businessInfo.postalCode].filter(Boolean).join(", ")} />
                  <Field label="Status" value={businessInfo.currentStatus} />
                  <Field label="Claimed" value={businessInfo.isClaimed ? "Yes" : "No"} />
                  <Field label="Photos" value={businessInfo.totalPhotos} />
                  <Field label="Price Level" value={businessInfo.priceLevel} />
                  {businessInfo.additionalCategories && <Field label="Other Categories" value={JSON.parse(businessInfo.additionalCategories).join(", ")} />}
                </div>
                {businessInfo.workHours && (
                  <div className="mt-3 pt-3 border-t border-[#f0f0f0]">
                    <p className="text-[11px] text-[#9a9a9a] uppercase tracking-wider mb-1">Work Hours</p>
                    <p className="text-[12px] text-[#6a6a6a] whitespace-pre-line">{(() => { try { return JSON.parse(businessInfo.workHours).join("\n"); } catch { return businessInfo.workHours; } })()}</p>
                  </div>
                )}
              </InfoCard>
            </Section>
          )}

          {/* ── Company (Companies House) ── */}
          {chData && (
            <Section title="Companies House">
              <InfoCard>
                {installer.legalEntityName && installer.legalEntityName !== "__no_match__" && installer.legalEntityName.toLowerCase() !== installer.companyName.toLowerCase() && (
                  <div className="rounded-md bg-[#FAFAF9] px-3 py-2 mb-3">
                    <p className="text-[11px] text-[#9a9a9a] uppercase tracking-wider">Registered Name</p>
                    <p className="text-[13px] font-medium mt-0.5">{installer.legalEntityName}</p>
                  </div>
                )}
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <Field label="Company Number" value={chData.companyNumber} link={chData.companyNumber ? `https://find-and-update.company-information.service.gov.uk/company/${chData.companyNumber}` : undefined} />
                  <Field label="Status" value={chData.companyStatus} />
                  <Field label="Incorporated" value={chData.incorporationDate} />
                  <Field label="Type" value={chData.companyType?.replace(/-/g, " ")} />
                  <Field label="Last Accounts" value={chData.lastAccountsDate} />
                  <Field label="Account Category" value={chData.accountCategory?.replace(/-/g, " ")} />
                  <Field label="Registered Address" value={chData.registeredAddress} />
                  <Field label="Employee Count" value={chData.employeeCount} />
                </div>
                {chData.sicCodes && (
                  <div className="mt-3">
                    <p className="text-[11px] text-[#9a9a9a] uppercase tracking-wider mb-1">SIC Codes</p>
                    <div className="flex flex-wrap gap-1">{JSON.parse(chData.sicCodes).map((code: string) => <Badge key={code} variant="outline" className="text-[11px]">{code} - {getSicDescription(code)}</Badge>)}</div>
                  </div>
                )}
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {chData.hasInsolvencyHistory && <Badge variant="outline" className="text-[11px] bg-red-50 text-red-600 border-red-200">Insolvency History</Badge>}
                  {chData.hasCharges && <Badge variant="outline" className="text-[11px] bg-amber-50 text-amber-600 border-amber-200">{chData.chargesCount} Charge{chData.chargesCount !== 1 ? "s" : ""}</Badge>}
                </div>
                <CorrectEnrichment installerId={installerId} source="companies_house" currentValue={chData.companyNumber} label="Companies House" placeholder="e.g. 12345678" helpText="Enter correct company number to re-fetch" />
              </InfoCard>

              <div className="grid gap-3 md:grid-cols-2 mt-3">
              {chData.officers && JSON.parse(chData.officers).length > 0 && (
                <InfoCard>
                  <p className="text-[11px] text-[#9a9a9a] uppercase tracking-wider mb-2">Directors & Officers</p>
                  <div className="space-y-0">
                    {JSON.parse(chData.officers).map((o: { name: string; role: string; appointedOn: string | null; resignedOn: string | null }, i: number) => (
                      <div key={i} className={`flex items-center justify-between py-2 ${i > 0 ? "border-t border-[#f0f0f0]" : ""}`}>
                        <div><p className="text-[13px] font-medium">{o.name}</p><p className="text-[11px] text-[#9a9a9a] capitalize">{o.role?.replace(/-/g, " ")}{o.appointedOn && ` — since ${o.appointedOn}`}</p></div>
                        {o.resignedOn && <Badge variant="outline" className="text-[10px] text-[#9a9a9a]">Resigned {o.resignedOn}</Badge>}
                      </div>
                    ))}
                  </div>
                </InfoCard>
              )}

              {chData.personsOfControl && JSON.parse(chData.personsOfControl).length > 0 && (
                <InfoCard>
                  <p className="text-[11px] text-[#9a9a9a] uppercase tracking-wider mb-2">Persons with Significant Control</p>
                  {JSON.parse(chData.personsOfControl).map((p: { name: string; naturesOfControl: string[] }, i: number) => (
                    <div key={i} className={`py-2 ${i > 0 ? "border-t border-[#f0f0f0]" : ""}`}>
                      <p className="text-[13px] font-medium">{p.name}</p>
                      {p.naturesOfControl?.length > 0 && <p className="text-[11px] text-[#9a9a9a]">{p.naturesOfControl.map((c) => c.replace(/-/g, " ")).join(", ")}</p>}
                    </div>
                  ))}
                </InfoCard>
              )}
              </div>
            </Section>
          )}

          {/* ── Marketing & Tech ── */}
          <Section title="Marketing & Technology">
            <div className="grid gap-3 md:grid-cols-2">
              <InfoCard>
                <p className="text-[11px] text-[#9a9a9a] uppercase tracking-wider mb-2">Marketing Signals</p>
                {mktSignals ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-y-2">
                      <Signal label="Google Analytics" active={mktSignals.hasGoogleAnalytics} />
                      <Signal label="Google Ads" active={mktSignals.hasGoogleAds} />
                      <Signal label="Meta Pixel" active={mktSignals.hasMetaPixel} />
                      <Signal label="Meta Ads" active={mktSignals.hasMetaAds} detail={mktSignals.metaAdCount ? `${mktSignals.metaAdCount} ads` : undefined} />
                      <Signal label="CRM Tool" active={mktSignals.hasCrmTool} detail={mktSignals.crmToolName || undefined} />
                      <Signal label="Live Chat" active={mktSignals.hasLiveChat} detail={mktSignals.liveChatTool || undefined} />
                    </div>
                    {mktSignals.estimatedMonthlyTraffic != null && <div className="text-[13px]"><span className="text-[#9a9a9a]">Est. Monthly Traffic: </span><span className="font-medium tabular-nums">{mktSignals.estimatedMonthlyTraffic.toLocaleString()}</span></div>}
                    {mktSignals.estimatedAdSpend != null && mktSignals.estimatedAdSpend > 0 && <div className="text-[13px]"><span className="text-[#9a9a9a]">Est. Ad Spend: </span><span className="font-medium tabular-nums">${mktSignals.estimatedAdSpend.toLocaleString()}/mo</span></div>}
                    {mktSignals.detectedTechnologies && (
                      <div className="pt-2 border-t border-[#f0f0f0]">
                        <p className="text-[11px] text-[#9a9a9a] uppercase tracking-wider mb-1">Detected Technologies</p>
                        <div className="flex flex-wrap gap-1">{JSON.parse(mktSignals.detectedTechnologies).map((t: string) => <Badge key={t} variant="outline" className="text-[11px]">{t}</Badge>)}</div>
                      </div>
                    )}
                  </div>
                ) : <p className="text-[13px] text-[#9a9a9a]">No marketing data yet</p>}
              </InfoCard>

              {/* Google Ads Transparency */}
              <InfoCard>
                <p className="text-[11px] text-[#9a9a9a] uppercase tracking-wider mb-2">Google Ads Transparency</p>
                {adsData ? (
                  <div className="space-y-2 text-[13px]">
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="Advertiser" value={adsData.advertiserName} />
                      <Field label="Verified" value={adsData.isVerified ? "Yes" : "No"} />
                      <Field label="Total Ads" value={adsData.totalAds} />
                      <Field label="Text / Image / Video" value={`${adsData.textAds || 0} / ${adsData.imageAds || 0} / ${adsData.videoAds || 0}`} />
                      <Field label="First Seen" value={adsData.firstAdSeen} />
                      <Field label="Last Seen" value={adsData.lastAdSeen} />
                    </div>
                    {adsData.sampleAdTitles && (
                      <div className="pt-2 border-t border-[#f0f0f0]">
                        <p className="text-[11px] text-[#9a9a9a] uppercase tracking-wider mb-1">Sample Ads</p>
                        <ul className="space-y-0.5">{JSON.parse(adsData.sampleAdTitles).slice(0, 5).map((t: string, i: number) => <li key={i} className="text-[12px] text-[#6a6a6a]">{t}</li>)}</ul>
                      </div>
                    )}
                  </div>
                ) : <p className="text-[13px] text-[#9a9a9a]">No Google Ads data yet</p>}
              </InfoCard>
            </div>
          </Section>

          {/* ── SEO & Traffic ── */}
          {(seoInfo || trafficInfo) && (
            <Section title="SEO & Traffic">
              <div className="grid gap-3 md:grid-cols-2">
                {seoInfo && (
                  <InfoCard>
                    <p className="text-[11px] text-[#9a9a9a] uppercase tracking-wider mb-2">SEO</p>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Domain Authority" value={seoInfo.domainAuthority} />
                      <Field label="Backlinks" value={seoInfo.backlinksCount?.toLocaleString()} />
                      <Field label="Referring Domains" value={seoInfo.referringDomains?.toLocaleString()} />
                      <Field label="Organic Keywords" value={seoInfo.organicKeywords?.toLocaleString()} />
                    </div>
                  </InfoCard>
                )}
                {trafficInfo && (
                  <InfoCard>
                    <p className="text-[11px] text-[#9a9a9a] uppercase tracking-wider mb-2">Traffic</p>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Google Organic" value={trafficInfo.googleOrganicEtv != null ? `${trafficInfo.googleOrganicEtv.toLocaleString()}/mo` : null} />
                      <Field label="Google Paid" value={trafficInfo.googlePaidEtv != null ? `${trafficInfo.googlePaidEtv.toLocaleString()}/mo` : null} />
                      {trafficInfo.googleOrganicTrafficCost != null && <Field label="Organic Value" value={`$${trafficInfo.googleOrganicTrafficCost.toLocaleString()}/mo`} />}
                      {trafficInfo.googlePaidTrafficCost != null && <Field label="Paid Spend" value={`$${trafficInfo.googlePaidTrafficCost.toLocaleString()}/mo`} />}
                      <Field label="Google Keywords" value={trafficInfo.googleOrganicCount?.toLocaleString()} />
                      {trafficInfo.bingOrganicEtv != null && <Field label="Bing Organic" value={`${trafficInfo.bingOrganicEtv.toLocaleString()}/mo`} />}
                    </div>
                  </InfoCard>
                )}
              </div>

              {keywords.length > 0 && (
                <InfoCard className="mt-3">
                  <p className="text-[11px] text-[#9a9a9a] uppercase tracking-wider mb-2">Top Keywords ({keywords.length})</p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-[12px]">
                      <thead><tr className="border-b border-[#f0f0f0]">
                        <th className="text-left py-1.5 pr-3 text-[11px] font-medium text-[#9a9a9a] uppercase tracking-wider">Keyword</th>
                        <th className="text-right py-1.5 px-2 text-[11px] font-medium text-[#9a9a9a] uppercase tracking-wider">Volume</th>
                        <th className="text-right py-1.5 px-2 text-[11px] font-medium text-[#9a9a9a] uppercase tracking-wider">CPC</th>
                        <th className="text-right py-1.5 px-2 text-[11px] font-medium text-[#9a9a9a] uppercase tracking-wider">Competition</th>
                      </tr></thead>
                      <tbody>{keywords.map((kw) => (
                        <tr key={kw.id} className="border-b border-[#f0f0f0] last:border-0">
                          <td className="py-1.5 pr-3 text-[#3a3a3a]">{kw.keyword}</td>
                          <td className="text-right py-1.5 px-2 tabular-nums">{kw.searchVolume?.toLocaleString() ?? "—"}</td>
                          <td className="text-right py-1.5 px-2 tabular-nums">{kw.cpc != null ? `$${kw.cpc.toFixed(2)}` : "—"}</td>
                          <td className="text-right py-1.5 px-2"><Badge variant="outline" className="text-[10px]">{kw.competition || "—"}</Badge></td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                </InfoCard>
              )}
            </Section>
          )}

          {/* ── Job Postings ── */}
          {jobData && (
            <Section title="Job Postings">
              <InfoCard>
                <div className="flex items-center gap-3 mb-3">
                  <Briefcase className="h-4 w-4 text-[#9a9a9a]" />
                  <span className="text-[13px] font-medium">{jobData.isHiring ? "Currently Hiring" : "Not Hiring"}</span>
                  {jobData.totalPostings != null && <span className="text-[12px] text-[#9a9a9a]">({jobData.totalPostings} postings)</span>}
                </div>
                {jobData.postings && (
                  <div className="space-y-1.5">
                    {JSON.parse(jobData.postings).slice(0, 10).map((j: { title: string; location?: string; source?: string; url?: string }, i: number) => (
                      <div key={i} className="flex items-center justify-between py-1.5 border-t border-[#f0f0f0] first:border-0 first:pt-0">
                        <div>
                          <p className="text-[13px] text-[#3a3a3a]">{j.title}</p>
                          <p className="text-[11px] text-[#9a9a9a]">{[j.location, j.source].filter(Boolean).join(" · ")}</p>
                        </div>
                        {j.url && <a href={j.url} target="_blank" rel="noopener noreferrer" className="text-[11px] text-primary hover:underline"><ExternalLink className="h-3 w-3" /></a>}
                      </div>
                    ))}
                  </div>
                )}
              </InfoCard>
            </Section>
          )}

          {/* ── Source-specific data ── */}
          {(installer.novaYearStarted || installer.novaBatteryStorage || installer.trustmarkTmln || installer.trustmarkDescription) && (
            <Section title="Source Details">
              <div className="grid gap-3 md:grid-cols-2">
                {(installer.novaYearStarted || installer.novaBatteryStorage || installer.novaLocationArea || installer.novaEnfProfileUrl) && (
                  <InfoCard>
                    <p className="text-[11px] text-[#9a9a9a] uppercase tracking-wider mb-2">Nova</p>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Year Started" value={installer.novaYearStarted} />
                      <Field label="Battery Storage" value={installer.novaBatteryStorage} />
                      <Field label="Location Area" value={installer.novaLocationArea} />
                      <Field label="Incorporated Name" value={installer.novaIncorporatedName} />
                      {installer.novaEnfProfileUrl && <Field label="ENF Profile" value="View" link={installer.novaEnfProfileUrl} />}
                    </div>
                  </InfoCard>
                )}
                {(installer.trustmarkTmln || installer.trustmarkDescription || installer.trustmarkMemberSince) && (
                  <InfoCard>
                    <p className="text-[11px] text-[#9a9a9a] uppercase tracking-wider mb-2">TrustMark</p>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="TMLN" value={installer.trustmarkTmln} mono />
                      <Field label="Status" value={installer.trustmarkStatus} />
                      <Field label="Member Since" value={installer.trustmarkMemberSince} />
                      <Field label="District" value={installer.trustmarkDistrict} />
                      <Field label="Region" value={installer.trustmarkRegion} />
                      <Field label="National Coverage" value={installer.trustmarkNationalCoverage} />
                      <Field label="Scheme Providers" value={installer.trustmarkSchemeProviders} />
                      {installer.trustmarkProfileUrl && <Field label="Profile" value="View" link={installer.trustmarkProfileUrl} />}
                    </div>
                    {installer.trustmarkDescription && (
                      <div className="mt-2 pt-2 border-t border-[#f0f0f0]">
                        <p className="text-[12px] text-[#6a6a6a]">{installer.trustmarkDescription}</p>
                      </div>
                    )}
                  </InfoCard>
                )}
              </div>
            </Section>
          )}

          {/* ── Activity ── */}
          <Section title="Activity">
            <ActivityTimeline installerId={installerId} initialActivities={activityList} />
          </Section>

        </div>
      </div>
    </div>
  );
}
