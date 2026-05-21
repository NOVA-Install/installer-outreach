import { NextRequest, NextResponse } from "next/server";
import { getInstallers } from "@/lib/queries/installers";
import { db } from "@/lib/db";
import { installers } from "@/lib/db/schema";

function boolParam(val: string | null): boolean | undefined {
  if (val === "true") return true;
  if (val === "false") return false;
  return undefined;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  const filters = {
    search: searchParams.get("search") || undefined,
    county: searchParams.get("county") || undefined,
    technology: searchParams.get("technology") || undefined,
    region: searchParams.get("region") || undefined,
    tier: searchParams.get("tier") || undefined,
    pipelineStage: searchParams.get("stage") || undefined,
    boilerUpgradeScheme: searchParams.get("bus") || undefined,
    hasWebsite: boolParam(searchParams.get("hasWebsite")),
    hasEmail: boolParam(searchParams.get("hasEmail")),
    hasReviews: boolParam(searchParams.get("hasReviews")),
    inMcs: boolParam(searchParams.get("inMcs")),
    inNova: boolParam(searchParams.get("inNova")),
    inTrustMark: boolParam(searchParams.get("inTrustMark")),
    scoreMin: searchParams.get("scoreMin") ? Number(searchParams.get("scoreMin")) : undefined,
    scoreMax: searchParams.get("scoreMax") ? Number(searchParams.get("scoreMax")) : undefined,
    ratingMin: searchParams.get("ratingMin") ? Number(searchParams.get("ratingMin")) : undefined,
    page: searchParams.get("page") ? Number(searchParams.get("page")) : 1,
    pageSize: searchParams.get("pageSize")
      ? Number(searchParams.get("pageSize"))
      : 100,
    sortBy: searchParams.get("sortBy") || "companyName",
    sortOrder: (searchParams.get("sortOrder") || "asc") as "asc" | "desc",
  };

  const result = await getInstallers(filters);
  return NextResponse.json(result);
}

export async function POST(request: NextRequest) {
  const body = await request.json();

  if (!body.companyName?.trim()) {
    return NextResponse.json(
      { error: "Company name is required" },
      { status: 400 }
    );
  }

  const [installer] = await db
    .insert(installers)
    .values({
      companyName: body.companyName.trim(),
      email: body.email?.trim() || null,
      telephone: body.telephone?.trim() || null,
      website: body.website?.trim() || null,
      address: body.address?.trim() || null,
      county: body.county?.trim() || null,
      postcode: body.postcode?.trim() || null,
      pipelineStage: "target",
    })
    .returning();

  return NextResponse.json(installer);
}
