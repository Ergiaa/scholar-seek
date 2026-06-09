import { Link } from "@tanstack/react-router";
import { Github, Twitter } from "lucide-react";

export function Footer() {
	return (
		<footer className="border-t bg-muted/20">
			<div className="container mx-auto px-4 py-8">
				<div className="flex flex-col items-center justify-between gap-4 md:flex-row">
					<div className="text-center md:text-left">
						<p className="font-semibold">Scholar Seek</p>
						<p className="text-muted-foreground text-sm">
							Academic research discovery platform.
						</p>
					</div>
					<div className="flex gap-4 text-muted-foreground text-sm">
						<Link className="transition-colors hover:text-foreground" to="/">
							Home
						</Link>
						<Link
							className="transition-colors hover:text-foreground"
							to="/search"
						>
							Browse All
						</Link>
					</div>
				</div>
				<div className="mt-8 flex flex-col items-center justify-between gap-4 border-t pt-8 text-muted-foreground text-xs md:flex-row">
					<p>©{new Date().getFullYear()} Scholar Seek. Demo project.</p>
					<div className="flex items-center gap-4">
						<a
							aria-label="GitHub"
							className="hover:text-foreground"
							href="https://github.com"
							rel="noreferrer"
							target="_blank"
						>
							<Github aria-hidden="true" className="h-4 w-4" />
						</a>
						<a
							aria-label="Twitter"
							className="hover:text-foreground"
							href="https://twitter.com"
							rel="noreferrer"
							target="_blank"
						>
							<Twitter aria-hidden="true" className="h-4 w-4" />
						</a>
					</div>
				</div>
			</div>
		</footer>
	);
}
