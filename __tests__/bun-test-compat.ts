/**
 * Compatibility shim that maps `bun:test` imports to vitest equivalents,
 * allowing tests written for Bun's test runner to execute under Node.js via vitest.
 *
 * Covered APIs:
 *   afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, test  → vitest equivalents
 *   mock    → vi.fn   (plain mock function factory)
 *   spyOn   → vi.spyOn
 *
 * Not covered — mock.module(): requires Bun's module system for ESM interception
 * and cannot be shimmed; calling it throws a descriptive error. Tests that use
 * it (cli.test.ts) are excluded from the vitest run via vitest.config.ts and
 * continue to run under `bun test`.
 */
import { vi } from "vitest";

export {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  test,
} from "vitest";
const mock = Object.assign(vi.fn, {
  module: (..._args: unknown[]): never => {
    throw new Error(
      "mock.module() is not supported in the Vitest/Node.js shim. " +
        "Use vi.mock() or vi.doMock() instead."
    );
  },
});

export { mock };
// Bound to `vi` so the `this` context is preserved when called as a standalone function.
export const spyOn = vi.spyOn.bind(vi);
