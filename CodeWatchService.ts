import { type Agent, AgentManager } from "@tokenring-ai/agent";
import { AgentEventState } from "@tokenring-ai/agent/state/agentEventState";
import type WorkspaceRuntime from "@tokenring-ai/app";
import type { TokenRingService } from "@tokenring-ai/app/types";
import FileSystemService from "@tokenring-ai/filesystem/FileSystemService";
import type { FileSystemWatcher } from "@tokenring-ai/filesystem/FileSystemTypes";
import type HostFileSystem from "@tokenring-ai/filesystem/HostFileSystem";
import { topLevelRoots } from "@tokenring-ai/filesystem/util/allowedPaths";
import { isIgnoreFile, RefreshingTreeIgnore } from "@tokenring-ai/filesystem/util/treeIgnore";
import EnhancedMap from "@tokenring-ai/utility/map/enhancedMap";
import async from "async";
import type z from "zod";
import type { CodeWatchConfigSchema } from "./index.ts";

type CodeWatchConfig = z.output<typeof CodeWatchConfigSchema>;

/** A line asking for a change: a whole-line `#` or `//` comment containing `AI!`. */
export interface AIMarker {
  /** 1-based. */
  line: number;
  text: string;
}

/** The `AI!` markers in a file. Comments after code, and block comments, do not count. */
export function findAIMarkers(text: string): AIMarker[] {
  const markers: AIMarker[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if ((line.startsWith("#") || line.startsWith("//")) && line.includes("AI!")) markers.push({ line: i + 1, text: line });
  }
  return markers;
}

/** Fans one logical watch out over every write-allowed root. */
class CompositeFileSystemWatcher implements FileSystemWatcher {
  constructor(private readonly watchers: FileSystemWatcher[]) {}

  on(event: "add" | "change" | "unlink", listener: (filePath: string) => void): this;
  on(event: "error", listener: (error: Error) => void): this;
  on(event: string, listener: (...args: unknown[]) => void): this;
  on(event: string, listener: (...args: never[]) => void): this {
    for (const watcher of this.watchers) {
      watcher.on(event, listener as (...args: unknown[]) => void);
    }
    return this;
  }

  close(): void {
    for (const watcher of this.watchers) {
      watcher.close();
    }
  }
}

export default class CodeWatchService implements TokenRingService {
  readonly name = "CodeWatchService";
  description = "Provides CodeWatch functionality that monitors files for AI comments";

  private readonly workQueue: async.QueueObject<{ filePath: string }>;

  /** The live watcher, while configured and started. */
  private watcher: FileSystemWatcher | null = null;
  /** Debounce timers, by path. */
  private stabilityTimers = new EnhancedMap<string, NodeJS.Timeout>();

  /** Absent until the `codewatch` key is configured; the service is idle without it. */
  private config: CodeWatchConfig | undefined;

  /** True after {@link start} has run — reconfigure only reconciles watchers once started. */
  private started = false;

  /** Watcher restarts, one at a time, so a config change mid-restart can't leave a watcher open. */
  private watcherUpdate: Promise<void> = Promise.resolve();
  /** Counts {@link stop} calls, so a watcher that finishes opening after a stop is closed again. */
  private stopCount = 0;

  /** Files an agent is working on; their changes (the agent's own edits) are not acted on. */
  private readonly working = new Set<string>();

  /**
   * The markers each file was last handled for. A file still showing the same markers afterwards
   * (the agent left them in) is not handed to another agent, so a stuck marker can't loop forever.
   */
  private readonly handledMarkers = new Map<string, string>();

  constructor(
    readonly app: WorkspaceRuntime,
    config?: CodeWatchConfig,
  ) {
    if (config) this.config = config;

    this.workQueue = async.queue<{ filePath: string }>(async (task, callback) => {
      try {
        await this.processFileForAIComments(task);
      } catch (err) {
        app.serviceError(this, `Error processing file ${task.filePath}:`, err);
      }
      callback();
    }, this.config?.concurrency ?? 1);
  }

  /**
   * Applies package config. Watchers are created in {@link start}; later
   * reconfigures re-reconcile live watchers.
   */
  async reconfigure(config: CodeWatchConfig | undefined): Promise<void> {
    // Without config (the `codewatch` key was removed) the service is idle: the restart below just closes the watcher.
    this.config = config;
    if (config) this.workQueue.concurrency = config.concurrency;
    if (this.started) {
      await this.restartWatcher();
    }
  }

  /**
   * Opens watchers for every configured watch. Called after all plugins have
   * reconfigured so the filesystem allow-list is final.
   */
  async start(): Promise<void> {
    this.started = true;
    await this.restartWatcher();
  }

  /**
   * Closes every watcher and clears debounce timers. Replaces the old `run`/`waitForAbort` loop.
   */
  stop(): void {
    this.started = false;
    this.stopCount++;

    this.closeWatcher();
    this.workQueue.kill();
  }

  private restartWatcher(): Promise<void> {
    const update = this.watcherUpdate.then(async () => {
      this.closeWatcher();
      if (!this.config || !this.started) return;
      const stopCount = this.stopCount;
      const watcher = await this.openWatcher(this.config);
      // Stopped while the watcher was opening.
      if (this.stopCount !== stopCount) {
        watcher.close();
        return;
      }
      this.watcher = watcher;
    });
    this.watcherUpdate = update.catch(() => {});
    return update;
  }

  private closeWatcher(): void {
    for (const timer of this.stabilityTimers.values()) clearTimeout(timer);
    this.stabilityTimers.clear();
    this.watcher?.close();
    this.watcher = null;
  }

  private hostIO(provider: HostFileSystem) {
    return {
      readFile: async (filePath: string) => {
        try {
          return await provider.readFile(filePath);
        } catch {
          return null;
        }
      },
      exists: async (filePath: string) => {
        try {
          return await provider.exists(filePath);
        } catch {
          return false;
        }
      },
    };
  }

  private async openWatcher(config: CodeWatchConfig): Promise<FileSystemWatcher> {
    const fileSystemService = this.app.requireService(FileSystemService);
    const host = fileSystemService.host;

    // One watcher per top-level write-allowed root; ignore rules are evaluated
    // at event time so .gitignore edits apply while watching.
    const roots = topLevelRoots(fileSystemService.getAllowedPaths().filter(entry => entry.permission === "write"));
    if (roots.length === 0) {
      this.app.serviceOutput(this, "No write-allowed paths to watch; code-watch is idle");
    }

    const watchers: FileSystemWatcher[] = [];
    for (const root of roots) {
      const treeIgnore = new RefreshingTreeIgnore(root.path, {}, this.hostIO(host));
      watchers.push(
        await host.watch(root.path, {
          pollInterval: config.pollInterval,
          stabilityThreshold: config.stabilityThreshold,
          ignoreFilter: (filePath: string, isDirectory?: boolean) => {
            if (isIgnoreFile(filePath)) treeIgnore.invalidate();
            return treeIgnore.shouldIgnore(filePath, isDirectory);
          },
        }),
      );
    }
    const watcher = new CompositeFileSystemWatcher(watchers);

    const modifiedFiles = this.stabilityTimers;

    const onFileChanged = (eventType: string, filePath: string) => {
      if (modifiedFiles.has(filePath)) {
        const timer = modifiedFiles.deleteAndReturnItem(filePath);
        clearTimeout(timer);
      }

      if (eventType === "add" || eventType === "change") {
        modifiedFiles.set(
          filePath,
          setTimeout(() => {
            modifiedFiles.delete(filePath);
            void this.workQueue.push({ filePath });
          }, config.stabilityThreshold),
        );
      }
    };

    watcher
      .on("add", filePath => onFileChanged("add", filePath))
      .on("change", filePath => onFileChanged("change", filePath))
      .on("unlink", filePath => onFileChanged("unlink", filePath))
      .on("error", error => this.app.serviceError(this, "Error in file watcher:", error));

    this.app.serviceOutput(this, `Watching ${roots.map(root => root.path).join(", ")} for AI comments`);
    return watcher;
  }

  /** Reads a changed file and, when it has new `AI!` markers, has an agent carry them out. */
  async processFileForAIComments({ filePath }: { filePath: string }): Promise<void> {
    // An agent is already on it; this change is most likely its own edit.
    if (this.working.has(filePath)) return;

    const fileSystemService = this.app.requireService(FileSystemService);
    const text = await fileSystemService.host.readFile(filePath);
    if (!text) return;

    const markers = findAIMarkers(text.toString("utf-8"));
    if (markers.length === 0) {
      this.handledMarkers.delete(filePath);
      return;
    }
    const signature = markers.map(marker => marker.text).join("\n");
    if (this.handledMarkers.get(filePath) === signature) {
      this.app.serviceOutput(this, `${filePath} still has AI! markers an agent was already asked to handle; edit them to try again`);
      return;
    }
    this.handledMarkers.set(filePath, signature);
    await this.triggerCodeModification(filePath, markers);
  }

  /** Starts one agent for the file, however many markers it has, and deletes the agent when it is done. */
  async triggerCodeModification(filePath: string, markers: AIMarker[]): Promise<void> {
    const config = this.config;
    if (!config) return;
    const agentManager = this.app.requireService(AgentManager);

    let agent: Agent;
    try {
      agent = agentManager.spawnAgent({ agentType: config.agentType, answerTimeoutSeconds: 0 });
    } catch (error: unknown) {
      this.app.serviceError(this, `Failed to spawn agent for code modification in ${filePath}:`, error);
      return;
    }

    const where = markers.map(marker => `${filePath}:${marker.line}`).join(", ");
    this.working.add(filePath);
    try {
      this.app.serviceOutput(this, `Code modification triggered from ${where}, running a Code Modification Agent`);
      const prompt = `
The user has edited the file ${filePath}, included above, adding instructions to the file, which they expect AI to execute.
The instructions are in the comments marked AI!:
${markers.map(marker => `- line ${marker.line}: ${marker.text}`).join("\n")}
Complete those instructions, and any in nearby comments, using any tools available to you.
Once complete, update the file. You MUST remove every comment line containing AI!. It is a critical failure to leave these lines in the file.
`.trim();
      const result = await this.runCodeModification(prompt, filePath, agent);
      if (result.status !== "success") {
        this.app.serviceError(this, `Code modification for ${where} did not finish (${result.status}): ${result.message}`);
      }
    } finally {
      this.working.delete(filePath);
      agentManager.deleteAgent(agent.id, "Code-watch modification complete");
    }
  }

  /** Gives the agent the file and the instructions as a chat message, and waits for its reply. */
  async runCodeModification(prompt: string, filePath: string, agent: Agent): Promise<{ status: "success" | "error" | "cancelled"; message: string }> {
    const fileSystemService = this.app.requireService(FileSystemService);
    await fileSystemService.addFileToChat(filePath, agent);

    const cursor = agent.getState(AgentEventState).getEventCursorFromCurrentPosition();
    const requestId = agent.handleInput({ from: "Code watch", message: prompt });
    for await (const state of agent.subscribeStateAsync(AgentEventState, agent.agentShutdownSignal)) {
      for (const event of state.yieldEventsByCursor(cursor)) {
        if (event.type === "agent.response" && event.requestId === requestId) return { status: event.status, message: event.message };
      }
    }
    return { status: "cancelled", message: "The agent stopped before it finished." };
  }
}
