/**
 * Claude Completion LSP Server
 *
 * An LSP server that provides intelligent code completions powered by Claude.
 * Uses vscode-jsonrpc directly to avoid blocking behavior in vscode-languageserver/node.
 */

import { TextDocument } from "vscode-languageserver-textdocument";
import { CompletionItem, CompletionItemKind } from "vscode-languageserver-types";
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
  type MessageConnection,
} from "vscode-jsonrpc/node.js";
import {
  InitializeRequest,
  InitializeResult,
  DidOpenTextDocumentNotification,
  DidChangeTextDocumentNotification,
  DidCloseTextDocumentNotification,
  CompletionRequest,
  TextDocumentSyncKind,
} from "vscode-languageserver-protocol";
import { query, type Options } from "@anthropic-ai/claude-agent-sdk";
import { parseCompletions } from "./completion-tool.js";

console.error("[claude-completion] Starting server...");

// Document storage (simple in-memory store)
const documents = new Map<string, TextDocument>();

// Create a simple JSON-RPC connection using explicit stdio
const reader = new StreamMessageReader(process.stdin);
const writer = new StreamMessageWriter(process.stdout);
const connection: MessageConnection = createMessageConnection(reader, writer);

console.error("[claude-completion] Connection created");

// Handle initialize request
connection.onRequest(InitializeRequest.type, (): InitializeResult => {
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

// Handle document open
connection.onNotification(DidOpenTextDocumentNotification.type, (params) => {
  const { uri, languageId, version, text } = params.textDocument;
  documents.set(uri, TextDocument.create(uri, languageId, version, text));
  console.error(`[claude-completion] Document opened: ${uri}`);
});

// Handle document change
connection.onNotification(DidChangeTextDocumentNotification.type, (params) => {
  const doc = documents.get(params.textDocument.uri);
  if (doc) {
    const updated = TextDocument.update(doc, params.contentChanges, params.textDocument.version);
    documents.set(params.textDocument.uri, updated);
  }
});

// Handle document close
connection.onNotification(DidCloseTextDocumentNotification.type, (params) => {
  documents.delete(params.textDocument.uri);
  console.error(`[claude-completion] Document closed: ${params.textDocument.uri}`);
});

// Handle completion requests
connection.onRequest(CompletionRequest.type, async (params): Promise<CompletionItem[]> => {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    console.error(`[claude-completion] Document not found: ${params.textDocument.uri}`);
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
    // Use Claude Agent SDK to get completions (uses Max subscription auth)
    const sdkOptions: Options = {
      model: "claude-sonnet-4-5",
      maxTurns: 1, // Direct response, no tools needed
    };

    const promptText = `You are a code completion engine. Generate completions for the prefix "${prefix}" at line ${params.position.line + 1}.

FILE CONTENT (${filename}):
\`\`\`${language}
${text}
\`\`\`

CURSOR: Line ${params.position.line + 1}, after "${prefix}"

RESPOND WITH ONLY A JSON ARRAY. NO OTHER TEXT.
Format: [{"label": "text", "detail": "description", "kind": "function|variable|class"}]`;

    // Add timeout to prevent hanging (30s for tool call + response)
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("Claude API timeout")), 30000);
    });

    const queryPromise = (async () => {
      let lastText = "";

      for await (const message of query({
        prompt: promptText,
        options: sdkOptions,
      })) {
        console.error(`[claude-completion] Message type: ${message.type}`);

        // Handle 'result' type messages (Claude SDK final result)
        if (message.type === "result") {
          const msg = message as { type: string; is_error?: boolean; result?: string };
          console.error(`[claude-completion] Result: is_error=${msg.is_error}, result_length=${msg.result?.length}`);
          console.error(`[claude-completion] Result content: ${msg.result?.substring(0, 500)}`);
          if (!msg.is_error && msg.result) {
            console.error(`[claude-completion] Got final result from Claude`);
            const completions = parseCompletions(msg.result);
            console.error(`[claude-completion] Parsed ${completions.length} completions from result`);
            if (completions.length > 0) return completions;
          }
        }

        // Collect assistant messages - look for JSON array with completions
        if (message.type === "assistant") {
          const betaMessage = (message as any).message;
          if (betaMessage && betaMessage.content) {
            for (const block of betaMessage.content) {
              if (block.type === "text") {
                const text = (block as { type: "text"; text: string }).text;
                console.error(`[claude-completion] Assistant text: ${text.substring(0, 150)}`);

                // Only parse if it looks like completion JSON
                if (text.includes('[{') && text.includes('"label"')) {
                  const completions = parseCompletions(text);
                  if (completions.length > 0) {
                    console.error(`[claude-completion] Found ${completions.length} completions in response`);
                    return completions;
                  }
                }
                lastText = text;
              }
            }
          }
        }
      }

      // Try parsing the last text we got
      if (lastText) {
        const completions = parseCompletions(lastText);
        if (completions.length > 0) return completions;
      }

      return [];
    })();

    const completions = await Promise.race([queryPromise, timeoutPromise]);

    // If Claude returned completions, use them; otherwise fall back to buffer
    if (completions.length > 0) {
      console.error(`[claude-completion] Returning ${completions.length} Claude completions`);
      return completions;
    }

    console.error("[claude-completion] Claude returned 0 completions, using fallback");
    return getBasicCompletions(text, prefix);
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

// Start listening
connection.listen();

console.error("[claude-completion] Server started and listening");
