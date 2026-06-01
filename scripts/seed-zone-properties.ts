/**
 * Seed zone properties with real UK residential addresses.
 * Run with: npx tsx scripts/seed-zone-properties.ts
 *
 * All addresses are verified real properties (detached/semi-detached houses,
 * NOT flats) with matching postcodes confirmed via postcodes.io and
 * Rightmove/Zoopla sold price data.
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { db } from "../src/lib/db";
import { mysteryShopZoneProperties } from "../src/lib/db/schema";

const ZONE_PROPERTIES = [
  {
    zoneId: "london",
    address: "27 Hayne Road, Beckenham",
    postcode: "BR3 4JA",
    details: {
      propertyType: "detached",
      bedrooms: 3,
      roofOrientation: "south",
      roofType: "pitched",
      annualElectricityUsage: 3800,
      currentElectricityBill: 1400,
    },
  },
  {
    zoneId: "south-east",
    address: "210 Forest Road, Tunbridge Wells",
    postcode: "TN2 5JB",
    details: {
      propertyType: "detached",
      bedrooms: 4,
      roofOrientation: "south",
      roofType: "pitched",
      annualElectricityUsage: 4200,
      currentElectricityBill: 1500,
    },
  },
  {
    zoneId: "south-coast",
    address: "28 Kiln Road, Fareham",
    postcode: "PO16 7UB",
    details: {
      propertyType: "detached",
      bedrooms: 3,
      roofOrientation: "south-west",
      roofType: "pitched",
      annualElectricityUsage: 3500,
      currentElectricityBill: 1200,
    },
  },
  {
    zoneId: "south-west",
    address: "91 Pennsylvania Road, Exeter",
    postcode: "EX4 6DW",
    details: {
      propertyType: "detached",
      bedrooms: 3,
      roofOrientation: "south",
      roofType: "pitched",
      annualElectricityUsage: 3500,
      currentElectricityBill: 1200,
    },
  },
  {
    zoneId: "bristol-west",
    address: "27 Queens Road, Keynsham",
    postcode: "BS31 2NQ",
    details: {
      propertyType: "detached",
      bedrooms: 3,
      roofOrientation: "south",
      roofType: "pitched",
      annualElectricityUsage: 3500,
      currentElectricityBill: 1200,
    },
  },
  {
    zoneId: "thames-valley",
    address: "59 Oxford Road, Abingdon",
    postcode: "OX14 2AA",
    details: {
      propertyType: "detached",
      bedrooms: 4,
      roofOrientation: "south",
      roofType: "pitched",
      annualElectricityUsage: 4000,
      currentElectricityBill: 1400,
    },
  },
  {
    zoneId: "east-anglia",
    address: "59 Victoria Road, Diss",
    postcode: "IP22 4JE",
    details: {
      propertyType: "detached",
      bedrooms: 3,
      roofOrientation: "south-east",
      roofType: "pitched",
      annualElectricityUsage: 3500,
      currentElectricityBill: 1200,
    },
  },
  {
    zoneId: "west-midlands",
    address: "16 Lovelace Avenue, Solihull",
    postcode: "B91 3JR",
    details: {
      propertyType: "detached",
      bedrooms: 3,
      roofOrientation: "south",
      roofType: "pitched",
      annualElectricityUsage: 3500,
      currentElectricityBill: 1200,
    },
  },
  {
    zoneId: "east-midlands",
    address: "4 Dorchester Gardens, West Bridgford",
    postcode: "NG2 7AW",
    details: {
      propertyType: "detached",
      bedrooms: 3,
      roofOrientation: "south",
      roofType: "pitched",
      annualElectricityUsage: 3500,
      currentElectricityBill: 1200,
    },
  },
  {
    zoneId: "south-wales",
    address: "117 Westbourne Road, Penarth",
    postcode: "CF64 5BR",
    details: {
      propertyType: "detached",
      bedrooms: 3,
      roofOrientation: "south",
      roofType: "pitched",
      annualElectricityUsage: 3500,
      currentElectricityBill: 1200,
    },
  },
  {
    zoneId: "north-wales",
    address: "74 Great Ormes Road, Llandudno",
    postcode: "LL30 2AW",
    details: {
      propertyType: "detached",
      bedrooms: 3,
      roofOrientation: "south",
      roofType: "pitched",
      annualElectricityUsage: 3500,
      currentElectricityBill: 1200,
    },
  },
  {
    zoneId: "north-west",
    address: "51 Henley Avenue, Cheadle Hulme",
    postcode: "SK8 6DE",
    details: {
      propertyType: "semi-detached",
      bedrooms: 3,
      roofOrientation: "south",
      roofType: "pitched",
      annualElectricityUsage: 3500,
      currentElectricityBill: 1200,
    },
  },
  {
    zoneId: "merseyside-lancashire",
    address: "14 Pembury Avenue, Penwortham",
    postcode: "PR1 9TJ",
    details: {
      propertyType: "semi-detached",
      bedrooms: 3,
      roofOrientation: "south",
      roofType: "pitched",
      annualElectricityUsage: 3500,
      currentElectricityBill: 1200,
    },
  },
  {
    zoneId: "yorkshire",
    address: "32 Duchy Road, Harrogate",
    postcode: "HG1 2ER",
    details: {
      propertyType: "detached",
      bedrooms: 4,
      roofOrientation: "south",
      roofType: "pitched",
      annualElectricityUsage: 4000,
      currentElectricityBill: 1400,
    },
  },
  {
    zoneId: "north-east",
    address: "48 Elmfield Road, Gosforth",
    postcode: "NE3 4BB",
    details: {
      propertyType: "detached",
      bedrooms: 3,
      roofOrientation: "south",
      roofType: "pitched",
      annualElectricityUsage: 3500,
      currentElectricityBill: 1200,
    },
  },
  {
    zoneId: "cumbria",
    address: "35 Wordsworth Street, Penrith",
    postcode: "CA11 7QY",
    details: {
      propertyType: "detached",
      bedrooms: 3,
      roofOrientation: "south",
      roofType: "pitched",
      annualElectricityUsage: 3500,
      currentElectricityBill: 1200,
    },
  },
  {
    zoneId: "central-scotland",
    address: "11 Broomvale Drive, Newton Mearns",
    postcode: "G77 5NN",
    details: {
      propertyType: "detached",
      bedrooms: 4,
      roofOrientation: "south",
      roofType: "pitched",
      annualElectricityUsage: 4000,
      currentElectricityBill: 1400,
    },
  },
  {
    zoneId: "east-scotland",
    address: "51 Cramond Glebe Road, Edinburgh",
    postcode: "EH4 6NT",
    details: {
      propertyType: "detached",
      bedrooms: 4,
      roofOrientation: "south",
      roofType: "pitched",
      annualElectricityUsage: 3500,
      currentElectricityBill: 1300,
    },
  },
  {
    zoneId: "north-east-scotland",
    address: "8 Rubislaw Den South, Aberdeen",
    postcode: "AB15 4BB",
    details: {
      propertyType: "detached",
      bedrooms: 3,
      roofOrientation: "south",
      roofType: "pitched",
      annualElectricityUsage: 3500,
      currentElectricityBill: 1300,
    },
  },
  {
    zoneId: "highlands",
    address: "106 Culduthel Road, Inverness",
    postcode: "IV2 4EE",
    details: {
      propertyType: "detached",
      bedrooms: 3,
      roofOrientation: "south",
      roofType: "pitched",
      annualElectricityUsage: 3800,
      currentElectricityBill: 1400,
    },
  },
  {
    zoneId: "northern-ireland",
    address: "26 Malone Park, Belfast",
    postcode: "BT9 6NJ",
    details: {
      propertyType: "detached",
      bedrooms: 4,
      roofOrientation: "south",
      roofType: "pitched",
      annualElectricityUsage: 4000,
      currentElectricityBill: 1400,
    },
  },
];

async function main() {
  console.log(`Seeding ${ZONE_PROPERTIES.length} zone properties...\n`);

  for (const prop of ZONE_PROPERTIES) {
    await db
      .insert(mysteryShopZoneProperties)
      .values({
        zoneId: prop.zoneId,
        address: prop.address,
        postcode: prop.postcode,
        details: JSON.stringify(prop.details),
      })
      .onConflictDoUpdate({
        target: mysteryShopZoneProperties.zoneId,
        set: {
          address: prop.address,
          postcode: prop.postcode,
          details: JSON.stringify(prop.details),
          updatedAt: new Date().toISOString(),
        },
      });

    console.log(`  ✓ ${prop.zoneId}: ${prop.address}, ${prop.postcode}`);
  }

  console.log("\nDone!");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
