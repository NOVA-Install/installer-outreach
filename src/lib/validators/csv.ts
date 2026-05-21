import { z } from "zod/v4";

export const csvRowSchema = z.object({
  "Company Name": z.string().min(1),
  "Certification Number": z.string().optional().default(""),
  "Certification Body": z.string().optional().default(""),
  Email: z.string().optional().default(""),
  Telephone: z.string().optional().default(""),
  Website: z.string().optional().default(""),
  Address: z.string().optional().default(""),
  County: z.string().optional().default(""),
  Postcode: z.string().optional().default(""),
  Country: z.string().optional().default(""),
  Latitude: z.coerce.number().optional(),
  Longitude: z.coerce.number().optional(),
  "Boiler Upgrade Scheme": z.string().optional().default(""),
  "Technologies Certified": z.string().optional().default(""),
  "Regions Covered": z.string().optional().default(""),
  "Installer ID": z.string().optional().default(""),
});

export type CsvRow = z.infer<typeof csvRowSchema>;
