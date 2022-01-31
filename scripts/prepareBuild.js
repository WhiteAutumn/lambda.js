const os = require("os");
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

const performDepcheck = async (event) => {
  if (event.cache.depcheck != null) {
    return Promise.resolve(event.cache.depcheck);
  }
  else {
    return require("depcheck")(event.sourceDirectory, {});
  }
};

const performEsbuild = async (event, packageJson) => {
  const temporaryName = uuid();

  const externals = packageJson ? Object.keys(packageJson.dependencies) : [];

  const esbuildParams = {
    entryPoints: [event.entry],
    bundle: true,
    sourcemap: true,
    platform: "node",
    external: [...externals, "aws-sdk"],
    outfile: path.join(temp, `${temporaryName}.js`)
  };

  const result = await esbuild.build(esbuildParams)
    .then(() => fs.promises.readFile(path.join(temp, `${temporaryName}.js.map`)))
    .then(it => JSON.parse(it));


  if (os.platform() == "win32") {
    return result.sources
      .map(it => path.resolve(it));
  }
  else {
    return result.sources
      .map(it => path.normalize(path.join(temp, it)));
  }
};

const scanDependencies = async (event, packageJson, packageLock) => {

  const [depcheckResult, esbuildResult] = await Promise.all([
    performDepcheck(event),
    performEsbuild(event, packageJson)
  ]);

  const used = {};
  for (const [dependency, files] of Object.entries(depcheckResult.using)) {
    for (const file of files) {
      if (esbuildResult.includes(file)) {
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
    sources: esbuildResult,
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

  if (packageJson && !packageLock) {
    console.log("WARN! Found package.json but not package-lock.json, will to install dependencies!");
  }

  if (packageLock && !packageJson) {
    console.log("WARN! Found package-lock.json but not package.json, will not install dependencies!");
  }

  if (!packageJson || !packageLock) {

    console.log(
      Buffer.from(
        JSON.stringify({
          hasDependencies: false,
          dependencyScan: { sources: await performEsbuild(event, packageJson) }
        })
      ).toString("base64")
    );
    return;
  }

  const [dependencyScan, buildDirHash] = await Promise.all([
    scanDependencies(event, packageJson, packageLock),
    makeBuildDir(event)
  ]);

  console.log(
    Buffer.from(
      JSON.stringify({
        hasDependencies: Object.keys(packageJson.dependencies).length > 0,
        dependencyScan, buildDirHash
      })
    ).toString("base64")
  );

})();
