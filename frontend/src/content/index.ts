import { inferPageSupport } from "../shared/handshake";

const pageSupport = inferPageSupport(window.location.href);

console.log("[content] Scaffold loaded", {
  url: window.location.href,
  pageSupport
});
