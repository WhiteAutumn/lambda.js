const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");
const temp = require("temp-dir");
const { v4: uuid } = require("uuid");
const { hashElement } = require("folder-hash");
const { parse, fabricate } = require("package-lock-parser"); 

const eventFromArgs = () => {
  const [raw] = process.argv.slice(2);
  return JSON.parse(Buffer.from(raw, "base64").toString("utf-8"));
};

const scanDependencies = async (event, packageJson, packageLock) => {

  let depcheckRequest;
  if (event.cache.depcheck != null) {
    depcheckRequest = Promise.resolve(event.cache.depcheck);
  }
  else {
    depcheckRequest = require("depcheck")(event.sourceDirectory, {})
  }

  const temporaryName = uuid();

  const esbuildParams = {
    entryPoints: [event.entry],
    bundle: true,
    sourcemap: true,
    external: Object.keys(packageJson.dependencies),
    outfile: path.join(temp, `${temporaryName}.js`)
  };

  const esbuildRequest = esbuild.build(esbuildParams)
    .then(() => fs.promises.readFile(path.join(temp, `${temporaryName}.js.map`)))
    .then(it => JSON.parse(it));

  const [esbuildResult, depcheckResult] = await Promise.all([
    esbuildRequest,
    depcheckRequest
  ]);

  const sources = esbuildResult.sources
    .map(it => path.resolve(it));

  const used = {};
  for (const [dependency, files] of Object.entries(depcheckResult.using)) {
    for (const file of files) {
      if (sources.includes(file)) {
        used[dependency] = true;
      }
    }
  }

  const dependencyTree = parse(packageLock);
  for (const dependency of Object.keys(dependencyTree.dependencies || {})) {
    if (!used[dependency]) {
      delete dependencyTree.dependencies[dependency];
    }
  }

  const fabricatedPackageLock = fabricate(dependencyTree);

  for (const dependency of Object.keys(packageJson.dependencies || {})) {
    if (!used[dependency]) {
      delete packageJson.dependencies[dependency];
    }
  }

  return {
    packageJson: packageJson,
    packageLock: fabricatedPackageLock,
    sources,
    cache: {
      depcheck: depcheckResult
    }
  };
};

const makeBuildDir = async (event) => {
  await Promise.all([
    fs.promises.writeFile(path.join(event.buildDirectory, "Dockerfile"), event.files.dockerfile),
    fs.promises.writeFile(path.join(event.buildDirectory, "writeDependencies.js"), event.files.script),
  ]);

  const { hash } = await hashElement(event.buildDirectory);

  return hash;
};

(async () => {

  const event = eventFromArgs();

  const [packageJson, packageLock] = await Promise.all([

    fs.promises.readFile(path.join(event.sourceDirectory, "package.json"))
      .then(it => JSON.parse(it))
      .catch(() => false),

    fs.promises.readFile(path.join(event.sourceDirectory, "package-lock.json"))
      .then(it => JSON.parse(it))
      .catch(() => false)

  ]);

  if (!packageJson || !packageLock) {
    return;
  }

  const [dependencyScan, buildDirHash] = await Promise.all([
    scanDependencies(event, packageJson, packageLock),
    makeBuildDir(event)
  ]);

  console.log(
    Buffer.from(
      JSON.stringify({ dependencyScan, buildDirHash })
    ).toString("base64")
  );

})();
