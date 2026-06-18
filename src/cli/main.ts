import { Console, Effect } from "effect";
import type { OssSetupInput, SetupProjectConfigInput } from "../ports/config-repository";
import {
	ossInitBlank,
	ossSetup,
	ossStoreCredentials,
	ossSync,
	ossStatus,
	ossList,
} from "../use-cases/oss-service";
import {
	add,
	assign,
	authLogin,
	authLogout,
	authStatus,
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
	listBoards,
	setup,
	show,
	start,
	status,
	standardizeBoard,
	standardizeCard,
	stepsFromDescription,
	syncBoard,
} from "../use-cases/flow-service";
import { buildKeyTree, printCardDetail, printCards, printSteps, renderTable } from "./render";
import {
	formatFlowScaffoldResult,
	initFlowScaffold,
	loadFlowSkillContent,
	loadFlowTemplateContent,
	loadFlowWorkflowContent,
} from "./flow-content";
import { withSpinner } from "./spinner";

export const runCli = (args: ReadonlyArray<string>) =>
	Effect.gen(function* () {
		const [command = "help", ...rest] = args;
		switch (command) {
			case "help":
			case "--help":
			case "-h":
				yield* Console.log(topUsage());
				return;
			case "setup": {
				if (hasHelp(rest)) {
					yield* Console.log(setupUsage());
					return;
				}

				const input = parseSetup(rest);
				if (input.list) {
					const boards = yield* withSpinner("Loading Fizzy boards...", listBoards());
					if (boards.length === 0) {
						yield* Console.log("(no boards)");
						return;
					}

					yield* Console.log(
						renderTable(boards, [
							{ header: "id", value: (board) => board.id },
							{ header: "name", value: (board) => board.name },
						]),
					);
					return;
				}

				const config = yield* withSpinner("Initializing Fizzy workflow...", setup(input));
				yield* Console.log(`created ${config.configPath}`);
				return;
			}
			case "auth":
				yield* runAuth(rest);
				return;
			case "flow":
				yield* runFlow(rest);
				return;
			case "oss":
				yield* runOss(rest);
				return;
			default:
				throw new Error(legacyCommandErrorMessage(command));
		}
	});

const legacyFlowCommands = {
	sync: "sync",
	mine: "mine",
	status: "status",
	next: "next",
	show: "show",
	start: "start",
	done: "done",
	block: "block",
	add: "add",
	"steps-from-desc": "steps-from-desc",
	"repair-markdown": "repair-markdown",
	"complete-steps": "complete-steps",
	"comment-template": "comment-template",
	"standardize-card": "standardize-card",
	"standardize-board": "standardize-board",
	std: "std",
	"std-all": "std-all",
	workflow: "workflow",
	skill: "skill",
} as const;

const legacyCommandErrorMessage = (command: string) => {
	const legacy = legacyFlowCommands[command as keyof typeof legacyFlowCommands];
	if (legacy) {
		return `unknown command: ${command}. Did you mean: fizzyx flow ${legacy}?`;
	}

	return `unknown command: ${command}\n\n${topUsage()}`;
};

const runFlow = (args: ReadonlyArray<string>) =>
	Effect.gen(function* () {
		const [command = "help", ...rest] = args;

		if (isHelpCommand(command)) {
			yield* Console.log(flowUsage());
			return;
		}

		switch (command) {
			case "sync": {
				if (hasHelp(rest)) {
					yield* Console.log(flowSyncUsage());
					return;
				}
				const cache = yield* withSpinner(
					"Syncing Fizzy board...",
					Effect.gen(function* () {
						const env = yield* makeFlowEnv;
						return yield* syncBoard(env);
					}),
				);
				yield* Console.log(`synced cards=${cache.cards.length} not_now=${cache.notNow.length}`);
				return;
			}
			case "mine": {
				if (hasHelp(rest)) {
					yield* Console.log(flowMineUsage());
					return;
				}
				const fresh = rest.includes("--fresh");
				const user = firstNonFlag(rest);
				const result = yield* withSpinner(
					"Loading my tasks...",
					Effect.gen(function* () {
						const env = yield* makeFlowEnv;
						return yield* mine(env, { fresh, user });
					}),
				);
				yield* Console.log(`# ${result.name}: ${result.userId}`);
				yield* Console.log(printCards(result.cards));
				return;
			}
			case "status": {
				if (hasHelp(rest)) {
					yield* Console.log(flowStatusUsage());
					return;
				}
				const result = yield* withSpinner(
					"Loading board status...",
					Effect.gen(function* () {
						const env = yield* makeFlowEnv;
						return yield* status(env, { fresh: rest.includes("--fresh") });
					}),
				);
				yield* Console.log(`# board cache age: ${result.age}s`);
				yield* Console.log("");
				yield* Console.log(
					printCards(
						result.cache.cards.filter((card) =>
							["INPROGRESS", "TODO"].includes(card.column?.name || ""),
						),
					),
				);
				if (result.cache.notNow.length > 0) {
					yield* Console.log(`\n# not_now (${result.cache.notNow.length})`);
					yield* Console.log(printCards(result.cache.notNow));
				}
				return;
			}
			case "next": {
				if (hasHelp(rest)) {
					yield* Console.log(flowNextUsage());
					return;
				}
				const result = yield* withSpinner(
					"Loading next task...",
					Effect.gen(function* () {
						const env = yield* makeFlowEnv;
						return yield* next(env, { fresh: rest.includes("--fresh") });
					}),
				);
				if (!result.card) {
					yield* Console.log(`no TODO card for ${result.user.name}`);
					return;
				}
				yield* Console.log(`#${result.card.number} ${result.card.title}`);
				yield* Console.log(`next: fizzyx flow start ${result.card.number}`);
				return;
			}
			case "show": {
				if (hasHelp(rest)) {
					yield* Console.log(flowShowUsage());
					return;
				}
				const number = parseNumber(rest[0]);
				const result = yield* withSpinner(
					"Loading card details...",
					Effect.gen(function* () {
						const env = yield* makeFlowEnv;
						return yield* show(env, number);
					}),
				);
				yield* Console.log(printCardDetail(result.card, result.comments));
				return;
			}
			case "start": {
				if (hasHelp(rest)) {
					yield* Console.log(flowStartUsage());
					return;
				}
				const number = parseNumber(rest[0]);
				yield* withSpinner(
					"Starting card...",
					Effect.gen(function* () {
						const env = yield* makeFlowEnv;
						return yield* start(env, number);
					}),
				);
				yield* Console.log(`started #${number}`);
				return;
			}
			case "done": {
				if (hasHelp(rest)) {
					yield* Console.log(flowDoneUsage());
					return;
				}
				const number = parseNumber(rest[0]);
				const explicitRef = rest
					.slice(1)
					.filter((arg) => !isHelpCommand(arg))
					.join(" ");
				const ref = explicitRef ? explicitRef : yield* resolveDoneRefFromGit();
				const result = yield* withSpinner(
					"Closing card...",
					Effect.gen(function* () {
						const env = yield* makeFlowEnv;
						return yield* done(env, number, ref);
					}),
				);
				yield* Console.log(`closed #${result.number} (${result.ref})`);
				return;
			}
			case "block": {
				if (hasHelp(rest)) {
					yield* Console.log(flowBlockUsage());
					return;
				}
				const number = parseNumber(rest[0]);
				const reason = rest.slice(1).join(" ");
				const result = yield* withSpinner(
					"Marking card blocked...",
					Effect.gen(function* () {
						const env = yield* makeFlowEnv;
						return yield* block(env, number, reason);
					}),
				);
				yield* Console.log(`blocked #${result.number}: ${result.reason}`);
				return;
			}
			case "assign": {
				if (hasHelp(rest)) {
					yield* Console.log(flowAssignUsage());
					return;
				}
				const number = parseNumber(rest[0]);
				const users = rest.slice(1).filter((a) => !a.startsWith("--"));
				if (users.length === 0) {
					throw new Error(flowAssignUsage());
				}
				const result = yield* withSpinner(
					"Assigning card...",
					Effect.gen(function* () {
						const env = yield* makeFlowEnv;
						return yield* assign(env, number, users);
					}),
				);
				yield* Console.log(`assigned #${result.number} to ${result.userIds.join(", ")}`);
				return;
			}
			case "comment-template": {
				if (hasHelp(rest)) {
					yield* Console.log(flowCommentTemplateUsage());
					return;
				}
				const [kind] = rest;
				if (!isValidCommentTemplateKind(kind)) {
					throw new Error(flowCommentTemplateUsage());
				}
				yield* Console.log(getStandardizedCommentTemplate(kind));
				return;
			}
			case "workflow": {
				if (hasHelp(rest)) {
					yield* Console.log(flowWorkflowUsage());
					return;
				}
				yield* Console.log(
					yield* withSpinner("Reading local workflow template...", loadFlowWorkflowContent()),
				);
				return;
			}
			case "skill": {
				const [subcommand, ...skillRest] = rest;

				if (subcommand === "init") {
					if (hasHelp(skillRest)) {
						yield* Console.log(flowSkillInitUsage());
						return;
					}

					for (const arg of skillRest) {
						if (arg !== "--force") {
							throw new Error(flowSkillInitUsage());
						}
					}

					const force = skillRest.includes("--force");
					const results = yield* withSpinner(
						"Writing flow skill scaffold...",
						initFlowScaffold({ force }),
					);
					for (const result of results) {
						yield* Console.log(formatFlowScaffoldResult(result));
					}
					return;
				}

				if (hasHelp(rest)) {
					yield* Console.log(flowSkillUsage());
					return;
				}

				if (subcommand !== undefined) {
					throw new Error(flowSkillUsage());
				}

				const skill = yield* withSpinner("Reading local skill file...", loadFlowSkillContent());
				yield* Console.log(skill);
				return;
			}
			case "repair-markdown": {
				if (hasHelp(rest)) {
					yield* Console.log(flowRepairMarkdownUsage());
					return;
				}
				const number = parseNumber(rest[0]);
				const repaired = yield* withSpinner(
					"Repairing card description...",
					Effect.gen(function* () {
						const env = yield* makeFlowEnv;
						return yield* repairMarkdownDescription(env, number);
					}),
				);
				yield* Console.log(`repaired #${repaired}`);
				return;
			}
			case "complete-steps": {
				if (hasHelp(rest)) {
					yield* Console.log(flowCompleteStepsUsage());
					return;
				}
				const number = parseNumber(rest[0]);
				const result = yield* withSpinner(
					"Completing pending steps...",
					Effect.gen(function* () {
						const env = yield* makeFlowEnv;
						return yield* completeSteps(env, number);
					}),
				);
				const plural = result.updatedCount === 1 ? "" : "s";
				yield* Console.log(`completed ${result.updatedCount} step${plural} for #${result.number}`);
				if (result.contents.length > 0) {
					yield* Console.log(result.contents.map((content) => `- ${content}`).join("\n"));
				}
				return;
			}
			case "std":
			case "standardize-card": {
				if (hasHelp(rest)) {
					yield* Console.log(flowStdUsage());
					return;
				}
				const number = parseNumber(rest[0]);
				const result = yield* withSpinner(
					"Standardizing card...",
					Effect.gen(function* () {
						const env = yield* makeFlowEnv;
						return yield* standardizeCard(env, number);
					}),
				);
				yield* Console.log(formatStandardizeResult(result));
				return;
			}
			case "std-all":
			case "standardize-board": {
				if (hasHelp(rest)) {
					yield* Console.log(flowStdAllUsage());
					return;
				}
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
				return;
			}
			case "add": {
				if (hasHelp(rest)) {
					yield* Console.log(flowAddUsage());
					return;
				}
				const user = rest[0];
				const title = rest[1];
				const descPath = parseFlag(rest, "--desc");
				if (!user || !title || !descPath) {
					throw new Error(flowAddUsage());
				}
				const number = yield* withSpinner(
					"Creating card...",
					Effect.gen(function* () {
						const description = yield* readDescription(descPath);
						const env = yield* makeFlowEnv;
						return yield* add(env, { user, title, description });
					}),
				);
				yield* Console.log(number);
				return;
			}
			case "steps-from-desc": {
				if (hasHelp(rest)) {
					yield* Console.log(flowStepsUsage());
					return;
				}
				const number = parseNumber(rest[0]);
				const steps = yield* withSpinner(
					"Syncing Done When steps...",
					Effect.gen(function* () {
						const env = yield* makeFlowEnv;
						return yield* stepsFromDescription(env, number);
					}),
				);
				yield* Console.log(printSteps(steps));
				return;
			}
			case "template": {
				if (hasHelp(rest)) {
					yield* Console.log(flowTemplateUsage());
					return;
				}
				yield* Console.log(
					yield* withSpinner("Reading local card template...", loadFlowTemplateContent()),
				);
				return;
			}
			case "doctor": {
				if (hasHelp(rest)) {
					yield* Console.log(flowDoctorUsage());
					return;
				}
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
					const status = isExpected ? "✓" : "•";
					lines.push(`  ${status} ${col.name} (${col.id})`);
				}
				lines.push("");
				lines.push("Implicit system actions:");
				for (const action of result.systemActions) {
					lines.push(`  ✓ ${action.name} via ${action.via} (not listed by columns API)`);
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
						lines.push(`  • ${fix}`);
					}
				} else {
					lines.push("\nAll good!");
				}
				yield* Console.log(lines.join("\n"));
				return;
			}
			case "init": {
				if (hasHelp(rest)) {
					yield* Console.log(flowInitUsage());
					return;
				}
				const env = yield* withSpinner("Initializing workflow config...", makeFlowEnv);
				yield* Console.log(
					`flow configured: todo=${env.config.flow.columns.todo} in_progress=${env.config.flow.columns.inProgress}`,
				);
				return;
			}
			case "help":
			case "--help":
			case "-h":
				yield* Console.log(flowUsage());
				return;
			default:
				throw new Error(`unknown flow command: ${command}\n\n${flowUsage()}`);
		}
	});

const runAuth = (args: ReadonlyArray<string>) =>
	Effect.gen(function* () {
		const [command = "help", ...rest] = args;

		if (isHelpCommand(command)) {
			yield* Console.log(authUsage());
			return;
		}

		switch (command) {
			case "login": {
				if (hasHelp(rest) || !rest[0]) {
					throw new Error(authLoginUsage());
				}
				const account = yield* withSpinner("Saving credentials...", authLogin(rest[0]));
				yield* Console.log(`token saved for ${account}`);
				return;
			}
			case "status": {
				if (hasHelp(rest)) {
					yield* Console.log(authStatusUsage());
					return;
				}
				const result = yield* withSpinner("Checking auth status...", authStatus);
				yield* Console.log(`account: ${result.account}`);
				yield* Console.log(`board: ${result.board}`);
				yield* Console.log(`authenticated: ${result.authenticated}`);
				if (result.identity) {
					yield* Console.log(`user: ${result.identity.name || ""}`);
					yield* Console.log(`user_id: ${result.identity.userId}`);
					yield* Console.log(`email: ${result.identity.email || ""}`);
				} else if (result.identityError) {
					yield* Console.log(`identity_error: ${result.identityError}`);
				}
				return;
			}
			case "logout": {
				if (hasHelp(rest)) {
					yield* Console.log(authLogoutUsage());
					return;
				}
				const account = yield* withSpinner("Clearing credentials...", authLogout);
				yield* Console.log(`token removed for ${account}`);
				return;
			}
			default:
				throw new Error(authUsage());
		}
	});

const runOss = (args: ReadonlyArray<string>) =>
	Effect.gen(function* () {
		const [command = "help", ...rest] = args;

		if (isHelpCommand(command)) {
			yield* Console.log(ossUsage());
			return;
		}

		switch (command) {
			case "ls": {
				if (hasHelp(rest)) {
					yield* Console.log(ossLsUsage());
					return;
				}
				const lsEnv = parseOssEnv(rest, "dev");
				const lsPrefix = parseFlag(rest, "--prefix") ?? undefined;
				const result = yield* withSpinner(
					`Listing ${lsEnv}...`,
					ossList({ env: lsEnv, prefix: lsPrefix }),
				);
				if (result.objects.length === 0) {
					yield* Console.log(`${lsEnv}: no objects found`);
					return;
				}
				const tree = buildKeyTree(result.objects as { key: string; size?: number }[]);
				for (const line of tree) {
					yield* Console.log(line);
				}
				if (result.isTruncated) {
					yield* Console.log(`  ... (truncated, more objects available)`);
				}
				yield* Console.log(`${lsEnv}: ${result.objects.length} objects`);
				return;
			}
			case "sync": {
				if (hasHelp(rest)) {
					yield* Console.log(ossSyncUsage());
					return;
				}
				const env = parseOssEnv(rest, "dev");
				const full = rest.includes("--full");
				const verify = rest.includes("--verify");
				const showUrls = !rest.includes("--no-urls");
				const stderr = process.stderr;
				const isTTY = stderr.isTTY;
				const frames = ["◐", "◓", "◑", "◒"];
				let frame = 0;
				const actionIcon: Record<string, string> = {
					checking: " ",
					uploading: "↑",
					skipping: "→",
					error: "✗",
				};
				let lastTotal = 0;
				const onProgress = (info: {
					current: number;
					total: number;
					file: string;
					action: string;
				}) => {
					lastTotal = info.total;
					if (!isTTY) return;
					const icon = actionIcon[info.action] ?? " ";
					const spinner = frames[frame++ % frames.length];
					const pct = Math.round((info.current / info.total) * 100);
					const barWidth = 16;
					const filled = Math.round((info.current / info.total) * barWidth);
					const bar = "█".repeat(filled) + "░".repeat(Math.max(0, barWidth - filled));
					const label = `  ${spinner} ${env} [${bar}] ${pct}%  ${icon} ${info.file}    `;
					stderr.write(`\r${label}`);
				};
				const result = yield* ossSync({ env, full, verify, onProgress });
				if (isTTY && lastTotal > 0) {
					stderr.write("\r\x1b[2K");
				}
				if (result.errors.length > 0) {
					for (const err of result.errors) {
						yield* Console.error(`  error: ${err}`);
					}
				}
				const dur =
					result.durationMs >= 1000
						? `${(result.durationMs / 1000).toFixed(1)}s`
						: `${result.durationMs}ms`;
				yield* Console.log(
					`  ✓ ${env} synced · ${result.uploaded} uploaded · ${result.skipped} skipped · ${dur}`,
				);
				if (showUrls) {
					const base = result.endpoint.replace(/\/+$/, "");
					for (const key of result.allKeys) {
						yield* Console.log(`    ${base}/${key}`);
					}
				}
				return;
			}
			case "status": {
				if (hasHelp(rest)) {
					yield* Console.log(ossStatusUsage());
					return;
				}
				const env = parseOssEnv(rest, "dev");
				const result = yield* withSpinner("Checking OSS status...", ossStatus({ env }));
				yield* Console.log(`env: ${result.env}`);
				yield* Console.log(`total local files: ${result.totalLocal}`);
				yield* Console.log(`manifest entries: ${result.manifestEntries}`);
				yield* Console.log(`pending uploads: ${result.pendingUploads}`);
				yield* Console.log(`pending deletions: ${result.pendingDeletions}`);
				yield* Console.log(`manifest: ${result.manifestPath}`);
				return;
			}
			case "setup": {
				if (hasHelp(rest)) {
					yield* Console.log(ossSetupUsage());
					return;
				}
				const env = parseOssEnv(rest, "default");
				const endpoint = parseFlag(rest, "--endpoint");
				const region = parseFlag(rest, "--region");
				const bucket = parseFlag(rest, "--bucket");
				const localDir = parseFlag(rest, "--local-dir");
				const remotePrefix = parseFlag(rest, "--remote-prefix");

				if (!endpoint && !region && !bucket && !localDir && remotePrefix === undefined) {
					const wrote = yield* withSpinner("Checking OSS config...", ossInitBlank());
					if (wrote) {
						yield* Console.log("OSS scaffold written to .fizzy.yaml");
						yield* Console.log(
							"Edit endpoint, region, local_dir, and optionally bucket/remote_prefix in the file",
						);
						yield* Console.log("");
					}
					yield* Console.log(`Configuring keys for [${env}]:`);
					const accessKeyId = yield* promptSecret(`  Access Key ID: `);
					const secretAccessKey = yield* promptSecret(`  Secret Access Key: `);
					if (!accessKeyId || !secretAccessKey) {
						yield* Console.log(
							"Keys not provided — add them later with: fizzyx oss setup --env <name>",
						);
						return;
					}
					yield* withSpinner(
						"Storing credentials...",
						ossStoreCredentials(env, accessKeyId, secretAccessKey),
					);
					yield* Console.log(`Credentials stored in OS keychain (service: fizzyx-oss)`);
					return;
				}

				if (!endpoint || !region || !localDir) {
					throw new Error(ossSetupUsage());
				}

				yield* Console.log(`Configuring OSS [${env}]:`);
				const accessKeyId = yield* promptSecret(`  Access Key ID: `);
				const secretAccessKey = yield* promptSecret(`  Secret Access Key: `);
				if (!accessKeyId || !secretAccessKey) {
					throw new Error("Access Key ID and Secret Access Key are required");
				}

				const input: OssSetupInput = {
					env,
					config: { endpoint, region, ...(bucket ? { bucket } : {}), accessKeyId, secretAccessKey },
					sync: { localDir, remotePrefix: remotePrefix ?? undefined },
				};
				const result = yield* withSpinner("Writing OSS config...", ossSetup(input));
				const resultEnvConfig = result.environments[env];
				if (!resultEnvConfig) throw new Error(`OSS environment "${env}" not found after setup`);
				yield* Console.log(`OSS ${env} config written to ${resultEnvConfig.endpoint}`);
				yield* Console.log(`Credentials stored in OS keychain (service: fizzyx-oss)`);
				return;
			}
			default:
				throw new Error(`unknown oss command: ${command}\n\n${ossUsage()}`);
		}
	});

const parseOssEnv = (args: ReadonlyArray<string>, defaultEnv: string): string => {
	if (args.includes("--prod")) return "prod";
	if (args.includes("--env")) {
		const idx = args.indexOf("--env");
		const val = args[idx + 1];
		if (val) return val;
	}
	return defaultEnv;
};

const parseSetup = (args: ReadonlyArray<string>): SetupProjectConfigInput => {
	const list = args.includes("--list");
	const flags = args.filter((arg) => arg.startsWith("--"));
	const positional = args.filter((arg) => !arg.startsWith("--"));

	if (list) {
		if (flags.length > 1 || positional.length > 0) {
			throw new Error("usage: fizzyx setup --list");
		}
		return { list: true };
	}

	if (flags.length > 0 || positional.length !== 1) {
		throw new Error("usage: fizzyx setup <board-id>");
	}

	return { board: positional[0] };
};

const parseNumber = (value: string | undefined): number => {
	const parsed = Number.parseInt((value || "").replace(/^#/, ""), 10);
	if (!Number.isFinite(parsed)) throw new Error("card number is required");
	return parsed;
};

const parseFlag = (args: ReadonlyArray<string>, name: string): string | undefined => {
	const index = args.indexOf(name);
	if (index < 0 || !args[index + 1]) {
		return undefined;
	}
	return args[index + 1];
};

const firstNonFlag = (args: ReadonlyArray<string>): string | undefined =>
	args.find((arg) => !arg.startsWith("--"));

const promptSecret = (message: string): Effect.Effect<string, Error> =>
	Effect.tryPromise({
		try: () =>
			new Promise<string>((resolve) => {
				const rl = require("node:readline").createInterface({
					input: process.stdin,
					output: process.stderr,
				});
				rl.question(message, (value: string) => {
					rl.close();
					resolve(value.trim());
				});
			}),
		catch: (cause) => new Error(String(cause)),
	});

const readDescription = (path: string) =>
	path === "-"
		? Effect.tryPromise({
				try: () => Bun.stdin.text(),
				catch: (cause) => new Error(`failed to read stdin: ${String(cause)}`),
			})
		: Effect.tryPromise({
				try: () => Bun.file(path).text(),
				catch: (cause) => new Error(`failed to read ${path}: ${String(cause)}`),
			});

const formatStandardizeResult = (result: {
	number: number;
	descriptionUpdated: boolean;
	stepsCreated: number;
	stepsUpdated: number;
	stepsCompleted: number;
}): string =>
	`standardized #${result.number} description=${result.descriptionUpdated ? "yes" : "no"} steps_created=${result.stepsCreated} steps_updated=${result.stepsUpdated} steps_completed=${result.stepsCompleted}`;

type FlowCommentTemplateKind = "done" | "blocked" | "unblocked" | "handoff" | "note";

const isValidCommentTemplateKind = (value: string | undefined): value is FlowCommentTemplateKind =>
	value === "done" ||
	value === "blocked" ||
	value === "unblocked" ||
	value === "handoff" ||
	value === "note";

const isHelpCommand = (value: string | undefined): value is "help" | "--help" | "-h" =>
	value === "help" || value === "--help" || value === "-h";

const hasHelp = (args: ReadonlyArray<string>): boolean => args.some(isHelpCommand);

const topUsage = (): string => `fizzyx <command>

commands:
  setup
  auth
  flow
  oss

Use:
  fizzyx <command> -h
for command help.`;

const setupUsage = (): string => `fizzyx setup <command>

commands:
  setup <board-id>
  setup --list`;

const authUsage = (): string => `fizzyx auth <command>

commands:
  auth login <token>
  auth status
  auth logout
  auth help`;

const flowUsage = (): string => `fizzyx flow <command>

commands:
    sync
    mine [--fresh] [user]
    status [--fresh]
    next [--fresh]
    show <card>
    start <card>
    done <card> [ref]
    block <card> <reason>
    comment-template <kind>
    workflow
    skill
    repair-markdown <card>
    complete-steps <card>
    std <card>
    std-all
    add <user> <title> --desc <file|->
    assign <card> <user> [user...]
    template
    steps-from-desc <card>
    init
    doctor
    flow help`;

const flowSyncUsage = (): string => "fizzyx flow sync";
const flowMineUsage = (): string => "fizzyx flow mine [--fresh] [user]";
const flowStatusUsage = (): string => "fizzyx flow status [--fresh]";
const flowNextUsage = (): string => "fizzyx flow next [--fresh]";
const flowShowUsage = (): string => "fizzyx flow show <card>";
const flowStartUsage = (): string => "fizzyx flow start <card>";
const flowDoneUsage = (): string => "fizzyx flow done <card> [ref]";
const flowBlockUsage = (): string => "fizzyx flow block <card> <reason>";
const flowRepairMarkdownUsage = (): string => "fizzyx flow repair-markdown <card>";
const flowCommentTemplateUsage = (): string => "fizzyx flow comment-template <kind>";
const flowWorkflowUsage = (): string => "fizzyx flow workflow";
const flowSkillUsage = (): string => "fizzyx flow skill";
const flowSkillInitUsage = (): string => "fizzyx flow skill init [--force]";
const flowCompleteStepsUsage = (): string => "fizzyx flow complete-steps <card>";
const flowStdUsage = (): string => "fizzyx flow std <card>  (alias: standardize-card)";
const flowStdAllUsage = (): string => "fizzyx flow std-all  (alias: standardize-board)";
const flowAddUsage = (): string => "fizzyx flow add <user> <title> --desc <file|->";
const flowAssignUsage = (): string => "fizzyx flow assign <card> <user> [user...]";
const flowTemplateUsage = (): string => "fizzyx flow template";
const flowStepsUsage = (): string => "fizzyx flow steps-from-desc <card>";
const flowInitUsage = (): string => "fizzyx flow init";
const flowDoctorUsage = (): string => "fizzyx flow doctor";

const authLoginUsage = (): string => "fizzyx auth login <token>";
const authStatusUsage = (): string => "fizzyx auth status";
const authLogoutUsage = (): string => "fizzyx auth logout";

const ossUsage = (): string => `fizzyx oss <command>

commands:
  ls [--env <name>] [--prefix <prefix>]
  sync [--env <name>] [--full] [--no-urls] [--verify]
  status [--env <name>]
  setup [--env <name> --endpoint <url> --region <region>
         --local-dir <path>] [--bucket <name>] [--remote-prefix <prefix>]`;

const ossLsUsage = (): string =>
	"fizzyx oss ls [--env <name>] [--prefix <prefix>]\n  List objects in the remote bucket";

const ossSyncUsage = (): string =>
	"fizzyx oss sync [--env <name>] [--full] [--no-urls] [--verify]\n  --full: ignore manifest, force full upload\n  --no-urls: suppress file URL output\n  --verify: check remote existence before skipping files";

const ossStatusUsage = (): string => "fizzyx oss status [--env <name>]";

const ossSetupUsage = (): string =>
	`fizzyx oss setup --env <name> --endpoint <url> --region <region> --local-dir <path> [--bucket <name>] [--remote-prefix <prefix>]\n  With no flags: init blank OSS scaffold in .fizzy.yaml, then prompt for keys\n  --bucket and --remote-prefix are optional; omit if endpoint already contains bucket name\nKeys are prompted interactively (not from args) to avoid shell history.`;
