import type { ConfigFieldMeta } from "@tokenring-ai/app/config/metadata";
import { z } from "zod";

export const CodeWatchConfigSchema = z
  .object({
    filesystems: z
      .record(
        z.string(),
        z.object({
          pollInterval: z.number().default(1000).meta({ unit: "ms", advanced: true, description: "How often to poll for file changes" } satisfies ConfigFieldMeta),
          stabilityThreshold: z
            .number()
            .default(2000)
            .meta({ unit: "ms", advanced: true, description: "Quiet time required before a changed file is considered stable" } satisfies ConfigFieldMeta),
          agentType: z.string().meta({ description: "Agent type spawned to react to changes in this filesystem" } satisfies ConfigFieldMeta),
        }),
      )
      .meta({ label: "Filesystems", description: "Watched filesystems, keyed by name" } satisfies ConfigFieldMeta),

    concurrency: z.number().default(1).meta({ description: "Maximum number of change-handling agents running at once" } satisfies ConfigFieldMeta),
  })
  .meta({ label: "Code Watch", description: "Watches filesystems and spawns agents in response to changes" } satisfies ConfigFieldMeta);

export { default as CodeWatchService } from "./CodeWatchService.ts";
