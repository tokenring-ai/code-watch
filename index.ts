import TokenRingApp from "@tokenring-ai/app";
import {TokenRingPlugin} from "@tokenring-ai/app";
import {z} from "zod";
import CodeWatchService from "./CodeWatchService.ts";
import packageJSON from './package.json' with {type: 'json'};

export const CodeWatchConfigSchema = z.any().optional();

export default {
  name: packageJSON.name,
  version: packageJSON.version,
  description: packageJSON.description,
  install(app: TokenRingApp) {
    const config = app.getConfigSlice('codewatch', CodeWatchConfigSchema);
    if (config) {
      app.addServices(new CodeWatchService(app, config));
    }
  }
} as TokenRingPlugin;

export {default as CodeWatchService} from "./CodeWatchService.ts";
