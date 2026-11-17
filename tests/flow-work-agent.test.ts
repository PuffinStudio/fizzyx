import { expect, test } from "bun:test";
import { startFakeBoard } from "./helpers/fake-board";

const mine = [{ id: "me", name: "Me" }];
const inProgress = { id: "inprogress-id", name: "IN PROGRESS" };

test("flow work --agent lists in-progress cards with their next step, then the next card", async () => {
  const board = startFakeBoard({
    cards: [
      {
        number: 7,
        title: "Checkout",
        description: "long background text",
        column: inProgress,
        assignees: mine,
        steps: [
          { id: "s1", content: "Design", completed: true },
          { id: "s2", content: "Build the form", completed: false },
          { id: "s3", content: "Verify", completed: false },
        ],
      },
      { number: 9, title: "Someone else's", column: inProgress, assignees: [{ id: "x" }] },
      { number: 8, title: "Refunds", column: { id: "todo-id", name: "TODO" }, assignees: mine },
    ],
  });
  try {
    const { stdout, exitCode } = await board.run(["flow", "work", "--fresh", "--agent"]);

    expect(exitCode).toBe(0);
    expect(stdout.trim().split("\n")).toEqual([
      "in_progress: 1",
      "  #7 Checkout (1/3, next: Build the form)",
      "next: #8 Refunds",
    ]);
  } finally {
    board.stop();
  }
});

test("flow work --agent stays within eight lines on a crowded board", async () => {
  const board = startFakeBoard({
    cards: Array.from({ length: 12 }, (_, index) => ({
      number: index + 1,
      title: `Card ${index + 1}`,
      column: inProgress,
      assignees: mine,
      steps: [{ id: `s${index}`, content: "Only step", completed: true }],
    })),
  });
  try {
    const { stdout } = await board.run(["flow", "work", "--fresh", "--agent"]);
    const lines = stdout.trim().split("\n");

    expect(lines).toHaveLength(8);
    expect(lines[0]).toBe("in_progress: 12");
    expect(lines[1]).toBe("  #1 Card 1 (1/1, all steps done)");
    expect(lines[6]).toContain("(+6 more)");
    expect(lines[7]).toBe("next: none");
  } finally {
    board.stop();
  }
});
