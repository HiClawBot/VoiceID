import { defineConfig } from "vite";

export default defineConfig({
	publicDir: "../../assets",
	server: {
		host: "127.0.0.1",
		port: 5173,
		strictPort: true,
		proxy: {
			"/v1": "http://127.0.0.1:3401",
			"/healthz": "http://127.0.0.1:3401",
			"/readyz": "http://127.0.0.1:3401",
		},
	},
	build: {
		sourcemap: true,
		target: "es2022",
	},
});
