const path = require("path");
const fs = require("fs");

const input = JSON.parse(Buffer.from(process.env.LAMBDAJS_AGENT_INPUT, "base64").toString("utf-8"));

fs.writeFileSync(path.join(process.env.LAMBDAJS_AGENT_OUTPUT, "package.json"), JSON.stringify(input.packageJson, null, 2));
fs.writeFileSync(path.join(process.env.LAMBDAJS_AGENT_OUTPUT, "package-lock.json"), JSON.stringify(input.packageLock, null, 2));

for (const dependency of Object.keys(input.packageJson.dependencies)) {
  console.log(`+ ${dependency}`);
}
