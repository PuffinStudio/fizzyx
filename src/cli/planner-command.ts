import { Console, Effect, Option } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { DEFAULT_PLANNER_PORT } from "../planner/index";
import { loadPlannerSnapshot } from "../use-cases/planner-service";
import { formatPlannerSnapshotJson } from "./planner-output";
import { savePlannerChatSignalServer } from "../adapters/app-config";
import { resolveAppConfigPath } from "../adapters/app-paths";

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

const handlePlannerChatConfig = (config: {
	readonly host: string;
	readonly port: Option.Option<number>;
	readonly path: Option.Option<string>;
	readonly insecure: boolean;
	readonly key: Option.Option<string>;
}): Effect.Effect<void, Error, never> =>
	Effect.gen(function* () {
		const server = {
			host: config.host,
			...(Option.isSome(config.port) ? { port: config.port.value } : {}),
			path: Option.isSome(config.path) ? config.path.value : "/",
			secure: !config.insecure,
			...(Option.isSome(config.key) ? { key: config.key.value } : {}),
		};

		yield* Effect.tryPromise({
			try: () => savePlannerChatSignalServer(server),
			catch: (cause) =>
				new Error(
					`failed to save planner chat config: ${
						cause instanceof Error ? cause.message : String(cause)
					}`,
				),
		});
		yield* Console.log(`Planner chat PeerServer saved to ${resolveAppConfigPath()}`);
	});

const plannerChatConfigCommand = Command.make(
	"chat-config",
	{
		host: Flag.string("host").pipe(Flag.withDescription("PeerServer host")),
		port: Flag.optional(
			Flag.integer("port").pipe(Flag.withDescription("PeerServer port, for example 9000")),
		),
		path: Flag.optional(
			Flag.string("path").pipe(Flag.withDescription("PeerServer path, for example /peerjs")),
		),
		insecure: Flag.boolean("insecure").pipe(
			Flag.withDescription("Use ws/http instead of wss/https"),
		),
		key: Flag.optional(Flag.string("key").pipe(Flag.withDescription("PeerServer key"))),
	},
	handlePlannerChatConfig,
).pipe(Command.withDescription("Configure the global planner team chat PeerServer"));

export const plannerCmd = Command.make("planner").pipe(
	Command.withDescription("Planner dashboard and maintenance tools"),
	Command.withSubcommands([plannerStartCommand, plannerSnapshotCommand, plannerChatConfigCommand]),
);
