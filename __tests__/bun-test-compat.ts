/**
 * Compatibility shim that maps `bun:test` imports to vitest equivalents,
 * allowing tests written for Bun's test runner to execute under Node.js via vitest.
 *
 * Covered APIs (all active test files):
 *   afterEach, beforeEach, describe, expect, test  → vitest equivalents
 *   mock    → vi.fn   (plain mock function factory)
 *   spyOn   → vi.spyOn
 *
 * Not covered — mock.module(): requires Bun's module system for ESM interception
 * and cannot be shimmed. Tests that use it (cli.test.ts) are excluded from the
 * vitest run via vitest.config.ts and continue to run under `bun test`.
 */
import {
  afterEach as _afterEach,
  beforeEach as _beforeEach,
  describe as _describe,
  expect as _expect,
  test as _test,
  vi,
} from "vitest";

export const afterEach = _afterEach;
export const beforeEach = _beforeEach;
export const describe = _describe;
export const expect = _expect;
export const test = _test;
export const mock = vi.fn;
export const spyOn = vi.spyOn;
