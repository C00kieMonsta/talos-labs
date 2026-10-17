// This block moves into guided/copy.ts (ACTIVITY, and words into CHAT.word) once the other session is done with that file.

/** The activity rows' strings (docs/DESIGN-AGENT.md section 4). Every value is under the banned-word test. */
export const ACTIVITY = {
  rows: {
    preparing: "Getting ready",
    batchAdmin: "Fixing {n} things",
    checking: "Checking it worked",
    watching: "Watching for the change",
    watchCheck: "Checking your Mac",
  },
  /** The participle of every catalogue guided.verb, pinned by a test. */
  verbs: {
    "Turn it on": "Turning it on",
    "Turn it off": "Turning it off",
    "Make it quiet": "Making it quiet",
    "Lock it sooner": "Locking it sooner",
    "Stop sharing it": "Stopping the sharing",
    "Add a password": "Adding a password",
    "Make it private": "Making it private",
    "Show me where": "Showing you where",
    Details: "Showing the details",
  },
  /** The state words; CHAT.word takes them over in the chat build. */
  words: {
    password: "your password",
    running: "{i} of {n}",
    working: "working",
    watching: "watching",
    done: "done",
    didNotChange: "did not change",
    stopped: "stopped",
    couldNotCheck: "couldn't check",
    notChangedYet: "not changed yet",
    noChange: "no change yet",
    same: "same",
    changed: "changed",
    stillOff: "still off",
    nowOn: "now on",
  },
} as const;
