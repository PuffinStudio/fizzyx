import { Spinner } from "@/components/ui/spinner";

export function PlannerLoading() {
	return (
		<div className="grid min-h-[calc(100vh-2rem)] place-items-center rounded-xl bg-muted/20">
			<div className="flex flex-col items-center gap-4 text-center">
				<div className="grid size-14 place-items-center rounded-full bg-muted/45 text-primary">
					<Spinner className="size-7" />
				</div>
				<div>
					<p className="text-lg font-semibold">Loading project data…</p>
					<p className="text-sm text-muted-foreground">
						Reading cached snapshot, then refreshing Fizzy in the background.
					</p>
				</div>
				<div className="grid w-[min(42rem,80vw)] gap-3 md:grid-cols-3">
					{Array.from({ length: 3 }).map((_, index) => (
						<div key={index} className="h-24 animate-pulse rounded-lg bg-muted/45" />
					))}
				</div>
			</div>
		</div>
	);
}
