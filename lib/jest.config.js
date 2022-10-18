const esModules = [".pnpm/uuid"].join("|")

module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  transformIgnorePatterns: [`/node_modules/(?!${esModules})`],
}
