import { db } from "@scholar-seek/db";
import { user } from "@scholar-seek/db/schema/auth";
import {
	crawlSchedule,
	crawlScheduleTarget,
} from "@scholar-seek/db/schema/crawl-schedule";
import { eq } from "drizzle-orm";
import { ROOT_ADMIN_ROLE } from "../../lib/auth";

interface DefaultTargetConfig {
	label: string;
	query?: string;
	categories?: string[];
	maxRecords: number;
}

interface DefaultScheduleConfig {
	name: string;
	source: string;
	cronPattern: string;
	targets: DefaultTargetConfig[];
}

// Semantic Scholar's bulk search has no "everything since X" mode — unlike
// arXiv/DOAJ, a query is mandatory (see validateTargetsForSource). A
// handful of broad field-of-study queries gives real daily coverage
// without needing the dynamic single-field-per-day rotation the old
// hardcoded scheduler used.
const SEMANTIC_SCHOLAR_DEFAULT_FIELDS = [
	"Computer Science",
	"Medicine",
	"Biology",
	"Physics",
	"Engineering",
];

// Mirrors the previous hardcoded RECURRING_CRAWLS array — staggered five
// minutes apart so the single-concurrency worker isn't asked to start
// multiple crawls at once. maxRecords is a generous safety cap; the daily
// incremental window (since last successful run) keeps actual volume small.
const DEFAULT_SCHEDULES: DefaultScheduleConfig[] = [
	{
		name: "Daily arXiv crawl",
		source: "arxiv",
		cronPattern: "25 3 * * *",
		targets: [{ label: "arxiv daily", maxRecords: 5000 }],
	},
	{
		name: "Daily DOAJ crawl",
		source: "doaj",
		cronPattern: "30 3 * * *",
		targets: [{ label: "doaj daily", maxRecords: 5000 }],
	},
	{
		name: "Daily Semantic Scholar crawl",
		source: "semantic_scholar",
		cronPattern: "35 3 * * *",
		targets: SEMANTIC_SCHOLAR_DEFAULT_FIELDS.map((field) => ({
			label: `semantic_scholar daily — ${field}`,
			query: field,
			categories: [field],
			maxRecords: 1000,
		})),
	},
];

// Runs once on boot, after the root admin exists. No-op once any schedule
// exists — this only ever seeds the initial set on a fresh database.
export async function ensureDefaultSchedules(): Promise<void> {
	const [existing] = await db
		.select({ id: crawlSchedule.id })
		.from(crawlSchedule)
		.limit(1);
	if (existing) {
		return;
	}

	const [rootAdmin] = await db
		.select({ id: user.id })
		.from(user)
		.where(eq(user.role, ROOT_ADMIN_ROLE));
	if (!rootAdmin) {
		return;
	}

	for (const config of DEFAULT_SCHEDULES) {
		const [schedule] = await db
			.insert(crawlSchedule)
			.values({
				name: config.name,
				source: config.source,
				cron_pattern: config.cronPattern,
				created_by: rootAdmin.id,
			})
			.returning({ id: crawlSchedule.id });

		if (!schedule) {
			continue;
		}

		await db.insert(crawlScheduleTarget).values(
			config.targets.map((t) => ({
				schedule_id: schedule.id,
				label: t.label,
				query: t.query,
				categories: t.categories,
				max_records: t.maxRecords,
			}))
		);
	}

	console.log(`[crawler] seeded ${DEFAULT_SCHEDULES.length} default schedule(s)`);
}
