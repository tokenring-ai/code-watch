import { Service } from "@token-ring/registry";
import FileSystemService from "@token-ring/filesystem/FileSystemService";
import ChatService from "@token-ring/chat/ChatService";
import { ModelRegistry, createChatRequest } from "@token-ring/ai-client";

export default class CodeWatchService extends Service {
	name = "CodeWatchService";
	description =
		"Provides CodeWatch functionality that monitors files for AI comments";

	constructor() {
		super();
		this.watcher = null;
		this.fileSystem = null;
	}

	isProcessing = false;
	modifiedFiles = new Set();

	/**
	 * Start the CodeWatchService
	 * @param {TokenRingRegistry} registry - The package registry
	 */
	async start(registry) {
		this.registry = registry;
		this.fileSystem = registry.getFirstServiceByType(FileSystemService);

		// Start watching the root directory for changes
		await this.startWatching();
	}

	/**
	 * Stop the service and clean up resources
	 */
	async stop(registry) {
		await this.stopWatching();
	}

	/**
	 * Start watching the directory for file changes using the provided FileSystem
	 */
	async startWatching() {
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
			.on("add", (filePath) => this.onFileChanged("add", filePath))
			.on("change", (filePath) => this.onFileChanged("change", filePath))
			.on("unlink", (filePath) => this.onFileChanged("unlink", filePath))
			.on("error", (error) => console.error("Error in file watcher:", error));
	}

	/**
	 * Stop watching for file changes
	 */
	async stopWatching() {
		if (this.watcher) {
			await this.watcher.close();
			this.watcher = null;
		}
	}

	/**
	 * Handle file change _events from the watcher
	 * @param {string} eventType - 'add', 'change', or 'unlink'
	 * @param {string} filePath - Path to the file (relative to rootDirectory)
	 */
	onFileChanged(eventType, filePath) {
		if (eventType === "add" || eventType === "change") {
			// Add the file to the modified files set
			this.modifiedFiles.add(filePath);

			// noinspection JSIgnoredPromiseFromCall
			this.processNextFile();
		}
	}

	/**
	 * Process the next file in the queue if not currently processing
	 */
	async processNextFile() {
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
		this.processNextFile();
	}

	/**
	 * Process a file to look for AI comments
	 * @param {string} filePath - Absolute path to the file
	 */
	async processFileForAIComments(filePath) {
		try {
			const content = await this.fileSystem.getFile(filePath);
			const lines = content.toString().split("\n");

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
	 * @param {string} line - The comment line
	 * @param {string} filePath - Path to the file containing the comment
	 * @param {number} lineNumber - Line number in the file
	 */
	async checkAndTriggerAIAction(line, filePath, lineNumber) {
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
	 * @param {string} commentLine - The comment line
	 * @param {string} filePath - Path to the file containing the comment
	 * @param {number} lineNumber - Line number in the file
	 */
	async handleAIComment(commentLine, filePath, lineNumber) {
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
			//this.triggerQuestionAnswer(content, filePath, lineNumber);
		} else if (commentLine.includes("AI")) {
			//this.noteAIComment(content, filePath, lineNumber);
		}
	}

	/**
	 * Trigger code modification based on AI! comment
	 * @param {string} content - Content of the comment
	 * @param {string} filePath - Path to the file containing the comment
	 * @param {number} lineNumber - Line number in the file
	 */
	async triggerCodeModification(content, filePath, lineNumber) {
		const chatService = this.registry.requireFirstServiceByType(ChatService);
		const modelRegistry =
			this.registry.requireFirstServiceByType(ModelRegistry);

		chatService.systemLine(
			`[CodeWatchService] Code modification triggered from ${filePath}:${lineNumber}`,
		);
		chatService.systemLine(`[CodeWatchService] Instruction: ${content}`);

		const fileContent = await this.fileSystem.getFile(filePath);

		const systemPrompt = {
			role: "system",
			content:
				"When you output a file with file tool, you MUST remove any lines that end with AI!. It is a critical failure to leave these lines in the file.",
		};

		const input = [
			{
				role: "user",
				content: `
The user has edited the file ${filePath}, adding instructions to the file, which they expect AI to execute.
Look for any lines in the file marked with the tag AI!, which contain the users instructions.
Complete the instructions in that line or in any nearby comments, using any tools available to you to complete the task.
Once complete, update the file using the file command. You MUST remove any lines that end with AI!. It is a critical failure to leave these lines in the file.
Afterwards, print a one sentence summary of the changes made to the file.

Here is the current, up to date version of the file ${filePath}:

${fileContent}`.trim(),
			},
		];

		const client = await modelRegistry.chat.getFirstOnlineClient(
			"auto:intelligence>=3,tools>=2",
		);

		chatService.systemLine(
			`[CodeWatchService] Using model ${client.getModelId()}`,
		);

		const request = await createChatRequest(
			{ input, systemPrompt },
			this.registry,
		);

		const [output, response] = await client.textChat(request, this.registry);

		chatService.systemLine(`[CodeWatchService] Code modification complete:`);
		for (const line of output.split("\n")) {
			chatService.systemLine(`[CodeWatchService] ${line}`);
		}
	}

	/**
	 * Mock function to trigger question answering based on AI? comment
	 * @param {string} content - Content of the comment
	 * @param {string} filePath - Path to the file containing the comment
	 * @param {number} lineNumber - Line number in the file
	 */
	async triggerQuestionAnswer(content, filePath, lineNumber) {
		const chatService = this.registry.requireFirstServiceByType(ChatService);
		chatService.infoLine(
			`[CodeWatchService][AI?] Question answering noted from ${filePath}:${lineNumber}. This feature is not fully implemented yet.`,
		);
		chatService.infoLine(`[CodeWatchService] Question: ${content}`);
		// In a real implementation, this would call an AI service to answer the question
	}

	/**
	 * Mock function to note an AI comment without taking immediate action
	 * @param {string} content - Content of the comment
	 * @param {string} filePath - Path to the file containing the comment
	 * @param {number} lineNumber - Line number in the file
	 */
	async noteAIComment(content, filePath, lineNumber) {
		const chatService = this.registry.requireFirstServiceByType(ChatService);
		chatService.infoLine(
			`[CodeWatchService][AI] AI comment noted from ${filePath}:${lineNumber}. This feature is not fully implemented yet.`,
		);
		chatService.infoLine(`[CodeWatchService] Note: ${content}`);
		// In a real implementation, this would store the comment for future use
	}
}
