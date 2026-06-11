import { Effect } from "effect";

type SpinnerWriter = {
	isTTY?: boolean;
	write: (value: string) => void;
};

type SpinnerEnvironment = {
	[envName: string]: string | undefined;
};

export interface SpinnerOptions {
	stderr?: SpinnerWriter;
	env?: SpinnerEnvironment;
	intervalMs?: number;
	showStatusLine?: boolean;
}

const DEFAULT_SPINNER_FRAMES = ["◐", "◓", "◑", "◒"] as const;
const DEFAULT_SPINNER_INTERVAL_MS = 80;
const LINE_CLEAR_SEQUENCE = "\r\x1b[2K";

type SpinnerHandle = {
	stop: () => void;
};

const getSpinnerWriter = (options?: SpinnerOptions): SpinnerWriter =>
	options?.stderr ?? process.stderr;

const getSpinnerEnv = (options?: SpinnerOptions): SpinnerEnvironment => options?.env ?? process.env;

const shouldAnimateSpinner = (options?: SpinnerOptions): boolean => {
	const stderr = getSpinnerWriter(options);
	if (!stderr.isTTY) {
		return false;
	}

	const env = getSpinnerEnv(options);
	if (env.CI || env.NO_COLOR || env.FIZZYX_NO_SPINNER === "1") {
		return false;
	}

	return true;
};

const clearLine = (stderr: SpinnerWriter): void => {
	stderr.write(LINE_CLEAR_SEQUENCE);
};

const startSpinner = (message: string, options: SpinnerOptions): Effect.Effect<SpinnerHandle> => {
	const stderr = getSpinnerWriter(options);
	const interval = options.intervalMs ?? DEFAULT_SPINNER_INTERVAL_MS;

	return Effect.sync(() => {
		let frameIndex = 0;
		const writeFrame = () => {
			const frame = DEFAULT_SPINNER_FRAMES[frameIndex++ % DEFAULT_SPINNER_FRAMES.length];
			stderr.write(`\r${message} ${frame}`);
		};

		writeFrame();
		const timer = setInterval(writeFrame, interval);

		return {
			stop() {
				clearInterval(timer);
				clearLine(stderr);
			},
		};
	});
};

const withStatusLine = <A, E, R>(
	effect: Effect.Effect<A, E, R>,
	message: string,
	options?: SpinnerOptions,
): Effect.Effect<A, E, R> => {
	const stderr = getSpinnerWriter(options);
	return Effect.gen(function* () {
		yield* Effect.sync(() => {
			stderr.write(`${message}\n`);
		});
		return yield* effect;
	});
};

export const withSpinner = <A, E, R>(
	message: string,
	effect: Effect.Effect<A, E, R>,
	options?: SpinnerOptions,
): Effect.Effect<A, E, R> => {
	if (!shouldAnimateSpinner(options)) {
		if (options?.showStatusLine) {
			return withStatusLine(effect, message, options);
		}
		return effect;
	}

	return Effect.gen(function* () {
		const spinner = yield* startSpinner(message, options ?? {});
		return yield* effect.pipe(
			Effect.onExit(() => {
				return Effect.sync(() => {
					spinner.stop();
				});
			}),
		);
	});
};
