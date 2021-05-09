import path from "path";
import fs from "fs";
import { execSync as exec } from "child_process";

import * as cdk from "@aws-cdk/core";
import lambda from "@aws-cdk/aws-lambda";

import { v4 as uuid } from "uuid";
import temp from "temp-dir";
import walk from "walkdir";

const metaDataPath = path.normalize(path.join(__dirname, "..", ".metadata.json"));
const scriptsPath = path.normalize(path.join(__dirname, "..", "scripts"));
const runtimeCache: any = {};

let metadata: any;
const fetchMetaData = () => {
  if (metadata == null) {
    if (fs.existsSync(metaDataPath)) {
      metadata = JSON.parse(fs.readFileSync(metaDataPath).toString("utf-8"));
    }
    else {
      metadata = {
        hashes: {}
      };
    }
  }
};

const saveMetaData = () => {
  fs.writeFileSync(metaDataPath, JSON.stringify(metadata, null, 2));
};

const makeBuildDirectory = () => {
  const dir = path.join(temp, uuid(), "build");
  fs.mkdirSync(dir, { recursive: true });

  return dir;
};

const makeDockerFile = (runtime: lambda.Runtime) => (`
FROM ${runtime.bundlingImage.image}:latest

COPY writeDependencies.js /lambda.js/writeDependencies.js
`);

const runScriptPrepareBuild = (event: any) => {

  const eventEncoded = Buffer.from(
    JSON.stringify(event)
  ).toString("base64");

  const output = exec(
    `${process.execPath} ${path.join(scriptsPath ,"prepareBuild.js")} ${eventEncoded}
  `);

  try {
    return JSON.parse(Buffer.from(output.toString("utf-8"), "base64").toString("utf-8"));
  }
  catch (e) {
    console.error(output.toString("utf-8"));
    throw new Error("Could not parse result from prepareBuild script!");
  }
};

export interface BuildPreparationOptions {
  runtime: lambda.Runtime;
  entry: string;
  directory: string;
  inplace: boolean;
}

export interface BuildPreparationResult {
  dependencies: {
    packageJson: any;
    packageLock: any;
  };
  build: {
    directory: string;
    hash: string;
  };
  info: {
    sources: string[]
  }
  cache: any
}

export function prepareBuild(options: BuildPreparationOptions): BuildPreparationResult {

  const temporaryDirectory = makeBuildDirectory();
  const dockerfile = makeDockerFile(options.runtime);

  let cache;
  if (runtimeCache[options.directory] != null) {
    cache = runtimeCache[options.directory];
  }

  const scriptResult = runScriptPrepareBuild({
    entry: options.entry,
    sourceDirectory: options.directory,
    buildDirectory: temporaryDirectory,
    files: {
      dockerfile,
      script: fs.readFileSync(path.normalize(path.join(__dirname, "..", "scripts", "writeDependencies.js"))).toString("utf-8")
    },
    cache: cache ?? {},
  });

  if (cache == null) {
    runtimeCache[options.directory] = {
      ...scriptResult.cache,
      paths: walk.sync(options.directory, { return_object: true })
    };

    cache = runtimeCache[options.directory];
  }

  return {
    dependencies: {
      packageJson: scriptResult.dependencyScan.packageJson,
      packageLock: scriptResult.dependencyScan.packageLock,
    },
    build: {
      directory: temporaryDirectory,
      hash: scriptResult.buildDirHash
    },
    info: {
      sources: scriptResult.dependencyScan.sources
    },
    cache
  };
}

export interface BundlingCreationOptions {
  build: {
    directory: string;
    hash: string;
  };
  dependencies: {
    packageJson: any;
    packageLock: any;
  };
}

export function makeBundlingOptions(options: BundlingCreationOptions, commands: string[] = []): cdk.BundlingOptions {

  fetchMetaData();

  let dockerImage: cdk.DockerImage;
  if (metadata.hashes[options.build.hash] != null) {
    dockerImage = cdk.DockerImage.fromRegistry(metadata.hashes[options.build.hash].dockerImage);
  }
  else {
    dockerImage = cdk.DockerImage.fromBuild(options.build.directory);
    metadata.hashes[options.build.hash] = {
      dockerImage: dockerImage.image
    };
  }

  saveMetaData();

  return {
    image: dockerImage,
    command: commands.length > 0 ? ["bash", "-c", commands.join(" && ")] : undefined,
    environment: {
      HOME: "/tmp/home",
      LAMBDAJS_AGENT_INPUT: Buffer.from(JSON.stringify(options.dependencies)).toString("base64"),
      LAMBDAJS_AGENT_OUTPUT: "/asset-output/nodejs"
    }
  }
}

