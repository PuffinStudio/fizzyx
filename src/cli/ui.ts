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

/**
 * Colour is for a person at a terminal. Piped output is read by programs and agents, where
 * escape codes are noise that has to be stripped or paid for.
 */
const colorEnabled = (): boolean => !process.env.NO_COLOR && Boolean(process.stdout?.isTTY);

const paint = (codes: string, text: string): string =>
  colorEnabled() ? `${codes}${text}${RESET}` : text;

export const ui = {
  info: (msg: string): string => `${paint(BLUE, "ℹ")} ${msg}`,
  success: (msg: string): string => `${paint(GREEN, "✓")} ${msg}`,
  warn: (msg: string): string => `${paint(YELLOW, "⚠")} ${msg}`,
  error: (msg: string): string => `${paint(RED, "✗")} ${msg}`,
  highlight: (msg: string): string => paint(BOLD, msg),
  dim: (msg: string): string => paint(DIM, msg),
  cmd: (msg: string): string => paint(CYAN, msg),
  label: (msg: string): string => paint(MAGENTA, msg),

  header: (msg: string): string => paint(`${BOLD}${CYAN}`, msg),

  kv: (key: string, value: string | number): string =>
    `  ${paint(DIM, `${key}:`)} ${paint(BOLD, String(value))}`,
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
