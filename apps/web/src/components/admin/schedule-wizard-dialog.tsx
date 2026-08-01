import { Button } from "@scholar-seek/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@scholar-seek/ui/components/dialog";
import { Input } from "@scholar-seek/ui/components/input";
import { Label } from "@scholar-seek/ui/components/label";
import { MultiSelect } from "@scholar-seek/ui/components/multi-select";
import { cn } from "@scholar-seek/ui/lib/utils";
import { useState } from "react";
import { toast } from "sonner";
import {
	type CrawlSource,
	type CreateScheduleInput,
	type Schedule,
	type TargetInput,
	type TargetSubmitInput,
	useCreateSchedule,
	useUpdateSchedule,
} from "../../lib/hooks/use-schedules";
import {
	categoryOptionsFor,
	useTaxonomies,
} from "../../lib/hooks/use-taxonomies";

const SOURCES: { value: CrawlSource; label: string }[] = [
	{ value: "arxiv", label: "arXiv" },
	{ value: "semantic_scholar", label: "Semantic Scholar" },
	{ value: "doaj", label: "DOAJ" },
];

const SOURCE_LABELS: Record<string, string> = {
	arxiv: "arXiv",
	semantic_scholar: "Semantic Scholar",
	doaj: "DOAJ",
};

export function sourceLabel(source: string): string {
	return SOURCE_LABELS[source] ?? source;
}

const STEP_LABELS: Record<number, string> = {
	1: "Name & cadence",
	2: "Targets",
	3: "Review & save",
};

export function distinctSources(schedule: Schedule): string[] {
	return Array.from(new Set(schedule.targets.map((t) => t.source)));
}

type CadenceMode = "daily" | "weekly" | "custom";

const CADENCE_MODES: CadenceMode[] = ["daily", "weekly", "custom"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DEFAULT_TIME = "03:00";
const WHITESPACE_PATTERN = /\s+/;
const NUMBER_PATTERN = /^\d+$/;
const WEEKDAY_PATTERN = /^[0-6]$/;

function pad(n: number): string {
	return String(n).padStart(2, "0");
}

function isNum(v: string): boolean {
	return NUMBER_PATTERN.test(v);
}

function parseCron(cron: string): {
	mode: CadenceMode;
	time: string;
	weekday: number;
} {
	const parts = cron.trim().split(WHITESPACE_PATTERN);
	if (parts.length === 5) {
		const [minute, hour, dom, month, dow] = parts;
		if (
			dom === "*" &&
			month === "*" &&
			dow === "*" &&
			isNum(minute) &&
			isNum(hour)
		) {
			return {
				mode: "daily",
				time: `${pad(Number(hour))}:${pad(Number(minute))}`,
				weekday: 0,
			};
		}
		if (
			dom === "*" &&
			month === "*" &&
			WEEKDAY_PATTERN.test(dow) &&
			isNum(minute) &&
			isNum(hour)
		) {
			return {
				mode: "weekly",
				time: `${pad(Number(hour))}:${pad(Number(minute))}`,
				weekday: Number(dow),
			};
		}
	}
	return { mode: "custom", time: DEFAULT_TIME, weekday: 0 };
}

function buildCron(mode: CadenceMode, time: string, weekday: number): string {
	const [hh, mm] = time.split(":").map(Number);
	if (mode === "daily") {
		return `${mm} ${hh} * * *`;
	}
	return `${mm} ${hh} * * ${weekday}`;
}

export function describeCron(cron: string): string {
	const { mode, time, weekday } = parseCron(cron);
	if (mode === "daily") {
		return `Daily at ${time}`;
	}
	if (mode === "weekly") {
		return `Weekly on ${WEEKDAYS[weekday]} at ${time}`;
	}
	return "Custom cron";
}

function emptyTarget(): TargetInput {
	return { label: "", maxRecords: 2000 };
}

// TanStack Start's SSR hydration revives ISO-8601-looking strings as real
// Date objects before they reach this component, so `since`/`until` can
// arrive as either a "YYYY-MM-DD" string or a Date — `<input type="date">`
// rejects anything else (and silently renders blank), so always normalize
// to the plain 10-char form it needs.
function toDateInputValue(value: unknown): string | undefined {
	if (!value) {
		return undefined;
	}
	const str = value instanceof Date ? value.toISOString() : String(value);
	return str.slice(0, 10);
}

function targetInputFromSchedule(schedule: Schedule): TargetInput[] {
	return schedule.targets.map((t) => ({
		source: t.source as CrawlSource,
		label: t.label,
		query: t.query ?? undefined,
		categories: t.categories ?? undefined,
		maxRecords: t.maxRecords,
		since: toDateInputValue(t.since),
		until: toDateInputValue(t.until),
		language: t.language ?? undefined,
	}));
}

function targetErrors(target: TargetInput): string[] {
	const errors: string[] = [];
	if (!target.source) {
		errors.push("Choose a source");
	}
	if (!target.label.trim()) {
		errors.push("Label is required");
	}
	if (target.source === "semantic_scholar" && !target.query?.trim()) {
		errors.push("Query is required for Semantic Scholar");
	}
	if (target.since && target.until && target.since > target.until) {
		errors.push('"Since" must be before "Until"');
	}
	return errors;
}

export function ScheduleWizardDialog({
	mode,
	schedule,
	trigger,
}: {
	mode: "create" | "edit";
	schedule?: Schedule;
	trigger: React.ReactElement;
}) {
	const [open, setOpen] = useState(false);
	const [step, setStep] = useState(1);
	const [name, setName] = useState(schedule?.name ?? "");
	const initialCadence = parseCron(schedule?.cronPattern ?? "0 3 * * *");
	const [cadenceMode, setCadenceMode] = useState<CadenceMode>(
		initialCadence.mode
	);
	const [time, setTime] = useState(initialCadence.time);
	const [weekday, setWeekday] = useState(initialCadence.weekday);
	const [cronPattern, setCronPattern] = useState(
		schedule?.cronPattern ?? "0 3 * * *"
	);
	const [targets, setTargets] = useState<TargetInput[]>(
		schedule ? targetInputFromSchedule(schedule) : [emptyTarget()]
	);
	const [attemptedNext, setAttemptedNext] = useState(false);
	const createSchedule = useCreateSchedule();
	const updateSchedule = useUpdateSchedule();
	const { data: taxonomies } = useTaxonomies();

	function resetForm() {
		const cadence = parseCron(schedule?.cronPattern ?? "0 3 * * *");
		setStep(1);
		setName(schedule?.name ?? "");
		setCadenceMode(cadence.mode);
		setTime(cadence.time);
		setWeekday(cadence.weekday);
		setCronPattern(schedule?.cronPattern ?? "0 3 * * *");
		setTargets(schedule ? targetInputFromSchedule(schedule) : [emptyTarget()]);
		setAttemptedNext(false);
	}

	function handleOpenChange(next: boolean) {
		setOpen(next);
		// Re-sync from the current `schedule` prop both when opening (so a
		// just-saved edit is reflected, not whatever was left over from
		// before the save) and when closing (discard unsaved changes).
		resetForm();
	}

	function handleCadenceModeChange(next: CadenceMode) {
		setCadenceMode(next);
		if (next !== "custom") {
			setCronPattern(buildCron(next, time, weekday));
		}
	}

	function handleTimeChange(next: string) {
		setTime(next);
		if (cadenceMode !== "custom") {
			setCronPattern(buildCron(cadenceMode, next, weekday));
		}
	}

	function handleWeekdayChange(next: number) {
		setWeekday(next);
		if (cadenceMode !== "custom") {
			setCronPattern(buildCron(cadenceMode, time, next));
		}
	}

	function updateTarget(index: number, patch: Partial<TargetInput>) {
		setTargets((prev) =>
			prev.map((t, i) => (i === index ? { ...t, ...patch } : t))
		);
	}

	function addTarget() {
		setTargets((prev) => [...prev, emptyTarget()]);
	}

	function removeTarget(index: number) {
		setTargets((prev) => prev.filter((_, i) => i !== index));
	}

	const targetsValid = targets.every((t) => targetErrors(t).length === 0);
	const nameValid = name.trim().length > 0 && cronPattern.trim().length > 0;

	function handleNext() {
		setAttemptedNext(true);
		if (step === 1 && nameValid) {
			setStep(2);
			setAttemptedNext(false);
		} else if (step === 2 && targetsValid) {
			setStep(3);
			setAttemptedNext(false);
		}
	}

	function handleBack() {
		setAttemptedNext(false);
		setStep((s) => Math.max(1, s - 1));
	}

	async function handleSave() {
		const submitTargets: TargetSubmitInput[] = targets.map((t) => ({
			source: t.source as CrawlSource,
			label: t.label.trim(),
			query: t.query?.trim() ? t.query.trim() : undefined,
			categories: t.categories?.length ? t.categories : undefined,
			maxRecords: t.maxRecords,
			since: t.since || undefined,
			until: t.until || undefined,
			language: t.language?.trim() ? t.language.trim() : undefined,
		}));
		const input: CreateScheduleInput = {
			name: name.trim(),
			cronPattern: cronPattern.trim(),
			targets: submitTargets,
		};
		try {
			if (mode === "create") {
				await createSchedule.mutateAsync(input);
				toast.success("Schedule created");
			} else if (schedule) {
				await updateSchedule.mutateAsync({ id: schedule.id, ...input });
				toast.success("Schedule updated");
			}
			handleOpenChange(false);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Save failed");
		}
	}

	const isPending = createSchedule.isPending || updateSchedule.isPending;
	const distinctSourcesInForm = Array.from(
		new Set(targets.map((t) => t.source).filter((s): s is CrawlSource => !!s))
	);
	const combinedMaxRecords = targets.reduce(
		(sum, t) => sum + (t.maxRecords || 0),
		0
	);

	return (
		<Dialog onOpenChange={handleOpenChange} open={open}>
			<DialogTrigger render={trigger} />
			<DialogContent className="max-w-2xl">
				<DialogHeader>
					<DialogTitle>
						{mode === "create" ? "New schedule" : `Edit ${schedule?.name}`}
					</DialogTitle>
					<DialogDescription>
						Step {step} of 3: {STEP_LABELS[step]}
					</DialogDescription>
				</DialogHeader>

				{step === 1 && (
					<div className="flex flex-col gap-3">
						<div className="flex flex-col gap-1">
							<Label htmlFor="schedule-name">Name</Label>
							<Input
								id="schedule-name"
								onChange={(e) => setName(e.target.value)}
								value={name}
							/>
							{attemptedNext && !name.trim() && (
								<p className="text-destructive text-xs">Name is required</p>
							)}
						</div>
						<div className="flex flex-col gap-1.5">
							<Label>Cadence</Label>
							<div className="flex w-fit border">
								{CADENCE_MODES.map((cadence) => (
									<button
										className={cn(
											"px-3 py-1.5 font-medium text-xs capitalize",
											cadenceMode === cadence
												? "bg-primary text-primary-foreground"
												: "text-muted-foreground hover:bg-muted"
										)}
										key={cadence}
										onClick={() => handleCadenceModeChange(cadence)}
										type="button"
									>
										{cadence}
									</button>
								))}
							</div>
						</div>

						{cadenceMode === "custom" ? (
							<div className="flex flex-col gap-1">
								<Label htmlFor="schedule-cron">Cron pattern</Label>
								<Input
									id="schedule-cron"
									onChange={(e) => setCronPattern(e.target.value)}
									placeholder="0 3 * * *"
									value={cronPattern}
								/>
							</div>
						) : (
							<div className="flex flex-wrap items-end gap-3">
								{cadenceMode === "weekly" && (
									<div className="flex flex-col gap-1">
										<Label htmlFor="schedule-weekday">Day</Label>
										<select
											className="h-8 border bg-background px-2 text-xs"
											id="schedule-weekday"
											onChange={(e) =>
												handleWeekdayChange(Number(e.target.value))
											}
											value={weekday}
										>
											{WEEKDAYS.map((day, i) => (
												<option key={day} value={i}>
													{day}
												</option>
											))}
										</select>
									</div>
								)}
								<div className="flex flex-col gap-1">
									<Label htmlFor="schedule-time">At</Label>
									<input
										className="h-8 w-28 border bg-background px-2 text-xs"
										id="schedule-time"
										onChange={(e) => handleTimeChange(e.target.value)}
										type="time"
										value={time}
									/>
								</div>
							</div>
						)}

						<div className="flex flex-col gap-0.5 border bg-muted/50 px-2.5 py-2 text-muted-foreground text-xs">
							<span>{describeCron(cronPattern)}</span>
							<span className="font-mono">{cronPattern}</span>
						</div>

						{attemptedNext && !cronPattern.trim() && (
							<p className="text-destructive text-xs">
								Cron pattern is required
							</p>
						)}
					</div>
				)}

				{step === 2 && (
					<div className="flex flex-col gap-3">
						{targets.map((target, i) => {
							const errors = attemptedNext ? targetErrors(target) : [];
							return (
								<div
									className="flex flex-col gap-2 border p-3"
									// biome-ignore lint/suspicious/noArrayIndexKey: target rows have no stable id until saved
									key={i}
								>
									<div className="flex items-center justify-between">
										<Label>Source</Label>
										<Button
											disabled={targets.length === 1}
											onClick={() => removeTarget(i)}
											size="xs"
											type="button"
											variant="ghost"
										>
											Remove
										</Button>
									</div>
									<select
										className="h-8 border bg-background px-2 text-xs"
										onChange={(e) =>
											updateTarget(i, {
												source: (e.target.value || undefined) as
													| CrawlSource
													| undefined,
												categories: [],
											})
										}
										value={target.source ?? ""}
									>
										<option value="">Choose a source...</option>
										{SOURCES.map((s) => (
											<option key={s.value} value={s.value}>
												{s.label}
											</option>
										))}
									</select>

									<Input
										onChange={(e) => updateTarget(i, { label: e.target.value })}
										placeholder="Label"
										value={target.label}
									/>

									{target.source === "semantic_scholar" && (
										<Input
											aria-invalid={errors.includes(
												"Query is required for Semantic Scholar"
											)}
											onChange={(e) =>
												updateTarget(i, { query: e.target.value })
											}
											placeholder="Query (required)"
											value={target.query ?? ""}
										/>
									)}

									<MultiSelect
										disabled={!target.source}
										onValueChange={(categories) =>
											updateTarget(i, { categories })
										}
										options={categoryOptionsFor(target.source, taxonomies)}
										placeholder="Categories (optional)"
										searchPlaceholder="Search categories..."
										value={target.categories ?? []}
									/>

									<div className="flex flex-col gap-1">
										<Label>Date range (optional)</Label>
										<div className="flex gap-2">
											<input
												className="h-8 flex-1 border bg-background px-2 text-xs"
												onChange={(e) =>
													updateTarget(i, {
														since: e.target.value || undefined,
													})
												}
												type="date"
												value={target.since ?? ""}
											/>
											<input
												className="h-8 flex-1 border bg-background px-2 text-xs"
												onChange={(e) =>
													updateTarget(i, {
														until: e.target.value || undefined,
													})
												}
												type="date"
												value={target.until ?? ""}
											/>
										</div>
										<p className="text-[11px] text-muted-foreground">
											Leave blank to crawl incrementally since this target's
											last successful run. Set both to fetch a fixed period on
											every run instead.
										</p>
									</div>

									{target.source === "doaj" && (
										<div className="flex flex-col gap-1">
											<Label htmlFor={`target-language-${i}`}>
												Language filter (optional)
											</Label>
											<Input
												id={`target-language-${i}`}
												onChange={(e) =>
													updateTarget(i, { language: e.target.value })
												}
												placeholder="Leave blank for all languages"
												value={target.language ?? ""}
											/>
											<p className="text-[11px] text-muted-foreground">
												ISO 639-2 code, e.g. "eng" for English, "ind" for
												Indonesian.
											</p>
										</div>
									)}

									<Input
										min={1}
										onChange={(e) =>
											updateTarget(i, { maxRecords: Number(e.target.value) })
										}
										placeholder="Max records"
										type="number"
										value={target.maxRecords}
									/>

									{errors.length > 0 && (
										<ul className="text-destructive text-xs">
											{errors.map((e) => (
												<li key={e}>{e}</li>
											))}
										</ul>
									)}
								</div>
							);
						})}
						<Button
							onClick={addTarget}
							size="sm"
							type="button"
							variant="outline"
						>
							+ Add target
						</Button>
					</div>
				)}

				{step === 3 && (
					<div className="flex flex-col gap-2 text-sm">
						<div className="flex justify-between">
							<span className="text-muted-foreground">Targets</span>
							<span className="font-medium">{targets.length}</span>
						</div>
						<div className="flex justify-between">
							<span className="text-muted-foreground">Sources</span>
							<span className="font-medium">
								{distinctSourcesInForm.map(sourceLabel).join(", ")}
							</span>
						</div>
						<div className="flex justify-between">
							<span className="text-muted-foreground">
								Combined max records
							</span>
							<span className="font-medium">
								{combinedMaxRecords.toLocaleString()}
							</span>
						</div>
						{targets.some((t) => t.since || t.until) && (
							<div className="flex justify-between">
								<span className="text-muted-foreground">Date range</span>
								<span className="font-medium">
									{targets.filter((t) => t.since || t.until).length} target(s)
									use a fixed period
								</span>
							</div>
						)}
						{targets.some((t) => t.language) && (
							<div className="flex justify-between">
								<span className="text-muted-foreground">Language filter</span>
								<span className="font-medium">
									{targets
										.filter((t) => t.language)
										.map((t) => t.language)
										.join(", ")}
								</span>
							</div>
						)}
					</div>
				)}

				<DialogFooter>
					{step > 1 && (
						<Button onClick={handleBack} type="button" variant="outline">
							Back
						</Button>
					)}
					{step < 3 && (
						<Button onClick={handleNext} type="button">
							Next
						</Button>
					)}
					{step === 3 && (
						<Button disabled={isPending} onClick={handleSave} type="button">
							{isPending ? "Saving..." : "Save schedule"}
						</Button>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
