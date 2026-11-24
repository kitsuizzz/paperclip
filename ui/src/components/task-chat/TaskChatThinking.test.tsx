// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskChatThinkingItem } from "./task-chat-model";

vi.mock("@/components/MarkdownBody", () => ({
  MarkdownBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { TaskChatThinking } from "./TaskChatThinking";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

function thinkingItem(overrides: Partial<TaskChatThinkingItem> = {}): TaskChatThinkingItem {
  return {
    id: "run:think:0",
    kind: "thinking",
    lines: ["Checking the deploy stamp", "The build reports cf62a713."],
    collapsed: true,
    ...overrides,
  };
}

describe("TaskChatThinking", () => {
  it("keeps settled reasoning collapsed until expanded, then shows the full text", async () => {
    await act(async () => root.render(<TaskChatThinking item={thinkingItem()} />));

    expect(container.querySelector('[data-state="settled"]')).not.toBeNull();
    const button = container.querySelector("button");
    expect(button?.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector('[data-testid="task-chat-thinking-text"]')).toBeNull();
    expect(container.querySelector('[data-testid="task-chat-thinking-preview"]')?.textContent)
      .toContain("cf62a713");

    await act(async () => button!.click());

    expect(button?.getAttribute("aria-expanded")).toBe("true");
    const expanded = container.querySelector('[data-testid="task-chat-thinking-text"]');
    expect(expanded?.textContent).toContain("Checking the deploy stamp");
    expect(expanded?.textContent).toContain("The build reports cf62a713.");
  });

  it("keeps the streaming label while the provider is still reasoning", async () => {
    await act(async () => root.render(
      <TaskChatThinking item={thinkingItem({ lines: [], streaming: true })} />,
    ));

    expect(container.querySelector('[data-state="active"]')).not.toBeNull();
    expect(container.textContent).toContain("Thinking…");
    expect(container.querySelector("button")).toBeNull();
  });

  it("stays expanded after the run settles so the text survives the turn", async () => {
    const item = thinkingItem({ streaming: true });
    await act(async () => root.render(<TaskChatThinking item={item} />));
    const button = container.querySelector("button");
    await act(async () => button!.click());
    expect(container.querySelector('[data-testid="task-chat-thinking-text"]')).not.toBeNull();

    await act(async () => root.render(
      <TaskChatThinking item={{ ...item, streaming: false }} />,
    ));

    expect(container.querySelector('[data-state="settled"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="task-chat-thinking-text"]')?.textContent)
      .toContain("The build reports cf62a713.");
  });
});
