// DH-0060 spike — interactive boot for agent-driven verification.
//
// The scripted spikes (spike-*.ts) drive one fixed scenario each. This script instead stands
// the whole rig up — compiled binary, mock provider, temp workspace, tmux session — and then
// GETS OUT OF THE WAY, printing the exact tmux commands a verification sub-agent (or a human)
// can use to drive the TUI by hand and take its own text screenshots:
//
//   bun e2e/spikes/tui/interactive-boot.ts --text "reply for turn 1" --text "reply for turn 2"
//   # ... prints SPIKE-TUI-READY plus a session name, then stays alive ...
//   tmux send-keys -t <session> -l 'hello there'   # type text
//   tmux send-keys -t <session> Enter              # press a key (Left/Right/Home/End/C-c/...)
//   tmux capture-pane -t <session> -p              # plain-text screenshot
//   tmux capture-pane -t <session> -e -p           # screenshot with ANSI escapes
//   tmux kill-session -t <session>                 # done (also ends this script)
//
// Each --text becomes one scripted mock-model reply, consumed in order per exchange (the last
// one repeats if the conversation goes longer). For tool calls / errors / token counts, pass
// --turns <file.json> with an array of MockTurn objects (see e2e/support/mock-provider.ts)
// instead. The script exits and cleans up when the tmux session ends or after --ttl seconds
// (default 300), whichever comes first.

import { ensureBuilt } from "../../support/build.ts";
import type { MockTurn } from "../../support/mock-provider.ts";
import { startMockAnthropicProvider, successTurn } from "../../support/mock-provider.ts";
import { startTmuxSession } from "../../support/tmux-pty.ts";
import { baseConfig, createWorkspace } from "../../support/workspace.ts";

interface CliArgs {
  texts: string[];
  turnsFile: string | null;
  ttlSeconds: number;
  cols: number;
  rows: number;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { texts: [], turnsFile: null, ttlSeconds: 300, cols: 100, rows: 30 };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (value === undefined) {
      throw new Error(`missing value for ${flag}`);
    }
    switch (flag) {
      case "--text":
        args.texts.push(value);
        break;
      case "--turns":
        args.turnsFile = value;
        break;
      case "--ttl":
        args.ttlSeconds = Number(value);
        break;
      case "--cols":
        args.cols = Number(value);
        break;
      case "--rows":
        args.rows = Number(value);
        break;
      default:
        throw new Error(`unrecognized argument ${JSON.stringify(flag)}`);
    }
    i += 1;
  }
  return args;
}

async function loadTurns(args: CliArgs): Promise<MockTurn[]> {
  if (args.turnsFile !== null) {
    return (await Bun.file(args.turnsFile).json()) as MockTurn[];
  }
  if (args.texts.length > 0) {
    return args.texts.map((text) => successTurn(text));
  }
  return [successTurn("Scripted mock reply. (Pass --text or --turns to customize.)")];
}

function tmuxSessionAlive(sessionName: string): boolean {
  const result = Bun.spawnSync({
    cmd: ["tmux", "has-session", "-t", sessionName],
    stdout: "pipe",
    stderr: "pipe",
  });
  return result.exitCode === 0;
}

const args = parseArgs(process.argv.slice(2));
const turns = await loadTurns(args);

const provider = startMockAnthropicProvider(turns);
const ws = createWorkspace("dh-spike-interactive-");
ws.writeConfig(baseConfig(provider.baseURL));
const binaryPath = await ensureBuilt();
const session = startTmuxSession([binaryPath], {
  cwd: ws.dir,
  cols: args.cols,
  rows: args.rows,
});

let cleanedUp = false;
function cleanup(): void {
  if (cleanedUp) return;
  cleanedUp = true;
  session.kill();
  provider.stop();
  ws.cleanup();
}
process.on("SIGINT", () => {
  cleanup();
  process.exit(130);
});
process.on("SIGTERM", () => {
  cleanup();
  process.exit(143);
});

try {
  await session.waitFor((screen) => screen.includes("Dark Harness"));
  await session.waitFor((screen) => screen.includes("Root Agent"));
} catch (error) {
  cleanup();
  throw error;
}

console.log("SPIKE-TUI-READY");
console.log(`session=${session.sessionName}`);
console.log(`workspace=${ws.dir}`);
console.log(`provider=${provider.baseURL}`);
console.log(`scripted turns=${turns.length}`);
console.log("drive it:");
console.log(`  tmux send-keys -t ${session.sessionName} -l 'your message here'`);
console.log(`  tmux send-keys -t ${session.sessionName} Enter`);
console.log(`  tmux capture-pane -t ${session.sessionName} -p`);
console.log(`  tmux capture-pane -t ${session.sessionName} -e -p   # raw ANSI variant`);
console.log(`  tmux kill-session -t ${session.sessionName}         # finish + auto-cleanup`);
console.log(`auto-cleanup after ${args.ttlSeconds}s or when the tmux session ends.`);

const deadline = Date.now() + args.ttlSeconds * 1000;
while (Date.now() < deadline && tmuxSessionAlive(session.sessionName)) {
  await Bun.sleep(2000);
}
cleanup();
console.log("SPIKE-TUI-DONE (session ended or ttl reached; everything cleaned up)");
