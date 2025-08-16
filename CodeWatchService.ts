import {createChatRequest, ModelRegistry} from "@token-ring/ai-client";
import {ChatInputMessage} from "@token-ring/ai-client/client/AIChatClient";
import ChatService from "@token-ring/chat/ChatService";
import FileSystemService from "@token-ring/filesystem/FileSystemService";
import {Registry, Service} from "@token-ring/registry";

// Minimal types to match the runtime behavior
type Watcher = {
  on: (event: string, cb: (...args: any[]) => void) => Watcher;
  close: () => Promise<void> | void;
};

type FileSystemLike = {
  watch: (path: string, opts?: Record<string, any>) => Promise<Watcher> | Watcher;
  getFile: (path: string) => Promise<string | Buffer>;
};


export default class CodeWatchService extends Service {
  name = "CodeWatchService";
  description =
    "Provides CodeWatch functionality that monitors files for AI comments";
  isProcessing = false;
  modifiedFiles: Set<string> = new Set();
  private watcher: Watcher | null;
  private fileSystem: FileSystemLike | null;
  private registry!: Registry;

  constructor() {
    super();
    this.watcher = null;
    this.fileSystem = null;
  }

  /**
   * Start the CodeWatchService
   * @param registry - The package registry
   */
  async start(registry: Registry): Promise<void> {
    this.registry = registry;
    this.fileSystem = registry.getFirstServiceByType(FileSystemService) as FileSystemLike | null;

    // Start watching the root directory for changes
    await this.startWatching();
  }

  /**
   * Stop the service and clean up resources
   */
  async stop(_registry?: unknown): Promise<void> {
    await this.stopWatching();
  }

  /**
   * Start watching the directory for file changes using the provided FileSystem
   */
  async startWatching(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
    }

    if (!this.fileSystem) {
      throw new Error("No virtual file system provided for watching");
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
      this.watcher = null;
    }
  }

  /**
   * Handle file change events from the watcher
   * @param eventType - 'add', 'change', or 'unlink'
   * @param filePath - Path to the file (relative to rootDirectory)
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
        console.error(`Error processing file ${filePath}:`, error);
      }
    }
    this.isProcessing = false;
    // noinspection ES6MissingAwait
    void this.processNextFile();
  }

  /**
   * Process a file to look for AI comments
   * @param filePath - Absolute path to the file
   */
  async processFileForAIComments(filePath: string): Promise<void> {
    try {
      if (!this.fileSystem) throw new Error("File system not initialized");
      const content = await this.fileSystem.getFile(filePath);
      const text = typeof content === "string" ? content : content.toString();
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
    } catch (error) {
      console.error(
        `Error processing file ${filePath} for AI comments:`,
        error,
      );
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
    const chatService = this.registry.requireFirstServiceByType(ChatService) as any;
    const modelRegistry =
      this.registry.requireFirstServiceByType(ModelRegistry) as any;

    chatService.systemLine(
      `[CodeWatchService] Code modification triggered from ${filePath}:${lineNumber}`,
    );
    chatService.systemLine(`[CodeWatchService] Instruction: ${content}`);

    if (!this.fileSystem) throw new Error("File system not initialized");
    const fileContent = await this.fileSystem.getFile(filePath);
    const fileText = typeof fileContent === "string" ? fileContent : fileContent.toString();

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

    chatService.systemLine(
      `[CodeWatchService] Using model ${client.getModelId()}`,
    );

    const request = await createChatRequest(
      {input, systemPrompt},
      this.registry,
    );

    const [output] = await client.textChat(request, this.registry);

    chatService.systemLine(`[CodeWatchService] Code modification complete:`);
    for (const line of String(output).split("\n")) {
      chatService.systemLine(`[CodeWatchService] ${line}`);
    }
  }

  /**
   * Mock function to trigger question answering based on AI? comment
   * @param content - Content of the comment
   * @param filePath - Path to the file containing the comment
   * @param lineNumber - Line number in the file
   */
  async triggerQuestionAnswer(content: string, filePath: string, lineNumber: number): Promise<void> {
    const chatService = this.registry.requireFirstServiceByType(ChatService) as any;
    chatService.infoLine(
      `[CodeWatchService][AI?] Question answering noted from ${filePath}:${lineNumber}. This feature is not fully implemented yet.`,
    );
    chatService.infoLine(`[CodeWatchService] Question: ${content}`);
    // In a real implementation, this would call an AI service to answer the question
  }

  /**
   * Mock function to note an AI comment without taking immediate action
   * @param content - Content of the comment
   * @param filePath - Path to the file containing the comment
   * @param lineNumber - Line number in the file
   */
  async noteAIComment(content: string, filePath: string, lineNumber: number): Promise<void> {
    const chatService = this.registry.requireFirstServiceByType(ChatService) as any;
    chatService.infoLine(
      `[CodeWatchService][AI] AI comment noted from ${filePath}:${lineNumber}. This feature is not fully implemented yet.`,
    );
    chatService.infoLine(`[CodeWatchService] Note: ${content}`);
    // In a real implementation, this would store the comment for future use
  }
}
