import { z } from "zod";

export const videoCompleteBody = z.object({
  advertisementId: z.string().uuid(),
});

export const treasureBoxIdParams = z.object({
  treasureBoxId: z.string().uuid(),
});
