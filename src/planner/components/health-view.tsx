import { motion } from "motion/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { issueBadgeClass, issueClass } from "./planner-style";
import type { PlannerIssue } from "./planner-types";

export function HealthView({
	health,
	onRepair,
}: {
	health: ReadonlyArray<PlannerIssue>;
	onRepair?: () => void;
}) {
	const items = health;

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
							Cards missing metadata or violating workflow expectations. Metadata repair is executed
							from `fizzyx flow repair`.
						</p>
					</div>
					{onRepair ? (
						<Button variant="secondary" size="sm" onClick={() => onRepair()}>
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
