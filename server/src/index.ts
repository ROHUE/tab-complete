/**
 * Claude Completion LSP Server
 *
 * An LSP server that provides intelligent code completions powered by Claude.
 * Uses streaming for fast perceived latency - returns buffer completions immediately
 * while Claude completions stream in via progress notifications.
 */

import { TextDocument } from "vscode-languageserver-textdocument";
import {
  CompletionItem,
  CompletionItemKind,
  CompletionList,
} from "vscode-languageserver-types";
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

// Track pending completion requests for cancellation
const pendingRequests = new Map<string, AbortController>();

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
    const updated = TextDocument.update(
      doc,
      params.contentChanges,
      params.textDocument.version
    );
    documents.set(params.textDocument.uri, updated);
  }

  // Cancel any pending completion request for this document
  const requestKey = params.textDocument.uri;
  const pending = pendingRequests.get(requestKey);
  if (pending) {
    console.error(`[claude-completion] Cancelling pending request for ${requestKey}`);
    pending.abort();
    pendingRequests.delete(requestKey);
  }
});

// Handle document close
connection.onNotification(DidCloseTextDocumentNotification.type, (params) => {
  documents.delete(params.textDocument.uri);
  pendingRequests.delete(params.textDocument.uri);
  console.error(`[claude-completion] Document closed: ${params.textDocument.uri}`);
});

/**
 * Get context around cursor (reduced for faster processing)
 */
function getContextAroundCursor(
  text: string,
  line: number,
  contextLines: number = 30
): string {
  const lines = text.split("\n");
  const start = Math.max(0, line - contextLines);
  const end = Math.min(lines.length, line + contextLines);
  return lines.slice(start, end).join("\n");
}

/**
 * Fallback: Get basic completions from buffer words
 */
function getBasicCompletions(text: string, prefix: string): CompletionItem[] {
  const words = new Set<string>();
  const wordRegex = /\b[a-zA-Z_][a-zA-Z0-9_]*\b/g;
  let match;

  while ((match = wordRegex.exec(text)) !== null) {
    if (
      match[0].toLowerCase().startsWith(prefix.toLowerCase()) &&
      match[0] !== prefix
    ) {
      words.add(match[0]);
    }
  }

  return Array.from(words)
    .slice(0, 10)
    .map((word) => ({
      label: word,
      kind: CompletionItemKind.Text,
      detail: "(buffer)",
      sortText: "z" + word, // Sort buffer completions last
    }));
}

// Handle completion requests with streaming
connection.onRequest(
  CompletionRequest.type,
  async (params): Promise<CompletionList> => {
    const startTime = Date.now();
    const document = documents.get(params.textDocument.uri);
    if (!document) {
      console.error(
        `[claude-completion] Document not found: ${params.textDocument.uri}`
      );
      return { isIncomplete: false, items: [] };
    }

    const text = document.getText();
    const lines = text.split("\n");
    const line = lines[params.position.line] || "";
    const prefix = line.substring(0, params.position.character);

    // Skip if prefix is too short or empty
    if (prefix.trim().length < 2) {
      return { isIncomplete: false, items: getBasicCompletions(text, prefix) };
    }

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
    const filename = uri.split("/").pop() || "unknown";

    console.error(
      `[claude-completion] Completion request: ${filename}:${params.position.line}:${params.position.character}`
    );
    console.error(`[claude-completion] Prefix: "${prefix}"`);

    // Get immediate buffer completions
    const bufferCompletions = getBasicCompletions(text, prefix);

    // Cancel any existing request for this document
    const requestKey = uri;
    const existingRequest = pendingRequests.get(requestKey);
    if (existingRequest) {
      existingRequest.abort();
    }

    // Create abort controller for this request
    const abortController = new AbortController();
    pendingRequests.set(requestKey, abortController);

    try {
      // Use reduced context for faster processing
      const context = getContextAroundCursor(text, params.position.line, 30);

      // Optimized prompt - shorter and more direct
      const promptText = `Complete code at cursor. Prefix: "${prefix}"

\`\`\`${language}
${context}
\`\`\`

JSON array only: [{"label":"completion","detail":"desc","kind":"function|variable|class"}]`;

      const sdkOptions: Options = {
        model: "claude-haiku-4-5",
        maxTurns: 1,
      };

      // Race between Claude response and a short timeout
      // Return buffer completions quickly, Claude completions if fast enough
      const claudePromise = (async () => {
        let accumulated = "";

        for await (const message of query({
          prompt: promptText,
          options: sdkOptions,
        })) {
          // Check if request was cancelled
          if (abortController.signal.aborted) {
            console.error("[claude-completion] Request cancelled");
            return [];
          }

          if (message.type === "result") {
            const msg = message as {
              type: string;
              is_error?: boolean;
              result?: string;
            };
            if (!msg.is_error && msg.result) {
              const completions = parseCompletions(msg.result);
              const elapsed = Date.now() - startTime;
              console.error(
                `[claude-completion] Got ${completions.length} completions in ${elapsed}ms`
              );
              return completions;
            }
          }

          // Try to parse incrementally from assistant messages
          if (message.type === "assistant") {
            const betaMessage = (message as any).message;
            if (betaMessage?.content) {
              for (const block of betaMessage.content) {
                if (block.type === "text") {
                  accumulated += block.text;
                  // Try to parse as soon as we have what looks like complete JSON
                  if (accumulated.includes("[{") && accumulated.includes("}]")) {
                    const completions = parseCompletions(accumulated);
                    if (completions.length > 0) {
                      const elapsed = Date.now() - startTime;
                      console.error(
                        `[claude-completion] Early parse: ${completions.length} completions in ${elapsed}ms`
                      );
                      return completions;
                    }
                  }
                }
              }
            }
          }
        }

        // Final attempt to parse accumulated text
        if (accumulated) {
          return parseCompletions(accumulated);
        }
        return [];
      })();

      // Use a short timeout - if Claude is slow, return buffer completions
      // and mark as incomplete so the editor might re-request
      const timeoutPromise = new Promise<CompletionItem[]>((resolve) => {
        setTimeout(() => {
          console.error("[claude-completion] Timeout - returning buffer completions");
          resolve([]);
        }, 8000); // 8 second timeout (SDK has ~6-7s baseline)
      });

      const claudeCompletions = await Promise.race([
        claudePromise,
        timeoutPromise,
      ]);

      // Clean up
      pendingRequests.delete(requestKey);

      // Combine results - Claude completions first, then buffer
      const allCompletions: CompletionItem[] = [];

      // Add Claude completions with high priority
      for (const item of claudeCompletions) {
        allCompletions.push({
          ...item,
          sortText: "a" + item.label, // Sort Claude completions first
        });
      }

      // Add buffer completions as fallback
      for (const item of bufferCompletions) {
        // Don't duplicate items
        if (!allCompletions.some((c) => c.label === item.label)) {
          allCompletions.push(item);
        }
      }

      const elapsed = Date.now() - startTime;
      console.error(
        `[claude-completion] Returning ${allCompletions.length} completions (${claudeCompletions.length} Claude, ${bufferCompletions.length} buffer) in ${elapsed}ms`
      );

      return {
        isIncomplete: claudeCompletions.length === 0, // Re-request if no Claude results
        items: allCompletions,
      };
    } catch (error) {
      pendingRequests.delete(requestKey);
      console.error("[claude-completion] Error:", error);
      return { isIncomplete: false, items: bufferCompletions };
    }
  }
);

// Start listening
connection.listen();

console.error("[claude-completion] Server started and listening");
