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
    app.addServices(new CodeWatchService(app));
  },
  async reconfigure(app, config) {
    if (config.codewatch) {
      await app.requireService(CodeWatchService).reconfigure(config.codewatch);
    }
  },
  configSchema: packageConfigSchema,
} satisfies TokenRingPlugin<typeof packageConfigSchema>;
