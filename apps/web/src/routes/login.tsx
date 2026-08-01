import { Button } from "@scholar-seek/ui/components/button";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@scholar-seek/ui/components/card";
import { Input } from "@scholar-seek/ui/components/input";
import { Label } from "@scholar-seek/ui/components/label";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { signIn } from "../lib/auth-client";

export const Route = createFileRoute("/login")({
	component: LoginPage,
});

function LoginPage() {
	const navigate = useNavigate();
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [isSubmitting, setIsSubmitting] = useState(false);

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		setError(null);
		setIsSubmitting(true);
		const { error: signInError } = await signIn.email({ email, password });
		setIsSubmitting(false);
		if (signInError) {
			setError(signInError.message ?? "Sign in failed");
			return;
		}
		navigate({ to: "/" });
	}

	return (
		<div className="container mx-auto flex max-w-sm flex-col gap-6 px-4 py-16">
			<Card>
				<CardHeader>
					<CardTitle>Sign in</CardTitle>
				</CardHeader>
				<CardContent>
					<form className="flex flex-col gap-4" onSubmit={handleSubmit}>
						<div className="flex flex-col gap-1">
							<Label htmlFor="email">Email</Label>
							<Input
								id="email"
								onChange={(e) => setEmail(e.target.value)}
								required
								type="email"
								value={email}
							/>
						</div>
						<div className="flex flex-col gap-1">
							<Label htmlFor="password">Password</Label>
							<Input
								id="password"
								onChange={(e) => setPassword(e.target.value)}
								required
								type="password"
								value={password}
							/>
						</div>
						{error && <p className="text-destructive text-xs">{error}</p>}
						<Button disabled={isSubmitting} type="submit">
							{isSubmitting ? "Signing in..." : "Sign in"}
						</Button>
					</form>
				</CardContent>
			</Card>
		</div>
	);
}
