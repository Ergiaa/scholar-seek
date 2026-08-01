import { Elysia } from "elysia";
import { auth, ROOT_ADMIN_ROLE } from "./auth";

const ADMIN_ROLES: string[] = ["admin", ROOT_ADMIN_ROLE];

export const authGuard = new Elysia({ name: "lib.auth-guard" })
	.derive({ as: "scoped" }, async ({ request }) => {
		const session = await auth.api.getSession({ headers: request.headers });
		return { session };
	})
	.macro({
		auth: {
			async resolve({ session, status }) {
				if (!session) {
					return status(401, { error: "Unauthorized" });
				}
				return { user: session.user };
			},
		},
		adminOnly: {
			async resolve({ session, status }) {
				if (!session) {
					return status(401, { error: "Unauthorized" });
				}
				if (!ADMIN_ROLES.includes(session.user.role ?? "")) {
					return status(403, { error: "Admin access required" });
				}
				return { user: session.user };
			},
		},
	});
