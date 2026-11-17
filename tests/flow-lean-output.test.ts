import { afterAll, beforeAll, expect, test } from "bun:test";
import { startFakeBoard, type FakeBoard } from "./helpers/fake-board";

const longText = "需求背景。".repeat(400);

let board: FakeBoard;

beforeAll(() => {
  board = startFakeBoard({
    cards: [
      {
        number: 7,
        title: "Checkout",
        description: longText,
        description_html: `<p>${longText}</p>`,
        column: { id: "inprogress-id", name: "IN PROGRESS" },
        assignees: [{ id: "me", name: "Me" }],
        steps: [
          { id: "s1", content: "Design", completed: true },
          { id: "s2", content: "Build", completed: false },
        ],
      },
      {
        number: 8,
        title: "Refunds",
        description: longText,
        description_html: `<p>${longText}</p>`,
        column: { id: "todo-id", name: "TODO" },
        assignees: [{ id: "me", name: "Me" }],
      },
    ],
  });
});

afterAll(() => board.stop());

test("flow list --json returns one line of projected cards", async () => {
  const { stdout, exitCode } = await board.run(["flow", "list", "--json"]);

  expect(exitCode).toBe(0);
  expect(stdout.trim().split("\n")).toHaveLength(1);
  expect(JSON.parse(stdout).data).toEqual([
    {
      number: 7,
      title: "Checkout",
      column: "IN PROGRESS",
      assignees: ["Me"],
      steps: { done: 1, total: 2 },
    },
    { number: 8, title: "Refunds", column: "TODO", assignees: ["Me"] },
  ]);
});

test("flow list --json --full keeps every card field", async () => {
  const { stdout } = await board.run(["flow", "list", "--json", "--full"]);
  const [card] = JSON.parse(stdout).data;

  expect(card.description).toBe(longText);
  expect(card.descriptionHtml).toContain(longText);
  expect(card.steps).toHaveLength(2);
});

test("flow work --json summarises instead of dumping the board cache", async () => {
  const lean = await board.run(["flow", "work", "--fresh", "--json"]);
  const data = JSON.parse(lean.stdout).data;

  expect(lean.exitCode).toBe(0);
  expect(data.current.map((card: { number: number }) => card.number)).toEqual([7, 8]);
  expect(data.next).toEqual({ number: 8, title: "Refunds", column: "TODO", assignees: ["Me"] });
  expect(data.board.cards).toBe(2);
  expect(lean.stdout).not.toContain("需求背景");

  const full = await board.run(["flow", "work", "--json", "--full"]);
  expect(JSON.parse(full.stdout).data.statusResult.cache.cards[0].description).toBe(longText);
});

test("flow show --json carries the description once unless --full is passed", async () => {
  const lean = JSON.parse((await board.run(["flow", "show", "7", "--json"])).stdout).data;
  expect(lean.card.description).toBe(longText);
  expect(lean.card.descriptionHtml).toBeUndefined();
  expect(lean.card.steps).toHaveLength(2);

  const full = JSON.parse((await board.run(["flow", "show", "7", "--json", "--full"])).stdout).data;
  expect(full.card.descriptionHtml).toContain(longText);
});
