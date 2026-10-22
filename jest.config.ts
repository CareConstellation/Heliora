import type { Config } from 'jest';

const config: Config = {
  testEnvironment: 'jest-environment-jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  transform: {
    '^.+\\.(ts|tsx)$': [
      'ts-jest',
      {
        tsconfig: {
          jsx: 'react-jsx',
        },
      },
    ],
    // @scure/bip39 and @noble/hashes ship ESM only; compile them to CommonJS for Jest.
    '^.+\\.js$': ['ts-jest', { tsconfig: { allowJs: true } }],
  },
  transformIgnorePatterns: ['/node_modules/(?!(@scure|@noble)/)'],
  moduleNameMapper: {
    '^@/lib/cryptoWorkerApi$': '<rootDir>/src/__mocks__/cryptoWorkerApi.ts',
    '^@/(.*)$': '<rootDir>/src/$1',
    // stub Next.js internals & CSS
    '^next/navigation$': '<rootDir>/src/__mocks__/next/navigation.ts',
    '\\.css$': '<rootDir>/src/__mocks__/styleMock.ts',
  },
  testMatch: ['**/__tests__/**/*.test.{ts,tsx}'],
  collectCoverageFrom: ['src/**/*.{ts,tsx}', '!src/**/*.d.ts', '!src/__mocks__/**'],
};

export default config;
