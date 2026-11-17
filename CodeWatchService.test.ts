import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { EventEmitter } from "node:events";
import { AgentCommandService, AgentManager } from "@tokenring-ai/agent";
import { AgentConfigSchema } from "@tokenring-ai/agent/schema";
import type TokenRingApp from "@tokenring-ai/app";
import createTestingApp from "@tokenring-ai/app/test/createTestingApp.test";
import FileSystemService from "@tokenring-ai/filesystem/FileSystemService";
import type { FileSystemWatcher } from "@tokenring-ai/filesystem/FileSystemTypes";
import { FileSystemConfigSchema } from "@tokenring-ai/filesystem/schema";
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
    provider: provider,
    getLastWatcher: () => watchers.at(-1) ?? null,
    getWatchers: () => watchers,
    getLastWatchOptions: () => lastWatchOptions,
  };
}

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function installFakeAgentManager(app: TokenRingApp, knownAgentTypes: string[] = ["code-mod"]) {
  const agentManager = new AgentManager(app);
  app.addService(AgentManager, agentManager);

  const spawned: { id: string; requireService: typeof app.requireService; spawnedWith: { agentType: string; answerTimeoutSeconds?: number | null } }[] = [];
  const deleted: string[] = [];
  let nextId = 0;

  (agentManager as unknown as { spawnAgent: (args: { agentType: string; answerTimeoutSeconds?: number | null }) => (typeof spawned)[number] }).spawnAgent =
    args => {
      const agent = {
        id: `agent-${++nextId}`,
        requireService: app.requireService.bind(app),
        spawnedWith: args,
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
  watcher: FileSystemWatcher | null;
  stabilityTimers: Map<string, NodeJS.Timeout>;
};

describe("CodeWatchService", () => {
  const filePath = "src/example.ts";
  const files = new Map<string, string>();

  let app: ReturnType<typeof createTestingApp>;
  let service: CodeWatchService;
  let fileSystemService: FileSystemService;
  let mockFs: ReturnType<typeof createMockProvider>;
  let fakeAgents: ReturnType<typeof installFakeAgentManager>;

  beforeEach(async () => {
    files.clear();
    files.set(filePath, "// hello\n");

    app = createTestingApp();
    mockFs = createMockProvider(files);
    fileSystemService = new FileSystemService(
      app,
      FileSystemConfigSchema.parse({
        allowedPaths: [{ path: "/repo", permission: "write" }],
      }),
      mockFs.provider as never,
    );
    app.addService(FileSystemService, fileSystemService);

    fakeAgents = installFakeAgentManager(app, ["code-mod"]);

    spyOn(fileSystemService, "addFileToChat").mockResolvedValue(undefined);

    service = new CodeWatchService(app);
    app.addService(CodeWatchService, service);
    await service.reconfigure(
      CodeWatchConfigSchema.parse({
        pollInterval: 10,
        stabilityThreshold: 40,
        agentType: "code-mod",
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
      expect(internals.watcher).not.toBeNull();
      expect(internals.stabilityTimers.size).toBe(1);

      service.stop();

      expect(watcher.closed).toBe(true);
      expect(internals.watcher).toBeNull();
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
    it("deletes the spawned agent when the modification throws", async () => {
      files.set(filePath, "// AI! add error handling\n");
      spyOn(service, "runCodeModification").mockRejectedValue(new Error("work failed"));

      await expect(service.processFileForAIComments({ filePath })).rejects.toThrow("work failed");

      expect(fakeAgents.spawned).toHaveLength(1);
      expect(fakeAgents.deleted).toEqual([fakeAgents.spawned[0]!.id]);
    });

    it("starts agents nobody watches, so their questions take their defaults at once", async () => {
      files.set(filePath, "// AI! add error handling\n");
      spyOn(service, "runCodeModification").mockResolvedValue({ status: "success", message: "" });

      await service.processFileForAIComments({ filePath });

      expect(fakeAgents.spawned[0]?.spawnedWith).toEqual({ agentType: "code-mod", answerTimeoutSeconds: 0 });
    });
  });

  describe("one agent per change", () => {
    it("starts one agent for a file with several markers, and lists them all", async () => {
      const trigger = spyOn(service, "triggerCodeModification").mockResolvedValue(undefined);
      files.set(filePath, "// AI! add error handling\nconst a = 1;\n# AI! and a test\n");
      await service.processFileForAIComments({ filePath });
      expect(trigger).toHaveBeenCalledTimes(1);
      expect(trigger.mock.calls[0]![1]).toEqual([
        { line: 1, text: "// AI! add error handling" },
        { line: 3, text: "# AI! and a test" },
      ]);
    });

    it("does not hand the same markers to another agent, but does once they change or come back", async () => {
      const trigger = spyOn(service, "triggerCodeModification").mockResolvedValue(undefined);
      files.set(filePath, "// AI! add error handling\n");
      await service.processFileForAIComments({ filePath });
      // The agent left the marker in: no second agent, so no loop.
      await service.processFileForAIComments({ filePath });
      expect(trigger).toHaveBeenCalledTimes(1);

      files.set(filePath, "// AI! add error handling, and log it\n");
      await service.processFileForAIComments({ filePath });
      expect(trigger).toHaveBeenCalledTimes(2);

      files.set(filePath, "const done = true;\n");
      await service.processFileForAIComments({ filePath });
      files.set(filePath, "// AI! add error handling, and log it\n");
      await service.processFileForAIComments({ filePath });
      expect(trigger).toHaveBeenCalledTimes(3);
    });

    it("ignores changes to a file while its agent is working on it", async () => {
      let finish = () => {};
      const trigger = spyOn(service, "triggerCodeModification");
      spyOn(service, "runCodeModification").mockImplementation(() => new Promise(resolve => (finish = () => resolve({ status: "success", message: "" }))));
      files.set(filePath, "// AI! add error handling\n");
      const first = service.processFileForAIComments({ filePath });
      await wait(0);
      files.set(filePath, "// AI! something else\n");
      await service.processFileForAIComments({ filePath });
      finish();
      await first;
      expect(trigger).toHaveBeenCalledTimes(1);
    });
  });

  describe("configuration", () => {
    it("stops watching when the codewatch config is removed", async () => {
      const watcher = mockFs.getLastWatcher()!;
      await service.reconfigure(undefined);
      expect(watcher.closed).toBe(true);
      expect((service as unknown as ServiceInternals).watcher).toBeNull();
    });

    it("leaves exactly one watcher open when config changes overlap", async () => {
      const config = CodeWatchConfigSchema.parse({ pollInterval: 10, stabilityThreshold: 40, agentType: "code-mod" });
      // One low-level watcher per watched root.
      const perWatch = mockFs.getWatchers().filter(watcher => !watcher.closed).length;
      await Promise.all([service.reconfigure(config), service.reconfigure(config), service.reconfigure(config)]);
      expect(mockFs.getWatchers().filter(watcher => !watcher.closed)).toHaveLength(perWatch);
    });

    it("does not leave a watcher open when stopped while one is opening", async () => {
      const config = CodeWatchConfigSchema.parse({ pollInterval: 10, stabilityThreshold: 40, agentType: "code-mod" });
      const pending = service.reconfigure(config);
      service.stop();
      await pending;
      expect(mockFs.getWatchers().filter(watcher => !watcher.closed)).toHaveLength(0);
    });
  });

  describe("comment detection", () => {
    it("triggers on full-line # and // comments that contain AI!", async () => {
      const trigger = spyOn(service, "triggerCodeModification").mockResolvedValue(undefined);

      files.set(filePath, "# AI! fix the loop\nconst x = 1;\n");
      await service.processFileForAIComments({ filePath });
      expect(trigger).toHaveBeenCalledTimes(1);

      trigger.mockClear();
      files.set(filePath, "// AI! refactor this\nfunction f() {}\n");
      await service.processFileForAIComments({ filePath });
      expect(trigger).toHaveBeenCalledTimes(1);
    });

    it("does not trigger on inline comments that begin with code", async () => {
      const trigger = spyOn(service, "triggerCodeModification").mockResolvedValue(undefined);

      files.set(filePath, "const result = processData(data); // AI! add error handling\n");
      await service.processFileForAIComments({ filePath });
      expect(trigger).not.toHaveBeenCalled();
    });

    it("does not trigger on # AI / // AI lines that lack AI!", async () => {
      const trigger = spyOn(service, "triggerCodeModification").mockResolvedValue(undefined);

      files.set(filePath, "# AI todo: fix this later\n// AI note only\n");
      await service.processFileForAIComments({ filePath });
      expect(trigger).not.toHaveBeenCalled();
    });

    it("does not trigger on C-style block comments", async () => {
      const trigger = spyOn(service, "triggerCodeModification").mockResolvedValue(undefined);

      files.set(filePath, "/* AI! do something */\n");
      await service.processFileForAIComments({ filePath });
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

describe("CodeWatchService with a real agent", () => {
  it("sends the instructions to the agent as a chat message, waits for its reply, then deletes it", async () => {
    const filePath = "/repo/src/example.ts";
    const files = new Map([[filePath, "const x = 1;\n// AI! add error handling\n"]]);
    const app = createTestingApp();
    const fileSystemService = new FileSystemService(
      app,
      FileSystemConfigSchema.parse({ allowedPaths: [{ path: "/repo", permission: "write" }] }),
      createMockProvider(files).provider as never,
    );
    app.addService(FileSystemService, fileSystemService);
    spyOn(fileSystemService, "addFileToChat").mockResolvedValue(undefined);

    // The real command service and agent loop; only the chat command is a stand-in, so an unknown
    // command (like the /work this used to send) would fail the test.
    const commands = new AgentCommandService();
    app.addService(AgentCommandService, commands);
    const received: string[] = [];
    commands.addAgentCommands([
      {
        name: "chat send",
        description: "chat",
        help: "chat",
        inputSchema: { args: {}, remainder: { name: "message", description: "", required: true } },
        execute: ({ remainder }: { remainder?: string }) => {
          received.push(remainder ?? "");
          return "done";
        },
      },
    ] as never);
    const agentManager = new AgentManager(app);
    app.addService(AgentManager, agentManager);
    agentManager.addAgentConfigs(
      AgentConfigSchema.parse({
        agentType: "code-mod",
        displayName: "Code mod",
        description: "test",
        category: "test",
        createMessage: "",
        debug: false,
        initialCommands: [],
        callable: true,
        idleTimeout: 0,
        maxRunTime: 0,
        minimumRunning: 0,
        subAgent: { allowedSubAgents: [] },
      }),
    );

    const service = new CodeWatchService(app);
    app.addService(CodeWatchService, service);
    await service.reconfigure(CodeWatchConfigSchema.parse({ agentType: "code-mod" }));

    const deleted = spyOn(agentManager, "deleteAgent");
    await service.processFileForAIComments({ filePath });

    expect(received).toHaveLength(1);
    expect(received[0]).toContain(`- line 2: // AI! add error handling`);
    expect(deleted).toHaveBeenCalledTimes(1);
    expect(agentManager.getAgents()).toEqual([]);
  });
});

describe("CodeWatchConfigSchema", () => {
  it("rejects the removed per-provider `filesystems` map", () => {
    expect(CodeWatchConfigSchema.safeParse({ agentType: "code-mod", filesystems: { local: { agentType: "code-mod" } } }).success).toBe(false);
    expect(CodeWatchConfigSchema.parse({ agentType: "code-mod" })).toMatchObject({ pollInterval: 1000, stabilityThreshold: 2000, concurrency: 1 });
  });
});
