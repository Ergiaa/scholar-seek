import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { signOut, useSession } from "../../lib/auth-client";
import { ThemeToggle } from "./theme-toggle";

export default function Header() {
	// Session state is only known client-side, so the auth-dependent links
	// must not render on the server (or the first client paint) — otherwise
	// hydration mismatches as soon as the client resolves a real session.
	const [mounted, setMounted] = useState(false);
	useEffect(() => setMounted(true), []);
	const { data: session } = useSession();
	const role = session?.user?.role;
	const isAdmin = mounted && (role === "admin" || role === "root_admin");

	return (
		<header className="border-b">
			<div className="container mx-auto flex items-center justify-between px-4 py-4">
				<Link className="font-semibold text-xl" to="/">
					Scholar Seek
				</Link>
				<div className="flex items-center gap-4">
					{isAdmin && (
						<Link className="text-sm" to="/admin/crawler">
							Crawler
						</Link>
					)}
					{mounted &&
						(session ? (
							<button
								className="text-sm"
								onClick={() => signOut()}
								type="button"
							>
								Sign out
							</button>
						) : (
							<Link className="text-sm" to="/login">
								Sign in
							</Link>
						))}
					<ThemeToggle />
				</div>
			</div>
		</header>
	);
}
