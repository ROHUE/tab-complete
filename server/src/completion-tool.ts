/**
 * Claude-powered completion tool using the Agent SDK
 */

import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import {
  CompletionItem,
  CompletionItemKind,
} from "vscode-languageserver/node.js";

// Schema for completion request
const CompletionRequestSchema = {
  buffer_content: z.string().describe("The full content of the current buffer"),
  cursor_line: z.number().describe("Current line number (0-indexed)"),
  cursor_column: z.number().describe("Current column position"),
  language: z.string().describe("Programming language of the file"),
  prefix: z.string().describe("The text before the cursor on the current line"),
  filename: z.string().describe("Name of the file being edited"),
};

// Re-export CompletionItem for convenience
export type { CompletionItem };

/**
 * Create the completion MCP server with Claude-powered tool
 */
export function createCompletionServer() {
  return createSdkMcpServer({
    name: "claude-completions",
    version: "1.0.0",
    tools: [
      tool(
        "get_completions",
        "Generate intelligent code completions based on the current context",
        CompletionRequestSchema,
        async (args) => {
          // Build context for Claude
          const lines = args.buffer_content.split("\n");
          const currentLine = lines[args.cursor_line] || "";

          // Get surrounding context (5 lines before and after)
          const startLine = Math.max(0, args.cursor_line - 5);
          const endLine = Math.min(lines.length, args.cursor_line + 5);
          const context = lines.slice(startLine, endLine).join("\n");

          const prompt = `You are a code completion assistant. Given the following ${args.language} code context, suggest completions for the cursor position.

File: ${args.filename}
Language: ${args.language}
Current line: ${currentLine}
Prefix being typed: "${args.prefix}"

Surrounding context:
\`\`\`${args.language}
${context}
\`\`\`

Generate 5-10 relevant completions. For each completion, provide:
1. The text to insert
2. A brief description
3. The kind (function, variable, class, keyword, snippet, etc.)

Return as JSON array with format:
[{"label": "completion_text", "detail": "brief description", "kind": "function|variable|class|keyword|snippet"}]

Only return the JSON array, no other text.`;

          // Return the prompt - Claude will process this
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  prompt,
                  context: {
                    language: args.language,
                    filename: args.filename,
                    line: args.cursor_line,
                    column: args.cursor_column,
                  },
                }),
              },
            ],
          };
        }
      ),
    ],
  });
}

/**
 * Parse Claude's response into completion items
 */
export function parseCompletions(response: string): CompletionItem[] {
  try {
    // Try to extract JSON from the response
    const jsonMatch = response.match(/\[[\s\S]*?\]/);
    if (!jsonMatch) {
      return [];
    }

    const items = JSON.parse(jsonMatch[0]);

    // Map kinds to LSP CompletionItemKind values
    const kindMap: Record<string, CompletionItemKind> = {
      function: CompletionItemKind.Function,
      method: CompletionItemKind.Method,
      variable: CompletionItemKind.Variable,
      class: CompletionItemKind.Class,
      interface: CompletionItemKind.Interface,
      module: CompletionItemKind.Module,
      property: CompletionItemKind.Property,
      keyword: CompletionItemKind.Keyword,
      snippet: CompletionItemKind.Snippet,
      text: CompletionItemKind.Text,
      field: CompletionItemKind.Field,
      constant: CompletionItemKind.Constant,
    };

    return items.map((item: { label: string; detail?: string; kind?: string }) => ({
      label: item.label,
      detail: item.detail,
      kind: kindMap[item.kind?.toLowerCase() || "text"] || CompletionItemKind.Text,
      insertText: item.label,
    }));
  } catch {
    console.error("Failed to parse completions:", response);
    return [];
  }
}
