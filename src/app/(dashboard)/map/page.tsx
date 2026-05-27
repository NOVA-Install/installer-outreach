import { db } from "@/lib/db";
import { installers, installerScores, googleReviews, trustpilotReviews, marketingSignals, websiteQuality } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { MapPageClient } from "@/components/map/map-page-client";
import { getDistinctCounties, getDistinctCrmTools, getDistinctAgencies } from "@/lib/queries/installers";

export const dynamic = "force-dynamic";

export default async function MapPage() {
  const [allInstallers, counties, crmTools, agencies] = await Promise.all([
    db
      .select({
        id: installers.id,
        companyName: installers.companyName,
        county: installers.county,
        postcode: installers.postcode,
        latitude: installers.latitude,
        longitude: installers.longitude,
        tier: installerScores.tier,
        overallScore: installerScores.overallScore,
        googleRating: googleReviews.rating,
        googleReviewCount: googleReviews.reviewCount,
        website: installers.website,
        technologiesCertified: installers.technologiesCertified,
        // Additional fields for filtering
        email: installers.email,
        pipelineStage: installers.pipelineStage,
        inMcs: installers.inMcs,
        inNova: installers.inNova,
        inTrustMark: installers.inTrustMark,
        isShortlisted: installers.isShortlisted,
        trustpilotRating: trustpilotReviews.rating,
        trustpilotReviewCount: trustpilotReviews.reviewCount,
        hasCrmTool: marketingSignals.hasCrmTool,
        crmToolName: marketingSignals.crmToolName,
        formType: websiteQuality.formType,
        agencyName: websiteQuality.agencyName,
      })
      .from(installers)
      .leftJoin(installerScores, eq(installers.id, installerScores.installerId))
      .leftJoin(googleReviews, eq(installers.id, googleReviews.installerId))
      .leftJoin(trustpilotReviews, eq(installers.id, trustpilotReviews.installerId))
      .leftJoin(marketingSignals, eq(installers.id, marketingSignals.installerId))
      .leftJoin(websiteQuality, eq(installers.id, websiteQuality.installerId)),
    getDistinctCounties(),
    getDistinctCrmTools(),
    getDistinctAgencies(),
  ]);

  return <MapPageClient installers={allInstallers} counties={counties} crmTools={crmTools} agencies={agencies} />;
}
