// Monorepo-aware Metro config: @club/shared and @club/db are published as raw
// TypeScript source from the workspace, so Metro has to watch the repo root and
// resolve out of the hoisted root node_modules (see the root .npmrc).
const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

module.exports = config;
