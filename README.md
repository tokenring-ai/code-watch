# Code Watch

## Overview

The CodeWatch service provides functionality for monitoring files for AI comments and triggering automated code modification workflows. It integrates with the TokenRing AI framework to automatically execute actions based on special comments like `# AI!` or `// AI!` in code files.

This service watches the configured file systems for file additions and changes. When a file is modified, it scans for comment lines that contain AI triggers. The service processes `AI!` comments by spawning code modification agents to execute the instructions.

## Key Features

- **File System Monitoring**: Watches multiple filesystems for file changes using a virtual filesystem provider
- **AI Comment Detection**: Detects AI triggers in both Python/shell (`#`) and C-style (`//`) comments
- **Smart Change Handling**: Uses stability thresholds to debounce rapid file changes
- **Concurrent Processing**: Processes files concurrently with configurable worker queue via `async.queue`
- **Agent Integration**: Automatically spawns appropriate agents to execute AI instructions in headless mode
- **Error Handling**: Comprehensive error logging and graceful failure handling
- **Ignore Filtering**: Respects ignore patterns from filesystem providers

## Chat Commands

This package does not provide chat commands. It operates as a background service monitoring files for changes.

## Plugin Configuration

Configure the CodeWatch plugin by adding the `codewatch` section to your application config. The plugin uses a `packageConfigSchema` that wraps the `CodeWatchConfigSchema`.

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
export const CodeWatchConfigSchema = z.object({
  filesystems: z.record(z.string(), z.object({
    pollInterval: z.number().default(1000),
    stabilityThreshold: z.number().default(2000),
    agentType: z.string()
  })),

  concurrency: z.number().default(1),
});
```

### Configuration Example

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
    concurrency: 2
  }
});
```

### Configuration Options

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| codewatch | CodeWatchConfig | optional | Main configuration for CodeWatch service |
| filesystems | Record<string, FileSystemConfig> | - | Configuration for each filesystem to monitor |
| concurrency | number | 1 | Maximum concurrent file processing operations |

#### CodeWatchConfig

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| filesystems | Record<string, FileSystemConfig> | - | Configuration for each filesystem to monitor |
| concurrency | number | 1 | Maximum concurrent file processing operations |

#### FileSystemConfig

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| pollInterval | number | 1000 | Polling interval in milliseconds for detecting file changes |
| stabilityThreshold | number | 2000 | Time in milliseconds to wait after a change before processing |
| agentType | string | - | Type of agent to spawn for code modifications |

## Agent Configuration

The plugin spawns agents for code modification tasks. Agents are spawned in headless mode (without human interaction).

### AI Comment Patterns

The service detects and handles the following AI comment patterns:

1. **Lines starting with `# AI` or `// AI`**: Triggers code modification
2. **Lines ending with `AI!`**: Triggers code modification
3. **Multi-line comments**: Only single-line comments are currently supported

### Agent Workflow

When an `AI!` comment is detected in a file:

1. The service spawns an agent of the specified type in headless mode
2. The file is added to the agent's chat context
3. The agent executes the instruction from the `AI!` comment
4. The agent uses available tools to complete the requested task
5. The agent updates the file using the file write tool
6. The service removes the `AI!` comment from the file as a completion marker

## Services

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

#### Methods

- `async run(signal: AbortSignal): Promise<void>`

  Starts the service and begins monitoring files for changes across all configured filesystems.

  **Parameters:**

  - `signal`: AbortSignal to cancel the service

  **Returns:** Promise that resolves when the service stops

  **Behavior:**

  - Starts monitoring for each configured filesystem
  - Handles graceful shutdown when signal is aborted
  - Returns immediately after all watchers are set up

- `watchFileSystem(fileSystemProviderName: string, filesystemConfig: FileSystemConfig, signal: AbortSignal): Promise<void>`

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
  - Uses ignore patterns from the filesystem provider

- `processFileForAIComments({filePath, fileSystemProviderName}: {filePath: string, fileSystemProviderName: string}): Promise<void>`

  Scans a file for AI comments and processes them.

  **Parameters:**

  - `filePath`: Path to the file
  - `fileSystemProviderName`: Name of the filesystem provider

  **Returns:** Promise that resolves when processing is complete

  **Behavior:**

  - Reads the file content
  - Splits content into lines
  - Checks each line for AI comment patterns
  - Queues files with AI comments for processing

- `checkAndTriggerAIAction(line: string, filePath: string, lineNumber: number, fileSystemProviderName: string): Promise<void>`

  Checks a comment line for AI triggers and initiates action.

  **Parameters:**

  - `line`: The comment line content
  - `filePath`: Path of the file containing the comment
  - `lineNumber`: Line number in the file
  - `fileSystemProviderName`: Name of the filesystem provider

  **Returns:** Promise that resolves when action is initiated

  **AI Trigger Patterns:**

  - Lines starting with `# AI`, `// AI`
  - Lines ending with `AI!`

- `handleAIComment(commentLine: string, filePath: string, lineNumber: number, fileSystemProviderName: string): Promise<void>`

  Handles processing of a specific AI comment type.

  **Parameters:**

  - `commentLine`: The comment line content
  - `filePath`: Path of the file
  - `lineNumber`: Line number in the file
  - `fileSystemProviderName`: Name of the filesystem provider

  **Returns:** Promise that resolves when handling is complete

  **Behavior:**

  - Extracts the actual comment content (removes comment markers)
  - Checks if comment contains `AI!` marker
  - Triggers code modification if `AI!` is present

- `triggerCodeModification(content: string, filePath: string, lineNumber: number, fileSystemProviderName: string): Promise<void>`

  Triggers code modification agent for an `AI!` comment.

  **Parameters:**

  - `content`: The content of the comment
  - `filePath`: Path of the file
  - `lineNumber`: Line number in the file
  - `fileSystemProviderName`: Name of the filesystem provider

  **Returns:** Promise that resolves when code modification starts

  **Behavior:**

  - Retrieves AgentManager and FileSystemService
  - Spawns agent of specified type in headless mode
  - Sets active filesystem for the agent
  - Creates and executes modification prompt
  - Removes `AI!` comment after completion

- `runCodeModification(prompt: string, filePath: string, agent: Agent): Promise<void>`

  Executes code modification agent.

  **Parameters:**

  - `prompt`: The instruction prompt for the agent
  - `filePath`: Path of the file
  - `agent`: The Agent instance to execute commands on

  **Returns:** Promise that resolves when modification is complete

  **Behavior:**

  - Adds file to agent's chat context
  - Retrieves AgentCommandService from agent
  - Executes `/work` command with the prompt
  - Waits for agent to complete the task

## Providers

This package does not provide providers.

## RPC Endpoints

This package does not define RPC endpoints.

## State Management

This package does not implement state management or persistence.

## Usage Examples

### Basic Integration

```typescript
import TokenRingApp from '@tokenring-ai/app';
import codeWatch from '@tokenring-ai/code-watch/plugin';

try {
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
      concurrency: 1
    }
  });
  console.log('CodeWatch plugin installed successfully');
} catch (error) {
  console.error('Failed to install CodeWatch:', error);
}
```

### Manual Configuration

```typescript
import TokenRingApp from '@tokenring-ai/app';
import CodeWatchService from '@tokenring-ai/code-watch/CodeWatchService';
import {CodeWatchConfigSchema} from '@tokenring-ai/code-watch';

const app = new TokenRingApp();

const config: z.infer<typeof CodeWatchConfigSchema> = {
  filesystems: {
    local: {
      pollInterval: 1500,
      stabilityThreshold: 2500,
      agentType: 'code-modification-agent'
    },
    project: {
      pollInterval: 1000,
      stabilityThreshold: 2000,
      agentType: 'project-agent'
    }
  },
  concurrency: 2
};

app.addServices(new CodeWatchService(app, config));
```

### Running the Service

```typescript
import TokenRingApp from '@tokenring-ai/app';
import CodeWatchService from '@tokenring-ai/code-watch/CodeWatchService';
import {CodeWatchConfigSchema} from '@tokenring-ai/code-watch';

const app = new TokenRingApp();
const config: z.infer<typeof CodeWatchConfigSchema> = {
  filesystems: {
    local: {
      pollInterval: 1000,
      stabilityThreshold: 2000,
      agentType: 'code-modification-agent'
    }
  },
  concurrency: 1
};

const service = new CodeWatchService(app, config);

const abortController = new AbortController();

// Start monitoring
await service.run(abortController.signal);

// Stop monitoring
abortController.abort();
```

### Error Handling Example

```typescript
import TokenRingApp from '@tokenring-ai/app';
import CodeWatchService from '@tokenring-ai/code-watch/CodeWatchService';
import {CodeWatchConfigSchema} from '@tokenring-ai/code-watch';

const app = new TokenRingApp();
const config: z.infer<typeof CodeWatchConfigSchema> = {
  filesystems: {
    local: {
      pollInterval: 1000,
      stabilityThreshold: 2000,
      agentType: 'code-modification-agent'
    }
  },
  concurrency: 1
};

const service = new CodeWatchService(app, config);
try {
  await service.run(new AbortController().signal);
} catch (error) {
  console.error('Error in CodeWatchService:', error);
}
```

### AI Comment Examples

The service detects AI comments in both Python/shell style and C-style comments:

```typescript
// Python/shell style - triggers code modification
# AI! Refactor this function to use async/await
function oldFunction() {
  // ... code
}

// C-style - triggers code modification
// AI! Add error handling to this function
function anotherFunction() {
  // ... code
}

// AI comments that don't end with AI! are detected but don't trigger actions
# AI Consider refactoring this code
```

### File Change Handling

The service handles file changes with debouncing:

```typescript
// User makes rapid changes to a file
// 1. File is added to modifiedFiles map with a timeout
// 2. Subsequent changes clear and reset the timeout
// 3. After stabilityThreshold (2000ms), the file is queued for processing
// 4. Only one processing event occurs for multiple rapid changes
```

## Integration

The `@tokenring-ai/code-watch` plugin integrates with the Token Ring application framework through service registration. It registers the `CodeWatchService` with the app, which then:

- Listens for file changes via the configured filesystems
- Processes detected AI comments by spawning appropriate agents
- Handles error logging and service monitoring

The plugin also integrates with:

- **FileSystemService**: For reading files and watching filesystem changes
- **AgentManager**: For spawning code modification agents
- **AgentCommandService**: For executing commands on spawned agents

### Integration Flow

1. **Service Startup**: Service registers with app and sets up file watchers
2. **File Change Detection**: Filesystem watcher detects changes
3. **Debouncing**: Stability threshold filters out rapid changes
4. **Comment Detection**: File content is scanned for AI comments
5. **Agent Spawning**: Appropriate agent is created and configured
6. **Instruction Processing**: Agent receives and executes instructions
7. **File Update**: Agent modifies the file and removes AI markers
8. **Completion**: Service logs success and continues monitoring

## Best Practices

1. **Agent Selection**: Choose appropriate agent types for different filesystems based on the type of code modifications expected
2. **Polling Intervals**: Balance between responsiveness and system load by adjusting `pollInterval` and `stabilityThreshold`
3. **Concurrency**: Set appropriate concurrency levels based on your system's capabilities
4. **Error Monitoring**: Implement monitoring for service errors to catch issues early
5. **Ignore Patterns**: Use ignore patterns to exclude files that don't require monitoring (handled by filesystem provider's ignore filter)
6. **File Stability**: Ensure files are fully written before triggering processing (stability threshold handles this)
7. **Agent Type Matching**: Match agent types to the complexity of tasks (use simpler agents for simple modifications, more capable agents for complex refactoring)

## Error Handling

The service implements comprehensive error handling:

- **File Processing Errors**: Errors during file reading or processing are caught and logged
- **Agent Errors**: Errors during agent execution are caught and logged
- **Watcher Errors**: Errors in file watchers are caught and logged
- **Graceful Shutdown**: Watchers are properly closed when service is stopped
- **Queue Handling**: Errors don't stop the queue; failed items are logged and processing continues

## Testing

Run tests with:

```bash
bun run test
```

Run tests in watch mode:

```bash
bun run test:watch
```

Run tests with coverage:

```bash
bun run test:coverage
```

**Note**: No test files currently exist in the package. Test infrastructure is configured but individual tests have not been implemented.

## Development

### Build

```bash
bun run build
```

### Package Structure

```
pkg/code-watch/
├── README.md                # Documentation
├── package.json             # Package configuration
├── vitest.config.ts         # Test configuration
├── index.ts                 # Main exports and schema
├── CodeWatchService.ts      # Main service implementation
└── plugin.ts                # Plugin configuration and installation
```

### Dependencies

This package depends on:

- `@tokenring-ai/app`: Core application framework
- `@tokenring-ai/agent`: Agent management and execution
- `@tokenring-ai/filesystem`: File system abstraction and watching
- `zod`: Schema validation
- `ignore`: File ignore pattern matching (from @tokenring-ai/filesystem)
- `async`: Concurrent queue processing

## License

MIT License - see [LICENSE](./LICENSE) file for details.
