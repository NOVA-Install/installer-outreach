export const PIPELINE_STAGES = [
  { key: "uncontacted", label: "Uncontacted", color: "#9a9a9a" },
  { key: "target", label: "Target", color: "#60a5fa" },
  { key: "contacted", label: "Contacted", color: "#4ABDE8" },
  { key: "first_meeting", label: "First Meeting", color: "#e8b94a" },
  { key: "proposal", label: "Proposal", color: "#b8a4ed" },
  { key: "negotiation", label: "Negotiation", color: "#38bdf8" },
  { key: "won", label: "Won", color: "#22c55e" },
  { key: "lost", label: "Lost", color: "#f87171" },
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number]["key"];

export const ACTIVITY_TYPES = [
  { key: "note", label: "Note", icon: "MessageSquare" },
  { key: "call", label: "Call", icon: "Phone" },
  { key: "email", label: "Email", icon: "Mail" },
  { key: "meeting", label: "Meeting", icon: "Users" },
  { key: "stage_change", label: "Stage Change", icon: "ArrowRight" },
] as const;

export type ActivityType = (typeof ACTIVITY_TYPES)[number]["key"];

// --- UK Zones ---

export const UK_ZONES = [
  {
    id: "london",
    name: "London",
    postcodePrefixes: ["EC", "WC", "W", "SW", "SE", "E", "N", "NW", "BR", "CR", "DA", "EN", "HA", "IG", "KT", "RM", "SM", "TW", "UB", "WD"],
  },
  {
    id: "south-east",
    name: "South East",
    postcodePrefixes: ["BN", "CT", "ME", "TN", "RH", "GU", "SS", "CM"],
  },
  {
    id: "south-coast",
    name: "South Coast",
    postcodePrefixes: ["SO", "PO", "BH", "SP"],
  },
  {
    id: "south-west",
    name: "South West",
    postcodePrefixes: ["EX", "PL", "TQ", "TR", "TA", "DT"],
  },
  {
    id: "bristol-west",
    name: "Bristol & West",
    postcodePrefixes: ["BS", "BA", "GL", "SN"],
  },
  {
    id: "thames-valley",
    name: "Thames Valley",
    postcodePrefixes: ["OX", "RG", "HP", "SL", "MK", "LU", "AL", "SG"],
  },
  {
    id: "east-anglia",
    name: "East Anglia",
    postcodePrefixes: ["NR", "IP", "CB", "CO", "PE"],
  },
  {
    id: "west-midlands",
    name: "West Midlands",
    postcodePrefixes: ["B", "WS", "DY", "WV", "CV", "WR", "ST"],
  },
  {
    id: "east-midlands",
    name: "East Midlands",
    postcodePrefixes: ["NG", "DE", "LE", "NN", "LN"],
  },
  {
    id: "south-wales",
    name: "South Wales",
    postcodePrefixes: ["CF", "SA", "NP", "LD"],
  },
  {
    id: "north-wales",
    name: "North Wales",
    postcodePrefixes: ["LL", "SY"],
  },
  {
    id: "north-west",
    name: "North West",
    postcodePrefixes: ["M", "SK", "WA", "WN", "BL", "OL", "CW", "CH"],
  },
  {
    id: "merseyside-lancashire",
    name: "Merseyside & Lancashire",
    postcodePrefixes: ["L", "PR", "FY", "BB", "LA"],
  },
  {
    id: "yorkshire",
    name: "Yorkshire",
    postcodePrefixes: ["S", "LS", "BD", "WF", "HD", "HX", "DN", "HU", "YO", "HG"],
  },
  {
    id: "north-east",
    name: "North East",
    postcodePrefixes: ["NE", "SR", "DH", "TS", "DL"],
  },
  {
    id: "cumbria",
    name: "Cumbria",
    postcodePrefixes: ["CA"],
  },
  {
    id: "central-scotland",
    name: "Central Scotland",
    postcodePrefixes: ["G", "FK", "KA", "ML", "PA", "DG", "TD"],
  },
  {
    id: "east-scotland",
    name: "East Scotland",
    postcodePrefixes: ["EH", "KY", "DD"],
  },
  {
    id: "north-east-scotland",
    name: "North East Scotland",
    postcodePrefixes: ["AB"],
  },
  {
    id: "highlands",
    name: "Highlands & Islands",
    postcodePrefixes: ["IV", "PH", "KW", "HS", "ZE"],
  },
  {
    id: "northern-ireland",
    name: "Northern Ireland",
    postcodePrefixes: ["BT"],
  },
] as const;

export type UKZoneId = (typeof UK_ZONES)[number]["id"];

/** Extract the postcode area (1-2 letter prefix) from a UK postcode */
export function extractPostcodeArea(postcode: string): string {
  const match = postcode.toUpperCase().trim().match(/^([A-Z]{1,2})\d/);
  return match ? match[1] : "";
}

/** Get all postcode prefixes for a set of zone IDs */
export function getPrefixesForZones(zoneIds: string[]): string[] {
  const prefixes: string[] = [];
  for (const zone of UK_ZONES) {
    if (zoneIds.includes(zone.id)) {
      prefixes.push(...zone.postcodePrefixes);
    }
  }
  return prefixes;
}
