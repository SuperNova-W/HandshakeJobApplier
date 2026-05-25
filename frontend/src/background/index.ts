import { createInitialRuntimeState } from "../shared/constants";
import type { ExtensionMessage, ExtensionResponse, RuntimeState } from "../shared/contracts";

const runtimeState: RuntimeState = createInitialRuntimeState();

function respond(sendResponse: (response: ExtensionResponse) => void, response: ExtensionResponse) {
  sendResponse(response);
}

chrome.runtime.onInstalled.addListener(() => {
  console.log("[background] Frontend scaffold installed");
});

chrome.runtime.onStartup.addListener(() => {
  console.log("[background] Service worker started");
});

chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
  switch (message.type) {
    case "runtime/get":
      respond(sendResponse, { ok: true, state: runtimeState });
      return;

    case "runtime/start-placeholder":
      runtimeState.runStatus = "RUNNING";
      runtimeState.startedAt = new Date().toISOString();
      runtimeState.lastError = null;
      runtimeState.appliedCount = 0;
      runtimeState.skippedCount = 0;
      runtimeState.failedCount = 0;
      respond(sendResponse, { ok: true, state: runtimeState });
      return;

    case "runtime/stop-placeholder":
      runtimeState.runStatus = "STOPPED";
      respond(sendResponse, { ok: true, state: runtimeState });
      return;

    default:
      respond(sendResponse, { ok: false, error: "Unknown message type" });
  }
});
