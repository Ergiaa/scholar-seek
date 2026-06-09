import katex from "katex";
import "katex/dist/katex.min.css";

type Token =
	| { type: "display"; content: string }
	| { type: "inline"; content: string }
	| { type: "text"; content: string };

/** Split text into display-math ($$), inline-math ($), and plain text segments. */
function tokenize(text: string): Token[] {
	const tokens: Token[] = [];
	// Match $$...$$ first (display), then $...$ (inline)
	const re = /(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$)/g;
	let lastIndex = 0;
	let match: RegExpExecArray | null;

	while (true) {
		match = re.exec(text);
		if (match === null) {
			break;
		}

		if (match.index > lastIndex) {
			tokens.push({
				type: "text",
				content: text.slice(lastIndex, match.index),
			});
		}
		const full = match[0];
		if (full.startsWith("$$")) {
			tokens.push({ type: "display", content: full.slice(2, -2) });
		} else {
			tokens.push({ type: "inline", content: full.slice(1, -1) });
		}
		lastIndex = re.lastIndex;
	}

	if (lastIndex < text.length) {
		tokens.push({ type: "text", content: text.slice(lastIndex) });
	}

	return tokens;
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

/** Convert common LaTeX text commands to HTML. Input must be HTML-escaped first. */
function processTextCommands(text: string): string {
	return (
		text
			// {\it text}, {\em text} → <em>
			.replace(/\{\\(?:it|em)\s+([^}]*)\}/g, "<em>$1</em>")
			// {\bf text} → <strong>
			.replace(/\{\\bf\s+([^}]*)\}/g, "<strong>$1</strong>")
			// {\sc text} → small-caps
			.replace(
				/\{\\sc\s+([^}]*)\}/g,
				'<span style="font-variant:small-caps">$1</span>'
			)
			// \textit{}, \emph{} → <em>
			.replace(/\\(?:textit|emph)\{([^}]*)\}/g, "<em>$1</em>")
			// \textbf{} → <strong>
			.replace(/\\textbf\{([^}]*)\}/g, "<strong>$1</strong>")
			// --- → em dash, -- → en dash
			.replace(/---/g, "\u2014")
			.replace(/--/g, "\u2013")
	);
}

function renderToken(token: Token): string {
	if (token.type === "text") {
		return processTextCommands(escapeHtml(token.content));
	}

	try {
		return katex.renderToString(token.content, {
			displayMode: token.type === "display",
			throwOnError: false,
			output: "html",
		});
	} catch {
		// Fall back to the raw source wrapped in a <code> so it's visible
		return `<code>${escapeHtml(token.content)}</code>`;
	}
}

interface ArxivAbstractProps {
	className?: string;
	text: string;
}

export function ArxivAbstract({ text, className }: ArxivAbstractProps) {
	const html = tokenize(text).map(renderToken).join("");

	return (
		<p
			className={className}
			// biome-ignore lint/security/noDangerouslySetInnerHtml: KaTeX renders math HTML; text segments are HTML-escaped before processing
			dangerouslySetInnerHTML={{ __html: html }}
		/>
	);
}
