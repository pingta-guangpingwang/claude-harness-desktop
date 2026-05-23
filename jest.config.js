/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/electron/$1',
    // Node16 module resolution: strip .js extension so ts-jest resolves to .ts
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: 'tsconfig.node.json',
    }],
  },
  collectCoverageFrom: [
    'electron/harnessAgent/*.ts',
    '!electron/harnessAgent/*.d.ts',
    '!electron/harnessAgent/*.js',
  ],
  coverageThreshold: {
    global: {
      branches: 50,
      functions: 50,
      lines: 50,
    },
  },
}
