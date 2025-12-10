import {AgentConfig} from "@tokenring-ai/agent/types";

export default {
  name: "Code Modification Agent",
  description: "A code modification agent, to use to work on files",
  category: "Development",
  type: "background",
  visual: {
    color: "blue",
  },
  chat: {
    systemPrompt: `When you output a file with file tool, you MUST remove any lines that end with AI!. It is a critical failure to leave these lines in the file.`,
    maxSteps: 100,
  },

  initialCommands: [
    "/tools enable @tokenring-ai/filesystem/*",
  ]
} satisfies AgentConfig;