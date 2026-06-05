import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { competitorEmployees } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const competitorId = parseInt(id, 10);

  const employees = await db
    .select()
    .from(competitorEmployees)
    .where(eq(competitorEmployees.competitorId, competitorId))
    .orderBy(competitorEmployees.fullName);

  return NextResponse.json(employees);
}
