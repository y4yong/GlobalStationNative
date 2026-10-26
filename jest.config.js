module.exports = {
  preset: '@react-native/jest-preset',
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/api/'],
  moduleNameMapper: {
    '^@react-native-documents/picker$': '<rootDir>/__mocks__/documentPicker.js',
    '^react-native-blob-util$': '<rootDir>/__mocks__/blobUtil.js',
  },
};
