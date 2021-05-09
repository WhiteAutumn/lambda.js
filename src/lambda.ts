import path from "path";
import fs from "fs";

import * as cdk from "@aws-cdk/core";
import * as lambda from "@aws-cdk/aws-lambda";

import { prepareBuild, makeBundlingOptions } from "./build";

interface HashMap<T> {
  [key: string]: T
}

const makeLambdaExcludes = (directory: string, sources: string[], paths: HashMap<fs.Stats>): string[] => {
  const include = [
    ...sources,
    path.join(directory, "package.json")
  ];

  const files = Object.entries(paths);
  let exclude: string[] = [];
  for (const [name, entry] of files) {
    if (entry.isFile()) {
      if (!include.includes(name)) {
        exclude.push(name);
      }
    }
    else {
      const containsNothing = files
        .filter(([it]) => it.startsWith(name))
        .every(([it]) => !include.includes(it));
      
      if (containsNothing) {
        exclude.push(name);
      }
    }
  }

  exclude = exclude
    .map(it => path.relative(directory, it))
    .map(it => it.replace(/\\/g, '/'));

  return [
    ...exclude,
    "node_modules"
  ];
};

export interface FunctionProps extends lambda.FunctionOptions {
  /**
   * 
   */
  entry: string;

  /**
   * 
   */
  function: string;

  /**
   * 
   */
  directory?: string;

  /**
   * 
   */
  inplace?: boolean;

  /**
   * 
   */
  runtime?: lambda.Runtime;
}

export class Function extends lambda.Function {

  public readonly layer?: lambda.LayerVersion;

  constructor(scope: cdk.Construct, id: string, props: FunctionProps) {

    props.entry = path.normalize(props.entry);

    const {
      entry,
      function: func,
      directory = path.dirname(entry),
      inplace = false,
      runtime = lambda.Runtime.NODEJS_14_X,
      ...functionProps
    } = props;

    const preparation = prepareBuild({ runtime, entry, directory, inplace });

    const code = lambda.Code.fromAsset(directory, {
      exclude: makeLambdaExcludes(directory, preparation.info.sources, preparation.cache.paths)
    })

    const handler = `${path.parse(entry).name}.${func}`;

    super(scope, id, {
      runtime,
      code,
      handler,
      ...functionProps,
    });

    if (preparation.hasDependencies) {

      this.layer = new lambda.LayerVersion(scope, `${id}Layer`, {
        code: lambda.Code.fromAsset(directory, {
          exclude: ["*", "!package.json", "!package-lock.json"],
          bundling: makeBundlingOptions({ build: preparation.build, dependencies: preparation.dependencies }, [
            "mkdir /asset-output/nodejs",
            "node /lambda.js/writeDependencies.js",
            "cd /asset-output/nodejs",
            "npm ci --production > /dev/null"
          ])
        })
      }); 

      this.addLayers(this.layer);
    }
  }
}
