# @tokenring-ai/code-watch

Code watcher service for Token Ring. This package provides a registry Service that monitors your workspace for file
changes and reacts to special in-file AI instructions written as comments.

When a changed file contains a comment tagged with AI!, the service sends the file and the instruction to your
configured LLM and asks it to apply the requested changes, using the file tool, and to remove the AI! line from the
file.

Current status: AI! is implemented. AI? (ask a question) and plain AI (note) are scaffolded but disabled by default in
the handler.

## Installation

This package is part of the Token Ring monorepo and is referenced in a workspace as:

- Name: `@tokenring-ai/code-watch`
- Version: `0.1.0`

It depends on the following peer packages being available/registered in your app:

- `@tokenring-ai/registry`
- `@tokenring-ai/filesystem`
- `@tokenring-ai/chat`
- `@tokenring-ai/ai-client`

## What it does

- Subscribes to the FileSystemService watcher (watch("./"))
- Collects added/changed file paths
- Reads file contents and scans for comment lines that include AI triggers
- Triggers an action for AI! lines:
- Builds a prompt with the entire file content and your AI! instruction
- Selects a capable model via ModelRegistry
- Requests the model to update the file using the file tool and to remove AI! comment lines
- Streams a short summary to ChatService

## Trigger syntax in code comments

The service looks for comment lines using either shell/Python style or C/JS style:

- Lines that start with one of:
- `# AI...`
- `// AI...`
- Or lines that end with one of:
- `AI`
- `AI!`
- `AI?`

Only AI! triggers an action at present. Example (JavaScript):

```js
> // AI! Refactor this function to use async/await and add proper error handling
function fetchData(cb) {
 doWork(function (err, res) {
  if (err) return cb(err);
  cb(null, res);
 });
}
```

Python/bash style also works:

```py
> # AI! Improve the algorithm below for O(n log n) sorting
```

Important: The LLM is instructed to remove any AI! lines when it writes the updated file.

## Using with tr-coder (recommended)

The tr-coder CLI will automatically add CodeWatchService when you declare `watchedFiles` in your
`.tokenring/coder-config.js`.

Minimal example config:

```js
export default {
  defaults: { model: "kimi-k2-instruct", persona: "code" },
  models: { /* your model providers here */ },
  watchedFiles: [
    { path: "./", include: /\.(js|jsx|ts|tsx|md|sql|txt)$/ },
  ],
};
```

- Starting tr-coder with this config registers ChatService, ModelRegistry, LocalFileSystemService, and CodeWatchService.
- CodeWatchService internally calls `fileSystem.watch("./")` and will receive change events based on your
  FileSystemService implementation and its configuration (e.g., include/exclude patterns from your app).

## Programmatic usage

```ts
import {ServiceRegistry} from "@tokenring-ai/registry";
import {LocalFileSystemService} from "@tokenring-ai/local-filesystem";
import {ChatService} from "@tokenring-ai/chat";
import {ModelRegistry} from "@tokenring-ai/ai-client";
import {CodeWatchService} from "@tokenring-ai/code-watch";

const registry = new ServiceRegistry();
await registry.start();

await registry.services.addServices(
  new ChatService({personas: {/*...*/}, persona: "code"}),
  new ModelRegistry(),
  new LocalFileSystemService({rootDirectory: process.cwd()}),
  new CodeWatchService(),
);

// Now, editing files under rootDirectory and saving lines with AI! will trigger model-driven updates
```

## API summary

- Class: `CodeWatchService extends Service`
- start(registry: Registry): Initializes and begins watching via FileSystemService.watch("./").
- stop(): Stops the watcher.
- startWatching()/stopWatching(): Manage underlying watcher.
- onFileChanged(eventType, filePath): Queues modified files.
- processNextFile(): Processes queued files serially.
- processFileForAIComments(filePath): Scans file content for AI triggers.
- handleAIComment(commentLine, filePath, lineNumber): Dispatches to action (currently only AI!).
- triggerCodeModification(content, filePath, lineNumber): Orchestrates model call and logs results to ChatService.
- triggerQuestionAnswer(...) and noteAIComment(...): Present but not wired in by default.

## Notes and limitations

- Only AI! is active. AI? and AI are present as stubs and currently not executed.
- The service relies on the registered `FileSystemService.watch` to emit events. Include/exclude behavior depends on the
  concrete file system service you register (e.g., LocalFileSystemService) and your app config. CodeWatchService itself
  calls `watch("./")`.
- The LLM request uses `@tokenring-ai/ai-client` and requires your ModelRegistry to be configured with a provider and
  model that supports tool use. The selection string is `auto:intelligence>=3,tools>=2`.
- File updates are expected to be performed by the model using the file tool within your application’s tool
  infrastructure; ensure tools are enabled in your registry.
- Security: Review AI! instructions before committing changes; they will be sent with the entire file content to your
  model provider.

## License

MIT
