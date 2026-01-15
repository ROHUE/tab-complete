/**
 * Claude Completion LSP Server
 *
 * An LSP server that provides intelligent code completions powered by Claude.
 * Uses dynamic import to avoid blocking at module load time.
 */

import { TextDocument } from "vscode-languageserver-textdocument";
import { CompletionItem, CompletionItemKind } from "vscode-languageserver-types";
import { query, type Options } from "@anthropic-ai/claude-agent-sdk";
import { createCompletionServer, parseCompletions } from "./completion-tool";

// Main function - dynamically import vscode-languageserver to avoid import blocking
async function main() {
  console.error("[claude-completion] Starting server...");

  // Dynamic import to avoid blocking at module load
  const {
    createConnection,
    TextDocuments,
    ProposedFeatures,
    TextDocumentSyncKind,
    StreamMessageReader,
    StreamMessageWriter,
  } = await import("vscode-languageserver/node");

  console.error("[claude-completion] Creating connection...");

  // Create LSP connection with explicit stdio streams
  const connection = createConnection(
    ProposedFeatures.all,
    new StreamMessageReader(process.stdin),
    new StreamMessageWriter(process.stdout)
  );

  // Document manager
  const documents = new TextDocuments(TextDocument);

  // Create the Claude completion MCP server
  const completionServer = createCompletionServer();

  // Initialize
  connection.onInitialize(() => {
    console.error("[claude-completion] Server initializing...");

    return {
      capabilities: {
        textDocumentSync: TextDocumentSyncKind.Incremental,
        completionProvider: {
          resolveProvider: false,
          triggerCharacters: [".", "(", "[", "{", " ", ":", "<", '"', "'", "/"],
        },
      },
    };
  });

  connection.onInitialized(() => {
    console.error("[claude-completion] Server initialized successfully");
  });

  // Handle completion requests
  connection.onCompletion(async (params) => {
    const document = documents.get(params.textDocument.uri);
    if (!document) {
      return [];
    }

    const text = document.getText();
    const lines = text.split("\n");
    const line = lines[params.position.line] || "";
    const prefix = line.substring(0, params.position.character);

    // Extract language from file extension
    const uri = params.textDocument.uri;
    const ext = uri.split(".").pop() || "";
    const languageMap: Record<string, string> = {
      py: "python",
      ts: "typescript",
      tsx: "typescript",
      js: "javascript",
      jsx: "javascript",
      lua: "lua",
      rs: "rust",
      go: "go",
      java: "java",
      cpp: "cpp",
      c: "c",
      rb: "ruby",
      php: "php",
    };
    const language = languageMap[ext] || ext;

    // Get filename from URI
    const filename = uri.split("/").pop() || "unknown";

    console.error(
      `[claude-completion] Completion request: ${filename}:${params.position.line}:${params.position.character}`
    );
    console.error(`[claude-completion] Prefix: "${prefix}"`);

    try {
      // Use Claude Agent SDK to get completions
      const sdkOptions: Options = {
        mcpServers: {
          completions: completionServer,
        },
        allowedTools: ["mcp__completions__get_completions"],
        maxTurns: 1,
      };

      const promptText = `Use the get_completions tool with these parameters:
- buffer_content: ${JSON.stringify(text)}
- cursor_line: ${params.position.line}
- cursor_column: ${params.position.character}
- language: "${language}"
- prefix: ${JSON.stringify(prefix)}
- filename: "${filename}"

Then analyze the code context and provide intelligent completions.`;

      let completions: CompletionItem[] = [];

      for await (const message of query({
        prompt: promptText,
        options: sdkOptions,
      })) {
        if (message.type === "assistant") {
          const betaMessage = message.message;
          if (betaMessage && betaMessage.content) {
            for (const block of betaMessage.content) {
              if (block.type === "text") {
                const textBlock = block as { type: "text"; text: string };
                completions = parseCompletions(textBlock.text);
                break;
              }
            }
          }
        }
      }

      console.error(`[claude-completion] Returning ${completions.length} completions`);
      return completions;
    } catch (error) {
      console.error("[claude-completion] Error getting completions:", error);

      // Fallback: return basic buffer completions
      return getBasicCompletions(text, prefix);
    }
  });

  /**
   * Fallback: Get basic completions from buffer words
   */
  function getBasicCompletions(text: string, prefix: string): CompletionItem[] {
    const words = new Set<string>();
    const wordRegex = /\b[a-zA-Z_][a-zA-Z0-9_]*\b/g;
    let match;

    while ((match = wordRegex.exec(text)) !== null) {
      if (match[0].toLowerCase().startsWith(prefix.toLowerCase()) && match[0] !== prefix) {
        words.add(match[0]);
      }
    }

    return Array.from(words)
      .slice(0, 20)
      .map((word) => ({
        label: word,
        kind: CompletionItemKind.Text,
        detail: "(buffer)",
      }));
  }

  // Listen for document changes
  documents.listen(connection);

  // Start the server
  connection.listen();

  console.error("[claude-completion] Server started");
}

// Run the main function
main().catch((err) => {
  console.error("[claude-completion] Fatal error:", err);
  process.exit(1);
});
