"use client";

import { useMemo, useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Star, TrendingUp, ChevronDown, ChevronUp } from "lucide-react";

interface ReviewItem {
  id: number;
  rating: number | null;
  reviewText: string | null;
  reviewerName: string | null;
  reviewDate: string | null;
}

function calcFrequency(reviews: ReviewItem[]) {
  const now = new Date();
  const reviewsWithDates = reviews
    .filter((r) => r.reviewDate)
    .map((r) => new Date(r.reviewDate!));

  if (reviewsWithDates.length === 0) {
    return { last30Days: 0, last90Days: 0, avg6Months: 0, monthlyBreakdown: [] };
  }

  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  const sixMonthsAgo = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);

  const last30Days = reviewsWithDates.filter((d) => d >= thirtyDaysAgo).length;
  const last90Days = reviewsWithDates.filter((d) => d >= ninetyDaysAgo).length;
  const last6Months = reviewsWithDates.filter((d) => d >= sixMonthsAgo).length;
  const avg6Months = last6Months / 6;

  // Monthly breakdown (last 6 months)
  const monthlyBreakdown: { month: string; count: number }[] = [];
  for (let i = 0; i < 6; i++) {
    const monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59);
    const count = reviewsWithDates.filter(
      (d) => d >= monthStart && d <= monthEnd
    ).length;
    monthlyBreakdown.push({
      month: monthStart.toLocaleDateString("en-GB", {
        month: "short",
        year: "numeric",
      }),
      count,
    });
  }

  return { last30Days, last90Days, avg6Months, monthlyBreakdown };
}

export function ReviewDetails({
  source,
  reviews,
  icon,
}: {
  source: "Google" | "Trustpilot";
  reviews: ReviewItem[];
  icon: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const freq = useMemo(() => calcFrequency(reviews), [reviews]);

  if (reviews.length === 0) return null;

  const shownReviews = expanded ? reviews : reviews.slice(0, 5);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          {icon}
          {source} Reviews ({reviews.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Frequency Stats */}
        <div className="grid grid-cols-3 gap-3 rounded-lg border p-3 bg-muted/30">
          <div className="text-center">
            <p className="text-2xl font-bold">{freq.last30Days}</p>
            <p className="text-xs text-muted-foreground">Last 30 days</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold">{freq.last90Days}</p>
            <p className="text-xs text-muted-foreground">Last 90 days</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold">{freq.avg6Months.toFixed(1)}</p>
            <p className="text-xs text-muted-foreground">Avg/month (6mo)</p>
          </div>
        </div>

        {/* Monthly Breakdown */}
        <div className="flex items-end gap-1 h-16">
          {freq.monthlyBreakdown
            .slice()
            .reverse()
            .map((m) => {
              const maxCount = Math.max(
                ...freq.monthlyBreakdown.map((mb) => mb.count),
                1
              );
              const height = Math.max((m.count / maxCount) * 100, 4);
              return (
                <div
                  key={m.month}
                  className="flex-1 flex flex-col items-center gap-0.5"
                >
                  <span className="text-[10px] font-medium">
                    {m.count > 0 ? m.count : ""}
                  </span>
                  <div
                    className="w-full rounded-sm bg-primary/70"
                    style={{ height: `${height}%` }}
                  />
                  <span className="text-[9px] text-muted-foreground">
                    {m.month.split(" ")[0]}
                  </span>
                </div>
              );
            })}
        </div>

        {/* Individual Reviews */}
        <div className="space-y-2">
          {shownReviews.map((review) => (
            <div
              key={review.id}
              className="rounded border p-3 text-sm space-y-1"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {review.rating != null && (
                    <div className="flex items-center gap-0.5">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <Star
                          key={i}
                          className={`h-3 w-3 ${
                            i < Math.round(review.rating || 0)
                              ? "fill-amber-400 text-amber-400"
                              : "text-gray-200"
                          }`}
                        />
                      ))}
                    </div>
                  )}
                  <span className="text-xs font-medium text-muted-foreground">
                    {review.reviewerName || "Anonymous"}
                  </span>
                </div>
                {review.reviewDate && (
                  <span className="text-[10px] text-muted-foreground">
                    {new Date(review.reviewDate).toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </span>
                )}
              </div>
              {review.reviewText && (
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {review.reviewText.length > 300
                    ? review.reviewText.slice(0, 300) + "..."
                    : review.reviewText}
                </p>
              )}
            </div>
          ))}
        </div>

        {reviews.length > 5 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setExpanded(!expanded)}
            className="w-full text-xs"
          >
            {expanded ? (
              <>
                <ChevronUp className="h-3 w-3 mr-1" /> Show less
              </>
            ) : (
              <>
                <ChevronDown className="h-3 w-3 mr-1" /> Show all{" "}
                {reviews.length} reviews
              </>
            )}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
