# @tokenring-ai/code-watch

Background service that triggers agents when specific `AI!` comments are detected in code files.

## Overview

The `@tokenring-ai/code-watch` package provides a background service for TokenRing applications
that monitors configured filesystems for file changes, scans changed files for AI comment markers
(`# AI!`, `// AI!`), and automatically spawns an agent of a configured type to execute the requested
code modifications.

For each configured filesystem, the service opens a watcher through the filesystem provider's `watch`
support, using per-filesystem `pollInterval` and `stabilityThreshold` values and an ignore filter
built from the provider's `.gitignore` / `.aiignore` files. Changed files are processed through a
concurrency-capped work queue; when a file contains an `AI!` comment, a fresh headless agent is
spawned to edit the file and remove the marker lines.

### Key Features

- **File system monitoring**: watches filesystem providers registered with `FileSystemService` for
  `add` and `change` events.
- **AI comment detection**: scans `#` (Python/shell) and `//` (C-style) comment lines for the `AI!`
  marker.
- **Debounced change handling**: forwards `pollInterval` and `stabilityThreshold` to the provider's
  watcher and coalesces repeated events per path before processing.
- **Concurrent processing**: processes files through an `async.queue` work queue with configurable
  concurrency.
- **Agent integration**: spawns a fresh headless agent of the filesystem's `agentType` per
  triggering comment and runs the edited file through the `/work` command.
- **Ignore filtering**: respects `.gitignore` / `.aiignore` plus default ignores (`.git`,
  `node_modules`, hidden files, `*.lock`).
- **Live reconfiguration**: updating the `codewatch` config re-reconciles the live watchers without
  a restart.

## Installation

```bash
bun add @tokenring-ai/code-watch
```

The plugin definition is exported from the `plugin` subpath (it is not re-exported from the package
entry):

```typescript
import TokenRingApp from "@tokenring-ai/app";
import PluginManager from "@tokenring-ai/app/PluginManager";
import codeWatchPlugin from "@tokenring-ai/code-watch/plugin";

const app = new TokenRingApp({ app: { workingDirectory, workspaceDirectory, configDirectories } });
const pluginManager = app.addService(new PluginManager(app));
await pluginManager.installPlugins([codeWatchPlugin]);
```

## Chat Commands

This package does not register any chat commands. It operates as a background service that monitors
files for changes.

## Tools

This package does not define any tools. Agents spawned to handle `AI!` comments use the tools of
their configured agent type.

## Configuration

The plugin reads a single `codewatch` configuration object:

```yaml
codewatch:
  filesystems:
    local:
      pollInterval: 1000          # optional, default 1000 (ms)
      stabilityThreshold: 2000    # optional, default 2000 (ms)
      agentType: code-modification-agent
    docs:
      agentType: docs-agent
  concurrency: 2                  # optional, default 1
```

| Field                     | Type                               | Required | Default | Description                                                                       |
|---------------------------|------------------------------------|----------|---------|-----------------------------------------------------------------------------------|
| `codewatch`               | `CodeWatchConfig`                  | no       | —       | Watches filesystems and spawns agents in response to changes                      |
| `codewatch.filesystems`   | `Record<string, FileSystemConfig>` | yes      | —       | Watched filesystems, keyed by name                                                |
| `codewatch.concurrency`   | `number`                           | no       | `1`     | Maximum number of changed files processed concurrently by the work queue          |

Each entry of `filesystems` is a `FileSystemConfig`:

| Field                | Type     | Required | Default | Description                                                                     |
|----------------------|----------|----------|---------|---------------------------------------------------------------------------------|
| `pollInterval`       | `number` | no       | `1000`  | How often to poll for file changes (ms)                                         |
| `stabilityThreshold` | `number` | no       | `2000`  | Quiet time required before a changed file is considered stable (ms)             |
| `agentType`          | `string` | yes      | —       | Agent type spawned to react to changes in this filesystem                        |

The keys of `filesystems` must match the names of filesystem providers registered with
`FileSystemService`; the watcher is opened on the provider of that name.

When the `codewatch` key is absent from the configuration, the plugin leaves the existing
configuration untouched (an unconfigured service uses `filesystems: {}` and `concurrency: 1`).

### Schema Metadata

The config schema annotates fields for configuration UI integration:

| Field | `.meta()` annotation |
|---|---|
| `codewatch` | `{ label: "Code Watch", description: "Watches filesystems and spawns agents in response to changes" }` |
| `codewatch.filesystems` | `{ label: "Filesystems", description: "Watched filesystems, keyed by name" }` |
| `codewatch.filesystems.<name>.pollInterval` | `{ unit: "ms", advanced: true, description: "How often to poll for file changes" }` |
| `codewatch.filesystems.<name>.stabilityThreshold` | `{ unit: "ms", advanced: true, description: "Quiet time required before a changed file is considered stable" }` |
| `codewatch.filesystems.<name>.agentType` | `{ description: "Agent type spawned to react to changes in this filesystem" }` |
| `codewatch.concurrency` | `{ description: "Maximum number of change-handling agents running at once" }` |

### AI comment triggers

The service inspects each line of a changed file and considers only lines whose trimmed form starts
with `#` (Python/shell style) or `//` (C-style). A comment triggers an agent when its content
contains the `AI!` marker:

```python
# AI! Fix the off-by-one error in the loop below
for i in range(10):
    print(i)
```

```javascript
// AI! Refactor this function to use async/await
function fetchData() {
    return fetch('/api/data').then(res => res.json());
}
```

The marker may appear anywhere within the comment (for example `# Rebuild this module AI!`), but the
line must still start with `#` or `//` — inline comments that begin with code (for example
`const result = processData(data); // AI! add error handling`) are not scanned. Lines that start
with `# AI` or `// AI` but do not contain `AI!` are detected but do not trigger an agent.

When a comment triggers, the service spawns a fresh headless agent of the filesystem's `agentType`,
adds the changed file to the agent's chat, and dispatches `/work` with instructions to execute the
`AI!` instructions, edit the file with the `file_write` tool, and remove the `AI!` lines.

## Core Components

### CodeWatchService

The background service that implements the package. It implements `TokenRingService`.

```typescript
import CodeWatchService from "@tokenring-ai/code-watch/CodeWatchService";
import { CodeWatchConfigSchema } from "@tokenring-ai/code-watch";

const service = app.requireService(CodeWatchService);
```

**Properties:**

| Property      | Type             | Description                                        |
|---------------|------------------|----------------------------------------------------|
| `name`        | `"CodeWatchService"` | Service identifier                             |
| `description` | `"Provides CodeWatch functionality that monitors files for AI comments"` | Service description |
| `app`         | `WorkspaceRuntime` | The application instance (readonly)             |

**Methods:**

| Method | Description |
|---|---|
| `reconfigure(config: CodeWatchConfig): Promise<void>` | Applies package config (`z.output<typeof CodeWatchConfigSchema>`), updates the work queue concurrency, and re-reconciles live watchers once the service has started |
| `start(): Promise<void>` | Opens a watcher for every configured filesystem. Called by `TokenRingApp.run()` after all plugins have been configured, so filesystem providers are available |
| `stop(): void` | Kills the work queue, clears stability timers, and closes every watcher |
| `processFileForAIComments({ filePath, fileSystemProviderName }): Promise<void>` | Reads a file through its provider and checks each `#` / `//` comment line for AI triggers |
| `checkAndTriggerAIAction(line, filePath, lineNumber, fileSystemProviderName): Promise<void>` | Forwards a comment line to `handleAIComment` when it starts with `# AI` / `// AI` or contains `AI!` |
| `handleAIComment(commentLine, filePath, lineNumber, fileSystemProviderName): Promise<void>` | Strips the comment marker and calls `triggerCodeModification` when the content contains `AI!` |
| `triggerCodeModification(_content, filePath, lineNumber, fileSystemProviderName): Promise<void>` | Spawns a headless agent of the filesystem's `agentType`, points the agent's active filesystem at the changed provider, and runs the code-modification prompt |
| `runCodeModification(prompt, filePath, agent): Promise<void>` | Adds the changed file to the agent's chat selection and dispatches `/work <prompt>` through `AgentCommandService` |

`reconfigure` and `start` throw a `ConfigurationError` when a configured filesystem's provider does
not support watching, and a plain `Error` (`Item <name> not found`) when the provider is not
registered with `FileSystemService`.

#### Change-to-agent pipeline

1. `openWatcher` requires the provider by name and calls `provider.watch("./", { pollInterval,
   stabilityThreshold, ignoreFilter })`, where `ignoreFilter` is built with
   `createIgnoreFilter(provider)` (defaults: `.git`, `node_modules`, hidden files, `*.lock`, plus
   everything listed in the provider's `.gitignore` and `.aiignore`).
2. `add` / `change` events are coalesced per path and enqueued on an `async.queue` whose worker is
   `processFileForAIComments`; `unlink` events only cancel pending work for that path; `error` events
   are logged through `app.serviceError`.
3. When a comment triggers, `triggerCodeModification` spawns a fresh headless agent of the
   filesystem's `agentType`, switches the agent's active filesystem to the changed provider via
   `FileSystemService.setActiveFileSystem`, and hands control to `runCodeModification`.
4. `runCodeModification` adds the changed file to the agent's chat selection (`addFileToChat`) and
   dispatches `executeAgentCommand(agent, "/work <prompt>")`. The prompt instructs the agent to
   execute the `AI!` instructions, update the file with the `file_write` tool, and remove any lines
   that end with the `AI!` marker.

## Services

The plugin registers a single service when installed:

```typescript
app.addService(new CodeWatchService(app));
```

Watchers are opened by `CodeWatchService.start()`, which `TokenRingApp.run()` invokes on every
service after all plugins are installed and configured; `stop()` closes them during shutdown.

### Plugin Lifecycle

The plugin (`plugin/code-watch/plugin.ts`) defines no agent lifecycle hooks; its plugin-level
lifecycle is:

| Field          | Value                                                                                    |
|----------------|------------------------------------------------------------------------------------------|
| `name`         | `@tokenring-ai/code-watch` (from package.json)                                           |
| `displayName`  | `Code Watcher`                                                                           |
| `version`      | package version                                                                          |
| `description`  | `Background service that triggers agents when specific AI comments are detected in code.` |
| `configSchema` | `z.object({ codewatch: CodeWatchConfigSchema.exactOptional() })`                          |

- **`install(app)`** — adds `CodeWatchService` to the app.
- **`reconfigure(app, config)`** — when `config.codewatch` is present, calls
  `CodeWatchService.reconfigure(config.codewatch)`, which stores the config, updates the work queue
  concurrency, and — once the service has started — re-reconciles the live watchers. When the
  `codewatch` key is absent, the plugin does nothing.

```typescript
import { z } from "zod";
import CodeWatchService from "./CodeWatchService.ts";
import { CodeWatchConfigSchema } from "./index.ts";
import packageJSON from "./package.json" with { type: "json" };

const packageConfigSchema = z.object({
  codewatch: CodeWatchConfigSchema.exactOptional(),
});

export default {
  name: packageJSON.name,
  displayName: "Code Watcher",
  version: packageJSON.version,
  description: packageJSON.description,
  install(app) {
    app.addService(new CodeWatchService(app));
  },
  async reconfigure(app, config) {
    if (config.codewatch) {
      await app.requireService(CodeWatchService).reconfigure(config.codewatch);
    }
  },
  configSchema: packageConfigSchema,
} satisfies TokenRingPlugin<typeof packageConfigSchema>;
```

## Dependencies

| Package                   | Purpose                                                                 |
|---------------------------|-------------------------------------------------------------------------|
| `@tokenring-ai/app`       | Application runtime, `TokenRingPlugin` / `TokenRingService` types, `ConfigurationError` |
| `@tokenring-ai/agent`     | `AgentManager` (spawning agents), `AgentCommandService` (dispatching `/work`) |
| `@tokenring-ai/filesystem`| `FileSystemService`, `FileSystemWatcher`, `createIgnoreFilter`          |
| `@tokenring-ai/utility`   | `EnhancedMap`, `EnhancedStringMap`                                      |
| `zod`                     | Configuration schema validation                                        |
| `async`                   | `async.queue` work queue and concurrency control                        |

## Testing

```bash
bun test              # run all tests
bun test --watch      # watch mode
bun test --coverage   # with coverage
```

The test commands are wired through `bun.config.ts`. The package currently ships no `*.test.ts`
files, so `bun test` reports zero tests; the commands are defined for future coverage.

## License

MIT License — see [LICENSE](./LICENSE) file for details.
