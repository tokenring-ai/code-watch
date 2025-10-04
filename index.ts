import {AgentTeam, TokenRingPackage} from "@tokenring-ai/agent";
import {z} from "zod";
import CodeWatchService from "./CodeWatchService.ts";
import packageJSON from './package.json' with {type: 'json'};

export const CodeWatchConfigSchema = z.any().optional();

export const packageInfo: TokenRingPackage = {
  name: packageJSON.name,
  version: packageJSON.version,
  description: packageJSON.description,
  install(agentTeam: AgentTeam) {
    const config = agentTeam.getConfigSlice('codewatch', CodeWatchConfigSchema);
    if (config) {
      agentTeam.addServices(new CodeWatchService(config));
    }
  }
};

export {default as CodeWatchService} from "./CodeWatchService.ts";
