import { expireAbandonedUploads, deleteUnneededAudio, requeueStuckUploads } from "../services/housekeeping.service.js";
import { inngest } from "./client.js";

// Runs every 10 minutes. Each task is its own step, so one failing does not repeat the others
export const housekeeping = inngest.createFunction(
  { id: "housekeeping", triggers: [{ cron: "*/10 * * * *" }], retries: 2 },
  async ({ step }) => {
    const now = new Date();
    const expired = await step.run("expire-abandoned-uploads", () => expireAbandonedUploads(now));
    const requeued = await step.run("requeue-stuck-uploads", () => requeueStuckUploads(now));
    const audioDeleted = await step.run("delete-unneeded-audio", () => deleteUnneededAudio(now));
    return { expired, requeued, audioDeleted };
  },
);
