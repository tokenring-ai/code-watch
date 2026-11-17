import type { ConfigFieldMeta } from "@tokenring-ai/app/config/metadata";
import { z } from "zod";

export const CodeWatchConfigSchema = z
  .object({
    agentType: z.string().meta({ description: "Agent type spawned to act on AI! comments in write-allowed host paths" } satisfies ConfigFieldMeta),
    pollInterval: z
      .number()
      .default(1000)
      .meta({ unit: "ms", advanced: true, description: "How often to poll for file changes" } satisfies ConfigFieldMeta),
    stabilityThreshold: z
      .number()
      .default(2000)
      .meta({ unit: "ms", advanced: true, description: "Quiet time required before a changed file is considered stable" } satisfies ConfigFieldMeta),
    /** Removed: code-watch used to be keyed by filesystem provider. It now watches every write-allowed host path once. */
    filesystems: z.never().exactOptional(),

    concurrency: z
      .number()
      .default(1)
      .meta({ description: "Maximum number of change-handling agents running at once" } satisfies ConfigFieldMeta),
  })
  .meta({ label: "Code Watch", description: "Watches host files and spawns agents in response to AI! comments" } satisfies ConfigFieldMeta);

export { default as CodeWatchService } from "./CodeWatchService.ts";
