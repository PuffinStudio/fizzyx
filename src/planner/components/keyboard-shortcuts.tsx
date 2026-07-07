"use client";

import { useEffect, useState } from "react";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogDescription,
} from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";

export type ShortcutAction =
	| "toggleTheme"
	| "refresh"
	| "showShortcuts"
	| "focusSearch"
	| "toggleChat"
	| "showBoards"
	| "previousBoard"
	| "nextBoard"
	| "newCard";

export interface Shortcut {
	key: string;
	description: string;
	action: ShortcutAction;
}

export const SHORTCUTS: Shortcut[] = [
	{ key: "d", description: "Toggle dark/light theme", action: "toggleTheme" },
	{ key: "r", description: "Refresh board data", action: "refresh" },
	{ key: "b", description: "Open board switcher", action: "showBoards" },
	{ key: "[", description: "Previous board", action: "previousBoard" },
	{ key: "]", description: "Next board", action: "nextBoard" },
	{ key: "c", description: "Toggle team chat", action: "toggleChat" },
	{ key: "/", description: "Focus search", action: "focusSearch" },
	{ key: "?", description: "Show keyboard shortcuts", action: "showShortcuts" },
	// { key: "n", description: "Create new card (when available)", action: "newCard" },
];

export function useKeyboardShortcuts(
	onRefresh: () => void,
	onToggleTheme: () => void,
	onFocusSearch?: () => void,
	onToggleChat?: () => void,
	onShowBoards?: () => void,
	onPreviousBoard?: () => void,
	onNextBoard?: () => void,
) {
	const [showShortcuts, setShowShortcuts] = useState(false);

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.repeat) return;
			if (event.metaKey || event.ctrlKey || event.altKey) return;

			const target = event.target as HTMLElement;
			const isEditable =
				target.isContentEditable ||
				target.closest("input, textarea, select, [contenteditable='true']");
			if (isEditable) return;

			const key = event.key.toLowerCase();

			if (key === "r") {
				event.preventDefault();
				onRefresh();
			} else if (key === "?") {
				event.preventDefault();
				setShowShortcuts(true);
			} else if (key === "c" && onToggleChat) {
				event.preventDefault();
				onToggleChat();
			} else if (key === "b" && onShowBoards) {
				event.preventDefault();
				onShowBoards();
			} else if (key === "[" && onPreviousBoard) {
				event.preventDefault();
				onPreviousBoard();
			} else if (key === "]" && onNextBoard) {
				event.preventDefault();
				onNextBoard();
			} else if (key === "/" && onFocusSearch) {
				event.preventDefault();
				onFocusSearch();
			} else if (key === "d") {
				onToggleTheme();
			}
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [
		onRefresh,
		onToggleTheme,
		onToggleChat,
		onFocusSearch,
		onShowBoards,
		onPreviousBoard,
		onNextBoard,
	]);

	return { showShortcuts, setShowShortcuts };
}

export function ShortcutsDialog({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-md sm:max-w-lg">
				<DialogHeader>
					<DialogTitle className="text-lg font-semibold">Keyboard Shortcuts</DialogTitle>
					<DialogDescription className="text-sm text-muted-foreground">
						Press keys to perform actions quickly
					</DialogDescription>
				</DialogHeader>
				<div className="space-y-3">
					{SHORTCUTS.map((shortcut) => (
						<div key={shortcut.action} className="flex items-center justify-between gap-4">
							<span className="text-sm text-foreground">{shortcut.description}</span>
							<Kbd className="flex-shrink-0">{shortcut.key}</Kbd>
						</div>
					))}
				</div>
			</DialogContent>
		</Dialog>
	);
}
