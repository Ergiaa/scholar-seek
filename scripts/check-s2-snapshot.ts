/**
 * Checks the size of the most recent Semantic Scholar dataset snapshot.
 *
 * Usage:
 *   bun scripts/check-s2-snapshot.ts [dataset]
 *
 * Without S2_API_KEY, reports the sizes stated in the public release
 * metadata. With S2_API_KEY set, also HEADs the actual download links
 * for the given dataset (default: "papers") and sums exact byte counts.
 */

import { gunzipSync } from "node:zlib";

const API_BASE = "https://api.semanticscholar.org/datasets/v1";
const SAMPLES_BASE = "https://s3-us-west-2.amazonaws.com/ai2-s2ag/samples";

// e.g. "200M records in 30 1.5GB files."
const SIZE_RE = /([\d.]+)([MK]?) records in (\d+) ([\d.]+)(GB|MB) files/;

const GIB = 1024 ** 3;

interface DatasetInfo {
	description: string;
	name: string;
}

interface ReleaseInfo {
	datasets: DatasetInfo[];
	release_id: string;
}

function parseStatedSize(description: string) {
	const m = description.match(SIZE_RE);
	if (!m) {
		return null;
	}
	const [, count, countUnit, files, fileSize, sizeUnit] = m;
	const countMultiplier = { M: 1e6, K: 1e3 }[countUnit ?? ""] ?? 1;
	const records = Number(count) * countMultiplier;
	const totalGb =
		Number(files) * Number(fileSize) * (sizeUnit === "MB" ? 1 / 1024 : 1);
	return { records, files: Number(files), totalGb };
}

function fmtGb(gb: number): string {
	return gb >= 1 ? `${gb.toFixed(1)} GB` : `${(gb * 1024).toFixed(0)} MB`;
}

async function getJson<T>(url: string, apiKey?: string): Promise<T> {
	const res = await fetch(url, {
		headers: apiKey ? { "x-api-key": apiKey } : {},
	});
	if (!res.ok) {
		throw new Error(`GET ${url} -> HTTP ${res.status}: ${await res.text()}`);
	}
	return res.json() as Promise<T>;
}

async function measureExactSize(dataset: string, apiKey: string) {
	const { files } = await getJson<{ files: string[] }>(
		`${API_BASE}/release/latest/dataset/${dataset}`,
		apiKey
	);

	console.log(`\nExact size of "${dataset}" (HEAD on ${files.length} files):`);
	let totalBytes = 0;
	for (const url of files) {
		const res = await fetch(url, { method: "HEAD" });
		const len = Number(res.headers.get("content-length") ?? 0);
		totalBytes += len;
	}
	console.log(
		`  ${files.length} files, ${(totalBytes / GIB).toFixed(2)} GiB compressed total`
	);
}

async function peekSample(dataset: string) {
	// Sample files are public — grab one record to show the schema.
	const res = await fetch(
		`${SAMPLES_BASE}/${dataset}/${dataset}-sample.jsonl.gz`
	);
	if (!res.ok) {
		console.log(`\n(no public sample available for "${dataset}")`);
		return;
	}
	const text = new TextDecoder().decode(
		gunzipSync(new Uint8Array(await res.arrayBuffer()))
	);
	const lines = text.trim().split("\n");
	const record = JSON.parse(lines[0] ?? "{}");
	const avgBytes = text.length / lines.length;

	console.log(
		`\nSample record from "${dataset}" (~${avgBytes.toFixed(0)} bytes/record uncompressed):`
	);
	console.log(JSON.stringify(record, null, 2).slice(0, 2000));
}

const dataset = process.argv[2] ?? "papers";
const apiKey = process.env.S2_API_KEY;

const release = await getJson<ReleaseInfo>(`${API_BASE}/release/latest`);
console.log(`Latest release: ${release.release_id}\n`);
console.log(
	`${"Dataset".padEnd(24)}${"Records".padEnd(11)}${"Files".padEnd(8)}Stated size`
);
console.log("-".repeat(56));

for (const ds of release.datasets) {
	const size = parseStatedSize(ds.description);
	const stats = size
		? `${(size.records / 1e6).toFixed(0)}M`.padEnd(11) +
			`${size.files}`.padEnd(8) +
			fmtGb(size.totalGb)
		: "(size not stated)";
	console.log(ds.name.padEnd(24) + stats);
}

await peekSample(dataset);

if (apiKey) {
	await measureExactSize(dataset, apiKey);
} else {
	console.log(
		"\nSet S2_API_KEY to also measure exact compressed size of the download files."
	);
}
