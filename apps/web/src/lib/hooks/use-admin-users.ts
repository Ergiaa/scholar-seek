import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { authClient } from "../auth-client";

export interface AdminUser {
	banExpires: Date | string | null;
	banned: boolean | null;
	banReason: string | null;
	createdAt: Date | string;
	email: string;
	id: string;
	name: string;
	role: string | null;
}

const USERS_QUERY_KEY = ["admin-users"];

export function useAdminUsers() {
	return useQuery({
		queryKey: USERS_QUERY_KEY,
		queryFn: async () => {
			const { data, error } = await authClient.admin.listUsers({
				query: { limit: 200, sortBy: "createdAt", sortDirection: "asc" },
			});
			if (error) {
				throw new Error(error.message ?? "Failed to load users");
			}
			return data.users as AdminUser[];
		},
	});
}

export function useCreateUser() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (input: {
			email: string;
			name: string;
			password: string;
			role?: "user" | "admin";
		}) => {
			const { data, error } = await authClient.admin.createUser(input);
			if (error) {
				throw new Error(error.message ?? "Failed to create user");
			}
			return data;
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: USERS_QUERY_KEY });
		},
	});
}

export function useSetRole() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async ({
			userId,
			role,
		}: {
			userId: string;
			role: "user" | "admin";
		}) => {
			const { data, error } = await authClient.admin.setRole({ userId, role });
			if (error) {
				throw new Error(error.message ?? "Failed to change role");
			}
			return data;
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: USERS_QUERY_KEY });
		},
	});
}

export function useBanUser() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async ({
			userId,
			banReason,
		}: {
			userId: string;
			banReason?: string;
		}) => {
			const { data, error } = await authClient.admin.banUser({
				userId,
				banReason,
			});
			if (error) {
				throw new Error(error.message ?? "Failed to ban user");
			}
			return data;
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: USERS_QUERY_KEY });
		},
	});
}

export function useUnbanUser() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (userId: string) => {
			const { data, error } = await authClient.admin.unbanUser({ userId });
			if (error) {
				throw new Error(error.message ?? "Failed to unban user");
			}
			return data;
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: USERS_QUERY_KEY });
		},
	});
}

export function useRemoveUser() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (userId: string) => {
			const { data, error } = await authClient.admin.removeUser({ userId });
			if (error) {
				throw new Error(error.message ?? "Failed to remove user");
			}
			return data;
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: USERS_QUERY_KEY });
		},
	});
}

export function useUserSessions(userId: string | null) {
	return useQuery({
		queryKey: ["admin-user-sessions", userId],
		queryFn: async () => {
			const { data, error } = await authClient.admin.listUserSessions({
				userId: userId as string,
			});
			if (error) {
				throw new Error(error.message ?? "Failed to load sessions");
			}
			return data.sessions;
		},
		enabled: !!userId,
	});
}

export function useRevokeUserSession() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async ({
			userId,
			sessionToken,
		}: {
			userId: string;
			sessionToken: string;
		}) => {
			const { error } = await authClient.admin.revokeUserSession({
				sessionToken,
			});
			if (error) {
				throw new Error(error.message ?? "Failed to revoke session");
			}
			return userId;
		},
		onSuccess: (userId) => {
			queryClient.invalidateQueries({
				queryKey: ["admin-user-sessions", userId],
			});
		},
	});
}

export function useRevokeAllUserSessions() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (userId: string) => {
			const { error } = await authClient.admin.revokeUserSessions({ userId });
			if (error) {
				throw new Error(error.message ?? "Failed to revoke sessions");
			}
			return userId;
		},
		onSuccess: (userId) => {
			queryClient.invalidateQueries({
				queryKey: ["admin-user-sessions", userId],
			});
		},
	});
}
