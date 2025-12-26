import {TokenRingPlugin} from "@tokenring-ai/app";
import {z} from "zod";
import CodeWatchService from "./CodeWatchService.ts";
import {CodeWatchConfigSchema} from "./index.ts";
import packageJSON from './package.json' with {type: 'json'};

const packageConfigSchema = z.object({
  codewatch: CodeWatchConfigSchema.optional(),
});

export default {
  name: packageJSON.name,
  version: packageJSON.version,
  description: packageJSON.description,
  install(app, config) {
    // const config = app.getConfigSlice('codewatch', CodeWatchConfigSchema.optional());
    if (config.codewatch) {
      app.addServices(new CodeWatchService(app, config.codewatch));
    }
  },
  config: packageConfigSchema
} satisfies TokenRingPlugin<typeof packageConfigSchema>;
