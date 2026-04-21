import { type Agent, AgentCommandService, AgentManager } from "@tokenring-ai/agent";
import type TokenRingApp from "@tokenring-ai/app";
import type { TokenRingService } from "@tokenring-ai/app/types";
import FileSystemService from "@tokenring-ai/filesystem/FileSystemService";
import createIgnoreFilter from "@tokenring-ai/filesystem/util/createIgnoreFilter";
import waitForAbort from "@tokenring-ai/utility/promise/waitForAbort";
import async from "async";
import type z from "zod";
import type { CodeWatchConfigSchema } from "./index.ts";

type FileSystemConfig = {
  pollInterval: number;
  stabilityThreshold: number;
  agentType: string;
};

export default class CodeWatchService implements TokenRingService {
  readonly name = "CodeWatchService";
  description = "Provides CodeWatch functionality that monitors files for AI comments";
  readonly workQueue: async.QueueObject<{
    filePath: string;
    fileSystemProviderName: string;
  }>;

  constructor(
    readonly app: TokenRingApp,
    readonly config: z.output<typeof CodeWatchConfigSchema>,
  ) {
    this.workQueue = async.queue<{
      filePath: string;
      fileSystemProviderName: string;
    }>(async (task, callback) => {
      try {
        await this.processFileForAIComments(task);
      } catch (err: unknown) {
        app.serviceError(this, `Error processing file ${task.filePath}:`, err);
      }
      callback();
    }, config.concurrency);
  }

  /**
   * Start the CodeWatchService
   */
  async run(signal: AbortSignal): Promise<void> {
    await Promise.all(
      Object.entries(this.config.filesystems).map(([filesystemProviderName, filesystemConfig]) =>
        this.watchFileSystem(filesystemProviderName, filesystemConfig, signal),
      ),
    );
  }

  async watchFileSystem(fileSystemProviderName: string, filesystemConfig: FileSystemConfig, signal: AbortSignal): Promise<void> {
    const fileSystemService = this.app.requireService(FileSystemService);
    const fileSystemProvider = fileSystemService.requireFileSystemProviderByName(fileSystemProviderName);

    if (!fileSystemProvider.watch) {
      throw new Error(`File system provider '${fileSystemProviderName}' does not support watching`);
    }

    // Use the virtual file system's watch method to create a watcher
    const watcher = await fileSystemProvider.watch("./", {
      pollInterval: filesystemConfig.pollInterval,
      stabilityThreshold: filesystemConfig.stabilityThreshold,
      ignoreFilter: await createIgnoreFilter(fileSystemProvider),
    });

    const modifiedFiles = new Map<string, NodeJS.Timeout>();

    const onFileChanged = (eventType: string, filePath: string) => {
      if (modifiedFiles.has(filePath)) {
        clearTimeout(modifiedFiles.get(filePath));
        modifiedFiles.delete(filePath);
      }

      if (eventType === "add" || eventType === "change") {
        modifiedFiles.set(
          filePath,
          setTimeout(() => {
            void this.workQueue.push({ filePath, fileSystemProviderName });
          }),
        );
      }
    };

    // Set up event handlers
    watcher
      .on("add", (filePath: string) => onFileChanged("add", filePath))
      .on("change", (filePath: string) => onFileChanged("change", filePath))
      .on("unlink", (filePath: string) => onFileChanged("unlink", filePath))
      .on("error", (error: unknown) => this.app.serviceError(this, "Error in file watcher:", error));

    return waitForAbort(signal, _ev => {
      watcher.close();
    });
  }

  /**
   * Process a file to look for AI comments
   */
  async processFileForAIComments({ filePath, fileSystemProviderName }: { filePath: string; fileSystemProviderName: string }): Promise<void> {
    const fileSystemService = this.app.requireService(FileSystemService);
    const fileSystemProvider = fileSystemService.requireFileSystemProviderByName(fileSystemProviderName);

    const text = await fileSystemProvider.readFile(filePath);
    if (!text) return;

    const lines = text.toString("utf-8").split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Check for Python/shell style comments (# ...)
      if (line.startsWith("#")) {
        await this.checkAndTriggerAIAction(line, filePath, i + 1, fileSystemProviderName);
      }
      // Check for C-style comments (// ...)
      else if (line.startsWith("//")) {
        await this.checkAndTriggerAIAction(line, filePath, i + 1, fileSystemProviderName);
      }
    }
  }

  /**
   * Check if a comment line contains AI triggers and handle them
   * @param line - The comment line (already trimmed)
   * @param filePath - Path to the file containing the comment
   * @param lineNumber - Line number in the file
   * @param fileSystemProviderName
   */
  async checkAndTriggerAIAction(line: string, filePath: string, lineNumber: number, fileSystemProviderName: string): Promise<void> {
    // Check for AI! triggers in the line
    // Pattern 1: Line starts with # AI or // AI (comment at beginning of line)
    const startsWithAIPattern = line.startsWith("# AI") || line.startsWith("// AI");
    // Pattern 2: Line contains AI! anywhere (for inline comments or end-of-line triggers)
    const containsAIExclamation = line.includes("AI!");

    if (startsWithAIPattern || containsAIExclamation) {
      await this.handleAIComment(line, filePath, lineNumber, fileSystemProviderName);
    }
  }

  /**
   * Handle an AI comment based on its type
   * @param commentLine - The comment line
   * @param filePath - Path to the file containing the comment
   * @param lineNumber - Line number in the file
   * @param fileSystemProviderName
   */
  async handleAIComment(commentLine: string, filePath: string, lineNumber: number, fileSystemProviderName: string): Promise<void> {
    // Extract the actual comment content (remove the comment marker)
    let content = commentLine.trim();
    if (commentLine.startsWith("# ")) {
      content = commentLine.substring(2);
    } else if (commentLine.startsWith("// ")) {
      content = commentLine.substring(3);
    }

    if (content.includes("AI!")) {
      await this.triggerCodeModification(content, filePath, lineNumber, fileSystemProviderName);
    }
  }

  /**
   * Trigger code modification based on AI! comment
   * @param content - Content of the comment
   * @param filePath - Path to the file containing the comment
   * @param lineNumber - Line number in the file
   * @param fileSystemProviderName
   */
  async triggerCodeModification(_content: string, filePath: string, lineNumber: number, fileSystemProviderName: string): Promise<void> {
    const agentManager = this.app.requireService(AgentManager);
    const fileSystemService = this.app.requireService(FileSystemService);
    const config = this.config.filesystems[fileSystemProviderName];

    let agent: Agent;
    try {
      agent = agentManager.spawnAgent({
        agentType: config.agentType,
        headless: true,
      });
    } catch (error: unknown) {
      this.app.serviceError(this, `Failed to spawn agent for code modification at ${filePath}:${lineNumber}:`, error);
      return;
    }

    fileSystemService.setActiveFileSystem(fileSystemProviderName, agent);
    this.app.serviceOutput(this, `Code modification triggered from ${filePath}:${lineNumber}, running a Code Modification Agent`);
    await this.runCodeModification(
      `
The user has edited the file ${filePath}, included above, adding instructions to the file, which they expect AI to execute.
Look for any lines in the file marked with the tag AI!, which contain the users instructions.
Complete the instructions in that line or in any nearby comments, using any tools available to you to complete the task.
Once complete, update the file using the file_write tool. You MUST remove any lines that end with AI!. It is a critical failure to leave these lines in the file.

`.trim(),
      filePath,
      agent,
    );
  }

  async runCodeModification(prompt: string, filePath: string, agent: Agent) {
    const fileSystemService = this.app.requireService(FileSystemService);
    await fileSystemService.addFileToChat(filePath, agent);

    const agentCommandService = agent.requireServiceByType(AgentCommandService);

    await agentCommandService.executeAgentCommand(agent, `/work ${prompt}`);
  }
}
