import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { issueBadgeClass, issueClass } from "./planner-style";
import type { PlannerIssue } from "./planner-types";

type PlannerRepairChange = {
	action?: string;
	cardNumber?: number;
};

const isUpdateDescriptionChange = (
	change: unknown,
): change is PlannerRepairChange & {
	action: "update_description";
	cardNumber: number;
} => {
	if (!change || typeof change !== "object") return false;
	const typed = change as { action?: unknown; cardNumber?: unknown };
	return typed.action === "update_description" && typeof typed.cardNumber === "number";
};

export function HealthView({
	health,
	onRepair,
}: {
	health: PlannerIssue[];
	onRepair?: () => void;
}) {
	const [repairing, setRepairing] = useState(false);
	const [items, setItems] = useState(health);

	useEffect(() => {
		setItems(health);
	}, [health]);

	const repairableCount = items.filter((issue: PlannerIssue) =>
		isRepairableMetadataIssue(issue.code),
	).length;

	const handleRepair = async () => {
		setRepairing(true);
		try {
			const res = await fetch("/api/planner/repair-metadata", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					apply: true,
					defaultPriority: "p2",
					defaultType: "chore",
				}),
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.error || "Repair failed");
			const changes = (
				Array.isArray(data?.changes) ? data.changes : []
			) as readonly PlannerRepairChange[];
			const repairedNumbers = new Set(
				changes
					.filter((change): change is PlannerRepairChange & { cardNumber: number } =>
						isUpdateDescriptionChange(change),
					)
					.map((change) => change.cardNumber),
			);
			const repairedCount = repairedNumbers.size;
			if (repairedCount > 0) {
				setItems((previous) => previous.filter((issue) => !repairedNumbers.has(issue.cardNumber)));
				toast.success(`已修复 ${repairedCount} 张卡并从列表移除`);
				return;
			}

			const count = (
				data.changes?.filter?.(
					(change: { action?: string }) => change.action === "update_description",
				) ?? []
			).length;
			if (data.applied) {
				toast.info(`没有可修复的卡片。`);
			} else {
				toast.info(`检测到 ${count} 张卡需要修复`);
			}
		} catch (cause) {
			toast.error(cause instanceof Error ? cause.message : "Repair failed");
		} finally {
			setRepairing(false);
		}
	};

	return (
		<motion.div
			initial={{ opacity: 0, y: 12 }}
			animate={{ opacity: 1, y: 0 }}
			transition={{ duration: 0.4, ease: "easeOut" }}
		>
			<section className="rounded-xl bg-muted/20 p-4">
				<div className="flex flex-row items-start justify-between gap-4">
					<div>
						<h2 className="text-base font-semibold">Card Health</h2>
						<p className="mt-1 text-sm text-muted-foreground">
							Cards missing metadata or violating workflow expectations.
						</p>
					</div>
					{repairableCount > 0 ? (
						<Button variant="outline" size="sm" onClick={handleRepair} disabled={repairing}>
							{repairing ? "Repairing…" : `Repair All (${repairableCount})`}
						</Button>
					) : null}
					{onRepair ? (
						<Button variant="secondary" size="sm" onClick={() => onRepair()} disabled={repairing}>
							刷新
						</Button>
					) : null}
				</div>
				<div className="mt-4 space-y-2">
					{items.slice(0, 30).map((issue, index) => (
						<motion.div
							key={`${issue.cardNumber}-${issue.code}-${index}`}
							initial={{ opacity: 0, x: -8 }}
							animate={{ opacity: 1, x: 0 }}
							transition={{ delay: index * 0.02, duration: 0.2 }}
							className={`rounded-lg border-l-4 bg-muted/10 p-3 ${issueClass(issue.severity)}`}
						>
							<div className="flex items-start justify-between gap-3">
								<span className="font-medium">
									#{issue.cardNumber} {issue.title}
								</span>
								<Badge className={`${issueBadgeClass(issue.severity)} rounded-full`}>
									{issue.severity}
								</Badge>
							</div>
							<p className="mt-1 text-sm text-muted-foreground">{issue.message}</p>
						</motion.div>
					))}
					{items.length === 0 ? (
						<p className="text-sm text-muted-foreground">No health issues found.</p>
					) : null}
				</div>
			</section>
		</motion.div>
	);
}

const isRepairableMetadataIssue = (code: string): boolean =>
	code === "missing_priority" ||
	code === "invalid_priority" ||
	code === "missing_type" ||
	code === "missing_owner" ||
	code === "multiple_priority";
