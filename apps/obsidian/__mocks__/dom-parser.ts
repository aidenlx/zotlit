import { Window } from "happy-dom";
import { afterAll, vi } from "vitest";

// XML readers need a parser while retaining Node's native fetch and Response.
const parserWindow = new Window();
vi.stubGlobal("DOMParser", parserWindow.DOMParser);
afterAll(async () => {
  await parserWindow.happyDOM.close();
  vi.unstubAllGlobals();
});
