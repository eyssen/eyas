#!/usr/bin/env bun
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { existsSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const projectName = process.argv[2] ?? "my-eyas";
const targetDir = join(process.cwd(), projectName);

// Exit with error if directory already exists
if (existsSync(targetDir)) {
  console.error(`Error: Directory "${projectName}" already exists.`);
  process.exit(1);
}

console.log(`\nCreating EYAS project: ${projectName}\n`);

// Create directory structure
const dirs = [
  targetDir,
  join(targetDir, "config"),
  join(targetDir, "config", "skills"),
  join(targetDir, "data"),
];

for (const dir of dirs) {
  mkdirSync(dir, { recursive: true });
}

const createdFiles: string[] = [];

// Copy templates
const templatesDir = join(__dirname, "templates");

const configYaml = readFileSync(join(templatesDir, "config.yaml"), "utf-8");
writeFileSync(join(targetDir, "config", "default.yaml"), configYaml);
createdFiles.push("config/default.yaml");

const dockerCompose = readFileSync(join(templatesDir, "docker-compose.yml"), "utf-8");
writeFileSync(join(targetDir, "docker-compose.yml"), dockerCompose);
createdFiles.push("docker-compose.yml");

// Create package.json
const packageJson = {
  name: projectName,
  version: "0.1.0",
  type: "module",
  scripts: {
    start: "eyas serve",
    doctor: "eyas doctor",
  },
  dependencies: {
    eyas: "latest",
  },
};
writeFileSync(join(targetDir, "package.json"), JSON.stringify(packageJson, null, 2) + "\n");
createdFiles.push("package.json");

// Create .gitignore
const gitignore = [
  "node_modules/",
  "data/",
  "*.db",
  "*.db-wal",
  "*.db-shm",
  ".env",
  "master.key",
  "",
].join("\n");
writeFileSync(join(targetDir, ".gitignore"), gitignore);
createdFiles.push(".gitignore");

// Print summary
console.log("Created files:");
for (const file of createdFiles) {
  console.log(`  ${projectName}/${file}`);
}

console.log(`
Next steps:

  cd ${projectName}
  bun install
  bun start
`);
