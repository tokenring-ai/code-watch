import {z} from "zod";

export const CodeWatchConfigSchema = z.any().optional();


export {default as CodeWatchService} from "./CodeWatchService.ts";
