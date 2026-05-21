"use client";

import { useEffect, useRef, useMemo, useState, useCallback } from "react";
import L from "leaflet";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  useMap,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Star, ExternalLink } from "lucide-react";

// Fix Leaflet default icon issue
// eslint-disable-next-line @typescript-eslint/no-explicit-any
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
  iconUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
  shadowUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
});

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
}

const tierColors: Record<string, string> = {
  high: "#22c55e",
  medium: "#e8b94a",
  low: "#9a9a9a",
};

function createIcon(tier: string | null) {
  const color = tierColors[tier || ""] || "#4ABDE8";
  return L.divIcon({
    className: "custom-marker",
    html: `<div style="background:${color};width:12px;height:12px;border-radius:50%;border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,0.3);"></div>`,
    iconSize: [12, 12],
    iconAnchor: [6, 6],
  });
}

// Cluster markers for performance
function MarkerClusterGroup({ installers }: { installers: MapInstaller[] }) {
  const map = useMap();
  const clusterRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (clusterRef.current) {
      map.removeLayer(clusterRef.current);
    }

    const group = L.layerGroup();

    installers.forEach((installer) => {
      if (installer.latitude == null || installer.longitude == null) return;

      const icon = createIcon(installer.tier);
      const marker = L.marker([installer.latitude, installer.longitude], {
        icon,
      });

      const popupContent = `
        <div style="min-width:200px;font-family:system-ui,-apple-system,sans-serif;">
          <strong style="font-size:14px;">${installer.companyName}</strong>
          <div style="margin-top:4px;font-size:12px;color:#666;">
            ${installer.county || ""} ${installer.postcode || ""}
          </div>
          ${
            installer.googleRating
              ? `<div style="margin-top:4px;font-size:12px;">Rating: ${installer.googleRating.toFixed(1)} (${installer.googleReviewCount || 0} reviews)</div>`
              : ""
          }
          ${
            installer.overallScore != null
              ? `<div style="margin-top:4px;font-size:12px;">Score: ${installer.overallScore.toFixed(0)}</div>`
              : ""
          }
          <a href="/installers/${installer.id}" style="display:inline-block;margin-top:8px;font-size:12px;color:#2563eb;text-decoration:underline;">View Details</a>
        </div>
      `;

      marker.bindPopup(popupContent);
      group.addLayer(marker);
    });

    group.addTo(map);
    clusterRef.current = group;

    return () => {
      if (clusterRef.current) {
        map.removeLayer(clusterRef.current);
      }
    };
  }, [installers, map]);

  return null;
}

export function MapInner({ installers }: { installers: MapInstaller[] }) {
  // UK center
  const center: L.LatLngExpression = [54.5, -2.5];

  return (
    <div className="h-full w-full relative">
      <MapContainer
        center={center}
        zoom={6}
        className="h-full w-full"
        scrollWheelZoom={true}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <MarkerClusterGroup installers={installers} />
      </MapContainer>

      {/* Legend */}
      <div className="absolute bottom-4 right-4 z-[1000] rounded-lg border bg-white p-3 shadow-md">
        <p className="text-xs font-semibold mb-2">Tier</p>
        <div className="space-y-1">
          {Object.entries(tierColors).map(([tier, color]) => (
            <div key={tier} className="flex items-center gap-2 text-xs">
              <div
                className="h-3 w-3 rounded-full border border-white shadow-sm"
                style={{ background: color }}
              />
              <span className="capitalize">{tier}</span>
            </div>
          ))}
          <div className="flex items-center gap-2 text-xs">
            <div
              className="h-3 w-3 rounded-full border border-white shadow-sm"
              style={{ background: "#4ABDE8" }}
            />
            <span>Unscored</span>
          </div>
        </div>
      </div>
    </div>
  );
}
