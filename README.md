# Code Watch Package Documentation

## Overview

The `@tokenring-ai/code-watch` package provides a service for monitoring file changes in a filesystem and detecting special AI-triggered comments within those files. It integrates with the TokenRing AI agent framework to automatically execute actions based on comments like `# AI!` or `// AI?` in code files. The primary purpose is to enable interactive code modification and querying through natural language instructions embedded as comments, allowing developers to collaborate with AI agents seamlessly during development.

This package watches the root directory for file additions, changes, and deletions. When a file is modified, it scans for comment lines starting with `# AI`, `// AI`, or ending with `AI!`, `AI?`, or `AI`. Currently, it fully supports triggering code modifications via `AI!` comments by spawning an AI agent to process and update the file. Support for `AI?` (question answering) and plain `AI` (noting comments) is stubbed but not fully implemented.

The service relies on the TokenRing agent ecosystem, using services like `FileSystemService` for watching and file operations, and `AgentTeam` for creating and managing AI agents.

## Installation/Setup

This package is designed for integration within the TokenRing AI framework. To use it:

1. Ensure the TokenRing AI agent dependencies are installed in your project:
   ```
   npm install @tokenring-ai/agent @tokenring-ai/ai-client @tokenring-ai/filesystem
   ```

2. Install the code-watch package:
   ```
   npm install @tokenring-ai/code-watch
   ```

3. In your TokenRing application, register the `CodeWatchService` as a service within an `AgentTeam`. No additional build steps are required, as it's a TypeScript module.

The package assumes a virtual filesystem provided by `FileSystemService` and an AI model registry for agent interactions.

## Package Structure

The package has a simple structure:

- **index.ts**: Entry point that exports the `CodeWatchService` class and package metadata from `package.json`.
- **CodeWatchService.ts**: Core implementation of the file watching and AI comment processing logic.
- **package.json**: Defines dependencies, exports, and scripts (e.g., for testing with Vitest).
- **README.md**: This documentation file.
- **LICENSE**: MIT license file.

No subdirectories; all source code is in the root of `pkg/code-watch`.

## Core Components

### CodeWatchService

The main class implementing the `TokenRingService` interface. It manages file watching, processes changes, and triggers AI agents.

#### Description
- Initializes with options specifying agent types (e.g., for code modification).
- Starts a file watcher on the root directory using polling (interval: 1000ms, stability threshold: 2000ms).
- On file add/change, queues the file for processing.
- Scans files for AI comments in Python (#) or C-style (//) syntax.
- For `AI!` comments, spawns a code modification agent to interpret and execute the instruction, then updates the file and removes the trigger comment.
- Handles errors via the agent team's error reporting.
- Ensures only one file processing cycle runs at a time to avoid overload.

#### Key Methods

- **constructor(config: CodeWatchServiceOptions)**
  - Parameters: `config` with `agentTypes` (e.g., `{ codeModification: 'some-agent-type' }`).
  - Initializes agent types for later use.

- **async start(agentTeam: AgentTeam): Promise<void>**
  - Starts the service by acquiring `FileSystemService` and initiating the file watcher.
  - Sets up event listeners for 'add', 'change', 'unlink', and 'error'.

- **async stop(agentTeam: AgentTeam): Promise<void>**
  - Stops the watcher and cleans up resources.

- **async startWatching(): Promise<void>**
  - Creates or recreates the file watcher on './' (root).
  - Attaches event handlers to `onFileChanged`.

- **async stopWatching(): Promise<void>**
  - Closes the watcher if active.

- **onFileChanged(eventType: string, filePath: string): void**
  - For 'add' or 'change', adds file to `modifiedFiles` set and triggers `processNextFile`.

- **async processNextFile(): Promise<void>**
  - Processes queued files sequentially if not already processing.
  - Calls `processFileForAIComments` for each, handles errors, and recurses if more files.

- **async processFileForAIComments(filePath: string): Promise<void>**
  - Reads file content, splits into lines.
  - For each line starting with '#' or '//', checks for AI triggers via `checkAndTriggerAIAction`.

- **async checkAndTriggerAIAction(line: string, filePath: string, lineNumber: number): Promise<void>**
  - Detects AI prefixes/suffixes and calls `handleAIComment` if matched.

- **async handleAIComment(commentLine: string, filePath: string, lineNumber: number): Promise<void>**
  - Extracts comment content (strips # or //).
  - Routes to `triggerCodeModification` for `AI!`, or stubs for `AI?`/`AI`.

- **async triggerCodeModification(content: string, filePath: string, lineNumber: number): Promise<void>**
  - Creates a code modification agent.
  - Builds a chat prompt with file context and instructions to execute the comment and remove `AI!` lines.
  - Uses an AI client (criteria: intelligence >=3, tools >=2) to generate output.
  - Logs the agent's actions and summary.

- **async triggerQuestionAnswer(content: string, filePath: string, lineNumber: number): Promise<void>**
  - Currently a stub: Logs the question; full implementation would query an AI service.

- **async noteAIComment(content: string, filePath: string, lineNumber: number): Promise<void>**
  - Currently a stub: Logs the note; full implementation would store for later use.

#### Interactions
The service interacts with:
- `FileSystemService`: For watching and reading files.
- `AgentTeam`: For creating agents, logging outputs/errors.
- `ModelRegistry`: To select AI models for chat.
- AI Agents: Spawned for specific tasks like code modification.

Error handling uses try-catch with agent team reporting. Processing is asynchronous and queued to handle bursts of changes.

## Usage Examples

### 1. Basic Integration in TokenRing AgentTeam
```typescript
import { AgentTeam } from '@tokenring-ai/agent';
import { CodeWatchService, CodeWatchServiceOptions } from '@tokenring-ai/code-watch';

const options: CodeWatchServiceOptions = {
  agentTypes: {
    codeModification: 'code-modifier-agent' // Replace with actual agent type
  }
};

const codeWatch = new CodeWatchService(options);
const agentTeam = new AgentTeam(/* ... config ... */);

// Start the service
await codeWatch.start(agentTeam);

// In your app loop or main:
// ... run agent team ...

// Stop when done
await codeWatch.stop(agentTeam);
```

### 2. Triggering Code Modification
Add a comment to a file like `src/example.ts`:
```typescript
// AI! Add a function to calculate factorial
function factorial(n: number): number {
  // Implementation will be added by AI
}
```
- Save the file: The watcher detects the change.
- The service processes it, spawns an agent, and the AI updates the file (e.g., adds the function and removes the `AI!` line).

### 3. Handling Questions (Stubbed)
Add to a file:
```python
# AI? What is the best way to optimize this loop?
for i in range(1000000):
    # code
```
- On save, logs the question; extend `triggerQuestionAnswer` for full AI response.

## Configuration Options

- **CodeWatchServiceOptions**:
  - `agentTypes.codeModification`: String identifier for the agent type to use for code changes (required).

Watcher config (internal, hardcoded):
- `pollInterval: 1000` ms.
- `stabilityThreshold: 2000` ms.

Environment variables: None explicitly; relies on TokenRing config for AI models and filesystem.

## API Reference

- **Class: CodeWatchService**
  - `constructor(config: CodeWatchServiceOptions)`
  - `async start(agentTeam: AgentTeam): Promise<void>`
  - `async stop(agentTeam: AgentTeam): Promise<void>`

- **Type: CodeWatchServiceOptions**
  - `{ agentTypes: { codeModification: string } }`

Public properties:
- `name: string = "CodeWatchService"`
- `description: string` (fixed)

All other methods are private/internal.

## Dependencies

- `@tokenring-ai/ai-client@0.1.0`: For AI chat requests and model registry.
- `@tokenring-ai/agent@0.1.0`: For agent teams and service integration.
- `@tokenring-ai/filesystem@0.1.0`: For file watching and operations.
- `ignore@^7.0.5`: Likely for ignoring files in watching (not directly used in code).

Peer dependencies: Assumes TokenRing framework is available.

## Contributing/Notes

- **Testing**: Run `npm test` using Vitest.
- **Building**: TypeScript; compiles to JS modules (ESM).
- **Limitations**: 
  - Only supports # and // comments; extend for other languages.
  - `AI?` and `AI` features are stubs—implement as needed.
  - Polling-based watching may not be real-time; suitable for virtual FS.
  - Assumes UTF-8 text files; binaries ignored.
  - No support for deletions in processing (only add/change trigger scans).
- **License**: MIT.
- Contributions: Fork, add features (e.g., more comment types, regex triggers), and submit PRs.

For issues or extensions, refer to the TokenRing AI repository.