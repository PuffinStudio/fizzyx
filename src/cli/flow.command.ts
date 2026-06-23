import { Console, Effect, Option } from "effect";
import { Command, Flag, Argument } from "effect/unstable/cli";
import { printCardDetail, printCards, printSteps } from "./render";
import {
	formatFlowScaffoldResult,
	createFlowDraft,
	initFlowScaffold,
	loadFlowSkillContent,
	loadFlowTemplateContent,
	loadFlowWorkflowContent,
} from "./flow-content";
import {
	add,
	assign,
	block,
	doctor,
	getStandardizedCommentTemplate,
	completeSteps,
	done,
	makeFlowEnv,
	mine,
	next,
	repairMarkdownDescription,
	resolveDoneRefFromGit,
	show,
	start,
	status,
	standardizeBoard,
	standardizeCard,
	stepsFromDescription,
	syncBoard,
} from "../use-cases/flow-service";
import { withSpinner, logSuccess } from "./ui";

const handleSync = (): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		const cache = yield* withSpinner(
			"Syncing Fizzy board...",
			Effect.gen(function* () {
				const env = yield* makeFlowEnv;
				return yield* syncBoard(env);
			}),
		);
		yield* logSuccess(`synced cards=${cache.cards.length} not_now=${cache.notNow.length}`);
	});

const handleMine = (config: {
	fresh: boolean;
	user: Option.Option<string>;
}): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		const resolvedUser = Option.isSome(config.user) ? config.user.value : undefined;
		const result = yield* withSpinner(
			"Loading my tasks...",
			Effect.gen(function* () {
				const env = yield* makeFlowEnv;
				return yield* mine(env, {
					fresh: config.fresh,
					user: resolvedUser,
				});
			}),
		);
		yield* Console.log(`# ${result.name}: ${result.userId}`);
		yield* Console.log(printCards(result.cards));
	});

const handleFlowStatus = (config: { fresh: boolean }): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		const result = yield* withSpinner(
			"Loading board status...",
			Effect.gen(function* () {
				const env = yield* makeFlowEnv;
				const result = yield* status(env, { fresh: config.fresh });
				return { env, result };
			}),
		);
		yield* Console.log(`# board cache age: ${result.result.age}s`);
		yield* Console.log("");
		const activeColumnIds = new Set([
			result.env.config.flow.columns.inProgress,
			result.env.config.flow.columns.todo,
		]);
		yield* Console.log(
			printCards(
				result.result.cache.cards.filter((card) => activeColumnIds.has(card.column?.id || "")),
			),
		);
		if (result.result.cache.notNow.length > 0) {
			yield* Console.log(`\n# not_now (${result.result.cache.notNow.length})`);
			yield* Console.log(printCards(result.result.cache.notNow));
		}
	});

const handleNext = (config: { fresh: boolean }): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		const result = yield* withSpinner(
			"Loading next task...",
			Effect.gen(function* () {
				const env = yield* makeFlowEnv;
				return yield* next(env, { fresh: config.fresh });
			}),
		);
		if (!result.card) {
			yield* Console.log(`no TODO card for ${result.user.name}`);
			return;
		}
		yield* Console.log(`#${result.card.number} ${result.card.title}`);
		yield* Console.log(`next: fizzyx flow start ${result.card.number}`);
	});

const handleShow = (config: { card: number }): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		const result = yield* withSpinner(
			"Loading card details...",
			Effect.gen(function* () {
				const env = yield* makeFlowEnv;
				return yield* show(env, config.card);
			}),
		);
		yield* Console.log(printCardDetail(result.card, result.comments));
	});

const handleStart = (config: { card: number }): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		yield* withSpinner(
			"Starting card...",
			Effect.gen(function* () {
				const env = yield* makeFlowEnv;
				return yield* start(env, config.card);
			}),
		);
		yield* logSuccess(`started #${config.card}`);
	});

const handleDone = (config: {
	card: number;
	ref: Option.Option<string>;
}): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		const explicitRef = Option.isSome(config.ref) ? config.ref.value : undefined;
		const resolvedRef = explicitRef ?? (yield* resolveDoneRefFromGit());
		const result = yield* withSpinner(
			"Closing card...",
			Effect.gen(function* () {
				const env = yield* makeFlowEnv;
				return yield* done(env, config.card, resolvedRef);
			}),
		);
		yield* logSuccess(`closed #${result.number} (${result.ref})`);
	});

const handleBlock = (config: { card: number; reason: string }): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		const result = yield* withSpinner(
			"Marking card blocked...",
			Effect.gen(function* () {
				const env = yield* makeFlowEnv;
				return yield* block(env, config.card, config.reason);
			}),
		);
		yield* Console.log(`blocked #${result.number}: ${result.reason}`);
	});

const handleAssign = (config: {
	card: number;
	users: ReadonlyArray<string>;
}): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		const result = yield* withSpinner(
			"Assigning card...",
			Effect.gen(function* () {
				const env = yield* makeFlowEnv;
				return yield* assign(env, config.card, config.users as string[]);
			}),
		);
		yield* logSuccess(`assigned #${result.number} to ${result.userIds.join(", ")}`);
	});

const handleCommentTemplate = (config: {
	kind: "done" | "blocked" | "unblocked" | "handoff" | "note";
}): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		yield* Console.log(getStandardizedCommentTemplate(config.kind));
	});

const handleWorkflow = (): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		yield* Console.log(
			yield* withSpinner("Reading local workflow template...", loadFlowWorkflowContent()),
		);
	});

const handleSkillInit = (config: { force: boolean }): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		const results = yield* withSpinner(
			"Writing flow skill scaffold...",
			initFlowScaffold({ force: config.force }),
		);
		for (const result of results) {
			yield* Console.log(formatFlowScaffoldResult(result));
		}
	});

const handleSkill = (): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		const skill = yield* withSpinner("Reading local skill file...", loadFlowSkillContent());
		yield* Console.log(skill);
	});

const handleRepairMarkdown = (config: { card: number }): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		const repaired = yield* withSpinner(
			"Repairing card description...",
			Effect.gen(function* () {
				const env = yield* makeFlowEnv;
				return yield* repairMarkdownDescription(env, config.card);
			}),
		);
		yield* logSuccess(`repaired #${repaired}`);
	});

const handleCompleteSteps = (config: { card: number }): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		const result = yield* withSpinner(
			"Completing pending steps...",
			Effect.gen(function* () {
				const env = yield* makeFlowEnv;
				return yield* completeSteps(env, config.card);
			}),
		);
		const plural = result.updatedCount === 1 ? "" : "s";
		yield* logSuccess(`completed ${result.updatedCount} step${plural} for #${result.number}`);
		if (result.contents.length > 0) {
			yield* Console.log(result.contents.map((content) => `- ${content}`).join("\n"));
		}
	});

const handleStd = (config: { card: number }): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		const result = yield* withSpinner(
			"Standardizing card...",
			Effect.gen(function* () {
				const env = yield* makeFlowEnv;
				return yield* standardizeCard(env, config.card);
			}),
		);
		yield* Console.log(formatStandardizeResult(result));
	});

const handleStdAll = (): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		const result = yield* withSpinner(
			"Standardizing board...",
			Effect.gen(function* () {
				const env = yield* makeFlowEnv;
				return yield* standardizeBoard(env);
			}),
		);
		yield* Console.log(result.results.map(formatStandardizeResult).join("\n"));
		yield* Console.log(
			`total=${result.total} descriptions=${result.descriptionUpdated} steps_created=${result.stepsCreated} steps_updated=${result.stepsUpdated} steps_completed=${result.stepsCompleted}`,
		);
	});

const handleAdd = (config: {
	user: string;
	title: string;
	desc?: string;
}): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		if (!config.desc) {
			yield* Console.log("usage: fizzyx flow add <user> <title> --desc <file|->");
			return;
		}
		const number = yield* withSpinner(
			"Creating card...",
			Effect.gen(function* () {
				const description = yield* readDescription(config.desc!);
				const env = yield* makeFlowEnv;
				return yield* add(env, {
					user: config.user,
					title: config.title,
					description,
				});
			}),
		);
		yield* Console.log(number);
	});

const handleStepsFromDesc = (config: { card: number }): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		const steps = yield* withSpinner(
			"Syncing Done When steps...",
			Effect.gen(function* () {
				const env = yield* makeFlowEnv;
				return yield* stepsFromDescription(env, config.card);
			}),
		);
		yield* Console.log(printSteps(steps));
	});

const handleFlowTemplate = (config: { draft: boolean }): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		if (config.draft) {
			const draftResult = yield* withSpinner("Writing card draft...", createFlowDraft());
			yield* Console.log(draftResult.path);
			return;
		}
		yield* Console.log(
			yield* withSpinner("Reading local card template...", loadFlowTemplateContent()),
		);
	});

const handleDoctor = (): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		const result = yield* withSpinner(
			"Checking flow health...",
			Effect.gen(function* () {
				const env = yield* makeFlowEnv;
				return yield* doctor(env);
			}),
		);
		const lines: string[] = [];
		lines.push("=== Board Health ===");
		lines.push(`account: ${result.account}`);
		lines.push(`board: ${result.boardId}`);
		lines.push(`api: ${result.apiUrl}`);
		lines.push("");
		lines.push("API-visible columns:");
		for (const col of result.allColumns) {
			const isExpected = result.columns.some((c) => c.id === col.id);
			const status = isExpected ? "\u2713" : "\u2022";
			lines.push(`  ${status} ${col.name} (${col.id})`);
		}
		lines.push("");
		lines.push("Implicit system actions:");
		for (const action of result.systemActions) {
			lines.push(`  \u2713 ${action.name} via ${action.via} (not listed by columns API)`);
		}
		if (result.info.length > 0) {
			lines.push("");
			for (const msg of result.info) {
				lines.push(`  i ${msg}`);
			}
		}
		if (result.fixes.length > 0) {
			lines.push("\nFixes:");
			for (const fix of result.fixes) {
				lines.push(`  \u2022 ${fix}`);
			}
		} else {
			lines.push("\nAll good!");
		}
		yield* Console.log(lines.join("\n"));
	});

const handleFlowInit = (): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		const env = yield* withSpinner("Initializing workflow config...", makeFlowEnv);
		yield* Console.log(
			`flow configured: todo=${env.config.flow.columns.todo} in_progress=${env.config.flow.columns.inProgress}`,
		);
	});

const flowSyncCmd = Command.make("sync", {}, handleSync).pipe(
	Command.withDescription("Sync Fizzy board cache"),
);

const flowMineCmd = Command.make(
	"mine",
	{
		fresh: Flag.boolean("fresh").pipe(Flag.withDescription("Skip cache, fetch from API")),
		user: Argument.string("user").pipe(
			Argument.withDescription("GitHub username to filter"),
			Argument.optional,
		),
	},
	handleMine,
).pipe(Command.withDescription("List my tasks"));

const flowStatusCmd = Command.make(
	"status",
	{
		fresh: Flag.boolean("fresh").pipe(Flag.withDescription("Skip cache, fetch from API")),
	},
	handleFlowStatus,
).pipe(Command.withDescription("Show board status"));

const flowNextCmd = Command.make(
	"next",
	{
		fresh: Flag.boolean("fresh").pipe(Flag.withDescription("Skip cache, fetch from API")),
	},
	handleNext,
).pipe(Command.withDescription("Show next TODO card"));

const flowShowCmd = Command.make(
	"show",
	{
		card: Argument.integer("card").pipe(
			Argument.withDescription("Card number"),
			Argument.withMetavar("CARD"),
		),
	},
	handleShow,
).pipe(Command.withDescription("Show card details"));

const flowStartCmd = Command.make(
	"start",
	{
		card: Argument.integer("card").pipe(
			Argument.withDescription("Card number"),
			Argument.withMetavar("CARD"),
		),
	},
	handleStart,
).pipe(Command.withDescription("Start a card"));

const flowDoneCmd = Command.make(
	"done",
	{
		card: Argument.integer("card").pipe(
			Argument.withDescription("Card number"),
			Argument.withMetavar("CARD"),
		),
		ref: Argument.string("ref").pipe(
			Argument.withDescription("Commit reference (SHA or message)"),
			Argument.optional,
		),
	},
	handleDone,
).pipe(Command.withDescription("Close a card"));

const flowBlockCmd = Command.make(
	"block",
	{
		card: Argument.integer("card").pipe(
			Argument.withDescription("Card number"),
			Argument.withMetavar("CARD"),
		),
		reason: Argument.string("reason").pipe(
			Argument.withMetavar("REASON"),
			Argument.withDescription("Block reason"),
		),
	},
	handleBlock,
).pipe(Command.withDescription("Block a card"));

const flowAssignCmd = Command.make(
	"assign",
	{
		card: Argument.integer("card").pipe(
			Argument.withDescription("Card number"),
			Argument.withMetavar("CARD"),
		),
		users: Argument.string("user").pipe(
			Argument.withMetavar("USER"),
			Argument.withDescription("User(s) to assign (use 'me' for self)"),
			Argument.variadic({ min: 1 }),
		),
	},
	handleAssign,
).pipe(Command.withDescription("Assign card to user(s)"));

const flowCommentTemplateCmd = Command.make(
	"comment-template",
	{
		kind: Argument.choice("kind", [
			"done",
			"blocked",
			"unblocked",
			"handoff",
			"note",
		] as const).pipe(Argument.withDescription("Template kind")),
	},
	handleCommentTemplate,
).pipe(Command.withDescription("Print standardized comment template"));

const flowWorkflowCmd = Command.make("workflow", {}, handleWorkflow).pipe(
	Command.withDescription("Print workflow process checklist"),
);

const flowSkillInitCmd = Command.make(
	"init",
	{
		force: Flag.boolean("force").pipe(Flag.withDescription("Overwrite existing files")),
	},
	handleSkillInit,
).pipe(Command.withDescription("Initialize flow skill scaffold"));

const flowSkillCmd = Command.make("skill", {}, handleSkill).pipe(
	Command.withDescription("Read or initialize flow skill"),
	Command.withSubcommands([flowSkillInitCmd]),
);

const flowRepairMarkdownCmd = Command.make(
	"repair-markdown",
	{
		card: Argument.integer("card").pipe(
			Argument.withDescription("Card number"),
			Argument.withMetavar("CARD"),
		),
	},
	handleRepairMarkdown,
).pipe(Command.withDescription("Repair card markdown description"));

const flowCompleteStepsCmd = Command.make(
	"complete-steps",
	{
		card: Argument.integer("card").pipe(
			Argument.withDescription("Card number"),
			Argument.withMetavar("CARD"),
		),
	},
	handleCompleteSteps,
).pipe(Command.withDescription("Complete pending steps"));

const flowStdCmd = Command.make(
	"std",
	{
		card: Argument.integer("card").pipe(
			Argument.withDescription("Card number"),
			Argument.withMetavar("CARD"),
		),
	},
	handleStd,
).pipe(Command.withAlias("standardize-card"), Command.withDescription("Standardize a single card"));

const flowStdAllCmd = Command.make("std-all", {}, handleStdAll).pipe(
	Command.withAlias("standardize-board"),
	Command.withDescription("Standardize all board cards"),
);

const flowAddCmd = Command.make(
	"add",
	{
		user: Argument.string("user").pipe(
			Argument.withDescription("GitHub username to assign"),
			Argument.withMetavar("USER"),
		),
		title: Argument.string("title").pipe(Argument.withDescription("Card title")),
		desc: Flag.string("desc").pipe(Flag.withDescription("Description file path ('-' for stdin)")),
	},
	handleAdd,
).pipe(Command.withDescription("Create a new card"));

const flowStepsFromDescCmd = Command.make(
	"steps-from-desc",
	{
		card: Argument.integer("card").pipe(
			Argument.withDescription("Card number"),
			Argument.withMetavar("CARD"),
		),
	},
	handleStepsFromDesc,
).pipe(Command.withDescription("Sync steps from card description"));

const flowTemplateCmd = Command.make(
	"template",
	{
		draft: Flag.boolean("draft").pipe(Flag.withDescription("Create a draft card file")),
	},
	handleFlowTemplate,
).pipe(Command.withDescription("Read card template or create draft"));

const flowDoctorCmd = Command.make("doctor", {}, handleDoctor).pipe(
	Command.withDescription("Check flow health"),
);

const flowInitCmd = Command.make("init", {}, handleFlowInit).pipe(
	Command.withDescription("Initialize flow config"),
);

const formatStandardizeResult = (result: {
	number: number;
	descriptionUpdated: boolean;
	stepsCreated: number;
	stepsUpdated: number;
	stepsCompleted: number;
}): string =>
	`standardized #${result.number} description=${result.descriptionUpdated ? "yes" : "no"} steps_created=${result.stepsCreated} steps_updated=${result.stepsUpdated} steps_completed=${result.stepsCompleted}`;

const readDescription = (path: string): Effect.Effect<string, any, any> =>
	path === "-"
		? Effect.tryPromise({
				try: () => Bun.stdin.text(),
				catch: (cause) => new Error(`failed to read stdin: ${String(cause)}`),
			})
		: Effect.tryPromise({
				try: () => Bun.file(path).text(),
				catch: (cause) => new Error(`failed to read ${path}: ${String(cause)}`),
			});

export const flowCmd = Command.make("flow").pipe(
	Command.withDescription("Manage Fizzy workflow boards"),
	Command.withSubcommands([
		flowSyncCmd,
		flowMineCmd,
		flowStatusCmd,
		flowNextCmd,
		flowShowCmd,
		flowStartCmd,
		flowDoneCmd,
		flowBlockCmd,
		flowAssignCmd,
		flowCommentTemplateCmd,
		flowWorkflowCmd,
		flowSkillCmd,
		flowRepairMarkdownCmd,
		flowCompleteStepsCmd,
		flowStdCmd,
		flowStdAllCmd,
		flowAddCmd,
		flowStepsFromDescCmd,
		flowTemplateCmd,
		flowDoctorCmd,
		flowInitCmd,
	]),
);
