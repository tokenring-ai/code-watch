import type { TokenRingPlugin } from "@tokenring-ai/app";
import { z } from "zod";
import CodeWatchService from "./CodeWatchService.ts";
import { CodeWatchConfigSchema } from "./index.ts";
import packageJSON from "./package.json" with { type: "json" };

const packageConfigSchema = z.object({
  codewatch: CodeWatchConfigSchema.exactOptional(),
});

export default {
  name: packageJSON.name,
  displayName: "Code Watcher",
  version: packageJSON.version,
  description: packageJSON.description,
  install(app) {
    app.addService(CodeWatchService, new CodeWatchService(app));
  },
  async reconfigure(app, config) {
    // Also when the key was removed, so the watcher stops.
    await app.requireService(CodeWatchService).reconfigure(config.codewatch);
  },
  configSchema: packageConfigSchema,
} satisfies TokenRingPlugin<typeof packageConfigSchema>;
