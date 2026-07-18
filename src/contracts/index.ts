// Single source of wire truth (CLAUDE.md §3, §6). Every domain imports types from here;
// nothing redeclares a wire type locally. Changes here are an architect-escalation trigger.

export * from "./commands.type.ts";
export * from "./config.type.ts";
export * from "./events.type.ts";
export * from "./exit-codes.constant.ts";
export * from "./log.type.ts";
export * from "./outcome.ts";
