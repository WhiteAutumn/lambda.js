import path from "path";
import fs from "fs";

import * as cdk from "@aws-cdk/core";
import * as lambda from "@aws-cdk/aws-lambda";

import { prepareBuild, makeBundlingOptions } from "./build";

interface HashMap<T> {
  [key: string]: T
}

export interface FunctionProps extends lambda.FunctionOptions {
  /**
   * 
   */
  entry: string;

  /**
   * 
   */
  handler: string;

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

    const include = [
      ...preparation.info.sources,
      path.join(directory, "package.json")
    ];      

    const code = lambda.Code.fromAsset(directory, {
      exclude: (Object.entries(preparation.cache.paths as HashMap<fs.Stats>))
        .filter(([_, it]) => it.isFile())
        .map(([path]) => path)
        .filter(it => !include.includes(it))
        .map(it => path.relative(directory, it))
        .map(it => it.replace(/\\/g, '/')),
    });

    super(scope, id, {
      runtime,
      code,
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
