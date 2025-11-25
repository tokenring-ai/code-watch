# @tokenring-ai/code-watch

## Overview

The `@tokenring-ai/code-watch` package provides a service for monitoring file changes and detecting AI-triggered comments within those files. It integrates with the TokenRing AI framework to automatically execute actions based on special comments like `# AI!` or `// AI?` in code files.

This package watches the root directory for file additions and changes. When a file is modified, it scans for comment lines that contain AI triggers and spawns AI agents to process them. Currently, it fully supports triggering code modifications via `AI!` comments, while support for `AI?` (question answering) and plain `AI` comments is implemented as stubs.

## Installation

```bash
npm install @tokenring-ai/code-watch
```

## Prerequisites

This package requires the following TokenRing AI dependencies:
- `@tokenring-ai/chat`
- `@tokenring-ai/agent`
- `@tokenring-ai/filesystem`

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
import CodeWatchService from "@tokenring-ai/code-watch";

const app = new TokenRingApp({
  // Your app configuration
});

// Configure the service
const config = {
  agentTypes: {
    codeModification: "code-modifier-agent" // Your agent type for code modifications
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

```
pkg/code-watch/
├── index.ts                 # Entry point and plugin definition
├── CodeWatchService.ts      # Main service implementation
├── agents/
│   └── codeModificationAgent.ts  # Agent configuration for code modifications
├── package.json            # Package configuration and dependencies
├── README.md               # This documentation
└── LICENSE                 # MIT license
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

- `async start()`: Start the service and begin watching files
- `async stop()`: Stop the service and clean up resources
- `onFileChanged(eventType: string, filePath: string)`: Handle file change events
- `async processFileForAIComments(filePath: string)`: Process a file for AI comments
- `async handleAIComment(commentLine: string, filePath: string, lineNumber: number)`: Handle AI comments

### Plugin Interface

The package exports a TokenRing plugin with the following structure:

```typescript
export default {
  name: "@tokenring-ai/code-watch",
  version: "0.1.0",
  description: "Service for watching code changes and triggering actions",
  install(app: TokenRingApp) {
    // Automatic installation logic
  }
}
```

## Configuration

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

- `@tokenring-ai/chat@0.1.0`: For AI chat functionality
- `@tokenring-ai/agent@0.1.0`: For agent management
- `@tokenring-ai/filesystem@0.1.0`: For file watching and operations
- `ignore@^7.0.5`: For file ignoring patterns

## Testing

Run the test suite:

```bash
npm test
```

## Limitations

- Currently supports only `#` (Python/Shell) and `//` (C-style) comments
- `AI?` and `AI` comment types are stub implementations
- Polling-based file watching (not real-time)
- Assumes UTF-8 text files
- No support for file deletion processing

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Submit a pull request

## License

MIT License - see LICENSE file for details.