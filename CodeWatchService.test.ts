import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { EventEmitter } from "node:events";
import { AgentCommandService, AgentManager } from "@tokenring-ai/agent";
import type TokenRingApp from "@tokenring-ai/app";
import createTestingApp from "@tokenring-ai/app/test/createTestingApp.test";
import type { FileSystemProvider, FileSystemWatcher } from "@tokenring-ai/filesystem/FileSystemProvider";
import FileSystemService from "@tokenring-ai/filesystem/FileSystemService";
import CodeWatchService from "./CodeWatchService.ts";
import { CodeWatchConfigSchema } from "./index.ts";

class MockWatcher extends EventEmitter implements FileSystemWatcher {
  closed = false;
  close(): void {
    this.closed = true;
    this.removeAllListeners();
  }
}

function createMockProvider(files: Map<string, string>) {
  const watchers: MockWatcher[] = [];
  let lastWatchOptions: { ignoreFilter?: (p: string) => boolean; pollInterval?: number; stabilityThreshold?: number } | null = null;

  const provider = {
    async *getDirectoryTree() {},
    async writeFile() {
      return true;
    },
    async appendFile() {
      return true;
    },
    async deleteFile() {
      return true;
    },
    async readFile(filePath: string) {
      const content = files.get(filePath);
      return content != null ? Buffer.from(content) : null;
    },
    async rename() {
      return true;
    },
    async exists(filePath: string) {
      return files.has(filePath);
    },
    async stat(filePath: string) {
      if (!files.has(filePath)) return { path: filePath, exists: false as const };
      return {
        path: filePath,
        absolutePath: filePath,
        exists: true as const,
        isFile: true,
        isDirectory: false,
        size: files.get(filePath)!.length,
      };
    },
    async createDirectory() {
      return true;
    },
    async copy() {
      return true;
    },
    async watch(_dir: string, options?: { ignoreFilter?: (p: string) => boolean; pollInterval?: number; stabilityThreshold?: number }) {
      lastWatchOptions = options ?? null;
      const watcher = new MockWatcher();
      watchers.push(watcher);
      return watcher;
    },
  };

  return {
    provider: provider as unknown as FileSystemProvider,
    getLastWatcher: () => watchers.at(-1) ?? null,
    getWatchers: () => watchers,
    getLastWatchOptions: () => lastWatchOptions,
  };
}

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function installFakeAgentManager(app: TokenRingApp, knownAgentTypes: string[] = ["code-mod"]) {
  const agentManager = new AgentManager(app);
  app.addService(AgentManager, agentManager);

  const spawned: { id: string; requireService: typeof app.requireService }[] = [];
  const deleted: string[] = [];
  let nextId = 0;

  (agentManager as unknown as { spawnAgent: (args: { agentType: string; headless: boolean }) => (typeof spawned)[number] }).spawnAgent = () => {
    const agent = {
      id: `agent-${++nextId}`,
      requireService: app.requireService.bind(app),
    };
    spawned.push(agent);
    return agent;
  };
  (agentManager as unknown as { deleteAgent: (id: string, _reason: string) => boolean }).deleteAgent = (id: string) => {
    deleted.push(id);
    return true;
  };
  (agentManager as unknown as { getAgentConfig: (agentType: string) => { agentType: string } | undefined }).getAgentConfig = (agentType: string) =>
    knownAgentTypes.includes(agentType) ? { agentType } : undefined;

  return { agentManager, spawned, deleted };
}

type ServiceInternals = {
  watchedFilesystems: Map<string, FileSystemWatcher>;
  stabilityTimers: Map<string, Map<string, NodeJS.Timeout>>;
};

describe("CodeWatchService", () => {
  const filePath = "src/example.ts";
  const files = new Map<string, string>();

  let app: ReturnType<typeof createTestingApp>;
  let service: CodeWatchService;
  let fileSystemService: FileSystemService;
  let mockFs: ReturnType<typeof createMockProvider>;
  let fakeAgents: ReturnType<typeof installFakeAgentManager>;
  let executeAgentCommand: ReturnType<typeof mock>;

  beforeEach(async () => {
    files.clear();
    files.set(filePath, "// hello\n");

    app = createTestingApp();
    mockFs = createMockProvider(files);
    fileSystemService = new FileSystemService();
    fileSystemService.registerFileSystemProvider("local", mockFs.provider);
    app.addService(FileSystemService, fileSystemService);

    fakeAgents = installFakeAgentManager(app, ["code-mod"]);

    const agentCommandService = new AgentCommandService();
    executeAgentCommand = mock(async () => ({ message: "" }));
    spyOn(agentCommandService, "executeAgentCommand").mockImplementation(executeAgentCommand);
    app.addService(AgentCommandService, agentCommandService);

    spyOn(fileSystemService, "setActiveFileSystem").mockImplementation(() => {});
    spyOn(fileSystemService, "addFileToChat").mockResolvedValue(undefined);

    service = new CodeWatchService(app);
    app.addService(CodeWatchService, service);
    await service.reconfigure(
      CodeWatchConfigSchema.parse({
        filesystems: {
          local: {
            pollInterval: 10,
            stabilityThreshold: 40,
            agentType: "code-mod",
          },
        },
        concurrency: 1,
      }),
    );
    await service.start();
  });

  afterEach(() => {
    service.stop();
  });

  describe("stability debounce", () => {
    it("forwards stabilityThreshold to the watcher and waits that long before processing", async () => {
      expect(mockFs.getLastWatchOptions()?.stabilityThreshold).toBe(40);

      const processed: string[] = [];
      spyOn(service, "processFileForAIComments").mockImplementation(async task => {
        processed.push(task.filePath);
      });

      mockFs.getLastWatcher()!.emit("change", filePath);
      await wait(15);
      expect(processed).toEqual([]);

      await wait(40);
      expect(processed).toEqual([filePath]);
    });

    it("coalesces rapid change events into a single process after the last quiet period", async () => {
      const processed: string[] = [];
      spyOn(service, "processFileForAIComments").mockImplementation(async task => {
        processed.push(task.filePath);
      });

      const watcher = mockFs.getLastWatcher()!;
      watcher.emit("change", filePath);
      await wait(15);
      watcher.emit("change", filePath);
      await wait(15);
      expect(processed).toEqual([]);

      await wait(40);
      expect(processed).toEqual([filePath]);
    });
  });

  describe("stop()", () => {
    it("closes watchers and clears watcher and timer maps", async () => {
      const watcher = mockFs.getLastWatcher()!;
      watcher.emit("change", filePath);

      const internals = service as unknown as ServiceInternals;
      expect(internals.watchedFilesystems.size).toBe(1);
      expect(internals.stabilityTimers.size).toBe(1);
      expect(internals.stabilityTimers.get("local")?.size).toBe(1);

      service.stop();

      expect(watcher.closed).toBe(true);
      expect(internals.watchedFilesystems.size).toBe(0);
      expect(internals.stabilityTimers.size).toBe(0);
    });

    it("can start again after stop and open a new watcher", async () => {
      const first = mockFs.getLastWatcher()!;
      service.stop();
      expect(first.closed).toBe(true);

      await service.start();
      const second = mockFs.getLastWatcher()!;
      expect(second).not.toBe(first);
      expect(second.closed).toBe(false);
    });
  });

  describe("agent lifecycle", () => {
    it("deletes the spawned agent after a successful modification", async () => {
      files.set(filePath, "// AI! add error handling\n");

      await service.processFileForAIComments({ filePath, fileSystemProviderName: "local" });

      expect(fakeAgents.spawned).toHaveLength(1);
      expect(fakeAgents.deleted).toEqual([fakeAgents.spawned[0]!.id]);
      expect(executeAgentCommand).toHaveBeenCalledTimes(1);
      expect(String(executeAgentCommand.mock.calls[0]![1])).toContain("/work ");
    });

    it("deletes the spawned agent when the modification throws", async () => {
      files.set(filePath, "// AI! add error handling\n");
      executeAgentCommand.mockRejectedValue(new Error("work failed"));

      await expect(service.processFileForAIComments({ filePath, fileSystemProviderName: "local" })).rejects.toThrow("work failed");

      expect(fakeAgents.spawned).toHaveLength(1);
      expect(fakeAgents.deleted).toEqual([fakeAgents.spawned[0]!.id]);
    });
  });

  describe("comment detection", () => {
    it("triggers on full-line # and // comments that contain AI!", async () => {
      const trigger = spyOn(service, "triggerCodeModification").mockResolvedValue(undefined);

      files.set(filePath, "# AI! fix the loop\nconst x = 1;\n");
      await service.processFileForAIComments({ filePath, fileSystemProviderName: "local" });
      expect(trigger).toHaveBeenCalledTimes(1);

      trigger.mockClear();
      files.set(filePath, "// AI! refactor this\nfunction f() {}\n");
      await service.processFileForAIComments({ filePath, fileSystemProviderName: "local" });
      expect(trigger).toHaveBeenCalledTimes(1);
    });

    it("does not trigger on inline comments that begin with code", async () => {
      const trigger = spyOn(service, "triggerCodeModification").mockResolvedValue(undefined);

      files.set(filePath, "const result = processData(data); // AI! add error handling\n");
      await service.processFileForAIComments({ filePath, fileSystemProviderName: "local" });
      expect(trigger).not.toHaveBeenCalled();
    });

    it("does not trigger on # AI / // AI lines that lack AI!", async () => {
      const trigger = spyOn(service, "triggerCodeModification").mockResolvedValue(undefined);

      files.set(filePath, "# AI todo: fix this later\n// AI note only\n");
      await service.processFileForAIComments({ filePath, fileSystemProviderName: "local" });
      expect(trigger).not.toHaveBeenCalled();
    });

    it("does not trigger on C-style block comments", async () => {
      const trigger = spyOn(service, "triggerCodeModification").mockResolvedValue(undefined);

      files.set(filePath, "/* AI! do something */\n");
      await service.processFileForAIComments({ filePath, fileSystemProviderName: "local" });
      expect(trigger).not.toHaveBeenCalled();
    });
  });

  describe("unlink events", () => {
    it("cancels a pending debounce without processing the deleted file", async () => {
      const processed: string[] = [];
      spyOn(service, "processFileForAIComments").mockImplementation(async task => {
        processed.push(task.filePath);
      });

      const watcher = mockFs.getLastWatcher()!;
      watcher.emit("change", filePath);
      watcher.emit("unlink", filePath);
      await wait(60);

      expect(processed).toEqual([]);
    });
  });
});
