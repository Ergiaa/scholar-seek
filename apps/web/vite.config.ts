import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

const isTest = Boolean(process.env.VITEST);

export default defineConfig({
	plugins: isTest
		? [tsconfigPaths(), viteReact()]
		: [tsconfigPaths(), tailwindcss(), tanstackStart(), viteReact()],
	server: {
		port: 3001,
	},
	test: {
		environment: "jsdom",
		globals: true,
		setupFiles: ["./src/test-setup.ts"],
	},
});
