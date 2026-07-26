# @tokenring-ai/code-watch

## Overview

The `@tokenring-ai/code-watch` package provides a background service for the
Token Ring AI ecosystem that monitors configured filesystems for file changes,
detects special AI comment patterns (like `# AI!` or `// AI!`), and automatically
spawns agents to execute code modifications based on those instructions.

This service uses polling-based file system watching with configurable intervals
and stability thresholds to debounce rapid file changes. When an AI comment with
the `AI!` marker is detected, the service spawns a configured agent type in
headless mode to execute the requested code modifications.

### Key Features

- **File System Monitoring**: Watches multiple filesystems for file additions
  and changes using virtual filesystem providers
- **AI Comment Detection**: Detects AI triggers in both Python/shell (`#`) and
  C-style (`//`) comments
- **Smart Change Handling**: Uses stability thresholds to debounce rapid
  file changes
- **Concurrent Processing**: Processes files concurrently with configurable
  worker queue via `async.queue`
- **Agent Integration**: Automatically spawns appropriate agents to execute
  AI instructions in headless mode
- **Error Handling**: Comprehensive error logging and graceful failure handling
- **Ignore Filtering**: Respects ignore patterns from filesystem providers

### Plugin Display Name

- **Name**: `@tokenring-ai/code-watch`
- **Display Name**: Code Watcher

## Installation

```bash
bun add @tokenring-ai/code-watch
```

### Dependencies

- `@tokenring-ai/app`: workspace:*
- `@tokenring-ai/agent`: workspace:*
- `@tokenring-ai/filesystem`: workspace:*
- `@tokenring-ai/utility`: workspace:*
- `zod`: ^4.4.3
- `async`: ^3.2.6

## Features

- Monitors multiple filesystems for file changes
- Detects AI comment patterns in code files (`# AI!`, `// AI!`)
- Automatically spawns agents to execute AI instructions
- Supports concurrent file processing
- Implements debouncing for stability via `stabilityThreshold`
- Integrates with TokenRing plugin system
- Respects ignore patterns from filesystem providers

## Chat Commands

This package does not provide chat commands. It operates as a background service
monitoring files for changes.

## Tools

This package does not provide tools. It operates as a background service.

## Configuration

### Configuration Options

#### Top-Level Configuration

| Field       | Type              | Default  | Description        |
|:------------|:------------------|:---------|:-------------------|
| `codewatch` | `CodeWatchConfig` | optional | Main configuration |

#### CodeWatchConfig

| Field         | Type                               | Default  | Description                                |
|:--------------|:-----------------------------------|:---------|:-------------------------------------------|
| `filesystems` | `Record<string, FileSystemConfig>` | required | Watched filesystems, keyed by name         |
| `concurrency` | `number`                           | 1        | Maximum number of change-handling agents running at once |

#### FileSystemConfig

| Field                | Type     | Default  | Description                                                    |
|:---------------------|:---------|:---------|:---------------------------------------------------------------|
| `pollInterval`       | `number` | 1000     | How often to poll for file changes (ms, advanced)              |
| `stabilityThreshold` | `number` | 2000     | Quiet time required before a changed file is considered stable (ms, advanced) |
| `agentType`          | `string` | required | Agent type spawned to react to changes in this filesystem      |

### Configuration Example

```yaml
codewatch:
  filesystems:
    local:
      pollInterval: 1000
      stabilityThreshold: 2000
      agentType: 'code-modification-agent'
  concurrency: 2
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

### Comment Detection Patterns

The service detects AI comments using these patterns:

1. **Lines starting with `# AI`** (Python/shell style)
2. **Lines starting with `// AI`** (C-style)
3. **Lines containing `AI!`** (any style)

**Important:** Only comments containing `AI!` will trigger code modification.
Comments that match the prefix patterns but don't contain `AI!` will be
detected but won't trigger action.

## License

MIT License - see LICENSE file for details.
