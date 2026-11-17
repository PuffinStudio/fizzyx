import { expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { startFakeBoard } from "./helpers/fake-board";

const finished = {
  number: 20,
  title: "Finished card",
  steps: [{ id: "s1", content: "Ship", completed: true }],
};

test("flow done closes a card without a note, outside git and in a dirty repository", async () => {
  const board = startFakeBoard({ cards: [finished] });
  try {
    const outsideGit = await board.run(["flow", "done", "20"]);
    expect(outsideGit.exitCode).toBe(0);
    expect(outsideGit.stdout.trim()).toBe("closed #20");

    Bun.spawnSync(["git", "init"], { cwd: board.projectDir, stdout: "ignore", stderr: "ignore" });
    writeFileSync(join(board.projectDir, "uncommitted.txt"), "work in progress\n");
    const dirtyRepo = await board.run(["flow", "done", "20"]);
    expect(dirtyRepo.exitCode).toBe(0);

    expect(board.closed).toEqual([20, 20]);
    expect(board.comments).toEqual([]);
  } finally {
    board.stop();
  }
});

test("flow done records a note as the closing comment when one is given", async () => {
  const board = startFakeBoard({ cards: [finished] });
  try {
    const { stdout, exitCode } = await board.run(["flow", "done", "20", "已在本机验收"]);

    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("closed #20 (已在本机验收)");
    expect(board.closed).toEqual([20]);
    expect(board.comments).toEqual([{ card: 20, body: "<p>done: 已在本机验收</p>" }]);
  } finally {
    board.stop();
  }
});

test("flow done refuses a card with unchecked steps unless --complete-steps is passed", async () => {
  const board = startFakeBoard({
    cards: [
      {
        number: 21,
        title: "Half done",
        steps: [
          { id: "s1", content: "Build", completed: true },
          { id: "s2", content: "Verify", completed: false },
        ],
      },
    ],
  });
  try {
    const refused = await board.run(["flow", "done", "21"]);
    expect(refused.exitCode).not.toBe(0);
    expect(board.closed).toEqual([]);

    const forced = await board.run(["flow", "done", "21", "--complete-steps"]);
    expect(forced.exitCode).toBe(0);
    expect(board.patchedSteps).toEqual(["/1/cards/21/steps/s2"]);
    expect(board.closed).toEqual([21]);
  } finally {
    board.stop();
  }
});
