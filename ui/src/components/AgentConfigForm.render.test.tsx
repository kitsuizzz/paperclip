// @vitest-environment jsdom
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Agent, Environment } from "@paperclipai/shared";
import { getEnvironmentCapabilities } from "@paperclipai/shared";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ToastProvider } from "../context/ToastContext";
import { AgentConfigForm } from "./AgentConfigForm";
import { isBlockedFromReplay } from "@/lib/analytics/replay-recording.test-utils";
import { ApiError } from "../api/client";
import { CodexLocalConfigFields } from "../adapters/codex-local/config-fields";
import type { AdapterConfigFieldsProps } from "../adapters/types";

const mockAgentsApi = vi.hoisted(() => ({
  get: vi.fn(),
  adapterModels: vi.fn(),
  detectModel: vi.fn(),
  list: vi.fn(),
  testEnvironment: vi.fn(),
  qualifyRunner: vi.fn(),
  startAdapterAuthLogin: vi.fn(),
  getAdapterAuthLoginStatus: vi.fn(),
  getActiveAdapterAuthLoginSession: vi.fn(),
  cancelAdapterAuthLogin: vi.fn(),
  startClaudeSetupTokenLogin: vi.fn(),
  getClaudeSetupTokenLoginStatus: vi.fn(),
  getActiveClaudeSetupTokenLoginSession: vi.fn(),
  getClaudeSetupTokenLoginPrompt: vi.fn(),
  submitClaudeSetupTokenBrowserCode: vi.fn(),
  completeClaudeSetupTokenLogin: vi.fn(),
  cancelClaudeSetupTokenLogin: vi.fn(),
  getClaudeOAuthTokenStatus: vi.fn(),
}));

const mockEnvironmentsApi = vi.hoisted(() => ({
  list: vi.fn(),
  capabilities: vi.fn(),
  probe: vi.fn(),
}));

const mockInstanceSettingsApi = vi.hoisted(() => ({
  get: vi.fn(),
  getExperimental: vi.fn(),
  getGeneral: vi.fn(),
}));

const mockSecretsApi = vi.hoisted(() => ({
  list: vi.fn(),
  listProposals: vi.fn(),
  listUserSecretDefinitions: vi.fn(async () => [] as unknown[]),
}));

const mockAdaptersApi = vi.hoisted(() => ({
  list: vi.fn(async () => [{ type: "codex_local", supportedRunners: ["legacy", "paperclip"], defaultRunner: "legacy" }]),
}));

vi.mock("../api/agents", () => ({ agentsApi: mockAgentsApi }));
vi.mock("../api/grokBot", () => ({
  grokBotApi: { connection: async () => ({ enabled: true, canConfigureConnection: true, binding: null }) },
}));
vi.mock("../api/adapters", () => ({ adaptersApi: mockAdaptersApi }));
vi.mock("../api/environments", () => ({ environmentsApi: mockEnvironmentsApi }));
vi.mock("../api/instanceSettings", () => ({ instanceSettingsApi: mockInstanceSettingsApi }));
vi.mock("../api/secrets", () => ({ secretsApi: mockSecretsApi }));
vi.mock("../lib/clipboard", () => ({ copyTextToClipboard: vi.fn() }));
vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({
    companies: [{ id: "company-1", name: "Paperclip", issuePrefix: "CO" }],
    selectedCompanyId: "company-1",
    selectedCompany: { id: "company-1", name: "Paperclip", issuePrefix: "CO" },
    selectionSource: "bootstrap",
    loading: false,
    error: null,
    setSelectedCompanyId: vi.fn(),
    reloadCompanies: vi.fn(),
    createCompany: vi.fn(),
  }),
}));
vi.mock("../adapters", () => ({
  getUIAdapter: (type: string) => ({
    type,
    label: "Codex",
    ConfigFields: (props: AdapterConfigFieldsProps) =>
      type === "paperclip_runner" ? <CodexLocalConfigFields {...props} /> : <div data-testid="adapter-config-fields" />,
    buildAdapterConfig: (values: { model?: string }) => ({ model: values.model || undefined }),
    parseStdoutLine: () => [],
  }),
}));
vi.mock("../adapters/use-adapter-capabilities", () => ({
  useAdapterCapabilities: () => () => ({
    supportsInstructionsBundle: true,
    supportsSkills: true,
    supportsLocalAgentJwt: true,
    requiresMaterializedRuntimeSkills: false,
    supportsAcp: true,
    login: { panelMode: "displayed_code", timeoutPolicy: "caller_bounded" },
  }),
}));
vi.mock("../adapters/use-disabled-adapters", () => ({ useDisabledAdaptersSync: () => [] }));
vi.mock("./MarkdownEditor", () => ({
  MarkdownEditor: ({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder?: string }) => (
    <textarea aria-label={placeholder ?? "Markdown"} value={value} onChange={(event) => onChange(event.currentTarget.value)} />
  ),
}));

async function act(callback: () => void | Promise<void>) {
  let result: void | Promise<void> = undefined;
  flushSync(() => {
    result = callback();
  });
  await result;
}

async function flushReact() {
  await act(async () => {
    for (let i = 0; i < 4; i += 1) {
      await Promise.resolve();
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    }
  });
}

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "agent-1",
    companyId: "company-1",
    name: "Cody",
    role: "Engineer",
    title: null,
    icon: null,
    status: "idle",
    reportsTo: null,
    capabilities: null,
    adapterType: "codex_local",
    adapterConfig: {},
    runtimeConfig: {},
    defaultEnvironmentId: null,
    contextMode: "thin",
    budgetMonthlyCents: 0,
    spentMonthlyCents: 0,
    permissions: {},
    lastHeartbeatAt: null,
    metadata: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  } as Agent;
}

function makeEnvironment(overrides: Partial<Environment>): Environment {
  return {
    id: "env-1",
    name: "Local",
    description: null,
    driver: "local",
    status: "active",
    config: {},
    envVars: {},
    metadata: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  };
}

const AUTH_MISSING_RESULT = {
  adapterType: "codex_local",
  status: "fail",
  checks: [{ code: "adapter_auth_missing", level: "error", message: "The sandbox has no ready authentication." }],
  testedAt: new Date(0).toISOString(),
};

const SANDBOX_CAPABILITIES = getEnvironmentCapabilities(["claude_local", "codex_local"], {
  sandboxProviders: { daytona: { supportsLoginPty: true, displayName: "Daytona" } },
});

function noActiveSession() {
  return Promise.reject(
    new ApiError("Adapter login session not found", 404, { error: "Adapter login session not found" }),
  );
}

async function clickByText(container: HTMLElement, label: string) {
  const button = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.trim() === label);
  await act(async () => {
    button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await flushReact();
}

describe("AgentConfigForm session replay masking", () => {
  let roots: Root[] = [];

  it.each(["paperclip", "legacy"] as const)("uses the resolved %s Claude form to preserve the correct turn limit", async defaultRunner => {
    mockAdaptersApi.list.mockResolvedValue([{ type: "claude_local", supportedRunners: defaultRunner === "paperclip" ? ["paperclip", "legacy"] : ["legacy"], defaultRunner }]);
    try {
      const values = { ...defaultCreateValues, adapterType: "claude_local", runner: "auto" as const };
      const result = await renderCreateForm([], values);
      roots.push(result.root);
      expect(result.container.querySelector('[aria-label="Runner"]')).toBeNull();
      expect(result.container.querySelector('[data-config-section="configuration"]')?.textContent?.includes("Advanced")).toBe(defaultRunner === "legacy");
      const resolved = result.onChange.mock.calls.reduce((current, [patch]) => ({ ...current, ...patch }), values);
      expect(resolved.resolvedRunner).toBe(defaultRunner);
      const config = buildClaudeLocalConfig(resolved);
      if (defaultRunner === "legacy") expect(config.maxTurnsPerRun).toBe(1000);
      else expect(config).not.toHaveProperty("maxTurnsPerRun");
      expect(config).not.toHaveProperty("resolvedRunner");
    } finally { mockAdaptersApi.list.mockResolvedValue([{ type: "codex_local", supportedRunners: ["legacy", "paperclip"], defaultRunner: "legacy" }]); }
  });


  it("carries a selected native Claude permission through the ordinary creation builder", async () => {
    mockAdaptersApi.list.mockResolvedValue([{ type: "claude_local", supportedRunners: ["paperclip", "legacy"], defaultRunner: "paperclip" }]);
    try {
      const values = { ...defaultCreateValues, adapterType: "claude_local", runner: "auto" as const };
      const result = await renderCreateForm([], values);
      roots.push(result.root);
      await clickElement(result.container.querySelector('[aria-label="Permission mode"]'));
      const deny = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(option => option.textContent === "Deny all");
      expect(deny).toBeTruthy();
      await clickElement(deny);
      const resolved = result.onChange.mock.calls.reduce((current, [patch]) => ({ ...current, ...patch }), values);
      expect(buildClaudeLocalConfig(resolved)).toMatchObject({ acpxPermissionMode: "deny-all" });
    } finally { mockAdaptersApi.list.mockResolvedValue([{ type: "codex_local", supportedRunners: ["legacy", "paperclip"], defaultRunner: "legacy" }]); }
  });

  it("keeps an explicit Codex draft policy until a harness reset clears it", async () => {
    mockEnvironmentsApi.list.mockResolvedValue([]);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    let current = { ...defaultCreateValues, adapterType: "codex_local", runner: "auto" as const,
      dangerouslyBypassSandbox: false, codexLegacySandboxBypass: false };
    function Fixture() {
      const [values, setValues] = useState<typeof defaultCreateValues>(current);
      current = values as typeof current;
      return <AgentConfigForm mode="create" values={values}
        onChange={patch => setValues(prev => ({ ...prev, ...patch }))} showAdapterTypeField hidePromptTemplate />;
    }
    try {
      await act(async () => root.render(<QueryClientProvider client={queryClient}><ToastProvider><TooltipProvider>
        <Fixture />
      </TooltipProvider></ToastProvider></QueryClientProvider>));
      await flushReact();
      expect(current.codexLegacySandboxBypass).toBe(false);
      for (const harness of ["claude_local", "codex_local"]) {
        await clickElement(container.querySelector('[aria-label="Harness"]'));
        await clickElement(document.querySelector(`[role="option"][data-value="${harness}"]`));
        await flushReact();
        expect(current.adapterType).toBe(harness);
        expect(current).toHaveProperty("codexLegacySandboxBypass", undefined);
      }
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it("keeps a saved claude_local engine and runner when switching harness away and back", async () => {
    const result = await renderForm([], {
      adapterType: "claude_local",
      adapterConfig: { engine: "cli", model: "claude-opus-5-5" },
    }, { showAdapterTypeField: true });
    roots.push(result.root);

    await clickElement(result.container.querySelector('[aria-label="Harness"]'));
    await clickElement(document.querySelector('[role="option"][data-value="opencode_local"]'));
    await flushReact();
    await clickElement(result.container.querySelector('[aria-label="Harness"]'));
    await clickElement(document.querySelector('[role="option"][data-value="claude_local"]'));
    await flushReact();
    await clickByText(result.container, "Save");

    expect(result.onSave).toHaveBeenCalledTimes(1);
    const patch = result.onSave.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(patch).toEqual({ runner: "legacy" });
    expect(patch).not.toHaveProperty("adapterType");
    expect(patch).not.toHaveProperty("adapterConfig");
  });

  it.each(["codex_local", "paperclip_runner"])("keeps a saved %s runner during unrelated edits", async adapterType => {
    const adapterConfig = { model: "gpt-5.6-sol", ...(adapterType === "paperclip_runner" ? { provider: "codex", reasoningEffort: "high" } : { modelReasoningEffort: "high" }) };
    const result = await renderForm([], { adapterType, adapterConfig }, { showAdapterTypeField: true });
    roots.push(result.root);
    expect(result.container.querySelector('[aria-label="Harness"]')?.textContent).toContain("Codex");
    expect(result.container.querySelector('[aria-label="Runner"]')).toBeNull();
    if (adapterType === "codex_local") {
      await clickByText(result.container, "Advanced");
      const labels = [...result.container.querySelectorAll("label")].map(label => label.textContent?.trim());
      expect(labels).toContain("Command");
      expect(labels).toContain("Extra args (comma-separated)");
    }
    await act(async () => setInputValue(result.container.querySelector<HTMLInputElement>('[placeholder="Agent name"]')!, "Renamed Cody"));
    await flushReact();
    await clickByText(result.container, "Save");
    expect(result.onSave).toHaveBeenCalledWith({ name: "Renamed Cody" });
  });

  it.each([
    { harness: "claude_local", label: "Claude", profile: { provider: "acpx", acpxAgent: "claude" } },
    { harness: "pi_local", label: "Pi", profile: { provider: "acpx", acpxAgent: "pi" } },
    { harness: "codex_local", label: "Codex", profile: { provider: "codex" } },
    { harness: "opencode_local", label: "OpenCode", profile: { provider: "opencode" } },
  ])("uses only Harness to choose $label for new and saved native agents", async ({ harness, label, profile }) => {
    mockAdaptersApi.list.mockResolvedValue([{ type: harness, supportedRunners: ["paperclip", "legacy"], defaultRunner: "paperclip" }]);
    const created = await renderCreateForm([], { adapterType: harness, runner: "auto" });
    roots.push(created.root);
    expect(created.container.querySelector('[aria-label="ACP agent"]')).toBeNull();
    if (harness === "pi_local") expect(created.container.querySelector('[aria-label="Pi thinking level"]')).not.toBeNull();

    const edited = await renderForm([], { adapterType: "paperclip_runner", adapterConfig: profile }, { showAdapterTypeField: true });
    roots.push(edited.root);
    expect(edited.container.querySelector('[aria-label="Harness"]')?.textContent).toContain(label);
    expect(edited.container.querySelector('[aria-label="ACP agent"]')).toBeNull();
    if (harness === "pi_local") expect(edited.container.querySelector('[aria-label="Pi thinking level"]')).not.toBeNull();
    await act(async () => setInputValue(edited.container.querySelector<HTMLInputElement>('[placeholder="Agent name"]')!, "Renamed agent"));
    await flushReact();
    await clickByText(edited.container, "Save");
    expect(edited.onSave).toHaveBeenCalledWith({ name: "Renamed agent" });
  });

  it.each([
    { adapterType: "process", label: "Process", adapterConfig: { command: "node", args: ["worker.js"] } },
    { adapterType: "http", label: "HTTP", adapterConfig: { url: "https://example.com/agent" } },
  ])("omits coming-soon options but preserves a saved $label agent", async ({ adapterType, label, adapterConfig }) => {
    const result = await renderForm([], { adapterType, adapterConfig }, { showAdapterTypeField: true });
    roots.push(result.root);
    expect(result.container.querySelector('[aria-label="Harness"]')?.textContent).toContain(label);
    await clickElement(result.container.querySelector('[aria-label="Harness"]'));
    const options = document.querySelector('[role="listbox"][aria-label="Harness"]');
    expect(options).not.toBeNull();
    const values = Array.from(options!.querySelectorAll('[role="option"]'), option => option.getAttribute("data-value"));
    expect(values).toEqual(expect.arrayContaining(["claude_local", "codex_local", "opencode_local", "pi_local"]));
    expect(values).not.toContain("process");
    expect(values).not.toContain("http");
    expect(options!.textContent).not.toContain("Coming soon");
    await clickElement(result.container.querySelector('[aria-label="Harness"]'));
    await act(async () => setInputValue(result.container.querySelector<HTMLInputElement>('[placeholder="Agent name"]')!, "Renamed saved agent"));
    await flushReact();
    await clickByText(result.container, "Save");
    expect(result.onSave).toHaveBeenCalledWith({ name: "Renamed saved agent" });
  });

  it.each(["codex_local", "claude_local", "grok_local"])("upgrades a saved %s in one click with pending edits", async adapterType => {
    mockAdaptersApi.list.mockResolvedValueOnce([{ type: adapterType, supportedRunners: ["legacy", "paperclip"], defaultRunner: "paperclip" }]);
    const result = await renderForm([], { adapterType, adapterConfig: { model: "existing-model", effort: "high" } });
    roots.push(result.root);
    expect(result.container.textContent).toContain("Upgrade to Paperclip Runner");
    await act(async () => setInputValue(result.container.querySelector<HTMLInputElement>('[placeholder="Agent name"]')!, "Renamed agent"));
    await flushReact();
    await clickByText(result.container, "Upgrade runner");
    expect(result.onSave).toHaveBeenCalledWith({ name: "Renamed agent", runner: "paperclip" });
  });

  it.each(["paperclip_runner", "gemini_local"])("does not offer an upgrade for %s", async adapterType => {
    const result = await renderForm([], { adapterType });
    roots.push(result.root);
    expect(result.container.textContent).not.toContain("Upgrade runner");
  });

  it("includes an uncommitted environment variable draft in an upgrade", async () => {
    mockAdaptersApi.list.mockResolvedValueOnce([{ type: "codex_local", supportedRunners: ["legacy", "paperclip"], defaultRunner: "paperclip" }]);
    const result = await renderForm([], { adapterConfig: { model: "gpt-5.4" } }, { environmentVariablesPlacement: "configuration" });
    roots.push(result.root);
    await clickByText(result.container, "Add variable");
    await act(async () => {
      setInputValue(result.container.querySelector<HTMLInputElement>('input[aria-label="Variable name"]')!, "MIGRATION_MARKER");
      setInputValue(result.container.querySelector<HTMLInputElement>('input[aria-label="Variable value"]')!, "kept");
    });
    await flushReact();
    await clickByText(result.container, "Upgrade runner");
    expect(result.onSave).toHaveBeenCalledWith(expect.objectContaining({ runner: "paperclip", replaceAdapterConfig: true,
      adapterConfig: { model: "gpt-5.4", env: { MIGRATION_MARKER: { type: "plain", value: "kept" } } },
    }));
  });

  it("keeps failed upgrades editable and allows retry", async () => {
    mockAdaptersApi.list.mockResolvedValueOnce([{ type: "codex_local", supportedRunners: ["legacy", "paperclip"], defaultRunner: "paperclip" }]);
    const result = await renderForm([]);
    roots.push(result.root);
    result.onSave.mockRejectedValueOnce(new Error("Paperclip Runner cannot honor these settings: extraArgs."));
    await clickByText(result.container, "Upgrade runner");
    expect(result.container.querySelector('[role="alert"]')?.textContent).toContain("extraArgs");
    expect(result.onSave).toHaveBeenLastCalledWith({ runner: "paperclip" });
    await clickByText(result.container, "Upgrade runner");
    expect(result.onSave).toHaveBeenCalledTimes(2);
    expect(result.container.querySelector('[role="alert"]')).toBeNull();
  });

  it("does not show an earlier agent's upgrade result after navigation", async () => {
    mockAdaptersApi.list.mockResolvedValueOnce([{ type: "codex_local", supportedRunners: ["legacy", "paperclip"], defaultRunner: "paperclip" }]);
    let finishUpgrade!: () => void;
    let changeAgent!: () => void;
    const save = vi.fn(() => new Promise<void>(resolve => { finishUpgrade = resolve; }));
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    function Fixture() {
      const [agent, setAgent] = useState(() => makeAgent());
      changeAgent = () => setAgent(makeAgent({ id: "agent-2", name: "Another agent" }));
      return <AgentConfigForm mode="edit" agent={agent} onSave={save} hidePromptTemplate />;
    }
    await act(async () => renderFormView(root, createFormQueryClient(), <Fixture />));
    await flushReact();
    await clickByText(container, "Upgrade runner");
    await act(async () => changeAgent());
    await act(async () => finishUpgrade());
    await flushReact();
    expect(container.textContent).not.toContain("Upgraded to Paperclip Runner.");
    expect(findButton(container, "Upgrade runner")).toBeDefined();
  });

  it("switches a saved legacy Claude agent to Paperclip Runner on a Runner-only environment", async () => {
    mockAdaptersApi.list.mockResolvedValue([{ type: "claude_local", supportedRunners: ["paperclip"], defaultRunner: "paperclip" }]);
    try {
      const result = await renderForm([], { adapterType: "claude_local", adapterConfig: { model: "claude-opus-5-5" } });
      roots.push(result.root);
      expect(result.container.querySelector('[aria-label="Runner"]')).toBeNull();
      expect(result.container.querySelector('[data-config-section="configuration"]')?.textContent).not.toContain("Advanced");
      await clickByText(result.container, "Save");
      expect(result.onSave).toHaveBeenCalledWith(expect.objectContaining({ runner: "paperclip" }));
    } finally { mockAdaptersApi.list.mockResolvedValue([{ type: "codex_local", supportedRunners: ["legacy", "paperclip"], defaultRunner: "legacy" }]); }
  });

  it("switches a new agent's Legacy choice to Paperclip Runner on a Runner-only environment", async () => {
    mockAdaptersApi.list.mockResolvedValue([{ type: "claude_local", supportedRunners: ["paperclip"], defaultRunner: "paperclip" }]);
    try {
      const result = await renderCreateForm([], { ...defaultCreateValues, adapterType: "claude_local", runner: "legacy" });
      roots.push(result.root);
      expect(result.onChange).toHaveBeenCalledWith({ runner: "paperclip" });
    } finally { mockAdaptersApi.list.mockResolvedValue([{ type: "codex_local", supportedRunners: ["legacy", "paperclip"], defaultRunner: "legacy" }]); }
  });

  it.each(["explicit", "instance", "managed", "env-draft"])("qualifies a saved Daytona Claude agent and upgrades with its legacy turn limit (%s environment)", async mode => {
    const environment = makeEnvironment({ id: "daytona-computer", name: "Paperclip Sandbox", driver: "sandbox", status: "active",
      config: { provider: "daytona", snapshot: "managed-snapshot" }, metadata: { managedByPaperclip: true } });
    const inventory = (qualified: boolean) => [
      { type: "claude_local", supportedRunners: qualified ? ["paperclip", "legacy"] : ["legacy"], defaultRunner: qualified ? "paperclip" : "legacy" },
      { type: "paperclip_runner", supportedRunners: ["legacy"], defaultRunner: "legacy" },
    ];
    mockAdaptersApi.list.mockResolvedValue(inventory(false));
    mockAgentsApi.qualifyRunner.mockImplementation(async () => {
      mockAdaptersApi.list.mockResolvedValue(inventory(true));
      return { ok: true, driver: "sandbox", details: { platformQualificationRecorded: true, leaseId: "probe-lease" } };
    });
    if (mode === "instance") mockInstanceSettingsApi.get.mockResolvedValue({ defaultEnvironmentId: environment.id });
    if (mode === "managed") mockInstanceSettingsApi.getExperimental.mockResolvedValue({ enableManagedSandboxOnly: true, enableEnvironments: false });
    const result = await renderForm([environment], { adapterType: "claude_local", defaultEnvironmentId: mode === "explicit" || mode === "env-draft" ? environment.id : null,
      adapterConfig: { model: "claude-opus-5-5", effort: "high", maxTurnsPerRun: 1000, dangerouslySkipPermissions: true } },
      { environmentVariablesPlacement: "configuration" });
    roots.push(result.root);
    expect(result.container.textContent).toContain("Upgrade to Paperclip Runner");
    expect(result.container.textContent).toContain("Max turns per run");
    expect(mockAgentsApi.qualifyRunner).not.toHaveBeenCalled();
    if (mode === "env-draft") {
      await clickByText(result.container, "Add variable");
      await act(async () => {
        setInputValue(result.container.querySelector<HTMLInputElement>('input[aria-label="Variable name"]')!, "MIGRATION_MARKER");
        setInputValue(result.container.querySelector<HTMLInputElement>('input[aria-label="Variable value"]')!, "kept");
      });
      await flushReact();
    }
    await clickByText(result.container, "Upgrade runner");
    expect(mockAgentsApi.qualifyRunner).toHaveBeenCalledWith("agent-1", environment.id, "company-1");
    expect(result.onSave).toHaveBeenCalledWith(mode === "env-draft" ? expect.objectContaining({
      runner: "paperclip", replaceAdapterConfig: true,
      adapterConfig: expect.objectContaining({ env: { MIGRATION_MARKER: { type: "plain", value: "kept" } } }),
    }) : { runner: "paperclip" });
  });

  it.each([false, true])("requires saving a changed computer before upgrading (qualified: %s)", async qualified => {
    const environments = ["saved-computer", "draft-computer"].map(id => makeEnvironment({ id, driver: "sandbox", status: "active",
      config: { provider: "daytona", snapshot: "managed-snapshot" } }));
    mockAdaptersApi.list.mockResolvedValue([
      { type: "claude_local", supportedRunners: qualified ? ["paperclip", "legacy"] : ["legacy"], defaultRunner: qualified ? "paperclip" : "legacy" },
      { type: "paperclip_runner", supportedRunners: ["legacy"], defaultRunner: "legacy" },
    ]);
    const result = await renderForm(environments, { adapterType: "claude_local", defaultEnvironmentId: "saved-computer" });
    roots.push(result.root);
    expect(findButton(result.container, "Upgrade runner")?.disabled).toBe(false);
    await selectEnvironment(result.container, "draft-computer");
    expect(findButton(result.container, "Upgrade runner")?.disabled).toBe(true);
    expect(result.container.textContent).toContain("Save your computer change before upgrading the runner.");
    await clickByText(result.container, "Upgrade runner");
    expect(mockAgentsApi.qualifyRunner).not.toHaveBeenCalled();
    expect(result.onSave).not.toHaveBeenCalled();
    await selectEnvironment(result.container, "saved-computer");
    expect(findButton(result.container, "Upgrade runner")?.disabled).toBe(false);
    expect(result.container.textContent).not.toContain("Save your computer change before upgrading the runner.");
  });

  it.each(["probe", "unsupported", "settings-changed"])("does not save after Daytona %s", async failure => {
    const environment = makeEnvironment({ id: "daytona-computer", name: "Paperclip Sandbox", driver: "sandbox", status: "active",
      config: { provider: "daytona", snapshot: "managed-snapshot" } });
    mockAdaptersApi.list.mockResolvedValue([{ type: "claude_local", supportedRunners: ["legacy"], defaultRunner: "legacy" }, { type: "paperclip_runner", supportedRunners: ["legacy"], defaultRunner: "legacy" }]);
    let finish!: () => void;
    mockAgentsApi.qualifyRunner.mockImplementation(() => new Promise(resolve => { finish = () => resolve({ ok: failure !== "probe",
      summary: "Could not verify this computer", details: { platformQualificationRecorded: failure !== "probe", leaseId: "lease" } }); }));
    const result = await renderForm([environment], { adapterType: "claude_local", defaultEnvironmentId: environment.id });
    roots.push(result.root);
    await clickByText(result.container, "Upgrade runner");
    if (failure === "settings-changed") {
      await act(async () => setInputValue(result.container.querySelector<HTMLInputElement>('input[placeholder="Agent name"]')!, "Edited during probe"));
    }
    await act(async () => finish());
    await flushReact();
    expect(result.onSave).not.toHaveBeenCalled();
    expect(result.container.querySelector('[role="alert"]')).not.toBeNull();
  });

  it.each([true, false])("respects forced Kubernetes instead of probing a saved Daytona default (target exists: %s)", async available => {
    const daytona = makeEnvironment({ id: "old-daytona", driver: "sandbox", config: { provider: "daytona", snapshot: "old-snapshot" } });
    const kubernetes = makeEnvironment({ id: "forced-kubernetes", driver: "sandbox", config: { provider: "kubernetes", image: `example.test/runner@sha256:${"a".repeat(64)}` } });
    mockInstanceSettingsApi.getGeneral.mockResolvedValue({ executionMode: "kubernetes" });
    const inventory = (qualified: boolean) => [
      { type: "claude_local", supportedRunners: qualified ? ["paperclip", "legacy"] : ["legacy"], defaultRunner: qualified ? "paperclip" : "legacy" },
      { type: "paperclip_runner", supportedRunners: ["legacy"], defaultRunner: "legacy" },
    ];
    mockAdaptersApi.list.mockResolvedValue(inventory(false));
    mockAgentsApi.qualifyRunner.mockImplementation(async () => {
      mockAdaptersApi.list.mockResolvedValue(inventory(true));
      return { ok: true, details: { platformQualificationRecorded: true, leaseId: "kubernetes-probe" } };
    });
    const result = await renderForm(available ? [daytona, kubernetes] : [daytona], {
      adapterType: "claude_local", defaultEnvironmentId: daytona.id,
    });
    roots.push(result.root);
    if (available) {
      await clickByText(result.container, "Upgrade runner");
      expect(mockAgentsApi.qualifyRunner).toHaveBeenCalledWith("agent-1", kubernetes.id, "company-1");
      expect(mockAdaptersApi.list).toHaveBeenLastCalledWith({ companyId: "company-1", environmentId: kubernetes.id });
      expect(result.onSave).toHaveBeenCalledWith({ runner: "paperclip" });
    } else {
      expect(findButton(result.container, "Upgrade runner")).toBeUndefined();
      expect(mockAgentsApi.qualifyRunner).not.toHaveBeenCalled();
    }
  });

  it("does not offer an upgrade when the target only supports Legacy", async () => {
    mockAdaptersApi.list.mockResolvedValueOnce([{ type: "codex_local", supportedRunners: ["legacy"], defaultRunner: "legacy" }]);
    const result = await renderForm([]);
    roots.push(result.root);
    expect(result.container.textContent).not.toContain("Upgrade runner");
  });

  it("explains ignored options already saved on a native Claude agent", async () => {
    const result = await renderForm([], { adapterType: "paperclip_runner", adapterConfig: {
      provider: "acpx", acpxAgent: "claude", model: "claude-opus-5-5", maxTurnsPerRun: 1000,
    } });
    roots.push(result.root);
    expect(result.container.querySelector('[role="status"]')?.textContent).toContain("maxTurnsPerRun");
    expect(result.container.textContent).toContain("is ignored. The agent can still run.");
  });

  it.each(["cursor_cloud", "paperclip_runner"])("does not offer unsupported thinking effort for saved Cursor Cloud on %s", async adapterType => {
    const result = await renderForm([], { adapterType, adapterConfig: {
      ...(adapterType === "paperclip_runner" ? { provider: "cursor_cloud", lifecycleMode: "per_turn" } : {}),
      model: "caller-model", repoUrl: "https://github.com/acme/repo",
    } });
    roots.push(result.root);
    expect(result.container.querySelector('[aria-label="Thinking effort"]')).toBeNull();
    if (adapterType === "paperclip_runner") {
      expect(result.container.querySelector('[aria-label="Model"]')).not.toBeNull();
      expect(result.container.textContent).toContain("Experimental");
    }
  });

  it.each(["codex", "claude", "grok"].flatMap(harness => ["modelReasoningEffort", "reasoningEffort", "effort"].map(key => ({ harness, key }))))("hydrates saved effort and clears explicit Auto for $harness ($key)", async ({ harness, key }) => {
    const profile = harness === "codex" ? { provider: "codex", model: "gpt-5.6-sol" } : { provider: "acpx", acpxAgent: harness, model: harness === "grok" ? "grok-4.7" : "claude-opus-5-5" };
    const result = await renderForm([], { adapterType: "paperclip_runner", adapterConfig: { ...profile, [key]: "high" } });
    roots.push(result.root);
    const effort = result.container.querySelector('[aria-label="Thinking effort"]');
    expect(effort?.textContent).toContain("High");
    await clickElement(effort);
    await clickElement(document.querySelector('[role="option"][data-value=""]'));
    await clickByText(result.container, "Save");
    const saved = result.onSave.mock.calls[0][0];
    expect(saved.replaceAdapterConfig).toBe(true);
    expect(saved.adapterConfig).toMatchObject(profile);
    for (const alias of ["modelReasoningEffort", "reasoningEffort", "effort"]) expect(saved.adapterConfig).not.toHaveProperty(alias);
  });

  it.each(["codex_local", "paperclip_runner"])("changes and clears the environment without changing a saved %s runner or account", async adapterType => {
    const adapterConfig = {
      model: "gpt-5.6-sol",
      ...(adapterType === "paperclip_runner" ? { provider: "codex", reasoningEffort: "high" } : { modelReasoningEffort: "high" }),
      env: { CODEX_HOME: { type: "secret_ref", secretId: "codex-account" } },
    };
    const result = await renderForm([
      ...daytonaEnvironments(),
      makeEnvironment({ id: "sandbox-2", name: "Daytona Two", driver: "sandbox", config: { provider: "daytona" } }),
    ], { adapterType, adapterConfig, defaultEnvironmentId: "sandbox-1" }, { showAdapterTypeField: true });
    roots.push(result.root);
    await selectEnvironment(result.container, "sandbox-2");
    expect(result.container.querySelector('[aria-label="Environment override"]')?.textContent).toContain("Daytona Two");
    expect(result.container.querySelector('[aria-label="Runner"]')).toBeNull();
    await clickByText(result.container, "Save");
    expect(result.onSave).toHaveBeenLastCalledWith({ defaultEnvironmentId: "sandbox-2" });

    await selectEnvironment(result.container, "");
    expect(result.container.querySelector('[aria-label="Environment override"]')?.textContent).toContain("Default: Local");
    expect(result.container.querySelector('[aria-label="Runner"]')).toBeNull();
    await clickByText(result.container, "Save");
    expect(result.onSave).toHaveBeenLastCalledWith({ defaultEnvironmentId: null });
  });

  it("clears a new agent's environment override to the empty draft value", async () => {
    const result = await renderCreateForm(daytonaEnvironments(), { defaultEnvironmentId: "sandbox-1", runner: "legacy" });
    roots.push(result.root);
    await selectEnvironment(result.container, "");
    expect(result.onChange).toHaveBeenLastCalledWith({ defaultEnvironmentId: "" });
  });

  it.each(["codex", "claude"])("hides empty Advanced settings for the saved native %s harness", async harness => {
    const profile = harness === "codex" ? { provider: "codex" } : { provider: "acpx", acpxAgent: "claude" };
    const result = await renderForm([], { adapterType: "paperclip_runner", adapterConfig: { ...profile, model: "saved-model" } });
    roots.push(result.root);
    const configuration = result.container.querySelector('[data-config-section="configuration"]')!;
    expect(configuration.textContent).not.toContain("Advanced");
    expect(result.container.querySelector('[aria-label="Runner"]')).toBeNull();
  });

  it.each([false, true])("keeps experimental native selection gated when enableNativeRunner is %s", async enabled => {
    mockInstanceSettingsApi.getExperimental.mockResolvedValue({ enableNativeRunner: enabled });
    const result = await renderForm([], { adapterType: "claude_local", adapterConfig: { model: "claude-sonnet-5" } }, { showAdapterTypeField: true });
    roots.push(result.root);
    await clickElement(result.container.querySelector('[aria-label="Harness"]'));
    const option = [...document.querySelectorAll('[role="option"]')].find(element => element.getAttribute("data-value") === "paperclip_runner");
    expect(Boolean(option)).toBe(enabled);
    if (!enabled) return;
    expect(document.body.textContent).toContain("Advanced");
    await clickElement(option);
    await clickByText(result.container, "Save");
    expect(result.onSave).toHaveBeenCalledWith(expect.objectContaining({
      adapterType: "paperclip_runner",
      adapterConfig: expect.objectContaining({ provider: "acpx", acpxAgent: "claude" }),
    }));
    expect(result.onSave.mock.calls[0][0].runner).toBeUndefined();
  });

  it("preserves Claude's saved runner without runner or legacy command controls when the experimental gate is off", async () => {
    mockInstanceSettingsApi.getExperimental.mockResolvedValue({ enableNativeRunner: false });
    const result = await renderForm([], { adapterType: "paperclip_runner", adapterConfig: { provider: "acpx", acpxAgent: "claude", model: "claude-opus-5-5", modelReasoningEffort: "high" } }, { showAdapterTypeField: true });
    roots.push(result.root);
    expect(result.container.querySelector('[aria-label="Harness"]')?.textContent).toContain("Claude");
    expect(result.container.querySelector('[data-config-section="configuration"]')?.textContent).not.toContain("Advanced");
    expect(result.container.querySelector('[aria-label="Runner"]')).toBeNull();
    const labels = Array.from(result.container.querySelectorAll("label")).map(label => label.textContent?.trim());
    expect(labels).not.toContain("Command");
    expect(labels).not.toContain("Extra args (comma-separated)");
    await act(async () => setInputValue(result.container.querySelector<HTMLInputElement>('[placeholder="Agent name"]')!, "Renamed Claude"));
    await flushReact();
    await clickByText(result.container, "Save");
    expect(result.onSave).toHaveBeenCalledWith({ name: "Renamed Claude" });
  });

  it.each([{ provider: "opencode", model: "openrouter/anthropic/claude-sonnet-4.6" }, { provider: "acpx", acpxAgent: "pi", model: "openrouter/anthropic/claude-sonnet-4.6", piThinkingLevel: "max", acpxPermissionMode: "approve-reads", lifecycleMode: "warm" }, { provider: "unknown-provider" }])("preserves saved native $provider configuration with the experimental gate off", async adapterConfig => {
    mockInstanceSettingsApi.getExperimental.mockResolvedValue({ enableNativeRunner: false });
    const result = await renderForm([], { adapterType: "paperclip_runner", adapterConfig }, { showAdapterTypeField: true });
    roots.push(result.root);
    if (adapterConfig.provider === "opencode" || adapterConfig.acpxAgent === "pi") {
      expect(result.container.querySelector('[aria-label="Harness"]')?.textContent).toContain(adapterConfig.provider === "opencode" ? "OpenCode" : "Pi");
      expect(result.container.querySelector('[aria-label="Runner"]')).toBeNull();
      expect(result.container.querySelector('[data-config-section="configuration"]')?.textContent).not.toContain("Advanced");
    }
    expect(result.container.querySelector('[aria-label="Runner"]')).toBeNull();
    if (adapterConfig.acpxAgent === "pi") {
      expect(result.container.querySelector('[aria-label="Pi thinking level"]')).not.toBeNull();
      expect(result.container.querySelector('[aria-label="Thinking effort"]')).toBeNull();
    }
    await act(async () => setInputValue(result.container.querySelector<HTMLInputElement>('[placeholder="Agent name"]')!, "Renamed native agent"));
    await flushReact();
    await clickByText(result.container, "Save");
    expect(result.onSave).toHaveBeenCalledWith({ name: "Renamed native agent" });
  });

  beforeEach(() => {
    mockEnvironmentsApi.list.mockResolvedValue([
      makeEnvironment({ id: "local-1", name: "Local", driver: "local" }),
      makeEnvironment({ id: "sandbox-1", name: "Daytona", driver: "sandbox", config: { provider: "daytona" } }),
    ]);
    mockEnvironmentsApi.capabilities.mockResolvedValue(SANDBOX_CAPABILITIES);
    mockAgentsApi.adapterModels.mockResolvedValue([]);
    mockAgentsApi.detectModel.mockResolvedValue(null);
    mockAgentsApi.list.mockResolvedValue([]);
    mockAgentsApi.testEnvironment.mockResolvedValue(AUTH_MISSING_RESULT);
    mockInstanceSettingsApi.get.mockResolvedValue({ defaultEnvironmentId: null });
    mockInstanceSettingsApi.getExperimental.mockResolvedValue({ enableEnvironments: true });
    mockInstanceSettingsApi.getGeneral.mockResolvedValue({ executionMode: "any" });
    mockSecretsApi.list.mockResolvedValue([]);
    mockSecretsApi.listProposals.mockResolvedValue([]);
    mockAgentsApi.getActiveAdapterAuthLoginSession.mockImplementation(noActiveSession);
    mockAgentsApi.getActiveClaudeSetupTokenLoginSession.mockImplementation(noActiveSession);
    mockAgentsApi.startAdapterAuthLogin.mockResolvedValue({
      sessionId: "session-1",
      environmentId: "sandbox-1",
      status: "starting",
      expiresAt: null,
      failure: null,
    });
    mockAgentsApi.getAdapterAuthLoginStatus.mockResolvedValue({
      sessionId: "session-1",
      environmentId: "sandbox-1",
      status: "waiting_for_user",
      expiresAt: null,
      failure: null,
      prompt: { url: "https://auth.example.test/device", code: "WXYZ-1234" },
    });
  });

  afterEach(async () => {
    for (const root of roots) {
      await act(async () => root.unmount());
    }
    roots = [];
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("blocks the displayed login code from session replay", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            <TooltipProvider>
              <AgentConfigForm
                mode="edit"
                agent={makeAgent({ defaultEnvironmentId: "sandbox-1" })}
                onSave={vi.fn()}
                hidePromptTemplate
                showAdapterTypeField={false}
                showAdapterTestEnvironmentButton
              />
            </TooltipProvider>
          </ToastProvider>
        </QueryClientProvider>,
      );
    });
    await flushReact();

    await clickByText(container, "Test");
    await clickByText(container, "Sign in");
    await flushReact();

    expect(isBlockedFromReplay("WXYZ-1234", document.body)).toBe(true);
  });
});
