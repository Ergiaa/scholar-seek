import { Badge } from "@scholar-seek/ui/components/badge";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@scholar-seek/ui/components/card";
import { Link } from "@tanstack/react-router";
import { formatDate } from "../../lib/utils";
import type { Paper } from "../../types/paper";
import { ArxivAbstract } from "../paper/arxiv-abstract";

interface ResultCardProps {
	paper: Paper;
}

function storeSearchState() {
	if (typeof window !== "undefined") {
		sessionStorage.setItem("lastSearchUrl", window.location.href);
	}
}

export function ResultCard({ paper }: ResultCardProps) {
	return (
		<Card className="transition-colors hover:border-primary" variant="elevated">
			<CardHeader>
				<Link
					onClick={storeSearchState}
					params={{ id: paper.id }}
					to="/paper/$id"
				>
					<CardTitle className="line-clamp-2 text-lg hover:text-primary">
						{paper.title}
					</CardTitle>
				</Link>
			</CardHeader>
			<CardContent className="space-y-2">
				<Link
					className="block"
					onClick={storeSearchState}
					params={{ id: paper.id }}
					to="/paper/$id"
				>
					<ArxivAbstract
						className="line-clamp-2 text-muted-foreground text-sm"
						text={paper.abstract ?? ""}
					/>
					<div className="mt-2 flex flex-wrap gap-1">
						{paper.authors.slice(0, 3).map((author) => (
							<Badge key={author} variant="secondary">
								{author}
							</Badge>
						))}
						{paper.authors.length > 3 && (
							<Badge variant="outline">+{paper.authors.length - 3}</Badge>
						)}
					</div>
				</Link>
				<div className="flex items-center justify-between gap-2 pt-2 text-muted-foreground text-xs">
					<span className="min-w-0 truncate" title={paper.journal ?? undefined}>
						{paper.journal
							? `${paper.journal} • ${formatDate(paper.publishedAt)}`
							: formatDate(paper.publishedAt)}
					</span>
					<a
						className="shrink-0 text-primary hover:underline"
						href={paper.sourceUrl}
						rel="noopener noreferrer"
						target="_blank"
					>
						View source
					</a>
				</div>
			</CardContent>
		</Card>
	);
}
