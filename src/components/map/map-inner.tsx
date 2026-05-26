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
import { PIPELINE_STAGES } from "@/lib/constants";

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
  // Additional fields for popup
  email: string | null;
  pipelineStage: string | null;
  trustpilotRating: number | null;
  trustpilotReviewCount: number | null;
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

// Use CircleMarkers with Canvas renderer for fast rendering of thousands of points
function MarkerLayer({ installers }: { installers: MapInstaller[] }) {
  const map = useMap();
  const layerRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (layerRef.current) {
      map.removeLayer(layerRef.current);
    }

    // Canvas renderer is much faster than SVG for thousands of markers
    const renderer = L.canvas({ padding: 0.5 });
    const group = L.layerGroup();

    installers.forEach((installer) => {
      if (installer.latitude == null || installer.longitude == null) return;

      const color = tierColors[installer.tier || ""] || "#4ABDE8";

      const marker = L.circleMarker([installer.latitude, installer.longitude], {
        renderer,
        radius: 5,
        fillColor: color,
        color: "#fff",
        weight: 1.5,
        opacity: 0.9,
        fillOpacity: 0.85,
      });

      // Build review lines
      const googleLine = installer.googleRating != null
        ? `<div style="display:flex;align-items:center;gap:4px;"><span style="color:#f59e0b;">&#9733;</span> ${installer.googleRating.toFixed(1)} <span style="color:#9a9a9a;">(${installer.googleReviewCount || 0})</span> <span style="color:#9a9a9a;font-size:11px;">Google</span></div>`
        : "";
      const tpLine = installer.trustpilotRating != null
        ? `<div style="display:flex;align-items:center;gap:4px;"><span style="color:#00b67a;">&#9733;</span> ${installer.trustpilotRating.toFixed(1)} <span style="color:#9a9a9a;">(${installer.trustpilotReviewCount || 0})</span> <span style="color:#9a9a9a;font-size:11px;">Trustpilot</span></div>`
        : "";
      const reviewSection = (googleLine || tpLine)
        ? `<div style="margin-top:6px;display:flex;flex-direction:column;gap:2px;">${googleLine}${tpLine}</div>`
        : `<div style="margin-top:6px;font-size:12px;color:#9a9a9a;">No reviews</div>`;

      // Stage badge
      const stage = PIPELINE_STAGES.find((s) => s.key === installer.pipelineStage);
      const stageBadge = stage
        ? `<span style="display:inline-block;padding:1px 6px;border-radius:9999px;font-size:11px;font-weight:500;color:white;background:${stage.color};">${stage.label}</span>`
        : "";

      // Score + tier
      const scoreLine = installer.overallScore != null
        ? `<span style="font-weight:600;font-size:13px;">${installer.overallScore.toFixed(0)}</span><span style="color:#9a9a9a;font-size:11px;margin-left:3px;">score</span>`
        : "";
      const tierLabel = installer.tier ? `<span style="display:inline-block;padding:1px 6px;border-radius:9999px;font-size:11px;font-weight:500;background:${tierColors[installer.tier] || "#4ABDE8"}20;color:${tierColors[installer.tier] || "#4ABDE8"};text-transform:capitalize;">${installer.tier}</span>` : "";
      const metaLine = (scoreLine || tierLabel)
        ? `<div style="margin-top:6px;display:flex;align-items:center;gap:6px;">${scoreLine}${tierLabel}${stageBadge}</div>`
        : (stageBadge ? `<div style="margin-top:6px;">${stageBadge}</div>` : "");

      // Website
      const websiteLine = installer.website
        ? `<div style="margin-top:4px;font-size:11px;"><a href="${installer.website.startsWith("http") ? installer.website : `https://${installer.website}`}" target="_blank" rel="noopener" style="color:#4ABDE8;text-decoration:none;">${installer.website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}</a></div>`
        : "";

      const popupContent = `
        <div style="min-width:220px;max-width:280px;font-family:system-ui,-apple-system,sans-serif;font-size:12px;line-height:1.4;">
          <strong style="font-size:14px;display:block;">${installer.companyName}</strong>
          <div style="margin-top:2px;color:#6a6a6a;">
            ${[installer.county, installer.postcode].filter(Boolean).join(" · ")}
          </div>
          ${reviewSection}
          ${metaLine}
          ${websiteLine}
          <div style="margin-top:8px;padding-top:6px;border-top:1px solid #f0f0f0;">
            <a href="/installers/${installer.id}" style="font-size:12px;color:#4ABDE8;text-decoration:none;font-weight:500;">View details &rarr;</a>
          </div>
        </div>
      `;

      marker.bindPopup(popupContent);
      group.addLayer(marker);
    });

    group.addTo(map);
    layerRef.current = group;

    return () => {
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
      }
    };
  }, [installers, map]);

  return null;
}

interface DistanceOrigin {
  postcode: string;
  lat: number;
  lng: number;
}

/** Fly to origin and render a radius circle + pin marker */
function OriginLayer({ origin }: { origin: DistanceOrigin }) {
  const map = useMap();
  const layerRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (layerRef.current) {
      map.removeLayer(layerRef.current);
    }

    const group = L.layerGroup();

    // Pin marker at origin
    const pinIcon = L.divIcon({
      className: "",
      html: `<div style="display:flex;flex-direction:column;align-items:center;">
        <div style="background:#4ABDE8;color:white;font-size:11px;font-weight:600;padding:2px 8px;border-radius:12px;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,0.2);">${origin.postcode}</div>
        <div style="width:2px;height:8px;background:#4ABDE8;"></div>
        <div style="width:8px;height:8px;background:#4ABDE8;border-radius:50%;border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,0.3);"></div>
      </div>`,
      iconSize: [80, 40],
      iconAnchor: [40, 40],
    });
    L.marker([origin.lat, origin.lng], { icon: pinIcon, interactive: false }).addTo(group);

    group.addTo(map);
    layerRef.current = group;

    // Fly to origin with appropriate zoom
    map.flyTo([origin.lat, origin.lng], 10, { duration: 1 });

    return () => {
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
      }
    };
  }, [origin, map]);

  return null;
}

export function MapInner({ installers, distanceOrigin }: { installers: MapInstaller[]; distanceOrigin?: DistanceOrigin | null }) {
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
        <MarkerLayer installers={installers} />
        {distanceOrigin && <OriginLayer origin={distanceOrigin} />}
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
