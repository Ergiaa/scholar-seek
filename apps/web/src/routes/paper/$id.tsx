import { Badge } from "@scholar-seek/ui/components/badge";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@scholar-seek/ui/components/card";
import { Separator } from "@scholar-seek/ui/components/separator";
import { Skeleton } from "@scholar-seek/ui/components/skeleton";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { ArxivAbstract } from "../../components/paper/arxiv-abstract";
import { usePaper, useRelatedPapers } from "../../lib/hooks/use-papers";
import { getSearchState } from "../../lib/search-state";
import { formatDate } from "../../lib/utils";

function getYear(dateString: string): string {
	return new Date(dateString).getFullYear().toString();
}

const paperSchema = z.object({
	id: z.string(),
});

export const Route = createFileRoute("/paper/$id")({
	component: PaperPage,
	params: {
		parse: (params) => paperSchema.parse(params),
	},
	head: ({ params }) => ({
		meta: [
			{ title: `${params.id} - Scholar Seek` },
			{ name: "description", content: "View paper details" },
		],
	}),
});

function PaperPage() {
	const { id } = Route.useParams();
	const { data: paper, isLoading, error } = usePaper(id);
	const { data: related } = useRelatedPapers(id);
	const [backPath, setBackPath] = useState("/search");

	useEffect(() => {
		const searchState = getSearchState();
		if (searchState?.url) {
			try {
				const { pathname, search } = new URL(searchState.url);
				setBackPath(pathname + search);
			} catch {
				setBackPath(searchState.url);
			}
		}
	}, []);

	useEffect(() => {
		if (paper) {
			document.title = `${paper.title} - Scholar Seek`;
		}
	}, [paper]);

	if (isLoading) {
		return (
			<div className="container mx-auto px-4 py-8">
				<div className="mx-auto max-w-3xl space-y-6">
					<Skeleton className="h-8 w-3/4" />
					<Skeleton className="h-4 w-1/2" />
					<Skeleton className="h-32 w-full" />
				</div>
			</div>
		);
	}

	if (error || !paper) {
		return (
			<div className="container mx-auto px-4 py-8">
				<div className="py-12 text-center">
					<p className="text-destructive">Error loading paper</p>
					<Link className="text-primary hover:underline" to="/search">
						Back to search
					</Link>
				</div>
			</div>
		);
	}

	return (
		<div className="container mx-auto px-4 py-8">
			<div className="mx-auto max-w-3xl space-y-6">
				<div>
					<Link
						className="text-muted-foreground text-sm transition-colors hover:text-foreground"
						to={backPath}
					>
						← Back to search
					</Link>
					<h1 className="mt-4 font-bold text-3xl leading-tight">
						{paper.title}
					</h1>
					<div className="mt-4 flex flex-wrap gap-1.5">
						{paper.authors.map((author) => (
							<Link key={author} search={{ author, q: author }} to="/search">
								<Badge
									className="cursor-pointer transition-[transform,background-color] hover:scale-105 hover:bg-secondary/80"
									variant="secondary"
								>
									{author}
								</Badge>
							</Link>
						))}
					</div>
				</div>

				<Separator />

				<Card variant="elevated">
					<CardHeader>
						<CardTitle>Abstract</CardTitle>
					</CardHeader>
					<CardContent>
						{paper.abstract ? (
							<ArxivAbstract
								className="text-muted-foreground leading-relaxed"
								text={paper.abstract}
							/>
						) : (
							<p className="text-muted-foreground">No abstract available</p>
						)}
					</CardContent>
				</Card>

				<Card variant="elevated">
					<CardHeader>
						<CardTitle>Details</CardTitle>
					</CardHeader>
					<CardContent className="space-y-3">
						<div className="flex items-start justify-between gap-4">
							<span className="shrink-0 text-muted-foreground">Journal</span>
							<span className="break-words text-right font-medium">
								{paper.journal ?? (
									<span className="text-muted-foreground">—</span>
								)}
							</span>
						</div>
						<div className="flex items-center justify-between">
							<span className="text-muted-foreground">Published</span>
							<span className="font-medium">
								{formatDate(paper.publishedAt)}
							</span>
						</div>
						{paper.doi && (
							<div className="flex items-center justify-between">
								<span className="text-muted-foreground">DOI</span>
								<a
									className="font-medium text-primary transition-colors hover:underline"
									href={`https://doi.org/${paper.doi}`}
									rel="noopener noreferrer"
									target="_blank"
								>
									{paper.doi}
								</a>
							</div>
						)}
						<div className="flex items-center justify-between">
							<span className="text-muted-foreground">Source</span>
							<a
								className="font-medium text-primary transition-colors hover:underline"
								href={paper.sourceUrl}
								rel="noopener noreferrer"
								target="_blank"
							>
								View original
							</a>
						</div>
					</CardContent>
				</Card>

				{paper.keywords && paper.keywords.length > 0 && (
					<Card variant="elevated">
						<CardHeader>
							<CardTitle>Keywords</CardTitle>
						</CardHeader>
						<CardContent>
							<div className="flex flex-wrap gap-1.5">
								{paper.keywords.map((keyword) => (
									<Link key={keyword} search={{ q: keyword }} to="/search">
										<Badge
											className="cursor-pointer transition-[transform,background-color] hover:scale-105 hover:bg-primary/15"
											variant="keyword"
										>
											{keyword}
										</Badge>
									</Link>
								))}
							</div>
						</CardContent>
					</Card>
				)}

				{related && related.length > 0 && (
					<Card variant="elevated">
						<CardHeader>
							<CardTitle>Related Papers</CardTitle>
						</CardHeader>
						<CardContent className="space-y-2">
							{related.slice(0, 5).map((p) => (
								<Link
									className="group block rounded-lg p-3 transition-colors hover:bg-muted/50"
									key={p.id}
									params={{ id: p.id }}
									to="/paper/$id"
								>
									<h3 className="line-clamp-2 font-medium text-sm transition-colors group-hover:text-primary">
										{p.title}
									</h3>
									<div className="mt-1.5 flex items-center gap-2 text-muted-foreground text-xs">
										<span>
											{p.authors[0]}
											{p.authors.length > 1 && " et al."}
										</span>
										<span className="text-border">•</span>
										<span>{getYear(p.publishedAt)}</span>
									</div>
								</Link>
							))}
						</CardContent>
					</Card>
				)}
			</div>
		</div>
	);
}
