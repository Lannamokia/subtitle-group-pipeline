import { z } from "zod";

export const updateBrandingSchema = z.object({
  app_name: z.string().trim().min(1, "App name is required").max(80, "App name is too long"),
});

export type UpdateBrandingInput = z.infer<typeof updateBrandingSchema>;
