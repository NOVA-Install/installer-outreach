import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  installers,
  installerScores,
  googleReviews,
  trustpilotReviews,
  companiesHouseData,
  marketingSignals,
} from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function GET() {
  const data = await db
    .select({
      companyName: installers.companyName,
      installerId: installers.installerId,
      certificationNumber: installers.certificationNumber,
      email: installers.email,
      telephone: installers.telephone,
      website: installers.website,
      address: installers.address,
      county: installers.county,
      postcode: installers.postcode,
      technologiesCertified: installers.technologiesCertified,
      regionsCovered: installers.regionsCovered,
      boilerUpgradeScheme: installers.boilerUpgradeScheme,
      overallScore: installerScores.overallScore,
      tier: installerScores.tier,
      reputationScore: installerScores.reputationScore,
      marketingActivityScore: installerScores.marketingActivityScore,
      googleRating: googleReviews.rating,
      googleReviewCount: googleReviews.reviewCount,
      trustpilotRating: trustpilotReviews.rating,
      trustpilotReviewCount: trustpilotReviews.reviewCount,
      companyNumber: companiesHouseData.companyNumber,
      companyStatus: companiesHouseData.companyStatus,
      incorporationDate: companiesHouseData.incorporationDate,
      hasGoogleAnalytics: marketingSignals.hasGoogleAnalytics,
      hasGoogleAds: marketingSignals.hasGoogleAds,
      hasMetaPixel: marketingSignals.hasMetaPixel,
      hasCrmTool: marketingSignals.hasCrmTool,
      hasLiveChat: marketingSignals.hasLiveChat,
    })
    .from(installers)
    .leftJoin(installerScores, eq(installers.id, installerScores.installerId))
    .leftJoin(googleReviews, eq(installers.id, googleReviews.installerId))
    .leftJoin(
      trustpilotReviews,
      eq(installers.id, trustpilotReviews.installerId)
    )
    .leftJoin(
      companiesHouseData,
      eq(installers.id, companiesHouseData.installerId)
    )
    .leftJoin(
      marketingSignals,
      eq(installers.id, marketingSignals.installerId)
    );

  // Build CSV
  if (data.length === 0) {
    return new NextResponse("No data", { status: 404 });
  }

  const headers = Object.keys(data[0]);
  const csvRows = [
    headers.join(","),
    ...data.map((row) =>
      headers
        .map((h) => {
          const val = (row as Record<string, unknown>)[h];
          if (val == null) return "";
          const str = String(val);
          if (str.includes(",") || str.includes('"') || str.includes("\n")) {
            return `"${str.replace(/"/g, '""')}"`;
          }
          return str;
        })
        .join(",")
    ),
  ].join("\n");

  return new NextResponse(csvRows, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="installers-export-${new Date().toISOString().split("T")[0]}.csv"`,
    },
  });
}
