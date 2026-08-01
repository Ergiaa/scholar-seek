import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { signOut, useSession } from "../../lib/auth-client";

export const Route = createFileRoute("/admin")({
	component: AdminLayout,
});

const NAV_ITEMS = [
	{ to: "/admin", label: "Overview" },
	{ to: "/admin/schedules", label: "Schedules" },
	{ to: "/admin/history", label: "History" },
	{ to: "/admin/users", label: "Users" },
] as const;

function AdminLayout() {
	// Session state is only known client-side (cookie-based), so the server
	// render and the client's very first paint must show the same thing,
	// otherwise React flags a hydration mismatch. Gate on mount so the first
	// client render always matches the server's "Loading..." output, then
	// resolve to the real session once mounted. Every child route trusts
	// this layout already gated it and does not re-check.
	const [mounted, setMounted] = useState(false);
	useEffect(() => setMounted(true), []);
	const { data: session, isPending } = useSession();

	if (!mounted || isPending) {
		return <div className="container mx-auto px-4 py-8">Loading...</div>;
	}

	const role = session?.user?.role;
	if (!session || (role !== "admin" && role !== "root_admin")) {
		return (
			<div className="container mx-auto px-4 py-8">
				<p className="text-muted-foreground text-sm">Admin access required.</p>
			</div>
		);
	}

	return (
		<div className="container mx-auto flex flex-col gap-6 px-4 py-8">
			<div className="flex flex-wrap items-center justify-between gap-4 border-b pb-4">
				<nav className="flex items-center gap-4">
					{NAV_ITEMS.map((item) => (
						<Link
							activeOptions={{ exact: item.to === "/admin" }}
							activeProps={{ className: "text-foreground font-medium" }}
							className="text-muted-foreground text-sm hover:text-foreground"
							key={item.to}
							to={item.to}
						>
							{item.label}
						</Link>
					))}
				</nav>
				<div className="flex items-center gap-3 text-muted-foreground text-xs">
					<span>
						Signed in as {session.user.email}
						{role === "root_admin" ? " (root admin)" : ""}
					</span>
					<button
						className="text-foreground text-xs hover:underline"
						onClick={() => signOut()}
						type="button"
					>
						Sign out
					</button>
				</div>
			</div>
			<Outlet />
		</div>
	);
}
