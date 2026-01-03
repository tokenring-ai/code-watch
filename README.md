# @tokenring-ai/code-watch

## Overview

The `@tokenring-ai/code-watch` package provides a service for monitoring file changes and detecting AI-triggered comments within code files. It integrates with the TokenRing AI framework to automatically execute actions based on special comments like `# AI!` or `// AI!` in code files.

This package watches the configured file systems for file additions and changes. When a file is modified, it scans for comment lines that contain AI triggers. The package processes `AI!` comments by spawning code modification agents; other AI comment variants (`AI?`, `AI`) are not processed and are ignored.

## Key Features

- **AI Comment Detection**: Scans files for special `AI!` comments in Python/shell (`#`) and C-style (`//`) comment lines
- **Agent Integration**: Spawns code modification agents to process `AI!` comments
- **TokenRing Plugin**: Designed to work seamlessly with the TokenRing application framework
- **Configurable**: Customizable agent types, polling intervals, and concurrency settings per filesystem
- **Error Handling**: Comprehensive error handling and service output logging
- **Queue Processing**: Handles file processing with configurable concurrency using an async work queue
- **File Event Monitoring**: Monitors file additions, changes, and deletions (deletions are logged but not processed)

## Core Components

### CodeWatchService

The main service responsible for file monitoring and AI comment processing.

- **Filesystem Watcher**: Uses polling-based detection for file changes across multiple filesystems
- **AI Comment Processor**: Scans for and processes `AI!` comment triggers
- **Agent Spawn Manager**: Handles spawning of code modification agents for `AI!` comments
- **Work Queue**: Manages concurrent file processing operations

### AI Comment Processing

The service processes the following types of AI comments:

- **`AI!` Comments**: Trigger code modification actions. When detected, the service spawns a code modification agent to process the instruction, updates the file, and removes the comment
- **`AI?` and `AI` Comments**: Not implemented and are ignored

## Installation

```bash
bun add @tokenring-ai/code-watch
```

## Chat Commands

This package does not provide chat commands. It operates as a background service monitoring files for changes.

## Plugin Configuration

Configure the CodeWatch plugin by adding the `codewatch` section to your application config:

```typescript
import TokenRingApp from '@tokenring-ai/app';
import codeWatch from '@tokenring-ai/code-watch';

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

### Configuration Schema

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

## Tools

This package does not provide tools. It operates as a background service.

## Services

### CodeWatchService

```typescript
import CodeWatchService from '@tokenring-ai/code-watch/CodeWatchService';
```

The `CodeWatchService` class implements `TokenRingService` and provides the following methods:

#### Constructor

```typescript
constructor(app: TokenRingApp, config: z.output<typeof CodeWatchConfigSchema>)
```

**Parameters:**

- `app`: TokenRing application instance
- `config`: Configuration object for service settings

#### Methods

- `async run(signal: AbortSignal): Promise<void>`

  Starts the service and begins monitoring files for changes.

  **Parameters:**

  - `signal`: AbortSignal to cancel the service

  **Returns:** Promise that resolves when the service stops

- `watchFileSystem(fileSystemProviderName: string, filesystemConfig: FileSystemConfig, signal: AbortSignal): Promise<void>`

  Configures a new filesystem to watch.

  **Parameters:**

  - `fileSystemProviderName`: Unique identifier for the filesystem
  - `filesystemConfig`: Configuration object including `pollInterval`, `stabilityThreshold`, and `agentType`
  - `signal`: AbortSignal to cancel the watcher

- `processFileForAIComments({filePath, fileSystemProviderName}: {filePath: string, fileSystemProviderName: string}): Promise<void>`

  Scans a file for AI comments and processes them.

  **Parameters:**

  - `filePath`: Path to the file
  - `fileSystemProviderName`: Name of the filesystem provider

- `checkAndTriggerAIAction(line: string, filePath: string, lineNumber: number, fileSystemProviderName: string): Promise<void>`

  Checks a comment line for AI triggers and initiates action.

  **Parameters:**

  - `line`: The comment line content
  - `filePath`: Path of the file containing the comment
  - `lineNumber`: Line number in the file
  - `fileSystemProviderName`: Name of the filesystem provider

- `handleAIComment(commentLine: string, filePath: string, lineNumber: number, fileSystemProviderName: string): Promise<void>`

  Handles processing of a specific AI comment type.

  **Parameters:**

  - `commentLine`: The comment line content
  - `filePath`: Path of the file
  - `lineNumber`: Line number in the file
  - `fileSystemProviderName`: Name of the filesystem provider

- `triggerCodeModification(content: string, filePath: string, lineNumber: number, fileSystemProviderName: string): Promise<void>`

  Triggers code modification agent for an `AI!` comment.

  **Parameters:**

  - `content`: The content of the comment
  - `filePath`: Path of the file
  - `lineNumber`: Line number in the file
  - `fileSystemProviderName`: Name of the filesystem provider

- `runCodeModification(prompt: string, filePath: string, agent: Agent): Promise<void>`

  Executes code modification agent.

  **Parameters:**

  - `prompt`: The instruction prompt for the agent
  - `filePath`: Path of the file
  - `agent`: The Agent instance to execute commands on

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
import codeWatch from '@tokenring-ai/code-watch';

try {
  const app = new TokenRingApp();
  app.install(codeWatch);
  console.log('CodeWatch plugin installed successfully');
} catch (error) {
  console.error('Failed to install CodeWatch:', error);
}
```

### Manual Configuration

```typescript
import TokenRingApp from '@tokenring-ai/app';
import CodeWatchService from '@tokenring-ai/code-watch/CodeWatchService';
import { CodeWatchConfigSchema } from '@tokenring-ai/code-watch';

const app = new TokenRingApp();

const config = {
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
const service = new CodeWatchService(app, config);

const abortController = new AbortController();

// Start monitoring
await service.run(abortController.signal);

// Stop monitoring
abortController.abort();
```

### Error Handling Example

```typescript
const service = new CodeWatchService(app, config);
try {
  await service.run(new AbortController().signal);
} catch (error) {
  console.error('Error in CodeWatchService:', error);
}
```

## Integration

The `@tokenring-ai/code-watch` plugin integrates with the TokenRing application framework through service registration. It registers the `CodeWatchService` with the app, which then:

- Listens for file changes via the configured filesystems
- Processes detected AI comments by spawning appropriate agents
- Handles error logging and service monitoring

## Best Practices

1. **Agent Selection**: Choose appropriate agent types for different filesystems based on the type of code modifications expected
2. **Polling Intervals**: Balance between responsiveness and system load by adjusting `pollInterval` and `stabilityThreshold`
3. **Concurrency**: Set appropriate concurrency levels based on your system's capabilities
4. **Error Monitoring**: Implement monitoring for service errors to catch issues early

## Testing

Run tests using:

```bash
bun run test
```

Run tests in watch mode:

```bash
bun run test:watch
```

Generate coverage reports:

```bash
bun run test:coverage
```

## Development

### Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Make changes and add tests
4. Submit a pull request

### Build

```bash
bun run build
```

## License

MIT License - see [LICENSE](./LICENSE) file for details.
