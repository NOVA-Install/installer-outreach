import { db } from "@/lib/db";
import { installers, installerScores, googleReviews } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { MapPageClient } from "@/components/map/map-page-client";
import { getDistinctCounties } from "@/lib/queries/installers";

export const dynamic = "force-dynamic";

export default async function MapPage() {
  const allInstallers = await db
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
    })
    .from(installers)
    .leftJoin(installerScores, eq(installers.id, installerScores.installerId))
    .leftJoin(googleReviews, eq(installers.id, googleReviews.installerId));

  const counties = await getDistinctCounties();

  return <MapPageClient installers={allInstallers} counties={counties} />;
}
