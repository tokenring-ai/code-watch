# @tokenring-ai/code-watch

## Overview

The `@tokenring-ai/code-watch` package provides a file monitoring service for the Token Ring AI ecosystem. It watches configured filesystems for file changes, detects special AI comment patterns (like `# AI!` or `// AI!`), and automatically spawns agents to execute code modifications based on those instructions.

This service uses polling-based file system watching with configurable intervals and stability thresholds to debounce rapid file changes. When an AI comment with the `AI!` marker is detected, the service spawns a configured agent type in headless mode to execute the requested code modifications.

### Key Features

- **File System Monitoring**: Watches multiple filesystems for file additions and changes using virtual filesystem providers
- **AI Comment Detection**: Detects AI triggers in both Python/shell (`#`) and C-style (`//`) comments
- **Smart Change Handling**: Uses stability thresholds to debounce rapid file changes
- **Concurrent Processing**: Processes files concurrently with configurable worker queue via `async.queue`
- **Agent Integration**: Automatically spawns appropriate agents to execute AI instructions in headless mode
- **Error Handling**: Comprehensive error logging and graceful failure handling
- **Ignore Filtering**: Respects ignore patterns from filesystem providers

## Installation

```bash
bun add @tokenring-ai/code-watch
```

### Dependencies

- `@tokenring-ai/app`: 0.2.0
- `@tokenring-ai/agent`: 0.2.0
- `@tokenring-ai/filesystem`: 0.2.0
- `@tokenring-ai/utility`: 0.2.0
- `zod`: ^4.3.6
- `async`: ^3.2.6
- `ignore`: ^7.0.5

## Features

- Monitors multiple filesystems for file changes
- Detects AI comment patterns in code files (`# AI!`, `// AI!`)
- Automatically spawns agents to execute AI instructions
- Supports concurrent file processing
- Implements debouncing for stability via `stabilityThreshold`
- Integrates with TokenRing plugin system
- Respects ignore patterns from filesystem providers

## Core Components/API

### CodeWatchService

The main service responsible for file monitoring and AI comment processing. Implements the `TokenRingService` interface.

```typescript
import CodeWatchService from "@tokenring-ai/code-watch/CodeWatchService";
import { CodeWatchConfigSchema } from "@tokenring-ai/code-watch";
```

#### Constructor

```typescript
constructor(app: TokenRingApp, config: z.output<typeof CodeWatchConfigSchema>)
```

**Parameters:**

- `app`: TokenRing application instance
- `config`: Configuration object for service settings

**Properties:**

| Property | Type | Description |
|----------|------|-------------|
| `name` | `"CodeWatchService"` | Service name |
| `description` | `string` | Service description |
| `app` | `TokenRingApp` | TokenRing application instance |
| `config` | `CodeWatchConfig` | Service configuration |
| `workQueue` | `Async.Queue<{ filePath: string, fileSystemProviderName: string }>` | Async queue for concurrent file processing operations |

#### Methods

##### `async run(signal: AbortSignal): Promise<void>`

Starts the service and begins monitoring files for changes across all configured filesystems.

**Parameters:**

- `signal`: `AbortSignal` to cancel the service

**Returns:** `Promise<void>` that resolves when all watchers are set up

**Behavior:**

- Iterates through all configured filesystems
- Calls `watchFileSystem()` for each filesystem
- Returns after all watchers are set up
- Handles graceful shutdown when signal is aborted

##### `async watchFileSystem(fileSystemProviderName: string, filesystemConfig: FileSystemConfig, signal: AbortSignal): Promise<void>`

Configures a new filesystem to watch.

**Parameters:**

- `fileSystemProviderName`: Unique identifier for the filesystem provider
- `filesystemConfig`: Configuration object including `pollInterval`, `stabilityThreshold`, and `agentType`
- `signal`: `AbortSignal` to cancel the watcher

**Returns:** `Promise<void>` that resolves when the watcher is set up

**Behavior:**

- Retrieves `FileSystemService` from the app
- Gets the filesystem provider by name
- Creates a file system watcher using the provider's `watch()` method
- Sets up event handlers for `add`, `change`, and `unlink` events
- Implements debouncing using `stabilityThreshold` to handle rapid changes
- Processes files that pass the stability threshold via `workQueue`
- Uses ignore patterns from the filesystem provider via `createIgnoreFilter()`
- Returns after setting up the watcher and waiting for abort signal

**Event Handling:**

```typescript
const onFileChanged = (eventType: string, filePath: string) => {
  if (modifiedFiles.has(filePath)) {
    clearTimeout(modifiedFiles.get(filePath));
    modifiedFiles.delete(filePath);
  }

  if (eventType === "add" || eventType === "change") {
    modifiedFiles.set(filePath, setTimeout(() => {
      this.workQueue.push({filePath, fileSystemProviderName});
    }));
  }
};
```

##### `async processFileForAIComments({filePath, fileSystemProviderName}: {filePath: string, fileSystemProviderName: string}): Promise<void>`

Scans a file for AI comments and processes them.

**Parameters:**

- `filePath`: Path to the file
- `fileSystemProviderName`: Name of the filesystem provider

**Returns:** `Promise<void>` that resolves when processing is complete

**Behavior:**

- Reads the file content from the filesystem provider
- Splits content into lines
- Checks each line for AI comment patterns:
  - Lines starting with `#` (Python/shell style)
  - Lines starting with `//` (C-style)
- Calls `checkAndTriggerAIAction()` for each comment line

##### `async checkAndTriggerAIAction(line: string, filePath: string, lineNumber: number, fileSystemProviderName: string): Promise<void>`

Checks a comment line for AI triggers and initiates action.

**Parameters:**

- `line`: The comment line content (trimmed)
- `filePath`: Path of the file containing the comment
- `lineNumber`: Line number in the file (1-indexed)
- `fileSystemProviderName`: Name of the filesystem provider

**Returns:** `Promise<void>` that resolves when action is initiated

**AI Trigger Patterns:**

- Lines starting with `# AI` or `// AI`
- Lines ending with `AI!`

If either pattern matches, calls `handleAIComment()`.

##### `async handleAIComment(commentLine: string, filePath: string, lineNumber: number, fileSystemProviderName: string): Promise<void>`

Handles processing of a specific AI comment.

**Parameters:**

- `commentLine`: The comment line content
- `filePath`: Path of the file
- `lineNumber`: Line number in the file
- `fileSystemProviderName`: Name of the filesystem provider

**Returns:** `Promise<void>` that resolves when handling is complete

**Behavior:**

- Extracts the actual comment content (removes `# ` or `// ` markers)
- Checks if comment contains `AI!` marker
- Triggers code modification if `AI!` is present via `triggerCodeModification()`

**Comment Content Extraction:**

```typescript
let content = commentLine.trim();
if (commentLine.startsWith("# ")) {
  content = commentLine.substring(2);
} else if (commentLine.startsWith("// ")) {
  content = commentLine.substring(3);
}
```

##### `async triggerCodeModification(content: string, filePath: string, lineNumber: number, fileSystemProviderName: string): Promise<void>`

Triggers code modification agent for an `AI!` comment.

**Parameters:**

- `content`: The content of the comment
- `filePath`: Path of the file
- `lineNumber`: Line number in the file
- `fileSystemProviderName`: Name of the filesystem provider

**Returns:** `Promise<void>` that resolves when code modification starts

**Behavior:**

- Retrieves `AgentManager` and `FileSystemService` from the app
- Gets the agent type from the filesystem configuration
- Spawns agent of specified type in headless mode via `agentManager.spawnAgent()`
- Sets active filesystem for the agent via `fileSystemService.setActiveFileSystem()`
- Creates and executes modification prompt
- Calls `runCodeModification()` to execute the agent
- Agent is responsible for removing the `AI!` comment after completion

**Prompt Template:**

The service generates a prompt that instructs the agent to:
1. Look for lines marked with `AI!` tag
2. Complete the instructions in that line or nearby comments
3. Update the file using the file_write tool
4. **Must remove** any lines that end with `AI!`

##### `async runCodeModification(prompt: string, filePath: string, agent: Agent): Promise<void>`

Executes code modification agent.

**Parameters:**

- `prompt`: The instruction prompt for the agent
- `filePath`: Path of the file
- `agent`: The `Agent` instance to execute commands on

**Returns:** `Promise<void>` that resolves when modification is complete

**Behavior:**

- Adds file to agent's chat context via `fileSystemService.addFileToChat()`
- Retrieves `AgentCommandService` from the agent
- Executes `/work` command with the prompt via `agentCommandService.executeAgentCommand()`
- Waits for agent to complete the task

## Usage Examples

### Basic Plugin Installation

```typescript
import TokenRingApp from '@tokenring-ai/app';
import codeWatch from '@tokenring-ai/code-watch/plugin';

const app = new TokenRingApp();

app.install(codeWatch, {
  codewatch: {
    filesystems: {
      local: {
        pollInterval: 1000,
        stabilityThreshold: 2000,
        agentType: 'code-modification-agent'
      }
    },
    concurrency: 2
  }
});

// Start the application
await app.run();
```

### Multiple Filesystem Configuration

```typescript
import TokenRingApp from '@tokenring-ai/app';
import codeWatch from '@tokenring-ai/code-watch/plugin';

const app = new TokenRingApp();

app.install(codeWatch, {
  codewatch: {
    filesystems: {
      local: {
        pollInterval: 1000,
        stabilityThreshold: 2000,
        agentType: 'code-modification-agent'
      },
      project: {
        pollInterval: 1500,
        stabilityThreshold: 2500,
        agentType: 'project-agent'
      }
    },
    concurrency: 3
  }
});

await app.run();
```

### AI Comment Examples

#### Python/Shell Style Comments

```python
# AI! Fix the off-by-one error in the loop below
for i in range(10):
    print(i)
```

#### C-Style Comments

```javascript
// AI! Refactor this function to use async/await
function fetchData() {
    return fetch('/api/data').then(res => res.json());
}
```

#### Inline AI Instructions

```typescript
const result = processData(data); // AI! Add error handling here
```

#### Comment Detection Patterns

The service detects AI comments using these patterns:

1. **Lines starting with `# AI`** (Python/shell style)
2. **Lines starting with `// AI`** (C-style)
3. **Lines ending with `AI!`** (any style)

**Important:** Only comments containing `AI!` will trigger code modification. Comments that match the prefix patterns but don't contain `AI!` will be detected but won't trigger action.

## Configuration

### Configuration Schema

The plugin configuration is defined in `plugin.ts`:

```typescript
import { TokenRingPlugin } from "@tokenring-ai/app";
import { z } from "zod";
import CodeWatchService from "./CodeWatchService.ts";
import { CodeWatchConfigSchema } from "./index.ts";
import packageJSON from './package.json' with {type: 'json'};

const packageConfigSchema = z.object({
  codewatch: CodeWatchConfigSchema.optional(),
});

export default {
  name: packageJSON.name,
  version: packageJSON.version,
  description: packageJSON.description,
  install(app, config) {
    if (config.codewatch) {
      app.addServices(new CodeWatchService(app, config.codewatch));
    }
  },
  config: packageConfigSchema
} satisfies TokenRingPlugin<typeof packageConfigSchema>;
```

The configuration schema is defined in `index.ts`:

```typescript
import { z } from "zod";

export const CodeWatchConfigSchema = z.object({
  filesystems: z.record(z.string(), z.object({
    pollInterval: z.number().default(1000),
    stabilityThreshold: z.number().default(2000),
    agentType: z.string()
  })),

  concurrency: z.number().default(1),
});
```

### Configuration Options

#### Top-Level Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `codewatch` | `CodeWatchConfig` | optional | Main configuration for CodeWatch service |

#### CodeWatchConfig

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `filesystems` | `Record<string, FileSystemConfig>` | required | Configuration for each filesystem to monitor |
| `concurrency` | `number` | 1 | Maximum concurrent file processing operations |

#### FileSystemConfig

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `pollInterval` | `number` | 1000 | Polling interval in milliseconds for detecting file changes |
| `stabilityThreshold` | `number` | 2000 | Time in milliseconds to wait after a change before processing |
| `agentType` | `string` | required | Type of agent to spawn for code modifications |

### Configuration Example

```typescript
{
  codewatch: {
    filesystems: {
      local: {
        pollInterval: 1000,      // Check for changes every 1 second
        stabilityThreshold: 2000, // Wait 2 seconds after last change before processing
        agentType: 'code-modification-agent'
      }
    },
    concurrency: 2  // Process up to 2 files concurrently
  }
}
```

## Integration

### Plugin Registration

The package integrates with the TokenRing application through the plugin system:

```typescript
import TokenRingApp from '@tokenring-ai/app';
import codeWatch from '@tokenring-ai/code-watch/plugin';

const app = new TokenRingApp();
app.install(codeWatch, {
  codewatch: {
    filesystems: {
      local: {
        pollInterval: 1000,
        stabilityThreshold: 2000,
        agentType: 'code-modification-agent'
      }
    },
    concurrency: 2
  }
});
```

### Service Registration

When installed, the plugin automatically registers the `CodeWatchService`:

```typescript
if (config.codewatch) {
  app.addServices(new CodeWatchService(app, config.codewatch));
}
```

### Required Services

The `CodeWatchService` requires the following services to be available:

- `FileSystemService`: For file operations and watching
- `AgentManager`: For spawning agents to execute AI instructions

### Agent Workflow

When an `AI!` comment is detected in a file:

1. The service spawns an agent of the specified type in headless mode
2. The file is added to the agent's chat context using `FileSystemService.addFileToChat()`
3. The agent executes the instruction from the `AI!` comment via `/work` command
4. The agent uses available tools to complete the requested task
5. The agent updates the file using the file write tool
6. The agent removes the `AI!` comment from the file as a completion marker

## Chat Commands

This package does not provide chat commands. It operates as a background service monitoring files for changes.

## RPC Endpoints

This package does not define RPC endpoints.

## State Management

This package does not implement state management or persistence.

## Testing and Development

### Running Tests

```bash
bun test
```

### Running Tests in Watch Mode

```bash
bun test:watch
```

### Running Test Coverage

```bash
bun test:coverage
```

### Build

```bash
bun build
```

### Package Structure

```
pkg/code-watch/
├── index.ts              # Configuration schema and exports
├── CodeWatchService.ts   # Main service implementation
├── plugin.ts             # Plugin definition and registration
├── package.json          # Package metadata and dependencies
├── README.md             # This documentation
├── vitest.config.ts      # Test configuration
└── BRAINSTORM.md         # Feature brainstorming and roadmap
```

## Dependencies

### Production Dependencies

| Package | Version | Description |
|---------|---------|-------------|
| `@tokenring-ai/app` | 0.2.0 | Core application framework |
| `@tokenring-ai/agent` | 0.2.0 | Agent management and orchestration |
| `@tokenring-ai/filesystem` | 0.2.0 | File system abstraction and providers |
| `@tokenring-ai/utility` | 0.2.0 | Utility functions and helpers |
| `zod` | ^4.3.6 | Schema validation |
| `async` | ^3.2.6 | Concurrent processing utilities |
| `ignore` | ^7.0.5 | Ignore pattern matching |

### Development Dependencies

| Package | Version | Description |
|---------|---------|-------------|
| `vitest` | ^4.1.0 | Testing framework |
| `typescript` | ^5.9.3 | TypeScript compiler |
| `@types/async` | ^3.2.25 | Async type definitions |

## License

MIT License - see LICENSE file for details.
