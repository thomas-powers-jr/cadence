/**
 * Phase 356 (rec-20260822-002): build an MCP tool result's `content` array
 * from the tool's buffered stdout and stderr. Pure, with no runtime import
 * from the MCP SDK.
 *
 * Before this phase the server picked `(stdout || stderr).trimEnd()`, so a
 * tool that printed a stdout line on success (settle prints `Settled <id>`)
 * lost every stderr notice. A plain concatenation would corrupt the JSON
 * report several tools print on stdout under `json: true`, so the first item
 * keeps exactly the pre-356 text and the notices follow as a second item:
 *
 * - first item: `(stdout !== '' ? stdout : stderr).trimEnd()`, or `ok`
 *   (exit code 0) / `failed` (otherwise) when that is empty;
 * - second item: `stderr.trimEnd()`, present only when stdout was non-empty
 *   and stderr has text.
 */
export interface ToolTextItem {
  type: 'text';
  text: string;
}

export function toolResultContent(stdout: string, stderr: string, exitCode: number): ToolTextItem[] {
  const first = (stdout !== '' ? stdout : stderr).trimEnd();
  const content: ToolTextItem[] = [
    { type: 'text', text: first.length > 0 ? first : exitCode === 0 ? 'ok' : 'failed' },
  ];
  const notices = stderr.trimEnd();
  if (stdout !== '' && notices.length > 0) content.push({ type: 'text', text: notices });
  return content;
}
