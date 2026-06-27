/**
 * This file is the entry point for the React app, it sets up the root
 * element and renders the App component to the DOM.
 *
 * It is included in `src/planner/index.html`.
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { NuqsAdapter } from "nuqs/adapters/react";
const elem = document.getElementById("root")!;

const isResizeObserverLoopError = (message: unknown): boolean =>
	typeof message === "string" && message.includes("ResizeObserver loop completed");

window.addEventListener("error", (event) => {
	if (isResizeObserverLoopError(event.message)) {
		event.preventDefault();
		event.stopImmediatePropagation();
	}
});

window.onerror = (message) => {
	if (isResizeObserverLoopError(message)) {
		return true;
	}
};

const app = (
	<StrictMode>
		<ThemeProvider>
			<NuqsAdapter>
				<TooltipProvider>
					<App />
					<Toaster />
				</TooltipProvider>
			</NuqsAdapter>
		</ThemeProvider>
	</StrictMode>
);

// https://bun.com/docs/bundler/hot-reloading#import-meta-hot-data
(import.meta.hot.data.root ??= createRoot(elem)).render(app);
