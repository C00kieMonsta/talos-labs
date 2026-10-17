import { createContext } from "react";

/** True while the chat's model turn runs; ExplainPanel reads it to refuse a second request (docs/DESIGN-CHAT.md section 6). */
export const ChatStreamContext = createContext<boolean>(false);
