import { NextResponse } from "next/server";
import { getDistinctCounties, getDistinctCrmTools, getDistinctAgencies } from "@/lib/queries/installers";

export async function GET() {
  const [counties, crmTools, agencies] = await Promise.all([
    getDistinctCounties(),
    getDistinctCrmTools(),
    getDistinctAgencies(),
  ]);

  return NextResponse.json({ counties, crmTools, agencies }, {
    headers: { "Cache-Control": "s-maxage=300, stale-while-revalidate=600" },
  });
}
