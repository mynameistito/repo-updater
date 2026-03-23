// Test approach for Bun fallback
// 1. Mock Bun as undefined globally
// 2. Spy on openURLNodejs (which is imported)
// 3. Call openURLs
// 4. Verify openURLNodejs was called

// This is the correct approach since we import openURLNodejs directly
