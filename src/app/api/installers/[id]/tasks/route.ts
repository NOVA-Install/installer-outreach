import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  dataforseoTasks,
  googleReviews,
  trustpilotReviews,
  reviewItems,
} from "@/lib/db/schema";
import { eq, desc, sql } from "drizzle-orm";

// GET - list tasks for this installer
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const installerId = parseInt(id, 10);

  const tasks = await db
    .select()
    .from(dataforseoTasks)
    .where(eq(dataforseoTasks.installerId, installerId))
    .orderBy(desc(dataforseoTasks.createdAt))
    .limit(20);

  return NextResponse.json(tasks);
}

// POST - check a pending task and retrieve results if ready
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const installerId = parseInt(id, 10);
  const { taskDbId } = await request.json();

  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) {
    return NextResponse.json(
      { error: "DATAFORSEO credentials not set" },
      { status: 500 }
    );
  }

  const auth =
    "Basic " + Buffer.from(`${login}:${password}`).toString("base64");

  // Find the task
  const [task] = await db
    .select()
    .from(dataforseoTasks)
    .where(eq(dataforseoTasks.id, taskDbId))
    .limit(1);

  if (!task || task.installerId !== installerId) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  if (task.status !== "pending") {
    return NextResponse.json({
      status: task.status,
      message: `Task already ${task.status}`,
      resultSummary: task.resultSummary,
    });
  }

  // Check task on DataForSEO
  const res = await fetch(
    `https://api.dataforseo.com/v3/${task.endpoint}/task_get/${task.taskId}`,
    { headers: { Authorization: auth } }
  );
  const data = await res.json();
  const dfsTask = data?.tasks?.[0];

  // Still in queue
  if (
    dfsTask?.status_code === 40601 ||
    dfsTask?.status_code === 40602
  ) {
    return NextResponse.json({
      status: "pending",
      message: `Still processing (${dfsTask.status_message})`,
      taskId: task.taskId,
    });
  }

  // No results
  if (dfsTask?.status_code === 40102) {
    await db
      .update(dataforseoTasks)
      .set({
        status: "no_results",
        resultSummary: "No search results found",
        completedAt: new Date().toISOString(),
      })
      .where(eq(dataforseoTasks.id, taskDbId));

    return NextResponse.json({
      status: "no_results",
      message: `No results found for "${task.searchTerm}"`,
    });
  }

  // Error
  if (dfsTask?.status_code && dfsTask.status_code >= 40000) {
    await db
      .update(dataforseoTasks)
      .set({
        status: "failed",
        resultSummary: `Error ${dfsTask.status_code}: ${dfsTask.status_message}`,
        completedAt: new Date().toISOString(),
      })
      .where(eq(dataforseoTasks.id, taskDbId));

    return NextResponse.json({
      status: "failed",
      message: `${dfsTask.status_code}: ${dfsTask.status_message}`,
    });
  }

  // Success - process results based on source type
  const result = dfsTask?.result?.[0];
  let summary = "Completed";

  if (task.source === "google_reviews" && result) {
    const ratingObj = result.rating;
    const ratingVal =
      typeof ratingObj === "object" ? ratingObj?.value : ratingObj;
    const reviewsCount = result.reviews_count || 0;

    if (ratingVal) {
      await db
        .delete(googleReviews)
        .where(eq(googleReviews.installerId, installerId));
      await db.insert(googleReviews).values({
        installerId,
        placeId: result.place_id || null,
        rating: ratingVal,
        reviewCount: reviewsCount,
        reviewsPerMonth:
          reviewsCount > 0 ? reviewsCount / 36 : null,
        businessStatus: null,
        fetchedAt: new Date().toISOString(),
      });

      // Store individual reviews if present
      if (result.items?.length > 0) {
        await db
          .delete(reviewItems)
          .where(
            sql`${reviewItems.installerId} = ${installerId} AND ${reviewItems.source} = 'google'`
          );
        const reviews = result.items
          .filter(
            (item: { type?: string }) => item.type === "google_review"
          )
          .map(
            (item: {
              rating?: { value?: number };
              review_text?: string;
              profile_name?: string;
              timestamp?: string;
            }) => ({
              installerId,
              source: "google" as const,
              rating: item.rating?.value || null,
              reviewText: item.review_text || null,
              reviewerName: item.profile_name || null,
              reviewDate: item.timestamp || null,
              fetchedAt: new Date().toISOString(),
            })
          );
        if (reviews.length > 0) {
          await db.insert(reviewItems).values(reviews);
        }
      }

      summary = `Rating: ${ratingVal}, ${reviewsCount} reviews`;
    } else {
      summary = "Business found but no rating";
    }
  }

  if (task.source === "trustpilot_search" && result) {
    const items = result.items;
    if (items?.length > 0) {
      const biz = items[0];
      await db
        .delete(trustpilotReviews)
        .where(eq(trustpilotReviews.installerId, installerId));
      await db.insert(trustpilotReviews).values({
        installerId,
        trustpilotUrl: biz.domain
          ? `https://www.trustpilot.com/review/${biz.domain}`
          : null,
        rating: biz.rating?.value || null,
        reviewCount: biz.reviews_count || 0,
        trustScore: biz.trust_score || null,
        fetchedAt: new Date().toISOString(),
      });
      summary = `Found: ${biz.domain}, rating: ${biz.rating?.value}, ${biz.reviews_count} reviews`;
    } else {
      summary = "No Trustpilot profile found";
    }
  }

  if (task.source === "trustpilot_reviews" && result) {
    const items = result.items;
    if (items?.length > 0) {
      await db
        .delete(reviewItems)
        .where(
          sql`${reviewItems.installerId} = ${installerId} AND ${reviewItems.source} = 'trustpilot'`
        );
      const tpReviews = items.map(
        (item: {
          rating?: { value?: number };
          review_text?: string;
          user_profile?: { name?: string };
          timestamp?: string;
        }) => ({
          installerId,
          source: "trustpilot" as const,
          rating: item.rating?.value || null,
          reviewText: item.review_text || null,
          reviewerName: item.user_profile?.name || null,
          reviewDate: item.timestamp || null,
          fetchedAt: new Date().toISOString(),
        })
      );
      await db.insert(reviewItems).values(tpReviews);
      summary = `${tpReviews.length} reviews fetched`;
    } else {
      summary = "No individual reviews returned";
    }
  }

  // Mark task complete
  await db
    .update(dataforseoTasks)
    .set({
      status: "completed",
      resultSummary: summary,
      completedAt: new Date().toISOString(),
    })
    .where(eq(dataforseoTasks.id, taskDbId));

  return NextResponse.json({ status: "completed", message: summary });
}
