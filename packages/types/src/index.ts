import { z } from "zod";

export const TravelerSchema = z.object({
  id: z.string(),
  name: z.string(),
  homeCity: z.string(),
  status: z.enum(["ready", "review", "blocked"])
});

export type Traveler = z.infer<typeof TravelerSchema>;

export * from "./domain";

export * from "./planning";
