// The one place this app speaks INTO a file panel's frame, in a module of its own so the
// `sonarjs/post-message` exception it needs covers this call and nothing else.
//
// The rule wants a target origin, and here there is none to name: the page is
// `sandbox="allow-scripts"` with no `allow-same-origin`, so its origin is opaque, `postMessage`
// takes a URL, and "null" is not one. `"*"` is the only spelling there is — the Markdown preview's
// reply has the same shape for the same reason (useMdPreviewScroll.ts). What is sent is addressed
// to a window this app created and holds, and carries nothing the page could not already ask for.
import { FILE_PANEL_FROM_HOST, type FilePanelHostMessage } from "../../common/filePanels";

export function postToFilePanel(frame: HTMLIFrameElement | null, message: FilePanelHostMessage): void {
  frame?.contentWindow?.postMessage({ source: FILE_PANEL_FROM_HOST, ...message }, "*");
}
