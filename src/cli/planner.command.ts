import { Console, Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { DEFAULT_PLANNER_PORT } from "../planner/index";
import { loadPlannerSnapshot, repairPlannerMetadata } from "../use-cases/planner-service";
import {
	formatPlannerSnapshotJson,
	formatPlannerHealthResult,
	formatCheckingPlannerHealthMessage,
	formatRepairMetadataChange,
	formatRepairMetadataReminder,
	formatRepairMetadataSummary,
} from "./planner-output";
import { withSpinner } from "./ui";

const handlePlannerHealth = (): Effect.Effect<void, any, any> =>
	withSpinner(formatCheckingPlannerHealthMessage(), loadPlannerSnapshot()).pipe(
		Effect.flatMap((snapshot) => Console.log(formatPlannerHealthResult(snapshot))),
	);

const handlePlannerStart = ({
	port,
}: {
	readonly port?: number;
}): Effect.Effect<void, Error, never> =>
	Effect.gen(function* () {
		yield* Effect.tryPromise({
			try: async () => {
				const { startPlannerServer } = await import("../planner/index");
				const serverOptions =
					typeof port === "number" && Number.isInteger(port)
						? {
								port,
							}
						: {};

				await startPlannerServer(serverOptions);
			},
			catch: (cause) =>
				new Error(
					`failed to start planner service: ${cause instanceof Error ? cause.message : String(cause)}`,
				),
		});

		yield* Effect.never;
	});

const plannerPortFlag = () =>
	Flag.integer("port").pipe(
		Flag.withAlias("p"),
		Flag.withDefault(DEFAULT_PLANNER_PORT),
		Flag.withDescription("Port to bind the planner server on (defaults to 24512)"),
	);

const plannerStartCommand = Command.make(
	"start",
	{
		port: plannerPortFlag(),
	},
	handlePlannerStart,
).pipe(Command.withDescription("Start the planner web service"));

const plannerHealthCommand = Command.make("health", {}, handlePlannerHealth).pipe(
	Command.withDescription("Check planner health summary"),
);

const plannerSnapshotCommand = Command.make(
	"snapshot",
	{
		autoFix: Flag.boolean("auto-fix").pipe(
			Flag.withDescription("Apply missing planner metadata repairs before snapshot"),
		),
		defaultPriority: Flag.choice("default-priority", ["p0", "p1", "p2"] as const).pipe(
			Flag.withDescription("Default priority for cards without priority metadata"),
			Flag.optional,
		),
		defaultType: Flag.string("default-type").pipe(
			Flag.withDescription("Default type for cards without type metadata"),
			Flag.optional,
		),
	},
	({ autoFix, defaultPriority, defaultType }) =>
		Effect.gen(function* () {
			if (autoFix) {
				const result = yield* repairPlannerMetadata({
					apply: true,
					defaultPriority: defaultPriority._tag === "Some" ? defaultPriority.value : undefined,
					defaultType: defaultType._tag === "Some" ? defaultType.value : undefined,
				});
				yield* Console.log(formatRepairMetadataSummary(result));
				for (const change of result.changes.filter((item) => item.action === "tag_card")) {
					yield* Console.log(
						formatRepairMetadataChange(
							change.cardNumber,
							change.action,
							change.reason,
							change.title,
						),
					);
				}
				if (result.changes.length === 0) {
					yield* Console.log(formatRepairMetadataReminder());
				}
			}

			const snapshot = yield* loadPlannerSnapshot();
			yield* Console.log(formatPlannerSnapshotJson(snapshot));
		}),
).pipe(Command.withDescription("Print planner snapshot JSON"));

const plannerRepairMetadataCommand = Command.make(
	"repair-metadata",
	{
		apply: Flag.boolean("apply").pipe(
			Flag.withDescription("Apply metadata repairs to Fizzy cards"),
		),
		defaultPriority: Flag.choice("default-priority", ["p0", "p1", "p2"] as const).pipe(
			Flag.withDescription("Default priority for cards without priority metadata"),
			Flag.optional,
		),
		defaultType: Flag.string("default-type").pipe(
			Flag.withDescription("Default type for cards without type metadata"),
			Flag.optional,
		),
	},
	({ apply, defaultPriority, defaultType }) =>
		Effect.gen(function* () {
			const result = yield* repairPlannerMetadata({
				apply,
				defaultPriority: defaultPriority._tag === "Some" ? defaultPriority.value : undefined,
				defaultType: defaultType._tag === "Some" ? defaultType.value : undefined,
			});
			yield* Console.log(formatRepairMetadataSummary(result));
			for (const change of result.changes.filter((item) => item.action === "tag_card")) {
				yield* Console.log(
					formatRepairMetadataChange(change.cardNumber, change.action, change.reason, change.title),
				);
			}
			if (!apply) {
				yield* Console.log(formatRepairMetadataReminder());
			}
		}),
).pipe(Command.withDescription("Plan or apply planner metadata repairs"));

export const plannerCmd = Command.make("planner").pipe(
	Command.withDescription("Planner dashboard and maintenance tools"),
	Command.withSubcommands([
		plannerStartCommand,
		plannerSnapshotCommand,
		plannerHealthCommand,
		plannerRepairMetadataCommand,
	]),
);
