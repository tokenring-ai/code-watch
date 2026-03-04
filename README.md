# @tokenring-ai/code-watch

## Overview

The CodeWatch service provides functionality for monitoring files for AI comments and triggering automated code modification workflows. It integrates with the TokenRing AI framework to automatically execute actions based on special comments like `# AI!` or `// AI!` in code files.

This service watches configured file systems for file additions and changes. When a file is modified, it scans for comment lines that contain AI triggers. The service processes `AI!` comments by spawning code modification agents to execute the instructions.

### Key Features

- **File System Monitoring**: Watches multiple filesystems for file additions and changes using a virtual filesystem provider
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
- `@tokenring-ai/chat`: 0.2.0
- `@tokenring-ai/agent`: 0.2.0
- `@tokenring-ai/filesystem`: 0.2.0
- `@tokenring-ai/utility`: 0.2.0
- `zod`: ^4.3.6
- `async`: ^3.2.6
- `ignore`: ^7.0.5

## Features

- Monitors multiple filesystems for file changes
- Detects AI comment patterns in code files
- Automatically spawns agents to execute AI instructions
- Supports concurrent file processing
- Implements debouncing for stability
- Integrates with TokenRing plugin system

## Core Components/API

### CodeWatchService

The main service responsible for file monitoring and AI comment processing.

```typescript
import CodeWatchService from "@tokenring-ai/code-watch/CodeWatchService";
import {CodeWatchConfigSchema} from "@tokenring-ai/code-watch";
```

The `CodeWatchService` class implements `TokenRingService` and provides the following methods:

#### Constructor

```typescript
constructor(app: TokenRingApp, config: z.output<typeof CodeWatchConfigSchema>)
```

**Parameters:**

- `app`: TokenRing application instance
- `config`: Configuration object for service settings

**Properties:**

- `name`: Service name, set to `"CodeWatchService"`
- `description`: Service description
- `workQueue`: Async queue for concurrent file processing operations
- `app`: TokenRing application instance
- `config`: Service configuration

#### Methods

##### `async run(signal: AbortSignal): Promise<void>`

Starts the service and begins monitoring files for changes across all configured filesystems.

**Parameters:**

- `signal`: AbortSignal to cancel the service

**Returns:** Promise that resolves when the service stops

**Behavior:**

- Starts monitoring for each configured filesystem
- Handles graceful shutdown when signal is aborted
- Returns after all watchers are set up

##### `async watchFileSystem(fileSystemProviderName: string, filesystemConfig: FileSystemConfig, signal: AbortSignal): Promise<void>`

Configures a new filesystem to watch.

**Parameters:**

- `fileSystemProviderName`: Unique identifier for the filesystem
- `filesystemConfig`: Configuration object including `pollInterval`, `stabilityThreshold`, and `agentType`
- `signal`: AbortSignal to cancel the watcher

**Returns:** Promise that resolves when the watcher is set up

**Behavior:**

- Creates a file system watcher using the configured filesystem provider
- Sets up event handlers for `add`, `change`, and `unlink` events
- Implements debouncing using stability threshold to handle rapid changes
- Processes files that pass the stability threshold
- Uses ignore patterns from the filesystem provider via `createIgnoreFilter()`
- Returns after setting up the watcher and waiting for abort signal

##### `async processFileForAIComments({filePath, fileSystemProviderName}: {filePath: string, fileSystemProviderName: string}): Promise<void>`

Scans a file for AI comments and processes them.

**Parameters:**

- `filePath`: Path to the file
- `fileSystemProviderName`: Name of the filesystem provider

**Returns:** Promise that resolves when processing is complete

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

- `line`: The comment line content
- `filePath`: Path of the file containing the comment
- `lineNumber`: Line number in the file
- `fileSystemProviderName`: Name of the filesystem provider

**Returns:** Promise that resolves when action is initiated

**AI Trigger Patterns:**

- Lines starting with `# AI` or `// AI`
- Lines ending with `AI!`

##### `async handleAIComment(commentLine: string, filePath: string, lineNumber: number, fileSystemProviderName: string): Promise<void>`

Handles processing of a specific AI comment type.

**Parameters:**

- `commentLine`: The comment line content
- `filePath`: Path of the file
- `lineNumber`: Line number in the file
- `fileSystemProviderName`: Name of the filesystem provider

**Returns:** Promise that resolves when handling is complete

**Behavior:**

- Extracts the actual comment content (removes `# ` or `// ` markers)
- Checks if comment contains `AI!` marker
- Triggers code modification if `AI!` is present via `triggerCodeModification()`

##### `async triggerCodeModification(content: string, filePath: string, lineNumber: number, fileSystemProviderName: string): Promise<void>`

Triggers code modification agent for an `AI!` comment.

**Parameters:**

- `content`: The content of the comment
- `filePath`: Path of the file
- `lineNumber`: Line number in the file
- `fileSystemProviderName`: Name of the filesystem provider

**Returns:** Promise that resolves when code modification starts

**Behavior:**

- Retrieves `AgentManager` and `FileSystemService` from the app
- Gets the agent type from the filesystem configuration
- Spawns agent of specified type in headless mode via `agentManager.spawnAgent()`
- Sets active filesystem for the agent via `fileSystemService.setActiveFileSystem()`
- Creates and executes modification prompt
- Calls `runCodeModification()` to execute the agent
- Agent is responsible for removing the `AI!` comment after completion

##### `async runCodeModification(prompt: string, filePath: string, agent: Agent): Promise<void>`

Executes code modification agent.

**Parameters:**

- `prompt`: The instruction prompt for the agent
- `filePath`: Path of the file
- `agent`: The Agent instance to execute commands on

**Returns:** Promise that resolves when modification is complete

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

## Configuration

### Configuration Schema

The plugin configuration is defined in `plugin.ts`:

```typescript
import {TokenRingPlugin} from "@tokenring-ai/app";
import {z} from "zod";
import CodeWatchService from "./CodeWatchService.ts";
import {CodeWatchConfigSchema} from "./index.ts";
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
import {z} from "zod";

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

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `codewatch` | CodeWatchConfig | optional | Main configuration for CodeWatch service |
| `filesystems` | Record<string, FileSystemConfig> | - | Configuration for each filesystem to monitor |
| `concurrency` | number | 1 | Maximum concurrent file processing operations |

#### CodeWatchConfig

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `filesystems` | Record<string, FileSystemConfig> | - | Configuration for each filesystem to monitor |
| `concurrency` | number | 1 | Maximum concurrent file processing operations |

#### FileSystemConfig

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `pollInterval` | number | 1000 | Polling interval in milliseconds for detecting file changes |
| `stabilityThreshold` | number | 2000 | Time in milliseconds to wait after a change before processing |
| `agentType` | string | - | Type of agent to spawn for code modifications |

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

## AI Comment Detection Pattern

The service detects AI triggers using two patterns:

1. **Lines starting with `# AI` or `// AI`**: Triggers code modification processing
2. **Lines ending with `AI!`**: Triggers code modification processing regardless of prefix content

### Detection Flow

- Lines starting with `#` or `//` are scanned
- Lines matching either pattern are sent to `checkAndTriggerAIAction()`
- Comments starting with `# AI` or `// AI` call `handleAIComment()`
- Comments ending with `AI!` call `handleAIComment()`
- Only comments with `AI!` in content trigger code modification via `triggerCodeModification()`

### AI Comment Types

The service supports one type of AI comment:

| Pattern | Description |
|---------|-------------|
| `AI!` | Indicates a command that AI must execute. This is a critical instruction that requires completion. |

**Note:** The `AI!` marker must be present in the comment content for code modification to be triggered. Comments that start with `# AI` or `// AI` but don't contain `AI!` will be detected but won't trigger action.

## Agent Configuration

The plugin spawns agents for code modification tasks. Agents are spawned in headless mode (without human interaction).

### Agent Workflow

When an `AI!` comment is detected in a file:

1. The service spawns an agent of the specified type in headless mode
2. The file is added to the agent's chat context using `FileSystemService.addFileToChat()`
3. The agent executes the instruction from the `AI!` comment via `/work` command
4. The agent uses available tools to complete the requested task
5. The agent updates the file using the file write tool
6. The service removes the `AI!` comment from the file as a completion marker (handled by the agent)

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
└── vitest.config.ts      # Test configuration
```

## Dependencies

### Production Dependencies

- `@tokenring-ai/app`: 0.2.0 - Core application framework
- `@tokenring-ai/chat`: 0.2.0 - Chat functionality
- `zod`: ^4.3.6 - Schema validation
- `@tokenring-ai/agent`: 0.2.0 - Agent management
- `@tokenring-ai/filesystem`: 0.2.0 - File system abstraction
- `@tokenring-ai/utility`: 0.2.0 - Utility functions
- `async`: ^3.2.6 - Concurrent processing
- `ignore`: ^7.0.5 - Ignore pattern matching

### Development Dependencies

- `vitest`: ^4.0.18 - Testing framework
- `typescript`: ^5.9.3 - TypeScript compiler
- `@types/async`: ^3.2.25 - Async type definitions

## License

MIT License - see LICENSE file for details.
