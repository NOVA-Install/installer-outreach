"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";

const MapInner = dynamic(
  () => import("./map-inner").then((mod) => mod.MapInner),
  {
    ssr: false,
    loading: () => (
      <div className="h-full w-full flex items-center justify-center bg-muted">
        <Skeleton className="h-full w-full" />
      </div>
    ),
  }
);

interface MapInstaller {
  id: number;
  companyName: string;
  county: string | null;
  postcode: string | null;
  latitude: number | null;
  longitude: number | null;
  tier: string | null;
  overallScore: number | null;
  googleRating: number | null;
  googleReviewCount: number | null;
  website: string | null;
  technologiesCertified: string | null;
  email: string | null;
  pipelineStage: string | null;
  trustpilotRating: number | null;
  trustpilotReviewCount: number | null;
}

interface DistanceOrigin {
  postcode: string;
  lat: number;
  lng: number;
}

export function InstallerMap({
  installers,
  distanceOrigin,
}: {
  installers: MapInstaller[];
  distanceOrigin?: DistanceOrigin | null;
}) {
  return <MapInner installers={installers} distanceOrigin={distanceOrigin} />;
}
