/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.ts'],
  setupFiles: ['<rootDir>/src/tests/env.setup.ts'],
  setupFilesAfterEnv: ['<rootDir>/src/tests/setup.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: '<rootDir>/tsconfig.json',
    }],
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/tests/**',
    '!src/index.ts',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  verbose: true,
  testTimeout: 30000,
  maxWorkers: 1,
  clearMocks: true,
  restoreMocks: true,
};
