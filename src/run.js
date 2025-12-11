#!/usr/bin/env node

import { InputError, main } from "./main.js"

let {
  OUTPUT_DIR: outputDir,
  EVENTS_DIR: eventsDir,
  TEMPLATE_PATH: templateYamlPath,
  STACK_NAME: stackName,
  STAGE: stage,
  USE_PACKAGE_NAME: usePackageName = true,
} = process.env

if (!stackName && usePackageName) {
  stackName = process.env.npm_package_name
}

if (stage) {
  stackName = `${stackName}-${stage}`
}

main({ argv: process.argv, stackName, outputDir, eventsDir, templateYamlPath }).catch(
  (error) => {
    if (error instanceof InputError) {
      console.error(error.message)
    } else {
      console.error(error)
    }
  }
)
