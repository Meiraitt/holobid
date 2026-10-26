import config from './jest.config.mjs';

export default {
  ...config,
  testMatch: ['<rootDir>/test/database/**/*.spec.ts'],
  testPathIgnorePatterns: ['/node_modules/'],
  testTimeout: 15_000,
};
