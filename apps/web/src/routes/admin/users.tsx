import { Badge } from "@scholar-seek/ui/components/badge";
import { Button } from "@scholar-seek/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@scholar-seek/ui/components/dialog";
import { Input } from "@scholar-seek/ui/components/input";
import { Label } from "@scholar-seek/ui/components/label";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { StatusChip } from "../../components/admin/status-chip";
import { useSession } from "../../lib/auth-client";
import {
	type AdminUser,
	useAdminUsers,
	useBanUser,
	useCreateUser,
	useRemoveUser,
	useRevokeAllUserSessions,
	useRevokeUserSession,
	useSetRole,
	useUnbanUser,
	useUserSessions,
} from "../../lib/hooks/use-admin-users";

export const Route = createFileRoute("/admin/users")({
	component: UsersPage,
});

function UsersPage() {
	const { data: session } = useSession();
	const { data: users, isLoading, error } = useAdminUsers();
	const currentUserId = session?.user?.id;

	return (
		<div className="flex flex-col gap-6">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="font-semibold text-xl">Users</h1>
					<p className="text-muted-foreground text-sm">
						Staff access: there is no public sign-up, this is the only way an
						account gets created.
					</p>
				</div>
				<CreateUserDialog />
			</div>

			{isLoading && <p className="text-muted-foreground text-sm">Loading...</p>}
			{error && <p className="text-destructive text-sm">{error.message}</p>}

			{users && users.length === 0 && (
				<div className="flex flex-col items-center gap-2 border border-dashed p-10 text-center">
					<p className="font-medium text-sm">No users yet</p>
					<p className="text-muted-foreground text-xs">
						Create the first admin account to get started.
					</p>
					<CreateUserDialog />
				</div>
			)}

			{users && users.length > 0 && (
				<div className="border">
					<div className="flex items-center gap-3 border-b bg-muted/50 px-4 py-2 font-medium text-[10.5px] text-muted-foreground uppercase tracking-wide">
						<span className="min-w-[140px] flex-[2]">Email / name</span>
						<span className="w-24 shrink-0">Role</span>
						<span className="w-24 shrink-0">Status</span>
						<span className="w-24 shrink-0">Created</span>
						<span className="w-52 shrink-0 text-right">Actions</span>
					</div>
					{users.map((user) => (
						<UserRow currentUserId={currentUserId} key={user.id} user={user} />
					))}
				</div>
			)}
		</div>
	);
}

function UserRow({
	user,
	currentUserId,
}: {
	user: AdminUser;
	currentUserId: string | undefined;
}) {
	const isRoot = user.role === "root_admin";
	const setRole = useSetRole();
	const unbanUser = useUnbanUser();
	const isBanned = !!user.banned;

	async function toggleRole() {
		try {
			await setRole.mutateAsync({
				userId: user.id,
				role: user.role === "admin" ? "user" : "admin",
			});
			toast.success("Role updated");
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed to update role");
		}
	}

	async function handleUnban() {
		try {
			await unbanUser.mutateAsync(user.id);
			toast.success("User unbanned");
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed to unban user");
		}
	}

	return (
		<div className="flex flex-col border-b last:border-b-0">
			<div className="flex items-center gap-3 px-4 py-3">
				<div className="min-w-[140px] flex-[2]">
					<p className="font-medium text-sm">{user.name}</p>
					<p className="text-muted-foreground text-xs">{user.email}</p>
				</div>
				<span className="w-24 shrink-0">
					<Badge variant={isRoot ? "default" : "secondary"}>
						{user.role ?? "user"}
					</Badge>
				</span>
				<span className="w-24 shrink-0">
					<StatusChip status={isBanned ? "banned" : "active"} />
				</span>
				<span className="w-24 shrink-0 text-muted-foreground text-xs">
					{new Date(user.createdAt).toLocaleDateString()}
				</span>
				<div className="flex w-52 shrink-0 justify-end gap-1.5">
					<SessionsDialog userId={user.id} userLabel={user.email} />
					<Button
						disabled={isRoot || setRole.isPending}
						onClick={toggleRole}
						size="xs"
						title={isRoot ? "Root admin cannot be modified" : undefined}
						variant="outline"
					>
						Role
					</Button>
					{isBanned ? (
						<Button
							disabled={isRoot || unbanUser.isPending}
							onClick={handleUnban}
							size="xs"
							variant="outline"
						>
							Unban
						</Button>
					) : (
						<BanUserDialog isRoot={isRoot} user={user} />
					)}
					<RemoveUserDialog
						disabled={isRoot || user.id === currentUserId}
						isRoot={isRoot}
						user={user}
					/>
				</div>
			</div>
			{isRoot && (
				<p className="px-4 pb-2 text-muted-foreground text-xs">
					Root admin cannot be modified: role, ban, and remove are disabled for
					this account.
				</p>
			)}
		</div>
	);
}

function CreateUserDialog() {
	const [open, setOpen] = useState(false);
	const [email, setEmail] = useState("");
	const [name, setName] = useState("");
	const [password, setPassword] = useState("");
	const createUser = useCreateUser();

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		try {
			await createUser.mutateAsync({ email, name, password, role: "admin" });
			toast.success("Account created");
			setEmail("");
			setName("");
			setPassword("");
			setOpen(false);
		} catch (err) {
			toast.error(
				err instanceof Error ? err.message : "Failed to create account"
			);
		}
	}

	return (
		<Dialog onOpenChange={setOpen} open={open}>
			<DialogTrigger render={<Button>+ Create account</Button>} />
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Create account</DialogTitle>
					<DialogDescription>
						There is no public sign-up, this is the only path to a new account.
					</DialogDescription>
				</DialogHeader>
				<form className="flex flex-col gap-3" onSubmit={handleSubmit}>
					<div className="flex flex-col gap-1">
						<Label htmlFor="new-user-name">Name</Label>
						<Input
							id="new-user-name"
							onChange={(e) => setName(e.target.value)}
							required
							value={name}
						/>
					</div>
					<div className="flex flex-col gap-1">
						<Label htmlFor="new-user-email">Email</Label>
						<Input
							id="new-user-email"
							onChange={(e) => setEmail(e.target.value)}
							required
							type="email"
							value={email}
						/>
					</div>
					<div className="flex flex-col gap-1">
						<Label htmlFor="new-user-password">Password</Label>
						<Input
							id="new-user-password"
							minLength={8}
							onChange={(e) => setPassword(e.target.value)}
							required
							type="password"
							value={password}
						/>
					</div>
					<DialogFooter>
						<Button disabled={createUser.isPending} type="submit">
							{createUser.isPending ? "Creating..." : "Create account"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

function BanUserDialog({ user, isRoot }: { user: AdminUser; isRoot: boolean }) {
	const [open, setOpen] = useState(false);
	const banUser = useBanUser();

	async function handleBan() {
		try {
			await banUser.mutateAsync({ userId: user.id });
			toast.success("User banned");
			setOpen(false);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed to ban user");
		}
	}

	return (
		<Dialog onOpenChange={setOpen} open={open}>
			<DialogTrigger
				render={
					<Button
						disabled={isRoot}
						size="xs"
						title={isRoot ? "Root admin cannot be modified" : undefined}
						variant="outline"
					>
						Ban
					</Button>
				}
			/>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Ban {user.email}?</DialogTitle>
					<DialogDescription>
						They'll be signed out everywhere and won't be able to sign back in
						until unbanned.
					</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<Button onClick={() => setOpen(false)} variant="outline">
						Cancel
					</Button>
					<Button
						disabled={banUser.isPending}
						onClick={handleBan}
						variant="destructive"
					>
						Ban user
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function RemoveUserDialog({
	user,
	isRoot,
	disabled,
}: {
	user: AdminUser;
	isRoot: boolean;
	disabled: boolean;
}) {
	const [open, setOpen] = useState(false);
	const removeUser = useRemoveUser();

	async function handleRemove() {
		try {
			await removeUser.mutateAsync(user.id);
			toast.success("User removed");
			setOpen(false);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed to remove user");
		}
	}

	return (
		<Dialog onOpenChange={setOpen} open={open}>
			<DialogTrigger
				render={
					<Button
						disabled={disabled}
						size="xs"
						title={isRoot ? "Root admin cannot be modified" : undefined}
						variant="destructive"
					>
						Remove
					</Button>
				}
			/>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Remove {user.email}?</DialogTitle>
					<DialogDescription>
						This permanently deletes their account. This cannot be undone.
					</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<Button onClick={() => setOpen(false)} variant="outline">
						Cancel
					</Button>
					<Button
						disabled={removeUser.isPending}
						onClick={handleRemove}
						variant="destructive"
					>
						Remove user
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function SessionsDialog({
	userId,
	userLabel,
}: {
	userId: string;
	userLabel: string;
}) {
	const [open, setOpen] = useState(false);
	const { data: sessions, isLoading } = useUserSessions(open ? userId : null);
	const revokeSession = useRevokeUserSession();
	const revokeAll = useRevokeAllUserSessions();

	async function handleRevoke(sessionToken: string) {
		try {
			await revokeSession.mutateAsync({ userId, sessionToken });
			toast.success("Session revoked");
		} catch (err) {
			toast.error(
				err instanceof Error ? err.message : "Failed to revoke session"
			);
		}
	}

	async function handleRevokeAll() {
		try {
			await revokeAll.mutateAsync(userId);
			toast.success("All sessions revoked");
		} catch (err) {
			toast.error(
				err instanceof Error ? err.message : "Failed to revoke sessions"
			);
		}
	}

	return (
		<Dialog onOpenChange={setOpen} open={open}>
			<DialogTrigger
				render={
					<Button size="xs" variant="outline">
						Sessions
					</Button>
				}
			/>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{userLabel}</DialogTitle>
					<DialogDescription>
						Active sessions for this account.
					</DialogDescription>
				</DialogHeader>
				<div className="flex flex-col gap-1">
					{isLoading && (
						<p className="text-muted-foreground text-xs">Loading...</p>
					)}
					{sessions?.length === 0 && (
						<p className="text-muted-foreground text-xs">No active sessions.</p>
					)}
					{sessions?.map((s) => (
						<div
							className="flex items-center gap-3 border-b py-2 text-xs last:border-b-0"
							key={s.token}
						>
							<span className="flex-1 truncate text-muted-foreground">
								{s.userAgent ?? "Unknown device"}
							</span>
							<span className="w-36 shrink-0 text-muted-foreground">
								{new Date(s.updatedAt).toLocaleString()}
							</span>
							<button
								className="shrink-0 font-medium text-destructive text-xs hover:underline"
								onClick={() => handleRevoke(s.token)}
								type="button"
							>
								Revoke
							</button>
						</div>
					))}
				</div>
				<DialogFooter>
					<Button
						disabled={revokeAll.isPending || sessions?.length === 0}
						onClick={handleRevokeAll}
						variant="destructive"
					>
						Revoke all sessions
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
