import {AgentManager} from "@tokenring-ai/agent";
import {AgentEventState} from "@tokenring-ai/agent/state/agentEventState";
import TokenRingApp from "@tokenring-ai/app";
import FileSystemService from "@tokenring-ai/filesystem/FileSystemService";
import {TokenRingService} from "@tokenring-ai/app/types";
import waitForAbort from "@tokenring-ai/utility/promise/waitForAbort";
import codeModificationAgent from './agents/codeModificationAgent.js'

const pkgName = "CodeWatchService";

// Minimal types to match the runtime behavior
type Watcher = {
  on: (event: string, cb: (...args: any[]) => void) => Watcher;
  close: () => Promise<void> | void;
};

export type CodeWatchServiceOptions = {
  agentTypes: {
    codeModification: string;
  }
}

export default class CodeWatchService implements TokenRingService {
  name = "CodeWatchService";
  description =
    "Provides CodeWatch functionality that monitors files for AI comments";
  isProcessing = false;
  modifiedFiles: Set<string> = new Set();
  private watcher!: Watcher;
  private fileSystem!: FileSystemService;
  private app: TokenRingApp;
  private agentTypes: CodeWatchServiceOptions["agentTypes"];

  constructor(app: TokenRingApp, config: CodeWatchServiceOptions) {
    this.app = app;
    this.agentTypes = config.agentTypes
  }

  /**
   * Start the CodeWatchService
   */
  async run(signal: AbortSignal): Promise<void> {
    this.fileSystem = this.app.requireService(FileSystemService);

    // Start watching the root directory for changes
    await this.startWatching();

    return waitForAbort(signal, async (ev) => {
      await this.stopWatching();
    });
  }

  /**
   * Start watching the directory for file changes using the provided FileSystem
   */
  async startWatching(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
    }

    // Use the virtual file system's watch method to create a watcher
    this.watcher = await this.fileSystem.watch("./", {
      pollInterval: 1000,
      stabilityThreshold: 2000,
    });

    // Set up event handlers
    this.watcher
      .on("add", (filePath: string) => this.onFileChanged("add", filePath))
      .on("change", (filePath: string) => this.onFileChanged("change", filePath))
      .on("unlink", (filePath: string) => this.onFileChanged("unlink", filePath))
      .on("error", (error: unknown) => console.error("Error in file watcher:", error));
  }

  /**
   * Stop watching for file changes
   */
  async stopWatching(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
    }
  }

  /**
   * Handle file change events from the watcher
   */
  onFileChanged(eventType: string, filePath: string): void {
    if (eventType === "add" || eventType === "change") {
      // Add the file to the modified files set
      this.modifiedFiles.add(filePath);

      // noinspection JSIgnoredPromiseFromCall
      void this.processNextFile();
    }
  }

  /**
   * Process the next file in the queue if not currently processing
   */
  async processNextFile(): Promise<void> {
    if (this.isProcessing) {
      return;
    }
    if (this.modifiedFiles.size === 0) {
      return;
    }

    const myFiles = this.modifiedFiles;
    this.modifiedFiles = new Set();
    this.isProcessing = true;
    for (const filePath of myFiles) {
      try {
        await this.processFileForAIComments(filePath);
      } catch (error) {
        this.app.serviceError(`[${pkgName}] Error processing file ${filePath}: ${error}`);
      }
    }
    this.isProcessing = false;

    this.app.trackPromise(this.processNextFile);
  }

  /**
   * Process a file to look for AI comments
   */
  async processFileForAIComments(filePath: string): Promise<void> {
    const text = await this.fileSystem.getFile(filePath);
    if (!text) return;

    const lines = text.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Check for Python/shell style comments (# ...)
      if (line.startsWith("#")) {
        await this.checkAndTriggerAIAction(line, filePath, i + 1);
      }
      // Check for C-style comments (// ...)
      else if (line.startsWith("//")) {
        await this.checkAndTriggerAIAction(line, filePath, i + 1);
      }
    }
  }

  /**
   * Check if a comment line contains AI triggers and handle them
   * @param line - The comment line
   * @param filePath - Path to the file containing the comment
   * @param lineNumber - Line number in the file
   */
  async checkAndTriggerAIAction(line: string, filePath: string, lineNumber: number): Promise<void> {
    // Check for comments that start with AI, AI!, or AI? --
    if (line.startsWith("# AI") || line.startsWith("// AI")) {
      await this.handleAIComment(line, filePath, lineNumber);
    }
    // Check for comments that end with AI, AI!, or AI? --
    else if (
      line.endsWith("AI") ||
      line.endsWith("AI!") ||
      line.endsWith("AI?")
    ) {
      await this.handleAIComment(line, filePath, lineNumber);
    }
  }

  /**
   * Handle an AI comment based on its type
   * @param commentLine - The comment line
   * @param filePath - Path to the file containing the comment
   * @param lineNumber - Line number in the file
   */
  async handleAIComment(commentLine: string, filePath: string, lineNumber: number): Promise<void> {
    // Extract the actual comment content (remove the comment marker)
    let content = commentLine.trim();
    if (commentLine.startsWith("# ")) {
      content = commentLine.substring(2);
    } else if (commentLine.startsWith("// ")) {
      content = commentLine.substring(3);
    }

    if (content.includes("AI!")) {
      await this.triggerCodeModification(content, filePath, lineNumber);
    } else if (commentLine.includes("AI?")) {
      // this.triggerQuestionAnswer(content, filePath, lineNumber);
    } else if (commentLine.includes("AI")) {
      // this.noteAIComment(content, filePath, lineNumber);
    }
  }

  /**
   * Trigger code modification based on AI! comment
   * @param content - Content of the comment
   * @param filePath - Path to the file containing the comment
   * @param lineNumber - Line number in the file
   */
  async triggerCodeModification(content: string, filePath: string, lineNumber: number): Promise<void> {
    const agentManager = this.app.requireService(AgentManager)
    const fileText = await this.fileSystem.getFile(filePath);
    if (!fileText) return;

    const agent = await agentManager.spawnAgentFromConfig(codeModificationAgent, { headless: true });

    this.app.serviceOutput(
      `[CodeWatchService] Code modification triggered from ${filePath}:${lineNumber}, running a ${this.agentTypes.codeModification} agent`,
    );
    agent.infoLine(`[CodeWatchService] Instruction: ${content}`);

    try {
      const message = `
    /chat The user has edited the file ${filePath}, adding instructions to the file, which they expect AI to execute.
    Look for any lines in the file marked with the tag AI!, which contain the users instructions.
    Complete the instructions in that line or in any nearby comments, using any tools available to you to complete the task.
    Once complete, update the file using the file command. You MUST remove any lines that end with AI!. It is a critical failure to leave these lines in the file.
    Afterwards, print a one sentence summary of the changes made to the file.

    Here is the current, up to date version of the file ${filePath}:

    ${fileText}`.trim();

      const abortController = new AbortController();

      // Wait for agent to be idle before sending new message
      const initialState = await agent.waitForState(AgentEventState, (state) => state.idle);
      const eventCursor = initialState.getEventCursorFromCurrentPosition();

      // Send the message to the agent
      const requestId = agent.handleInput({message});

      // Subscribe to agent events to process the response
      const unsubscribe = agent.subscribeState(AgentEventState, (state) => {
        for (const event of state.yieldEventsByCursor(eventCursor)) {
          switch (event.type) {
            case 'output.info':
            case 'output.warning':
              this.app.serviceOutput(`[CodeWatchService] ${event.message}`);
              break;
            case 'output.error':
              this.app.serviceError(`[CodeWatchService] ${event.message}`);
              break;
            case "input.handled":
              if (event.requestId === requestId) {
                unsubscribe();
                agent.infoLine(`[CodeWatchService] Code modification complete`);
                return;
              }
              break;
          }
        }
      });

      // Set timeout for the response
      if (agent.config.maxRunTime > 0) {
        setTimeout(() => {
          unsubscribe();
          this.app.serviceOutput(`[CodeWatchService] Code modification timed out after ${agent.config.maxRunTime} seconds.`);
        }, agent.config.maxRunTime * 1000);
      }
    } finally {
      await agentManager.deleteAgent(agent);
    }
  }

  /**
   * Mock function to trigger question answering based on AI? comment
   * @param content - Content of the comment
   * @param filePath - Path to the file containing the comment
   * @param lineNumber - Line number in the file
   */
  async triggerQuestionAnswer(content: string, filePath: string, lineNumber: number): Promise<void> {
    this.app.serviceOutput(
      `[CodeWatchService][AI?] Question answering noted from ${filePath}:${lineNumber}. This feature is not fully implemented yet.`,
    );
    this.app.serviceOutput(`[CodeWatchService] Question: ${content}`);
    // In a real implementation, this would call an AI service to answer the question
  }

  /**
   * Mock function to note an AI comment without taking immediate action
   * @param content - Content of the comment
   * @param filePath - Path to the file containing the comment
   * @param lineNumber - Line number in the file
   */
  async noteAIComment(content: string, filePath: string, lineNumber: number): Promise<void> {
    this.app.serviceOutput(
      `[CodeWatchService][AI] AI comment noted from ${filePath}:${lineNumber}. This feature is not fully implemented yet.`,
    );
    this.app.serviceOutput(`[CodeWatchService] Note: ${content}`);
    // In a real implementation, this would store the comment for future use
  }
}