/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: "node",
  testMatch: ["<rootDir>/src/**/*.spec.ts"],
  clearMocks: true,
  // Emulator tests can take longer to connect/tear down than jest's
  // 5s default, especially on a cold CI runner.
  testTimeout: 20000,
  transform: {
    "^.+\\.tsx?$": ["ts-jest", {tsconfig: "tsconfig.spec.json"}],
  },
};
