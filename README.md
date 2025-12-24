# @tokenring-ai/code-watch

## Overview

The `@tokenring-ai/code-watch` package provides a service for monitoring file changes and detecting AI-triggered comments within code files. It integrates with the TokenRing AI framework to automatically execute actions based on special comments like `# AI!`, `# AI?`, or `# AI` in code files.

This package watches the root directory for file additions and changes. When a file is modified, it scans for comment lines that contain AI triggers and spawns AI agents to process them. The package currently supports triggering code modifications via `AI!` comments, while support for `AI?` (question answering) and plain `AI` comments is implemented as stubs.

## Features

- **File Watching**: Monitors the root directory for file additions, changes, and deletions
- **AI Comment Detection**: Scans files for special AI comments (`# AI!`, `# AI?`, `# AI`)
- **Agent Integration**: Spawns code modification agents to process `AI!` comments
- **TokenRing Plugin**: Designed to work seamlessly with the TokenRing application framework
- **Configurable**: Customizable agent types and watcher settings
- **Error Handling**: Comprehensive error handling and service output logging

## Installation

```bash
bun install @tokenring-ai/code-watch
```

## Prerequisites

This package requires the following TokenRing AI dependencies:
- `@tokenring-ai/app@0.2.0`
- `@tokenring-ai/agent@0.2.0`
- `@tokenring-ai/chat@0.2.0`
- `@tokenring-ai/filesystem@0.2.0`

## Usage

### Basic Integration

The package is designed to work as a TokenRing plugin. Here's how to integrate it:

```typescript
import TokenRingApp from "@tokenring-ai/app";
import codeWatch from "@tokenring-ai/code-watch";

const app = new TokenRingApp({
  // Your app configuration
});

// Install the code-watch plugin
app.install(codeWatch);

// The service will be automatically configured and started
```

### Manual Configuration

You can also configure the service manually:

```typescript
import TokenRingApp from "@tokenring-ai/app";
import {CodeWatchService} from "@tokenring-ai/code-watch";

const app = new TokenRingApp({
  // Your app configuration
});

// Configure the service
const config = {
  agentTypes: {
    codeModification: "code-modification-agent" // Agent type for code modifications
  }
};

// Add the service to the app
app.addServices(new CodeWatchService(app, config));
```

## AI Comment Triggers

The package supports different types of AI comments:

### Code Modification (`AI!`)

```typescript
// AI! Add a function to calculate factorial
function factorial(n: number): number {
  // Implementation will be added by AI
}
```

```python
# AI! Optimize this loop for better performance
for i in range(1000000):
    # code
```

When a file containing an `AI!` comment is saved, the service will:
1. Detect the comment
2. Spawn a code modification agent
3. Process the instruction and update the file
4. Remove the `AI!` comment line

### Question Answering (`AI?`)

```typescript
// AI? What is the best way to optimize this loop?
for i in range(1000000):
    # code
```

Currently logs the question for future implementation.

### AI Comments (`AI`)

```typescript
// AI This function needs unit tests
function example() {
    // code
}
```

Currently logs the comment for future implementation.

## Package Structure

```bash
pkg/code-watch/
├── index.ts                 # Entry point and schema definition
├── CodeWatchService.ts      # Main service implementation
├── plugin.ts               # TokenRing plugin interface
├── agents/
│   └── codeModificationAgent.ts  # Agent configuration for code modifications
├── package.json            # Package configuration and dependencies
├── README.md               # This documentation
├── LICENSE                 # MIT license
└── vitest.config.ts        # Test configuration
```

## API Reference

### CodeWatchService

The main class implementing the file watching and AI comment processing functionality.

#### Constructor

```typescript
constructor(app: TokenRingApp, config: CodeWatchServiceOptions)
```

**Parameters:**
- `app`: The TokenRing application instance
- `config`: Configuration object with agent types

#### Configuration Options

```typescript
interface CodeWatchServiceOptions {
  agentTypes: {
    codeModification: string;  // Agent type for code modifications
  }
}
```

#### Methods

- `async run(signal: AbortSignal)`: Start the service and begin watching files
- `async startWatching()`: Start watching the directory for file changes
- `async stopWatching()`: Stop watching for file changes
- `onFileChanged(eventType: string, filePath: string)`: Handle file change events
- `async processNextFile()`: Process the next file in the queue
- `async processFileForAIComments(filePath: string)`: Process a file for AI comments
- `async checkAndTriggerAIAction(line: string, filePath: string, lineNumber: number)`: Check for AI triggers
- `async handleAIComment(commentLine: string, filePath: string, lineNumber: number)`: Handle AI comments
- `async triggerCodeModification(content: string, filePath: string, lineNumber: number)`: Trigger code modification
- `async triggerQuestionAnswer(content: string, filePath: string, lineNumber: number)`: Mock function for question answering
- `async noteAIComment(content: string, filePath: string, lineNumber: number)`: Mock function to note AI comments

### Plugin Interface

The package exports a TokenRing plugin with the following structure:

```typescript
export default {
  name: "@tokenring-ai/code-watch",
  version: "0.2.0",
  description: "Service for watching code changes and triggering actions",
  install(app: TokenRingApp) {
    const config = app.getConfigSlice('codewatch', CodeWatchConfigSchema);
    if (config) {
      app.addServices(new CodeWatchService(app, config));
    }
  }
}
```

## Configuration

### Configuration Schema

```typescript
import {z} from "zod";

export const CodeWatchConfigSchema = z.any().optional();
```

### Environment Variables

The package doesn't require specific environment variables, but relies on the TokenRing framework configuration for:

- AI model selection
- Filesystem configuration
- Agent service configuration

### Watcher Configuration

The file watcher uses the following settings (hardcoded):

- `pollInterval`: 1000ms
- `stabilityThreshold`: 2000ms

## Dependencies

- `@tokenring-ai/app@0.2.0`: Base application framework
- `@tokenring-ai/agent@0.2.0`: Agent management system
- `@tokenring-ai/chat@0.2.0`: AI chat functionality
- `@tokenring-ai/filesystem@0.2.0`: Filesystem operations
- `ignore@^7.0.5`: File ignoring patterns

## Testing

Run the test suite:

```bash
bun run test
```

Or with coverage:

```bash
bun run test test:coverage
```

## Limitations

- Currently supports only `#` (Python/Shell) and `//` (C-style) comments
- `AI?` and `AI` comment types are stub implementations
- Polling-based file watching (not real-time)
- Assumes UTF-8 text files
- No support for file deletion processing
- Only processes files on add/change events

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Submit a pull request

## License

MIT License - see LICENSE file for details.