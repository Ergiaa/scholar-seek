import { db } from "@scholar-seek/db";
import { user } from "@scholar-seek/db/schema/auth";
import { env } from "@scholar-seek/env/server";
import { APIError, betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin } from "better-auth/plugins";
import { defaultStatements } from "better-auth/plugins/admin/access";
import { createAccessControl } from "better-auth/plugins/access";
import { eq } from "drizzle-orm";

// Foundation for custom RBAC: every app-specific permission this project
// knows about lives in this one statement. Adding a resource here (e.g.
// `crawlSchedule: ["create", "read", "update", "delete"]`) makes it
// available to `ac.newRole()` below without touching the guard/route layer.
const statement = {
	...defaultStatements,
} as const;

export const accessControl = createAccessControl(statement);

export const ROOT_ADMIN_ROLE = "root_admin";

const roles = {
	[ROOT_ADMIN_ROLE]: accessControl.newRole({
		user: ["create", "list", "set-role", "ban", "impersonate", "delete", "set-password", "update"],
		session: ["list", "revoke", "delete"],
	}),
	admin: accessControl.newRole({
		user: ["create", "list", "set-role", "ban", "set-password"],
		session: ["list", "revoke", "delete"],
	}),
	user: accessControl.newRole({}),
};

export const auth = betterAuth({
	baseURL: env.BETTER_AUTH_URL,
	secret: env.BETTER_AUTH_SECRET,
	trustedOrigins: [env.CORS_ORIGIN],
	database: drizzleAdapter(db, {
		provider: "pg",
	}),
	emailAndPassword: {
		enabled: true,
		// Bootstrapping happens exclusively through the seeded root admin
		// (see ensureRootAdmin in index.ts) — there is no open registration.
		disableSignUp: true,
	},
	plugins: [
		admin({
			ac: accessControl,
			roles,
			defaultRole: "user",
			adminRoles: ["admin", ROOT_ADMIN_ROLE],
		}),
	],
	databaseHooks: {
		user: {
			update: {
				// The root admin's role/ban state can't be changed through any
				// admin endpoint (setRole, banUser), no matter who's calling it.
				before: async (data, context) => {
					const targetUserId = context?.body?.userId as string | undefined;
					if (!targetUserId) {
						return;
					}
					const [target] = await db
						.select({ role: user.role })
						.from(user)
						.where(eq(user.id, targetUserId));
					if (target?.role !== ROOT_ADMIN_ROLE) {
						return;
					}
					const revokesRole = "role" in data && data.role !== ROOT_ADMIN_ROLE;
					const bans = data.banned === true;
					if (revokesRole || bans) {
						throw new APIError("FORBIDDEN", {
							message: "The root admin account cannot be demoted or banned.",
						});
					}
				},
			},
			delete: {
				// entityToDelete is the full pre-existing row (see better-auth's
				// deleteWithHooks), so this is reliable regardless of caller.
				before: async (existingUser) => {
					if (existingUser.role === ROOT_ADMIN_ROLE) {
						throw new APIError("FORBIDDEN", {
							message: "The root admin account cannot be deleted.",
						});
					}
				},
			},
		},
	},
});

// Public sign-up is disabled, so this is the only path that ever creates
// the first account. Safe to call on every boot — it's a no-op once a
// root admin row exists.
export async function ensureRootAdmin() {
	const [existingRoot] = await db
		.select({ id: user.id })
		.from(user)
		.where(eq(user.role, ROOT_ADMIN_ROLE));
	if (existingRoot) {
		return;
	}

	const [existingByEmail] = await db
		.select({ id: user.id })
		.from(user)
		.where(eq(user.email, env.ROOT_ADMIN_EMAIL));
	if (existingByEmail) {
		await db
			.update(user)
			.set({ role: ROOT_ADMIN_ROLE })
			.where(eq(user.id, existingByEmail.id));
		console.log(`[auth] promoted existing ${env.ROOT_ADMIN_EMAIL} to root admin`);
		return;
	}

	// Calling auth.api.createUser with no headers/request skips the
	// session + permission checks it normally enforces — the intended
	// escape hatch for trusted server-side/seed calls like this one.
	await auth.api.createUser({
		body: {
			email: env.ROOT_ADMIN_EMAIL,
			password: env.ROOT_ADMIN_PASSWORD,
			name: env.ROOT_ADMIN_NAME,
			role: ROOT_ADMIN_ROLE,
		},
	});
	console.log(`[auth] seeded root admin ${env.ROOT_ADMIN_EMAIL}`);
}
