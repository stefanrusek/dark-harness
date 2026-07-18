const PROCESS_LOCK_KEY = Symbol.for("dh.test.processLock");

type ProcessLockState = {
  tail: Promise<void>;
};

function getProcessLockState(): ProcessLockState {
  const globalAny = globalThis as typeof globalThis & {
    [PROCESS_LOCK_KEY]?: ProcessLockState;
  };
  let state = globalAny[PROCESS_LOCK_KEY];
  if (!state) {
    state = { tail: Promise.resolve() };
    globalAny[PROCESS_LOCK_KEY] = state;
  }
  return state;
}

export async function withProcessMutationLock<T>(run: () => Promise<T> | T): Promise<T> {
  const state = getProcessLockState();
  const previous = state.tail;
  let release!: () => void;
  state.tail = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await run();
  } finally {
    release();
  }
}
