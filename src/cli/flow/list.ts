import { Console, Effect, Option } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { listFlowCards } from "../../use-cases/flow-service";
import { printCards } from "../render";
import { runWithFlowRuntimeEnv } from "../flow-workflow";
import { flowJson } from "../flow-json";

const handleList = (config: {
	indexedBy: Option.Option<string>;
	search: Option.Option<string>;
	all: boolean;
	json: boolean;
}): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		const cards = yield* runWithFlowRuntimeEnv("Loading cards...", (env) =>
			listFlowCards(env, {
				indexedBy: Option.getOrUndefined(config.indexedBy),
				search: Option.getOrUndefined(config.search),
				all: config.all,
			}),
		);
		yield* Console.log(
			config.json
				? flowJson(cards, `${cards.length} card(s)`, [
						{ action: "show", cmd: "fizzyx flow show <card>", description: "View a card" },
					])
				: printCards(cards),
		);
	});

export const flowListCmd = Command.make(
	"list",
	{
		indexedBy: Flag.string("indexed-by").pipe(
			Flag.withDescription("Fizzy lane such as closed, not_now, maybe, or golden"),
			Flag.optional,
		),
		search: Flag.string("search").pipe(
			Flag.withDescription("Filter cards by space-separated terms"),
			Flag.optional,
		),
		all: Flag.boolean("all").pipe(Flag.withDescription("Request all matching cards")),
		json: Flag.boolean("json").pipe(Flag.withDescription("Print cards as JSON")),
	},
	handleList,
).pipe(Command.withDescription("List cards on the configured board"));
