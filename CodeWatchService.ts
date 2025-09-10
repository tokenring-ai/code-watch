import {AgentTeam} from "@tokenring-ai/agent";
import {TokenRingService} from "@tokenring-ai/agent/types";
import {createChatRequest, ModelRegistry} from "@tokenring-ai/ai-client";
import {ChatInputMessage} from "@tokenring-ai/ai-client/client/AIChatClient";
import FileSystemService from "@tokenring-ai/filesystem/FileSystemService";

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
  private agentTeam!: AgentTeam;
  private agentTypes: CodeWatchServiceOptions["agentTypes"];

  constructor(config: CodeWatchServiceOptions) {
    this.agentTypes = config.agentTypes
  }

  /**
   * Start the CodeWatchService
   */
  async start(agentTeam: AgentTeam): Promise<void> {
    this.fileSystem = agentTeam.services.requireFirstItemByType(FileSystemService);

    // Start watching the root directory for changes
    await this.startWatching();
  }

  /**
   * Stop the service and clean up resources
   */
  async stop(_agentTeam: AgentTeam): Promise<void> {
    await this.stopWatching();
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
        this.agentTeam.serviceError(`[${pkgName}] Error processing file ${filePath}: ${error}`);
      }
    }
    this.isProcessing = false;
    // noinspection ES6MissingAwait
    void this.processNextFile();
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
    const fileText = await this.fileSystem.getFile(filePath);
    if (!fileText) return;
    const agent = await this.agentTeam.createAgent(this.agentTypes.codeModification);

    const modelRegistry = agent.requireFirstServiceByType(ModelRegistry);

    this.agentTeam.serviceOutput(
      `[CodeWatchService] Code modification triggered from ${filePath}:${lineNumber}, running a ${this.agentTypes.codeModification} agent`,
    );
    agent.infoLine(`[CodeWatchService] Instruction: ${content}`);

    const systemPrompt: ChatInputMessage = {
      role: "system",
      content:
        "When you output a file with file tool, you MUST remove any lines that end with AI!. It is a critical failure to leave these lines in the file.",
    };

    const input: ChatInputMessage[] = [
      {
        role: "user",
        content: `
:The user has edited the file ${filePath}, adding instructions to the file, which they expect AI to execute.
Look for any lines in the file marked with the tag AI!, which contain the users instructions.
Complete the instructions in that line or in any nearby comments, using any tools available to you to complete the task.
Once complete, update the file using the file command. You MUST remove any lines that end with AI!. It is a critical failure to leave these lines in the file.
Afterwards, print a one sentence summary of the changes made to the file.

Here is the current, up to date version of the file ${filePath}:

${fileText}`.trim(),
      },
    ];

    const client = await modelRegistry.chat.getFirstOnlineClient(
      "auto:intelligence>=3,tools>=2",
    );

    agent.infoLine(
      `[CodeWatchService] Using model ${client.getModelId()}`,
    );

    const request = await createChatRequest(
      {input, systemPrompt},
      agent,
    );

    const [output] = await client.textChat(request, agent);

    agent.infoLine(`[CodeWatchService] Code modification complete:`);
    for (const line of String(output).split("\n")) {
      agent.infoLine(`[CodeWatchService] ${line}`);
    }
  }

  /**
   * Mock function to trigger question answering based on AI? comment
   * @param content - Content of the comment
   * @param filePath - Path to the file containing the comment
   * @param lineNumber - Line number in the file
   */
  async triggerQuestionAnswer(content: string, filePath: string, lineNumber: number): Promise<void> {
    this.agentTeam.serviceOutput(
      `[CodeWatchService][AI?] Question answering noted from ${filePath}:${lineNumber}. This feature is not fully implemented yet.`,
    );
    this.agentTeam.serviceOutput(`[CodeWatchService] Question: ${content}`);
    // In a real implementation, this would call an AI service to answer the question
  }

  /**
   * Mock function to note an AI comment without taking immediate action
   * @param content - Content of the comment
   * @param filePath - Path to the file containing the comment
   * @param lineNumber - Line number in the file
   */
  async noteAIComment(content: string, filePath: string, lineNumber: number): Promise<void> {
    this.agentTeam.serviceOutput(
      `[CodeWatchService][AI] AI comment noted from ${filePath}:${lineNumber}. This feature is not fully implemented yet.`,
    );
    this.agentTeam.serviceOutput(`[CodeWatchService] Note: ${content}`);
    // In a real implementation, this would store the comment for future use
  }
}
