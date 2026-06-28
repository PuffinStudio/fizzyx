import { Console, Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { DEFAULT_PLANNER_PORT } from "../planner/index";
import { loadPlannerSnapshot } from "../use-cases/planner-service";
import { formatPlannerSnapshotJson } from "./planner-output";

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

const plannerSnapshotCommand = Command.make("snapshot", {}, () =>
	Effect.gen(function* () {
		const snapshot = yield* loadPlannerSnapshot();
		yield* Console.log(formatPlannerSnapshotJson(snapshot));
	}),
).pipe(Command.withDescription("Print planner snapshot JSON"));

export const plannerCmd = Command.make("planner").pipe(
	Command.withDescription("Planner dashboard and maintenance tools"),
	Command.withSubcommands([plannerStartCommand, plannerSnapshotCommand]),
);
