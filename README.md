# @tokenring-ai/code-watch

Background service that triggers agents when specific `AI!` comments are detected in code files.

## Overview

The `@tokenring-ai/code-watch` package provides a background service for TokenRing applications
that monitors the host filesystem for file changes, scans changed files for AI comment markers
(`# AI!`, `// AI!`), and automatically spawns an agent of a configured type to execute the requested
code modifications.

Once the `codewatch` key is configured, the service opens a single logical watcher covering every
write-allowed host path (the top-level `filesystem.allowedPaths` entries with `write` permission),
using the configured `pollInterval` and `stabilityThreshold` values and an ignore filter built from each root's
`.gitignore` / `.aiignore` files. Without the `codewatch` key the service is idle. Changed files are processed through a
concurrency-capped work queue; when a file contains an `AI!` comment, a fresh unattended agent is
spawned to edit the file and remove the marker lines.

### Key Features

- **File system monitoring**: watches the host filesystem (via `FileSystemService`) for
  `add` and `change` events.
- **AI comment detection**: scans `#` (Python/shell) and `//` (C-style) comment lines for the `AI!`
  marker.
- **Debounced change handling**: forwards `pollInterval` and `stabilityThreshold` to the host
  watcher and coalesces repeated events per path before processing.
- **Concurrent processing**: processes files through an `async.queue` work queue with configurable
  concurrency.
- **Agent integration**: spawns one fresh unattended agent of the configured `agentType` per changed
  file with `AI!` markers, and sends it the instructions as a chat message.
- **No loops**: changes made while an agent works on a file are ignored, and a file whose markers
  were already handed to an agent (and left in) is not handed to another until the markers change.
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
  agentType: code-modification-agent
  pollInterval: 1000          # optional, default 1000 (ms)
  stabilityThreshold: 2000    # optional, default 2000 (ms)
  concurrency: 2              # optional, default 1
```

| Field                          | Type              | Required | Default | Description                                                                 |
|--------------------------------|-------------------|----------|---------|-----------------------------------------------------------------------------|
| `codewatch`                    | `CodeWatchConfig` | no       | —       | Watches host files and spawns agents in response to `AI!` comments          |
| `codewatch.agentType`          | `string`          | yes      | —       | Agent type spawned to act on `AI!` comments in write-allowed host paths     |
| `codewatch.pollInterval`       | `number`          | no       | `1000`  | How often to poll for file changes (ms)                                     |
| `codewatch.stabilityThreshold` | `number`          | no       | `2000`  | Quiet time required before a changed file is considered stable (ms)         |
| `codewatch.concurrency`        | `number`          | no       | `1`     | Maximum number of changed files processed concurrently by the work queue    |

There is one watcher, covering every write-allowed host path; there are no named watches. If no
write-allowed path exists, the service logs `No write-allowed paths to watch; code-watch is idle`.

The old per-watch `filesystems` map has been removed: the schema declares it as
`z.never().exactOptional()`, so a config that still sets `codewatch.filesystems` fails validation.
Move `agentType`, `pollInterval` and `stabilityThreshold` up to the `codewatch` object.

When the `codewatch` key is absent from the configuration the service stays idle (no watcher is
opened), and removing the key while running closes the watcher.

### Schema Metadata

The config schema annotates fields for configuration UI integration:

| Field | `.meta()` annotation |
|---|---|
| `codewatch` | `{ label: "Code Watch", description: "Watches host files and spawns agents in response to AI! comments" }` |
| `codewatch.agentType` | `{ description: "Agent type spawned to act on AI! comments in write-allowed host paths" }` |
| `codewatch.pollInterval` | `{ unit: "ms", advanced: true, description: "How often to poll for file changes" }` |
| `codewatch.stabilityThreshold` | `{ unit: "ms", advanced: true, description: "Quiet time required before a changed file is considered stable" }` |
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
with `# AI` or `// AI` but do not contain `AI!` do not trigger an agent, nor do block comments.

When a file has markers, the service spawns one fresh unattended agent of the configured `agentType`
for the whole file, adds the file to the agent's chat, and sends it a chat message listing every
marker (line and text) with instructions to carry them out, update the file, and remove the `AI!`
lines. If the agent leaves the same markers in, they are not handed to another agent; edit them to
try again.

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
| `reconfigure(config: CodeWatchConfig \| undefined): Promise<void>` | Applies package config (`z.output<typeof CodeWatchConfigSchema>`), updates the work queue concurrency, and restarts the watcher once the service has started; `undefined` closes it |
| `start(): Promise<void>` | Opens the watcher over every write-allowed host path (when `codewatch` is configured). Called by `TokenRingApp.run()` after all plugins have been configured, so the filesystem allow-list is final |
| `stop(): void` | Kills the work queue, clears stability timers, and closes every watcher |
| `processFileForAIComments({ filePath }): Promise<void>` | Reads a file from the host filesystem and, when it has `AI!` markers not already handed to an agent (and no agent is working on it), calls `triggerCodeModification` once |
| `triggerCodeModification(filePath, markers): Promise<void>` | Spawns an unattended agent (`answerTimeoutSeconds: 0`: its questions take their defaults at once) of the configured `agentType` (returns early when `codewatch` is unconfigured), runs the code-modification prompt, and deletes the agent afterwards |
| `runCodeModification(prompt, filePath, agent): Promise<{ status, message }>` | Adds the changed file to the agent's chat selection, sends the prompt as a chat message (`agent.handleInput`), and resolves with the agent's response |

`findAIMarkers(text)` (exported) returns the `{ line, text }` of every whole-line `#` / `//` comment containing `AI!`.

#### Change-to-agent pipeline

1. `openWatcher` takes `FileSystemService.host`, picks the top-level write-allowed roots from
   `getAllowedPaths()`, and calls `host.watch(root, { pollInterval, stabilityThreshold, ignoreFilter })`
   for each one, combining the watchers into one. `ignoreFilter` uses a refreshing `TreeIgnore`
   (defaults: `.git`, `node_modules`, hidden files, `*.lock`, plus everything listed in the
   `.gitignore` and `.aiignore` files).
2. `add` / `change` events are coalesced per path and enqueued on an `async.queue` whose worker is
   `processFileForAIComments`; `unlink` events only cancel pending work for that path; `error` events
   are logged through `app.serviceError`.
3. When a file has new markers, `triggerCodeModification` spawns one fresh unattended agent of the
   configured `agentType` and hands control to `runCodeModification`; the agent is deleted once the
   modification finishes or fails. While it works, changes to that file are ignored.
4. `runCodeModification` adds the changed file to the agent's chat selection (`addFileToChat`) and
   sends the prompt as a chat message, which the agent's default command (`/chat send`) handles. The
   prompt lists the markers and instructs the agent to carry them out, update the file, and remove
   every comment line containing `AI!`. A response other than success is logged.

## Services

The plugin registers a single service when installed:

```typescript
app.addService(CodeWatchService, new CodeWatchService(app));
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
- **`reconfigure(app, config)`** — calls `CodeWatchService.reconfigure(config.codewatch)`, which
  stores the config, updates the work queue concurrency, and — once the service has started —
  restarts the watcher (restarts run one at a time). When the `codewatch` key is absent, the watcher
  is closed.

```typescript
import type { TokenRingPlugin } from "@tokenring-ai/app";
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
    app.addService(CodeWatchService, new CodeWatchService(app));
  },
  async reconfigure(app, config) {
    // Also when the key was removed, so the watcher stops.
    await app.requireService(CodeWatchService).reconfigure(config.codewatch);
  },
  configSchema: packageConfigSchema,
} satisfies TokenRingPlugin<typeof packageConfigSchema>;
```

## Dependencies

| Package                   | Purpose                                                                 |
|---------------------------|-------------------------------------------------------------------------|
| `@tokenring-ai/app`       | Application runtime, `TokenRingPlugin` / `TokenRingService` types, `ConfigurationError` |
| `@tokenring-ai/agent`     | `AgentManager` (spawning agents), `AgentEventState` (waiting for the agent's response) |
| `@tokenring-ai/filesystem`| `FileSystemService`, `FileSystemWatcher`, `TreeIgnore`          |
| `@tokenring-ai/utility`   | `EnhancedMap`, `EnhancedStringMap`                                      |
| `zod`                     | Configuration schema validation                                        |
| `async`                   | `async.queue` work queue and concurrency control                        |

## Testing

```bash
bun test              # run all tests
bun test --watch      # watch mode
bun test --coverage   # with coverage
```

The test commands are wired through `bun.config.ts`. `CodeWatchService.test.ts` covers the
stability debounce, `stop()`/restart, agent cleanup, comment detection, `unlink` cancellation, and
`CodeWatchConfigSchema` validation.

## License

MIT License — see [LICENSE](./LICENSE) file for details.
