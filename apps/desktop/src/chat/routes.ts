import type { Route } from "../app/router";

/** The chat route; the app lane adds { name: "chat" } to Route and this cast goes. */
export const CHAT_ROUTE: Route = { name: "chat" } as unknown as Route;
