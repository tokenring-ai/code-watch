import TokenRingApp from "@tokenring-ai/app";
import {TokenRingPlugin} from "@tokenring-ai/app";
import CodeWatchService from "./CodeWatchService.ts";
import {CodeWatchConfigSchema} from "./index.ts";
import packageJSON from './package.json' with {type: 'json'};


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
} satisfies TokenRingPlugin;
