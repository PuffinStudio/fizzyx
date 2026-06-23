import { Console, Effect } from "effect";
import { withSpinner as withSpinnerOriginal } from "./spinner";

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const BLUE = "\x1b[34m";
const MAGENTA = "\x1b[35m";
const CYAN = "\x1b[36m";

export const ui = {
	info: (msg: string): string => `${BLUE}ℹ${RESET} ${msg}`,
	success: (msg: string): string => `${GREEN}✓${RESET} ${msg}`,
	warn: (msg: string): string => `${YELLOW}⚠${RESET} ${msg}`,
	error: (msg: string): string => `${RED}✗${RESET} ${msg}`,
	highlight: (msg: string): string => `${BOLD}${msg}${RESET}`,
	dim: (msg: string): string => `${DIM}${msg}${RESET}`,
	cmd: (msg: string): string => `${CYAN}${msg}${RESET}`,
	label: (msg: string): string => `${MAGENTA}${msg}${RESET}`,

	header: (msg: string): string => `${BOLD}${CYAN}${msg}${RESET}`,

	kv: (key: string, value: string | number): string =>
		`  ${DIM}${key}:${RESET} ${BOLD}${value}${RESET}`,
};

export const logInfo = (msg: string) => Console.log(ui.info(msg));
export const logSuccess = (msg: string) => Console.log(ui.success(msg));
export const logWarn = (msg: string) => Console.log(ui.warn(msg));
export const logError = (msg: string) => Console.error(ui.error(msg));
export const logDim = (msg: string) => Console.log(ui.dim(msg));
export const logHeader = (msg: string) => Console.log(ui.header(msg));
export const logKv = (key: string, value: string | number) => Console.log(ui.kv(key, value));

export const logEmptyLine = () => Console.log("");

export const withSpinner = <A, E, R>(message: string, effect: Effect.Effect<A, E, R>) =>
	withSpinnerOriginal(message, effect, { showStatusLine: true });
