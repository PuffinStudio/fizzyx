import { Console, Effect } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { searchFlowCards } from "../../use-cases/flow-service";
import { printCards } from "../render";
import { runWithFlowRuntimeEnv } from "../flow-workflow";
import { flowJson } from "../flow-json";

const handleSearch = (config: {
	query: string;
	allBoards: boolean;
	json: boolean;
}): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		const cards = yield* runWithFlowRuntimeEnv("Searching cards...", (env) =>
			searchFlowCards(env, config.query, { allBoards: config.allBoards }),
		);
		yield* Console.log(
			config.json
				? flowJson(cards, `${cards.length} result(s) for ${JSON.stringify(config.query)}`, [
						{ action: "show", cmd: "fizzyx flow show <card>", description: "View a card" },
					])
				: printCards(cards),
		);
	});

export const flowSearchCmd = Command.make(
	"search",
	{
		query: Argument.string("query").pipe(
			Argument.withDescription("Full-text search query"),
			Argument.withMetavar("QUERY"),
		),
		allBoards: Flag.boolean("all-boards").pipe(
			Flag.withDescription("Keep results from every account board"),
		),
		json: Flag.boolean("json").pipe(Flag.withDescription("Print cards as JSON")),
	},
	handleSearch,
).pipe(Command.withDescription("Full-text search cards"));
