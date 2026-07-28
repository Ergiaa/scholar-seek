import { Toaster } from "@scholar-seek/ui/components/sonner";
import type { QueryClient } from "@tanstack/react-query";
import {
	createRootRouteWithContext,
	HeadContent,
	Outlet,
	Scripts,
} from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";

import { Footer } from "../components/layout/footer";
import Header from "../components/layout/header";

import appCss from "../index.css?url";

export interface RouterAppContext {
	queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterAppContext>()({
	head: () => ({
		meta: [
			{
				charSet: "utf-8",
			},
			{
				name: "viewport",
				content: "width=device-width, initial-scale=1",
			},
			{
				title: "Scholar Seek - Academic Research Discovery",
			},
			{
				name: "description",
				content:
					"Search and discover academic papers across all scientific disciplines.",
			},
			{
				name: "theme-color",
				content: "#ffffff",
				media: "(prefers-color-scheme: light)",
			},
			{
				name: "theme-color",
				content: "#1e1e2e",
				media: "(prefers-color-scheme: dark)",
			},
		],
		links: [
			{
				rel: "stylesheet",
				href: appCss,
			},
		],
	}),

	component: RootDocument,
});

function RootDocument() {
	return (
		<html
			lang="en"
			style={{ colorScheme: "light dark" }}
			suppressHydrationWarning
		>
			<head>
				<HeadContent />
				<script
					// biome-ignore lint/security/noDangerouslySetInnerHtml: Theme script must run before hydration
					dangerouslySetInnerHTML={{
						__html: `
							(function() {
								const saved = localStorage.getItem('theme');
								const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
								if (saved === 'dark' || (!saved && prefersDark)) {
									document.documentElement.classList.add('dark');
								}
							})();
						`,
					}}
				/>
			</head>
			<body>
				<a
					className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-2 focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:text-sm focus:ring-2 focus:ring-primary"
					href="#main-content"
				>
					Skip to main content
				</a>
				<div className="flex min-h-screen flex-col">
					<Header />
					<main className="flex-1" id="main-content">
						<Outlet />
					</main>
					<Footer />
				</div>
				<Toaster richColors />
				<TanStackRouterDevtools position="bottom-left" />
				<Scripts />
			</body>
		</html>
	);
}
